// Notion Rich Text tools: build_rich_text, append_rich_text_paragraph,
//   append_mention_block, append_inline_equation, get_page_plain_text,
//   search_page_content, extract_headings_outline
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const RichTextPartSchema = z.object({
  content: z.string().describe("Text content for this segment"),
  bold: z.boolean().optional().describe("Bold formatting"),
  italic: z.boolean().optional().describe("Italic formatting"),
  strikethrough: z.boolean().optional().describe("Strikethrough formatting"),
  underline: z.boolean().optional().describe("Underline formatting"),
  code: z.boolean().optional().describe("Inline code formatting"),
  color: z.string().optional().describe(
    "Text color. Values: default, gray, brown, orange, yellow, green, blue, purple, pink, red, " +
    "or append _background for background: gray_background, blue_background, etc."
  ),
  href: z.string().optional().describe("URL to link this text to"),
});

const BuildRichTextSchema = z.object({
  parts: z.array(RichTextPartSchema).min(1).describe(
    "Array of rich text segments. Each segment can have different formatting. " +
    "Example: [{content:'Hello ',bold:true},{content:'world',italic:true,color:'blue'}]"
  ),
});

const AppendRichTextParagraphSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append to"),
  parts: z.array(RichTextPartSchema).min(1).describe(
    "Array of rich text parts for the paragraph. Mix formatting freely. " +
    "E.g. [{content:'Important: ',bold:true,color:'red'},{content:'read this carefully.',italic:true}]"
  ),
  after: z.string().optional().describe("Block ID to insert after (default: end of parent)"),
});

const AppendMentionBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append to"),
  mention_type: z.enum(["page", "database", "user", "date"]).describe(
    "Type of mention: 'page' (link to a Notion page), 'database' (link to a database), 'user' (mention a user), 'date' (insert a date)"
  ),
  target_id: z.string().optional().describe("Page ID, database ID, or user ID to mention (required for page/database/user mentions)"),
  date: z.string().optional().describe("ISO 8601 date string for date mentions. E.g. '2024-12-31' or '2024-12-31T10:00:00.000Z'"),
  prefix_text: z.string().optional().describe("Text to prepend before the mention in the same paragraph"),
  suffix_text: z.string().optional().describe("Text to append after the mention in the same paragraph"),
  after: z.string().optional().describe("Block ID to insert after (default: end of parent)"),
});

const AppendInlineEquationSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append to"),
  equation: z.string().describe("LaTeX expression for the inline equation. E.g. 'x^2 + y^2 = r^2'"),
  prefix_text: z.string().optional().describe("Regular text to prepend before the equation"),
  suffix_text: z.string().optional().describe("Regular text to append after the equation"),
  after: z.string().optional().describe("Block ID to insert after (default: end of parent)"),
});

const GetPagePlainTextSchema = z.object({
  page_id: z.string().describe("Page ID to extract plain text from"),
  max_depth: z.number().min(1).max(5).optional().default(2).describe("Maximum nesting depth to recurse into (default 2)"),
  separator: z.string().optional().default("\n").describe("String to use between blocks (default: newline)"),
});

const SearchPageContentSchema = z.object({
  page_id: z.string().describe("Page ID to search within"),
  query: z.string().describe("Text to search for within the page content (case-insensitive)"),
  max_depth: z.number().min(1).max(5).optional().default(3).describe("Maximum nesting depth to search (default 3)"),
});

const ExtractHeadingsOutlineSchema = z.object({
  page_id: z.string().describe("Page ID to extract headings from"),
  include_h1: z.boolean().optional().default(true).describe("Include H1 (heading_1) blocks"),
  include_h2: z.boolean().optional().default(true).describe("Include H2 (heading_2) blocks"),
  include_h3: z.boolean().optional().default(true).describe("Include H3 (heading_3) blocks"),
});

// ============ Helpers ============

function buildRichTextPart(part: z.infer<typeof RichTextPartSchema>): Record<string, unknown> {
  const annotations: Record<string, unknown> = {};
  if (part.bold !== undefined) annotations.bold = part.bold;
  if (part.italic !== undefined) annotations.italic = part.italic;
  if (part.strikethrough !== undefined) annotations.strikethrough = part.strikethrough;
  if (part.underline !== undefined) annotations.underline = part.underline;
  if (part.code !== undefined) annotations.code = part.code;
  if (part.color) annotations.color = part.color;

  const textObj: Record<string, unknown> = { content: part.content };
  if (part.href) textObj.link = { url: part.href };

  return {
    type: "text",
    text: textObj,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  };
}

function extractPlainText(block: Record<string, unknown>): string {
  const btype = block.type as string;
  if (!btype) return "";
  const content = block[btype] as Record<string, unknown> | undefined;
  if (!content) return "";
  const richText = content.rich_text as Array<{ plain_text?: string }> | undefined;
  if (!richText) return "";
  return richText.map((rt) => rt.plain_text || "").join("");
}

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "build_rich_text",
      title: "Build Rich Text",
      description:
        "Helper tool that constructs a Notion rich_text array from a structured list of text parts with mixed formatting. Returns the rich_text array you can embed in block content. Use this to compose complex formatted text before using append_blocks.",
      inputSchema: {
        type: "object",
        properties: {
          parts: {
            type: "array",
            items: { type: "object" },
            description: "Text segments with formatting. Each: {content, bold?, italic?, strikethrough?, underline?, code?, color?, href?}",
          },
        },
        required: ["parts"],
      },
      outputSchema: {
        type: "object",
        properties: {
          rich_text: { type: "array", items: { type: "object" } },
          plain_text: { type: "string" },
          segment_count: { type: "number" },
        },
        required: ["rich_text", "plain_text"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "append_rich_text_paragraph",
      title: "Append Rich Text Paragraph",
      description:
        "Append a paragraph block with mixed rich text formatting to a Notion page. Lets you mix bold, italic, colored, code, and linked text in a single paragraph — simpler than building raw block JSON.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          parts: {
            type: "array",
            items: { type: "object" },
            description: "Text segments. Each: {content, bold?, italic?, strikethrough?, underline?, code?, color?, href?}",
          },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "parts"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_mention_block",
      title: "Append Mention Block",
      description:
        "Append a paragraph block containing a @mention — either a page, database, user, or date mention. Optionally add prefix/suffix text around the mention. Great for creating inter-page links, action items assigned to users, or dated references.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          mention_type: {
            type: "string",
            enum: ["page", "database", "user", "date"],
            description: "Type of mention: page, database, user, or date",
          },
          target_id: { type: "string", description: "Page/database/user ID to mention (required for page/database/user)" },
          date: { type: "string", description: "ISO 8601 date for date mention. E.g. '2024-12-31'" },
          prefix_text: { type: "string", description: "Text before the mention" },
          suffix_text: { type: "string", description: "Text after the mention" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "mention_type"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_inline_equation",
      title: "Append Inline Equation",
      description:
        "Append a paragraph block containing an inline LaTeX math equation — optionally with surrounding text. Inline equations render inline within the text flow (use append_equation_block for a standalone block-level equation).",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          equation: { type: "string", description: "LaTeX math expression. E.g. 'E = mc^2'" },
          prefix_text: { type: "string", description: "Text before the equation" },
          suffix_text: { type: "string", description: "Text after the equation" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "equation"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_page_plain_text",
      title: "Get Page Plain Text",
      description:
        "Recursively fetch all text content from a Notion page and return it as clean plain text. Strips all formatting and block structure — perfect for summarization, text analysis, or feeding to LLMs. Handles nested blocks up to max_depth.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to extract text from" },
          max_depth: { type: "number", description: "Max recursion depth (1-5, default 2)" },
          separator: { type: "string", description: "Separator between blocks (default: newline)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          plain_text: { type: "string" },
          block_count: { type: "number" },
          character_count: { type: "number" },
        },
        required: ["page_id", "plain_text"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "search_page_content",
      title: "Search Page Content",
      description:
        "Search for text within a specific Notion page's block content. Returns all blocks that contain the query string with their types and context. Useful for finding specific content within a known page without reading all blocks manually.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to search within" },
          query: { type: "string", description: "Text to search for (case-insensitive)" },
          max_depth: { type: "number", description: "Max recursion depth (1-5, default 3)" },
        },
        required: ["page_id", "query"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          query: { type: "string" },
          matches: { type: "array", items: { type: "object" } },
          match_count: { type: "number" },
        },
        required: ["page_id", "query", "matches", "match_count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "extract_headings_outline",
      title: "Extract Headings Outline",
      description:
        "Extract all heading blocks (H1, H2, H3) from a Notion page to build a structured outline/table of contents. Returns headings in order with their text and level. Useful for navigation, summarization, or generating table of contents.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to extract headings from" },
          include_h1: { type: "boolean", description: "Include H1 headings (default: true)" },
          include_h2: { type: "boolean", description: "Include H2 headings (default: true)" },
          include_h3: { type: "boolean", description: "Include H3 headings (default: true)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          outline: { type: "array", items: { type: "object" } },
          heading_count: { type: "number" },
        },
        required: ["page_id", "outline"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    build_rich_text: async (args) => {
      const { parts } = BuildRichTextSchema.parse(args);
      const richText = parts.map(buildRichTextPart);
      const plainText = parts.map((p) => p.content).join("");
      const structured = {
        rich_text: richText,
        plain_text: plainText,
        segment_count: richText.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    append_rich_text_paragraph: async (args) => {
      const params = AppendRichTextParagraphSchema.parse(args);
      const richText = params.parts.map(buildRichTextPart);
      const paragraphBlock = {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText },
      };
      const body: Record<string, unknown> = { children: [paragraphBlock] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_rich_text_paragraph", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_rich_text_paragraph", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_mention_block: async (args) => {
      const params = AppendMentionBlockSchema.parse(args);
      const richText: Record<string, unknown>[] = [];

      if (params.prefix_text) {
        richText.push({ type: "text", text: { content: params.prefix_text } });
      }

      let mention: Record<string, unknown>;
      switch (params.mention_type) {
        case "page":
          if (!params.target_id) throw new Error("target_id required for page mention");
          mention = { type: "page", page: { id: params.target_id } };
          break;
        case "database":
          if (!params.target_id) throw new Error("target_id required for database mention");
          mention = { type: "database", database: { id: params.target_id } };
          break;
        case "user":
          if (!params.target_id) throw new Error("target_id required for user mention");
          mention = { type: "user", user: { object: "user", id: params.target_id } };
          break;
        case "date":
          if (!params.date) throw new Error("date required for date mention");
          mention = { type: "date", date: { start: params.date } };
          break;
        default:
          throw new Error(`Unknown mention_type: ${params.mention_type}`);
      }

      richText.push({ type: "mention", mention });

      if (params.suffix_text) {
        richText.push({ type: "text", text: { content: params.suffix_text } });
      }

      const block = {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText },
      };
      const body: Record<string, unknown> = { children: [block] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_mention_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_mention_block", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_inline_equation: async (args) => {
      const params = AppendInlineEquationSchema.parse(args);
      const richText: Record<string, unknown>[] = [];

      if (params.prefix_text) {
        richText.push({ type: "text", text: { content: params.prefix_text } });
      }

      richText.push({ type: "equation", equation: { expression: params.equation } });

      if (params.suffix_text) {
        richText.push({ type: "text", text: { content: params.suffix_text } });
      }

      const block = {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText },
      };
      const body: Record<string, unknown> = { children: [block] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_inline_equation", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_inline_equation", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_page_plain_text: async (args) => {
      const params = GetPagePlainTextSchema.parse(args);
      let blockCount = 0;
      const textParts: string[] = [];

      const fetchAndExtract = async (blockId: string, depth: number) => {
        if (depth > params.max_depth) return;
        let cursor: string | undefined;
        do {
          const qs = new URLSearchParams({ page_size: "100" });
          if (cursor) qs.set("start_cursor", cursor);
          const response = await logger.time("tool.get_page_plain_text.fetch", () =>
            client.get<Record<string, unknown>>(`/blocks/${blockId}/children?${qs}`)
          , { tool: "get_page_plain_text", blockId, depth });

          const results = (response.results as Record<string, unknown>[]) || [];
          for (const block of results) {
            blockCount++;
            const text = extractPlainText(block);
            if (text) textParts.push(text);
            if (block.has_children && depth < params.max_depth) {
              await fetchAndExtract(block.id as string, depth + 1);
            }
          }
          cursor = response.next_cursor as string | undefined;
        } while (cursor);
      };

      await fetchAndExtract(params.page_id, 1);

      const plainText = textParts.join(params.separator);
      const structured = {
        page_id: params.page_id,
        plain_text: plainText,
        block_count: blockCount,
        character_count: plainText.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    search_page_content: async (args) => {
      const params = SearchPageContentSchema.parse(args);
      const lowerQuery = params.query.toLowerCase();
      const matches: Record<string, unknown>[] = [];

      const searchBlocks = async (blockId: string, depth: number) => {
        if (depth > params.max_depth) return;
        let cursor: string | undefined;
        do {
          const qs = new URLSearchParams({ page_size: "100" });
          if (cursor) qs.set("start_cursor", cursor);
          const response = await logger.time("tool.search_page_content.fetch", () =>
            client.get<Record<string, unknown>>(`/blocks/${blockId}/children?${qs}`)
          , { tool: "search_page_content", blockId, depth });

          const results = (response.results as Record<string, unknown>[]) || [];
          for (const block of results) {
            const text = extractPlainText(block);
            if (text.toLowerCase().includes(lowerQuery)) {
              matches.push({
                block_id: block.id,
                type: block.type,
                depth,
                text,
                context: text.substring(
                  Math.max(0, text.toLowerCase().indexOf(lowerQuery) - 40),
                  Math.min(text.length, text.toLowerCase().indexOf(lowerQuery) + params.query.length + 40)
                ),
              });
            }
            if (block.has_children && depth < params.max_depth) {
              await searchBlocks(block.id as string, depth + 1);
            }
          }
          cursor = response.next_cursor as string | undefined;
        } while (cursor);
      };

      await searchBlocks(params.page_id, 1);

      const structured = {
        page_id: params.page_id,
        query: params.query,
        matches,
        match_count: matches.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    extract_headings_outline: async (args) => {
      const params = ExtractHeadingsOutlineSchema.parse(args);
      const allowedTypes = new Set<string>();
      if (params.include_h1) allowedTypes.add("heading_1");
      if (params.include_h2) allowedTypes.add("heading_2");
      if (params.include_h3) allowedTypes.add("heading_3");

      const outline: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const qs = new URLSearchParams({ page_size: "100" });
        if (cursor) qs.set("start_cursor", cursor);
        const response = await logger.time("tool.extract_headings_outline.fetch", () =>
          client.get<Record<string, unknown>>(`/blocks/${params.page_id}/children?${qs}`)
        , { tool: "extract_headings_outline", page_id: params.page_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const block of results) {
          const btype = block.type as string;
          if (allowedTypes.has(btype)) {
            const text = extractPlainText(block);
            const level = btype === "heading_1" ? 1 : btype === "heading_2" ? 2 : 3;
            outline.push({
              block_id: block.id,
              level,
              type: btype,
              text,
            });
          }
        }
        cursor = response.next_cursor as string | undefined;
      } while (cursor);

      const structured = {
        page_id: params.page_id,
        outline,
        heading_count: outline.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
