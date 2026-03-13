// Notion Block tools — comprehensive coverage
// Original: get_block, append_blocks, get_block_children, delete_block, update_block,
//   get_block_children_recursive, append_code_block, append_callout_block,
//   append_toggle_block, append_table_block
// Round 2: append_image_block, append_video_block, append_embed_block, append_bookmark_block,
//   append_link_preview_block, append_divider_block, append_equation_block, append_file_block,
//   append_pdf_block, append_synced_block, append_template_block, append_breadcrumb_block,
//   append_column_list_block, get_all_blocks_flat
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetBlockSchema = z.object({
  block_id: z.string().describe("Notion block ID (UUID format)"),
});

const richTextSchema = z.object({
  content: z.string().describe("Text content"),
  link: z.string().optional().describe("Optional URL link"),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  code: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  color: z.string().optional().describe("Text color (e.g., 'red', 'blue_background')"),
});

const blockSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());

const AppendBlocksSchema = z.object({
  block_id: z.string().describe("Parent block or page ID to append children to"),
  children: z.array(blockSchema).describe(
    `Array of Notion block objects to append. Supported types: paragraph, heading_1, heading_2, heading_3, bulleted_list_item, numbered_list_item, to_do, toggle, code, quote, divider, callout.
Examples:
- Paragraph: {object:'block',type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:'Hello world'}}]}}
- Heading: {object:'block',type:'heading_1',heading_1:{rich_text:[{type:'text',text:{content:'Title'}}]}}
- Bullet: {object:'block',type:'bulleted_list_item',bulleted_list_item:{rich_text:[{type:'text',text:{content:'Item'}}]}}
- To-do: {object:'block',type:'to_do',to_do:{rich_text:[{type:'text',text:{content:'Task'}}],checked:false}}
- Code: {object:'block',type:'code',code:{rich_text:[{type:'text',text:{content:'console.log(x)'}}],language:'javascript'}}
- Divider: {object:'block',type:'divider',divider:{}}`
  ),
  after: z.string().optional().describe("ID of an existing block after which to insert — inserts at end if omitted"),
});

const GetBlockChildrenSchema = z.object({
  block_id: z.string().describe("Block or page ID to list children of"),
  start_cursor: z.string().optional().describe("Cursor for next page of results"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Number of blocks to return (1-100, default 25)"),
});

const DeleteBlockSchema = z.object({
  block_id: z.string().describe("Notion block ID to delete (permanently)"),
});

const UpdateBlockSchema = z.object({
  block_id: z.string().describe("Notion block ID to update"),
  block_type: z.string().describe(
    `Block type — must match the existing block type (you cannot change a block's type). Examples: 'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'code', 'quote', 'callout'`
  ),
  content: z.record(z.unknown()).describe(
    `Updated block content keyed by block type. Examples:
- Paragraph: {rich_text: [{type:'text',text:{content:'Updated text'}}]}
- Heading: {rich_text: [{type:'text',text:{content:'New Heading'}}], color: 'default'}
- To-do: {rich_text: [{type:'text',text:{content:'Task'}}], checked: true}
- Code: {rich_text: [{type:'text',text:{content:'const x = 1;'}}], language: 'javascript'}
- Callout: {rich_text: [{type:'text',text:{content:'Note!'}}], icon: {emoji: '💡'}, color: 'yellow_background'}`
  ),
  archived: z.boolean().optional().describe("Set to true to archive (hide) this block without deleting it"),
});

const GetBlockChildrenRecursiveSchema = z.object({
  block_id: z.string().describe("Root block or page ID to recursively fetch all children from"),
  max_depth: z.number().min(1).max(10).optional().default(3).describe("Maximum nesting depth to recurse into (1-10, default 3). Higher values may be slow for large pages."),
  page_size: z.number().min(1).max(100).optional().default(50).describe("Number of blocks per API call (1-100, default 50)"),
});

const AppendCodeBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the code block to"),
  code: z.string().describe("Code content to display in the code block"),
  language: z.enum([
    "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#",
    "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow", "fortran",
    "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "html", "java",
    "javascript", "json", "julia", "kotlin", "latex", "less", "lisp", "livescript",
    "lua", "makefile", "markdown", "markup", "matlab", "mermaid", "nix", "objective-c",
    "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog", "protobuf",
    "python", "r", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss",
    "shell", "sql", "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic",
    "webassembly", "xml", "yaml", "java/c/c++/c#"
  ]).optional().default("plain text").describe("Programming language for syntax highlighting"),
  caption: z.string().optional().describe("Optional caption text for the code block"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendCalloutBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the callout to"),
  text: z.string().describe("Text content of the callout"),
  icon_emoji: z.string().optional().default("💡").describe("Emoji icon for the callout (default: 💡). E.g. '⚠️', '📌', '✅', '❌', '📝'"),
  color: z.enum([
    "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red",
    "gray_background", "brown_background", "orange_background", "yellow_background",
    "green_background", "blue_background", "purple_background", "pink_background", "red_background"
  ]).optional().default("default").describe("Background color for the callout (default: default)"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendToggleBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the toggle block to"),
  summary: z.string().describe("Summary/title text of the toggle (shown when collapsed)"),
  children: z.array(blockSchema).optional().describe(
    `Blocks to nest inside the toggle (shown when expanded). Array of Notion block objects.
Example: [{type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:'Hidden content'}}]}}]`
  ),
  color: z.string().optional().describe("Text color for the toggle summary (e.g., 'default', 'gray', 'blue')"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendTableBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the table to"),
  rows: z.array(z.array(z.string())).describe(
    `Table data as 2D array of strings. First row is treated as header if has_column_header is true.
Example (3 columns, 3 rows including header):
[
  ['Name', 'Status', 'Priority'],
  ['Task A', 'Done', 'High'],
  ['Task B', 'In Progress', 'Medium']
]`
  ),
  has_column_header: z.boolean().optional().default(true).describe("Whether the first row is a header row (default: true)"),
  has_row_header: z.boolean().optional().default(false).describe("Whether the first column is a header column (default: false)"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

// ============ Round 2 Schemas ============

const AppendImageBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the image to"),
  url: z.string().url().describe("External image URL (must be publicly accessible). E.g. 'https://example.com/image.png'"),
  caption: z.string().optional().describe("Optional caption text for the image"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendVideoBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the video to"),
  url: z.string().url().describe("External video URL. Notion supports YouTube, Vimeo, and direct video file URLs."),
  caption: z.string().optional().describe("Optional caption text for the video"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendEmbedBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the embed to"),
  url: z.string().url().describe("URL to embed. Notion supports many providers (Google Maps, Figma, GitHub Gists, CodePen, Loom, etc.)"),
  caption: z.string().optional().describe("Optional caption text for the embed"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendBookmarkBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the bookmark to"),
  url: z.string().url().describe("URL to bookmark (Notion will fetch metadata automatically)"),
  caption: z.string().optional().describe("Optional caption/description for the bookmark"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendLinkPreviewBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the link preview to"),
  url: z.string().url().describe("URL to preview. Works best with URLs that provide Open Graph metadata."),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendDividerBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the divider (horizontal rule) to"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendEquationBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the equation to"),
  expression: z.string().describe("LaTeX math expression. E.g. 'E = mc^2', '\\\\int_0^\\\\infty e^{-x^2} dx = \\\\frac{\\\\sqrt{\\\\pi}}{2}'"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendFileBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the file to"),
  url: z.string().url().describe("External file URL (must be publicly accessible). E.g. 'https://example.com/document.pdf'"),
  name: z.string().optional().describe("Display name for the file. E.g. 'Project Report.pdf'"),
  caption: z.string().optional().describe("Optional caption text"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendPdfBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the PDF to"),
  url: z.string().url().describe("External PDF URL (must be publicly accessible). E.g. 'https://example.com/report.pdf'"),
  caption: z.string().optional().describe("Optional caption text for the PDF"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendSyncedBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the synced block to"),
  synced_from_block_id: z.string().optional().describe(
    "Block ID to sync FROM (reference). If provided, creates a reference synced block that mirrors the original. " +
    "If omitted, creates a new original synced block (you then add children to it separately)."
  ),
  children: z.array(blockSchema).optional().describe(
    "Child blocks to place inside a NEW original synced block. Only used when synced_from_block_id is NOT provided."
  ),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendTemplateBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the template block to"),
  button_text: z.string().describe("Text shown on the template button. E.g. 'Add weekly review'"),
  children: z.array(blockSchema).optional().describe(
    "Block children that will be stamped when the template button is clicked. Array of Notion block objects."
  ),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendBreadcrumbBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the breadcrumb navigation to"),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const AppendColumnListBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the column layout to"),
  columns: z.array(
    z.array(blockSchema).describe("Blocks for this column")
  ).min(2).describe(
    "Array of columns — each column is an array of Notion block objects. Minimum 2 columns required.\n" +
    "Example: [[{type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:'Left column'}}]}}], [{type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:'Right column'}}]}}]]"
  ),
  after: z.string().optional().describe("ID of existing block to insert after (default: end of parent)"),
});

const GetAllBlocksFlatSchema = z.object({
  block_id: z.string().describe("Root block or page ID to recursively flatten all blocks from"),
  page_size: z.number().min(1).max(100).optional().default(50).describe("Number of blocks per API call (1-100, default 50)"),
  include_types: z.array(z.string()).optional().describe(
    "Optional allow-list of block types to include (others are skipped). E.g. ['paragraph','heading_1','heading_2'] to get only text blocks."
  ),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_block",
      title: "Get Block",
      description:
        "Get the content and type of a specific Notion block by ID. Returns block type (paragraph, heading, list item, etc.) and its rich text content. Use when you need to inspect a specific block's content.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Notion block ID (UUID format)" },
        },
        required: ["block_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          has_children: { type: "boolean" },
          created_time: { type: "string" },
          last_edited_time: { type: "string" },
        },
        required: ["id", "type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "append_blocks",
      title: "Append Blocks",
      description:
        "Append child blocks (content) to a Notion page or block. Supports paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item, to_do, toggle, code, quote, divider. Returns the appended blocks. Use to add content to a page.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          children: {
            type: "array",
            items: { type: "object" },
            description: "Block objects to append. Each needs type + type-keyed content. E.g. {type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:'Hello'}}]}}",
          },
          after: { type: "string", description: "ID of existing block to insert after (default: end)" },
        },
        required: ["block_id", "children"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
        },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_block_children",
      title: "Get Block Children",
      description:
        "List child blocks of a Notion page or block. Returns content blocks with their types and text. Use to read page content. Supports cursor pagination for long pages. Call after get_page to see page body.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Page or block ID to list children of" },
          start_cursor: { type: "string", description: "Cursor for next page of results" },
          page_size: { type: "number", description: "Blocks to return (1-100, default 25)" },
        },
        required: ["block_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          next_cursor: { type: "string" },
          has_more: { type: "boolean" },
        },
        required: ["results", "has_more"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "delete_block",
      title: "Delete Block",
      description:
        "Permanently delete a Notion block by ID. This cannot be undone. Also deletes any child blocks. Use only when the user explicitly asks to delete a block or section of content.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Notion block ID to delete" },
        },
        required: ["block_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          deleted_id: { type: "string" },
        },
        required: ["success"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_block",
      title: "Update Block",
      description:
        "Update the content of an existing Notion block. You must specify the block's type and provide the updated content for that type. Block types cannot be changed — only content can be updated. Supports paragraph, heading_1/2/3, bulleted_list_item, numbered_list_item, to_do, code, quote, callout, toggle.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Notion block ID to update" },
          block_type: { type: "string", description: "The block's type (e.g. 'paragraph', 'to_do', 'code') — must match the existing type" },
          content: { type: "object", description: "Updated content for the block type. E.g. for paragraph: {rich_text:[{type:'text',text:{content:'Updated'}}]}" },
          archived: { type: "boolean", description: "Set true to archive (hide) this block" },
        },
        required: ["block_id", "block_type", "content"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          last_edited_time: { type: "string" },
        },
        required: ["id", "type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_block_children_recursive",
      title: "Get Block Children Recursive",
      description:
        "Recursively fetch all child blocks of a Notion page or block up to a configurable depth. Returns a nested tree structure with each block and its children. Useful for reading the complete content tree of a page. Be careful with deep or wide pages — use max_depth to limit API calls.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Root page or block ID to recursively fetch" },
          max_depth: { type: "number", description: "Max nesting depth to recurse into (1-10, default 3)" },
          page_size: { type: "number", description: "Blocks per API call (1-100, default 50)" },
        },
        required: ["block_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string" },
          blocks: { type: "array", items: { type: "object" } },
          total_fetched: { type: "number" },
          depth_reached: { type: "number" },
        },
        required: ["block_id", "blocks", "total_fetched"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "append_code_block",
      title: "Append Code Block",
      description:
        "Append a formatted code block to a Notion page or block. Supports syntax highlighting for 60+ programming languages. Simpler than using append_blocks with a raw code block object.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          code: { type: "string", description: "Code content to display" },
          language: { type: "string", description: "Language for syntax highlighting (e.g. 'javascript', 'python', 'sql', 'bash', 'typescript'). Default: 'plain text'" },
          caption: { type: "string", description: "Optional caption text" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "code"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
        },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_callout_block",
      title: "Append Callout Block",
      description:
        "Append a callout (highlighted note) block to a Notion page. Callouts draw attention to important information with an icon and optional color background. Simpler than using append_blocks with a raw callout object.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          text: { type: "string", description: "Text content of the callout" },
          icon_emoji: { type: "string", description: "Emoji icon (default: 💡). E.g. '⚠️', '📌', '✅', '❌'" },
          color: { type: "string", description: "Background color: 'default','gray','blue','green','yellow','orange','red','purple','pink', or append '_background' for background variants. Default: 'default'" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "text"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
        },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_toggle_block",
      title: "Append Toggle Block",
      description:
        "Append a toggle (collapsible) block to a Notion page. Toggles have a summary visible when collapsed and optional nested children revealed when expanded. Great for FAQs, spoilers, and hierarchical content.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          summary: { type: "string", description: "Text shown in the toggle header (always visible)" },
          children: { type: "array", items: { type: "object" }, description: "Blocks nested inside the toggle (shown when expanded)" },
          color: { type: "string", description: "Text color for summary (e.g. 'default', 'gray', 'blue')" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "summary"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
        },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_table_block",
      title: "Append Table Block",
      description:
        "Append a table block to a Notion page from a 2D array of strings. Automatically creates the table with the correct number of columns and rows. The first row is treated as the header by default.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          rows: { type: "array", items: { type: "array", items: { type: "string" } }, description: "2D array of strings. E.g. [['Name','Score'],['Alice','95'],['Bob','87']]" },
          has_column_header: { type: "boolean", description: "First row is a header (default: true)" },
          has_row_header: { type: "boolean", description: "First column is a header (default: false)" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "rows"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
        },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },

    // ============ Round 2 Tool Definitions ============

    {
      name: "append_image_block",
      title: "Append Image Block",
      description:
        "Append an image block to a Notion page using an external URL. The image must be publicly accessible. Notion will display it inline in the page. Optionally add a caption.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          url: { type: "string", description: "Publicly accessible image URL. E.g. 'https://example.com/photo.png'" },
          caption: { type: "string", description: "Optional caption text displayed below the image" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_video_block",
      title: "Append Video Block",
      description:
        "Append a video block to a Notion page. Supports YouTube, Vimeo, and direct video file URLs. Notion renders supported URLs as embedded players.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          url: { type: "string", description: "Video URL — YouTube, Vimeo, or direct video file URL" },
          caption: { type: "string", description: "Optional caption text" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_embed_block",
      title: "Append Embed Block",
      description:
        "Append an embed block to a Notion page. Works with many providers: Figma, GitHub Gist, Google Maps, Google Slides, Loom, Miro, Typeform, Twitter/X, CodePen, and more. Notion renders supported URLs as rich embeds.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          url: { type: "string", description: "URL to embed. E.g. Figma file URL, GitHub Gist URL, Loom video URL" },
          caption: { type: "string", description: "Optional caption text" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_bookmark_block",
      title: "Append Bookmark Block",
      description:
        "Append a bookmark block to a Notion page. Notion will fetch the URL's metadata (title, description, favicon) and display it as a rich link card.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          url: { type: "string", description: "URL to bookmark — Notion fetches title/description automatically" },
          caption: { type: "string", description: "Optional caption/note text" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_link_preview_block",
      title: "Append Link Preview Block",
      description:
        "Append a link_preview block to a Notion page. Similar to bookmark but uses the link_preview block type — displays a preview card. Works well with URLs that have Open Graph metadata.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          url: { type: "string", description: "URL to preview" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_divider_block",
      title: "Append Divider Block",
      description:
        "Append a divider (horizontal rule) block to a Notion page. Useful for separating sections of content visually.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
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
      name: "append_equation_block",
      title: "Append Equation Block",
      description:
        "Append a block-level LaTeX math equation to a Notion page. Use standard LaTeX notation for math expressions. The equation renders as a centered display-mode formula.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          expression: { type: "string", description: "LaTeX math expression. E.g. 'E = mc^2' or '\\\\sum_{i=0}^n i = \\\\frac{n(n+1)}{2}'" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "expression"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_file_block",
      title: "Append File Block",
      description:
        "Append a file attachment block to a Notion page using an external URL. Displays as a downloadable file link with a file icon.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          url: { type: "string", description: "Publicly accessible file URL. E.g. 'https://example.com/report.xlsx'" },
          name: { type: "string", description: "Display name for the file. E.g. 'Q4 Report.xlsx'" },
          caption: { type: "string", description: "Optional caption text" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_pdf_block",
      title: "Append PDF Block",
      description:
        "Append a PDF viewer block to a Notion page using an external URL. Notion renders it as an inline PDF viewer that can be scrolled and zoomed.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          url: { type: "string", description: "Publicly accessible PDF URL. E.g. 'https://example.com/document.pdf'" },
          caption: { type: "string", description: "Optional caption text" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_synced_block",
      title: "Append Synced Block",
      description:
        "Append a synced block to a Notion page. Two modes: (1) Create a new ORIGINAL synced block with children — any copies of this block will mirror its content. (2) Create a REFERENCE synced block that mirrors an existing original block (provide synced_from_block_id).",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          synced_from_block_id: { type: "string", description: "Block ID of the original synced block to mirror. Omit to create a new original." },
          children: { type: "array", items: { type: "object" }, description: "Blocks inside the new original synced block. Only used when creating an original (no synced_from_block_id)." },
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
      name: "append_template_block",
      title: "Append Template Block",
      description:
        "Append a template block to a Notion page. Template blocks show a button that, when clicked in Notion, stamps child blocks into the page. Great for reusable content snippets like daily notes, meeting agendas, etc.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          button_text: { type: "string", description: "Text on the template button. E.g. 'Add meeting notes'" },
          children: { type: "array", items: { type: "object" }, description: "Blocks that get stamped when the button is clicked" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "button_text"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_breadcrumb_block",
      title: "Append Breadcrumb Block",
      description:
        "Append a breadcrumb navigation block to a Notion page. The breadcrumb automatically shows the page hierarchy (parent pages) as a trail of links — useful for deep page trees.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
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
      name: "append_column_list_block",
      title: "Append Column List Block",
      description:
        "Append a multi-column layout block to a Notion page. Each column is an independent content area. Pass an array of column arrays — each inner array contains Notion block objects for that column. Minimum 2 columns required.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          columns: {
            type: "array",
            items: { type: "array", items: { type: "object" } },
            description: "Array of columns — each column is an array of block objects. Min 2 columns. E.g. [[{type:'paragraph',...}], [{type:'paragraph',...}]]",
          },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "columns"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_all_blocks_flat",
      title: "Get All Blocks Flat",
      description:
        "Recursively fetch ALL blocks from a Notion page or block and return them as a flat ordered list (depth-first). Unlike get_block_children_recursive (which returns a tree), this returns a flat array ideal for LLM context, search, or text extraction. Each block has a depth field. Optionally filter by block type.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Root page or block ID to flatten" },
          page_size: { type: "number", description: "Blocks per API call (1-100, default 50)" },
          include_types: {
            type: "array",
            items: { type: "string" },
            description: "Optional filter — only return blocks of these types. E.g. ['paragraph','heading_1','heading_2'] for text only.",
          },
        },
        required: ["block_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string" },
          blocks: { type: "array", items: { type: "object" } },
          total_count: { type: "number" },
          types_found: { type: "object" },
        },
        required: ["block_id", "blocks", "total_count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_block: async (args) => {
      const { block_id } = GetBlockSchema.parse(args);
      const result = await logger.time("tool.get_block", () =>
        client.get(`/blocks/${block_id}`)
      , { tool: "get_block", block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_blocks: async (args) => {
      const params = AppendBlocksSchema.parse(args);
      const body: Record<string, unknown> = { children: params.children };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_blocks", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_blocks", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_block_children: async (args) => {
      const params = GetBlockChildrenSchema.parse(args);
      const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
      if (params.start_cursor) queryParams.set("start_cursor", params.start_cursor);

      const result = await logger.time("tool.get_block_children", () =>
        client.get(`/blocks/${params.block_id}/children?${queryParams}`)
      , { tool: "get_block_children", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    delete_block: async (args) => {
      const { block_id } = DeleteBlockSchema.parse(args);
      await logger.time("tool.delete_block", () =>
        client.delete(`/blocks/${block_id}`)
      , { tool: "delete_block", block_id });

      const result = { success: true, deleted_id: block_id };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_block: async (args) => {
      const params = UpdateBlockSchema.parse(args);
      const body: Record<string, unknown> = {
        [params.block_type]: params.content,
      };
      if (params.archived !== undefined) body.archived = params.archived;

      const result = await logger.time("tool.update_block", () =>
        client.patch(`/blocks/${params.block_id}`, body)
      , { tool: "update_block", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_block_children_recursive: async (args) => {
      const params = GetBlockChildrenRecursiveSchema.parse(args);
      let totalFetched = 0;
      let depthReached = 0;

      const fetchBlocks = async (blockId: string, depth: number): Promise<Record<string, unknown>[]> => {
        if (depth > params.max_depth) return [];
        if (depth > depthReached) depthReached = depth;

        const blocks: Record<string, unknown>[] = [];
        let cursor: string | undefined;

        do {
          const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
          if (cursor) queryParams.set("start_cursor", cursor);

          const response = await logger.time("tool.get_block_children_recursive.fetch", () =>
            client.get<Record<string, unknown>>(`/blocks/${blockId}/children?${queryParams}`)
          , { tool: "get_block_children_recursive", blockId, depth });

          const results = (response.results as Record<string, unknown>[]) || [];
          totalFetched += results.length;

          for (const block of results) {
            const enriched: Record<string, unknown> = { ...block };
            if (block.has_children && depth < params.max_depth) {
              enriched._children = await fetchBlocks(block.id as string, depth + 1);
            }
            blocks.push(enriched);
          }

          cursor = response.next_cursor as string | undefined;
        } while (cursor);

        return blocks;
      };

      const blocks = await fetchBlocks(params.block_id, 1);
      const result = {
        block_id: params.block_id,
        blocks,
        total_fetched: totalFetched,
        depth_reached: depthReached,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_code_block: async (args) => {
      const params = AppendCodeBlockSchema.parse(args);
      const codeBlock: Record<string, unknown> = {
        object: "block",
        type: "code",
        code: {
          rich_text: [{ type: "text", text: { content: params.code } }],
          language: params.language,
          ...(params.caption ? { caption: [{ type: "text", text: { content: params.caption } }] } : {}),
        },
      };

      const body: Record<string, unknown> = { children: [codeBlock] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_code_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_code_block", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_callout_block: async (args) => {
      const params = AppendCalloutBlockSchema.parse(args);
      const calloutBlock: Record<string, unknown> = {
        object: "block",
        type: "callout",
        callout: {
          rich_text: [{ type: "text", text: { content: params.text } }],
          icon: { type: "emoji", emoji: params.icon_emoji },
          color: params.color,
        },
      };

      const body: Record<string, unknown> = { children: [calloutBlock] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_callout_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_callout_block", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_toggle_block: async (args) => {
      const params = AppendToggleBlockSchema.parse(args);
      const toggleBlock: Record<string, unknown> = {
        object: "block",
        type: "toggle",
        toggle: {
          rich_text: [{ type: "text", text: { content: params.summary } }],
          ...(params.color ? { color: params.color } : {}),
          ...(params.children && params.children.length > 0 ? { children: params.children } : {}),
        },
      };

      const body: Record<string, unknown> = { children: [toggleBlock] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_toggle_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_toggle_block", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_table_block: async (args) => {
      const params = AppendTableBlockSchema.parse(args);

      if (!params.rows || params.rows.length === 0) {
        throw new Error("rows must be a non-empty 2D array of strings");
      }

      const tableWidth = params.rows[0].length;

      const tableRowBlocks = params.rows.map((row) => {
        const cells = row.map((cellText) => [
          { type: "text", text: { content: cellText } },
        ]);
        while (cells.length < tableWidth) {
          cells.push([{ type: "text", text: { content: "" } }]);
        }
        return {
          type: "table_row",
          table_row: { cells: cells.slice(0, tableWidth) },
        };
      });

      const tableBlock: Record<string, unknown> = {
        object: "block",
        type: "table",
        table: {
          table_width: tableWidth,
          has_column_header: params.has_column_header,
          has_row_header: params.has_row_header,
          children: tableRowBlocks,
        },
      };

      const body: Record<string, unknown> = { children: [tableBlock] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_table_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_table_block", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    // ============ Round 2 Handlers ============

    append_image_block: async (args) => {
      const params = AppendImageBlockSchema.parse(args);
      const imageBlock: Record<string, unknown> = {
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: { url: params.url },
          ...(params.caption ? { caption: [{ type: "text", text: { content: params.caption } }] } : {}),
        },
      };
      const body: Record<string, unknown> = { children: [imageBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_image_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_image_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_video_block: async (args) => {
      const params = AppendVideoBlockSchema.parse(args);
      const videoBlock: Record<string, unknown> = {
        object: "block",
        type: "video",
        video: {
          type: "external",
          external: { url: params.url },
          ...(params.caption ? { caption: [{ type: "text", text: { content: params.caption } }] } : {}),
        },
      };
      const body: Record<string, unknown> = { children: [videoBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_video_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_video_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_embed_block: async (args) => {
      const params = AppendEmbedBlockSchema.parse(args);
      const embedBlock: Record<string, unknown> = {
        object: "block",
        type: "embed",
        embed: {
          url: params.url,
          ...(params.caption ? { caption: [{ type: "text", text: { content: params.caption } }] } : {}),
        },
      };
      const body: Record<string, unknown> = { children: [embedBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_embed_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_embed_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_bookmark_block: async (args) => {
      const params = AppendBookmarkBlockSchema.parse(args);
      const bookmarkBlock: Record<string, unknown> = {
        object: "block",
        type: "bookmark",
        bookmark: {
          url: params.url,
          ...(params.caption ? { caption: [{ type: "text", text: { content: params.caption } }] } : {}),
        },
      };
      const body: Record<string, unknown> = { children: [bookmarkBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_bookmark_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_bookmark_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_link_preview_block: async (args) => {
      const params = AppendLinkPreviewBlockSchema.parse(args);
      const linkPreviewBlock: Record<string, unknown> = {
        object: "block",
        type: "link_preview",
        link_preview: { url: params.url },
      };
      const body: Record<string, unknown> = { children: [linkPreviewBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_link_preview_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_link_preview_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_divider_block: async (args) => {
      const params = AppendDividerBlockSchema.parse(args);
      const dividerBlock: Record<string, unknown> = {
        object: "block",
        type: "divider",
        divider: {},
      };
      const body: Record<string, unknown> = { children: [dividerBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_divider_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_divider_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_equation_block: async (args) => {
      const params = AppendEquationBlockSchema.parse(args);
      const equationBlock: Record<string, unknown> = {
        object: "block",
        type: "equation",
        equation: { expression: params.expression },
      };
      const body: Record<string, unknown> = { children: [equationBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_equation_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_equation_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_file_block: async (args) => {
      const params = AppendFileBlockSchema.parse(args);
      const fileBlock: Record<string, unknown> = {
        object: "block",
        type: "file",
        file: {
          type: "external",
          external: { url: params.url },
          ...(params.name ? { name: params.name } : {}),
          ...(params.caption ? { caption: [{ type: "text", text: { content: params.caption } }] } : {}),
        },
      };
      const body: Record<string, unknown> = { children: [fileBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_file_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_file_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_pdf_block: async (args) => {
      const params = AppendPdfBlockSchema.parse(args);
      const pdfBlock: Record<string, unknown> = {
        object: "block",
        type: "pdf",
        pdf: {
          type: "external",
          external: { url: params.url },
          ...(params.caption ? { caption: [{ type: "text", text: { content: params.caption } }] } : {}),
        },
      };
      const body: Record<string, unknown> = { children: [pdfBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_pdf_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_pdf_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_synced_block: async (args) => {
      const params = AppendSyncedBlockSchema.parse(args);
      let syncedBlock: Record<string, unknown>;

      if (params.synced_from_block_id) {
        // Reference synced block — mirrors an existing original
        syncedBlock = {
          object: "block",
          type: "synced_block",
          synced_block: {
            synced_from: { type: "block_id", block_id: params.synced_from_block_id },
          },
        };
      } else {
        // New original synced block
        syncedBlock = {
          object: "block",
          type: "synced_block",
          synced_block: {
            synced_from: null,
            ...(params.children && params.children.length > 0 ? { children: params.children } : {}),
          },
        };
      }

      const body: Record<string, unknown> = { children: [syncedBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_synced_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_synced_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_template_block: async (args) => {
      const params = AppendTemplateBlockSchema.parse(args);
      const templateBlock: Record<string, unknown> = {
        object: "block",
        type: "template",
        template: {
          rich_text: [{ type: "text", text: { content: params.button_text } }],
          ...(params.children && params.children.length > 0 ? { children: params.children } : {}),
        },
      };
      const body: Record<string, unknown> = { children: [templateBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_template_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_template_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_breadcrumb_block: async (args) => {
      const params = AppendBreadcrumbBlockSchema.parse(args);
      const breadcrumbBlock: Record<string, unknown> = {
        object: "block",
        type: "breadcrumb",
        breadcrumb: {},
      };
      const body: Record<string, unknown> = { children: [breadcrumbBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_breadcrumb_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_breadcrumb_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    append_column_list_block: async (args) => {
      const params = AppendColumnListBlockSchema.parse(args);

      const columnBlocks = params.columns.map((colChildren) => ({
        object: "block",
        type: "column",
        column: {
          ...(colChildren.length > 0 ? { children: colChildren } : {}),
        },
      }));

      const columnListBlock: Record<string, unknown> = {
        object: "block",
        type: "column_list",
        column_list: {
          children: columnBlocks,
        },
      };

      const body: Record<string, unknown> = { children: [columnListBlock] };
      if (params.after) body.after = params.after;
      const result = await logger.time("tool.append_column_list_block", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "append_column_list_block", block_id: params.block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_all_blocks_flat: async (args) => {
      const params = GetAllBlocksFlatSchema.parse(args);
      const flatBlocks: Array<Record<string, unknown>> = [];
      const typeCounts: Record<string, number> = {};

      const flatten = async (blockId: string, depth: number): Promise<void> => {
        let cursor: string | undefined;
        do {
          const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
          if (cursor) queryParams.set("start_cursor", cursor);

          const response = await logger.time("tool.get_all_blocks_flat.fetch", () =>
            client.get<Record<string, unknown>>(`/blocks/${blockId}/children?${queryParams}`)
          , { tool: "get_all_blocks_flat", blockId, depth });

          const results = (response.results as Record<string, unknown>[]) || [];

          for (const block of results) {
            const blockType = block.type as string;
            if (!params.include_types || params.include_types.includes(blockType)) {
              flatBlocks.push({ ...block, _depth: depth });
              typeCounts[blockType] = (typeCounts[blockType] || 0) + 1;
            }
            if (block.has_children) {
              await flatten(block.id as string, depth + 1);
            }
          }

          cursor = response.next_cursor as string | undefined;
        } while (cursor);
      };

      await flatten(params.block_id, 0);

      const result = {
        block_id: params.block_id,
        blocks: flatBlocks,
        total_count: flatBlocks.length,
        types_found: typeCounts,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
