// Notion Table of Contents tools: append_table_of_contents_block,
//   generate_toc_page, build_numbered_outline, append_heading_with_anchor,
//   get_page_structure
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const AppendTocBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the table of contents to"),
  color: z.enum([
    "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
    "gray_background", "brown_background", "orange_background", "yellow_background",
    "green_background", "blue_background", "purple_background", "pink_background", "red_background"
  ]).optional().default("default").describe("Color for the table of contents block"),
  after: z.string().optional().describe("Block ID to insert after (default: end)"),
});

const GetPageStructureSchema = z.object({
  page_id: z.string().describe("Page ID to get structure from"),
  include_types: z.array(z.string()).optional().describe(
    "Block types to include in structure (default: all heading types and major containers). " +
    "E.g. ['heading_1','heading_2','heading_3','toggle','callout']"
  ),
});

const GenerateTocPageSchema = z.object({
  source_page_id: z.string().describe("Page ID to generate TOC from"),
  target_page_id: z.string().describe("Page ID to append the generated TOC to"),
  max_depth: z.number().min(1).max(3).optional().default(3).describe("Max heading level to include (1=H1 only, 2=H1+H2, 3=all headings)"),
});

const AppendNumberedOutlineSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the numbered outline to"),
  items: z.array(z.object({
    text: z.string().describe("Outline item text"),
    level: z.number().min(1).max(3).describe("Indentation level (1=top, 2=second, 3=third)"),
    link: z.string().optional().describe("Optional URL or block ID to link this item to"),
  })).min(1).describe("Outline items to append as a numbered/indented list"),
  after: z.string().optional().describe("Block ID to insert after (default: end)"),
});

const AppendLinkToPageBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append to"),
  target_page_id: z.string().describe("Page ID to create a link to"),
  after: z.string().optional().describe("Block ID to insert after (default: end)"),
});

// ============ Helpers ============

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
      name: "append_table_of_contents_block",
      title: "Append Table of Contents Block",
      description:
        "Append a table_of_contents block to a Notion page. Notion automatically generates a navigation panel from the page's heading blocks (H1, H2, H3). This is the native TOC block — it updates automatically as headings change.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          color: { type: "string", description: "Color for the TOC block (default: default)" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_page_structure",
      title: "Get Page Structure",
      description:
        "Get the high-level block structure of a Notion page — headings, toggles, callouts, and other structural blocks. Returns a simplified tree showing the page's organization without full content. Faster than get_block_children_recursive for navigation purposes.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to analyze" },
          include_types: {
            type: "array",
            items: { type: "string" },
            description: "Block types to include (default: headings, toggles, callouts, dividers)",
          },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          structure: { type: "array", items: { type: "object" } },
          block_count: { type: "number" },
          heading_count: { type: "number" },
        },
        required: ["page_id", "structure"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "generate_toc_page",
      title: "Generate TOC Page",
      description:
        "Scan a source page's headings and generate a text-based table of contents in a target page. Creates a nested list of heading links as page mentions. More customizable than the native table_of_contents block.",
      inputSchema: {
        type: "object",
        properties: {
          source_page_id: { type: "string", description: "Page ID to generate TOC from" },
          target_page_id: { type: "string", description: "Page ID to write the TOC into" },
          max_depth: { type: "number", description: "Max heading depth (1-3, default 3)" },
        },
        required: ["source_page_id", "target_page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          source_page_id: { type: "string" },
          target_page_id: { type: "string" },
          headings_found: { type: "number" },
          blocks_added: { type: "number" },
        },
        required: ["source_page_id", "target_page_id", "headings_found"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_numbered_outline",
      title: "Append Numbered Outline",
      description:
        "Append a structured numbered outline to a Notion page as a hierarchy of numbered list items. Each item can have 1-3 levels of nesting. Useful for creating structured documents, agendas, and hierarchical content.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          items: {
            type: "array",
            items: { type: "object" },
            description: "Outline items: [{text, level (1-3), link?}]",
          },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "items"],
      },
      outputSchema: {
        type: "object",
        properties: {
          blocks_appended: { type: "number" },
          result: { type: "object" },
        },
        required: ["blocks_appended"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_link_to_page_block",
      title: "Append Link to Page Block",
      description:
        "Append a link_to_page block that creates a direct inline reference/link to another Notion page. Displays as a page preview card. Different from a text mention — this is a dedicated block-level page link.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          target_page_id: { type: "string", description: "Page ID to link to" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "target_page_id"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    append_table_of_contents_block: async (args) => {
      const params = AppendTocBlockSchema.parse(args);
      const tocBlock = {
        object: "block",
        type: "table_of_contents",
        table_of_contents: { color: params.color },
      };
      const body: Record<string, unknown> = { children: [tocBlock] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_table_of_contents_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_table_of_contents_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_page_structure: async (args) => {
      const params = GetPageStructureSchema.parse(args);
      const defaultTypes = new Set([
        "heading_1", "heading_2", "heading_3",
        "toggle", "callout", "divider", "table_of_contents",
        "column_list", "synced_block", "child_page", "child_database",
      ]);
      const allowedTypes = params.include_types
        ? new Set(params.include_types)
        : defaultTypes;

      const structure: Record<string, unknown>[] = [];
      let headingCount = 0;
      let blockCount = 0;
      let cursor: string | undefined;

      do {
        const qs = new URLSearchParams({ page_size: "100" });
        if (cursor) qs.set("start_cursor", cursor);
        const response = await logger.time("tool.get_page_structure.fetch", () =>
          client.get<Record<string, unknown>>(`/blocks/${params.page_id}/children?${qs}`)
        , { tool: "get_page_structure", page_id: params.page_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const block of results) {
          blockCount++;
          const btype = block.type as string;
          if (allowedTypes.has(btype)) {
            const text = extractPlainText(block);
            const level = btype === "heading_1" ? 1 : btype === "heading_2" ? 2 : btype === "heading_3" ? 3 : undefined;
            if (level !== undefined) headingCount++;
            structure.push({
              block_id: block.id,
              type: btype,
              text,
              level,
              has_children: block.has_children,
            });
          }
        }
        cursor = response.next_cursor as string | undefined;
      } while (cursor);

      const structured = { page_id: params.page_id, structure, block_count: blockCount, heading_count: headingCount };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    generate_toc_page: async (args) => {
      const params = GenerateTocPageSchema.parse(args);
      const headings: Array<{ block_id: string; level: number; text: string }> = [];
      let cursor: string | undefined;

      do {
        const qs = new URLSearchParams({ page_size: "100" });
        if (cursor) qs.set("start_cursor", cursor);
        const response = await logger.time("tool.generate_toc_page.fetch", () =>
          client.get<Record<string, unknown>>(`/blocks/${params.source_page_id}/children?${qs}`)
        , { tool: "generate_toc_page", source_page_id: params.source_page_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const block of results) {
          const btype = block.type as string;
          const level = btype === "heading_1" ? 1 : btype === "heading_2" ? 2 : btype === "heading_3" ? 3 : 0;
          if (level > 0 && level <= params.max_depth) {
            headings.push({ block_id: block.id as string, level, text: extractPlainText(block) });
          }
        }
        cursor = response.next_cursor as string | undefined;
      } while (cursor);

      if (headings.length === 0) {
        return {
          content: [{ type: "text", text: JSON.stringify({ source_page_id: params.source_page_id, target_page_id: params.target_page_id, headings_found: 0, blocks_added: 0 }, null, 2) }],
          structuredContent: { source_page_id: params.source_page_id, target_page_id: params.target_page_id, headings_found: 0, blocks_added: 0 },
        };
      }

      // Build blocks for the target page
      const tocBlocks = headings.map((h) => {
        const indent = "  ".repeat(h.level - 1);
        const prefix = indent + (h.level === 1 ? "• " : h.level === 2 ? "  ◦ " : "    ▪ ");
        return {
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text", text: { content: prefix } },
              { type: "mention", mention: { type: "page", page: { id: h.block_id } } },
              { type: "text", text: { content: ` (H${h.level})` }, annotations: { color: "gray" } },
            ],
          },
        };
      });

      const result = await logger.time("tool.generate_toc_page.append", () =>
        client.patch(`/blocks/${params.target_page_id}/children`, { children: tocBlocks })
      , { tool: "generate_toc_page", target_page_id: params.target_page_id });
      void result;

      const structured = {
        source_page_id: params.source_page_id,
        target_page_id: params.target_page_id,
        headings_found: headings.length,
        blocks_added: tocBlocks.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    append_numbered_outline: async (args) => {
      const params = AppendNumberedOutlineSchema.parse(args);

      // Build top-level numbered items; nest level 2 and 3 under their parent
      const topLevelItems: Record<string, unknown>[] = [];
      let currentL1: Record<string, unknown> | null = null;
      let currentL2: Record<string, unknown> | null = null;

      for (const item of params.items) {
        const richText: Record<string, unknown>[] = [];
        if (item.link) {
          richText.push({ type: "text", text: { content: item.text, link: { url: item.link } } });
        } else {
          richText.push({ type: "text", text: { content: item.text } });
        }

        if (item.level === 1) {
          currentL1 = {
            object: "block", type: "numbered_list_item",
            numbered_list_item: { rich_text: richText, children: [] },
          };
          currentL2 = null;
          topLevelItems.push(currentL1);
        } else if (item.level === 2 && currentL1) {
          currentL2 = {
            object: "block", type: "numbered_list_item",
            numbered_list_item: { rich_text: richText, children: [] },
          };
          const l1Content = currentL1.numbered_list_item as Record<string, unknown[]>;
          if (!l1Content.children) l1Content.children = [];
          (l1Content.children as Record<string, unknown>[]).push(currentL2);
        } else if (item.level === 3 && currentL2) {
          const leaf = {
            object: "block", type: "numbered_list_item",
            numbered_list_item: { rich_text: richText },
          };
          const l2Content = currentL2.numbered_list_item as Record<string, unknown[]>;
          if (!l2Content.children) l2Content.children = [];
          (l2Content.children as Record<string, unknown>[]).push(leaf);
        } else {
          // Fallback: append as top level
          topLevelItems.push({
            object: "block", type: "numbered_list_item",
            numbered_list_item: { rich_text: richText },
          });
        }
      }

      const body: Record<string, unknown> = { children: topLevelItems };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_numbered_outline", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_numbered_outline", block_id: params.block_id });

      const structured = { blocks_appended: topLevelItems.length, result };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    append_link_to_page_block: async (args) => {
      const params = AppendLinkToPageBlockSchema.parse(args);
      const linkBlock = {
        object: "block",
        type: "link_to_page",
        link_to_page: { type: "page_id", page_id: params.target_page_id },
      };
      const body: Record<string, unknown> = { children: [linkBlock] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_link_to_page_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_link_to_page_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
