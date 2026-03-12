// Notion Comment tools: create_comment, list_comments
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const CreateCommentSchema = z.object({
  page_id: z.string().optional().describe("Page ID to add a top-level comment to"),
  discussion_id: z.string().optional().describe("Discussion thread ID to reply within an existing thread"),
  rich_text: z.array(z.record(z.unknown())).optional().describe(
    "Rich text comment content. Example: [{type:'text',text:{content:'Great work!'}}]"
  ),
  text: z.string().optional().describe("Plain text comment content (simpler alternative to rich_text)"),
});

const ListCommentsSchema = z.object({
  block_id: z.string().describe("Page or block ID to list comments for"),
  start_cursor: z.string().optional().describe("Cursor for next page of results"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Comments per page (1-100, default 25)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "create_comment",
      title: "Create Comment",
      description:
        "Add a comment to a Notion page. Provide either page_id (for a new top-level comment) or discussion_id (to reply in a thread). Provide either text (plain string) or rich_text (Notion rich text array). Returns the created comment.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID for a new top-level comment" },
          discussion_id: { type: "string", description: "Discussion thread ID to reply within" },
          text: { type: "string", description: "Plain text comment (simpler option)" },
          rich_text: { type: "array", items: { type: "object" }, description: "Rich text comment: [{type:'text',text:{content:'Message'}}]" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          object: { type: "string" },
          discussion_id: { type: "string" },
          rich_text: { type: "array" },
          created_time: { type: "string" },
          created_by: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_comments",
      title: "List Comments",
      description:
        "List all comments on a Notion page or block. Returns comment text, author, timestamps, and discussion IDs. Use when the user wants to read discussion threads on a page.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Page or block ID to list comments for" },
          start_cursor: { type: "string", description: "Cursor for next page of results" },
          page_size: { type: "number", description: "Comments per page (1-100, default 25)" },
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
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    create_comment: async (args) => {
      const params = CreateCommentSchema.parse(args);

      if (!params.page_id && !params.discussion_id) {
        throw new Error("Either page_id or discussion_id is required");
      }
      if (!params.text && !params.rich_text) {
        throw new Error("Either text or rich_text is required");
      }

      const body: Record<string, unknown> = {};

      if (params.page_id) {
        body.parent = { page_id: params.page_id };
      }
      if (params.discussion_id) {
        body.discussion_id = params.discussion_id;
      }

      if (params.text) {
        body.rich_text = [{ type: "text", text: { content: params.text } }];
      } else if (params.rich_text) {
        body.rich_text = params.rich_text;
      }

      const result = await logger.time("tool.create_comment", () =>
        client.post("/comments", body)
      , { tool: "create_comment" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_comments: async (args) => {
      const params = ListCommentsSchema.parse(args);
      const queryParams = new URLSearchParams({
        block_id: params.block_id,
        page_size: String(params.page_size),
      });
      if (params.start_cursor) queryParams.set("start_cursor", params.start_cursor);

      const result = await logger.time("tool.list_comments", () =>
        client.get(`/comments?${queryParams}`)
      , { tool: "list_comments", block_id: params.block_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
