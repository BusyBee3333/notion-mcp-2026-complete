// Notion User tools: get_user, list_users
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetUserSchema = z.object({
  user_id: z.string().describe("Notion user ID (UUID format) or 'me' for the integration bot user"),
});

const ListUsersSchema = z.object({
  start_cursor: z.string().optional().describe("Cursor for next page of results"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Users per page (1-100, default 25)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_user",
      title: "Get User",
      description:
        "Get a Notion user's profile by ID. Returns name, email (if accessible), avatar, and type (person or bot). Use 'me' as user_id to get the integration's own bot user info. Use when you need to look up a specific user.",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "User ID (UUID) or 'me' for the integration bot" },
        },
        required: ["user_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          object: { type: "string" },
          type: { type: "string", enum: ["person", "bot"] },
          name: { type: "string" },
          avatar_url: { type: "string" },
          person: { type: "object" },
          bot: { type: "object" },
        },
        required: ["id", "type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_users",
      title: "List Users",
      description:
        "List all users in the Notion workspace. Returns user profiles including name, type (person or bot), and avatar. Supports cursor pagination. Use when you need to find user IDs or see who has workspace access.",
      inputSchema: {
        type: "object",
        properties: {
          start_cursor: { type: "string", description: "Cursor for next page of results" },
          page_size: { type: "number", description: "Users per page (1-100, default 25)" },
        },
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
    get_user: async (args) => {
      const { user_id } = GetUserSchema.parse(args);
      const result = await logger.time("tool.get_user", () =>
        client.get(`/users/${user_id}`)
      , { tool: "get_user", user_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_users: async (args) => {
      const params = ListUsersSchema.parse(args);
      const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
      if (params.start_cursor) queryParams.set("start_cursor", params.start_cursor);

      const result = await logger.time("tool.list_users", () =>
        client.get(`/users?${queryParams}`)
      , { tool: "list_users" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
