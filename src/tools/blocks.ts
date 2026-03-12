// Notion Block tools: get_block, append_blocks, get_block_children, delete_block
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetBlockSchema = z.object({
  block_id: z.string().describe("Notion block ID (UUID format)"),
});

// Rich text helper for block construction
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
  };

  return { tools, handlers };
}
