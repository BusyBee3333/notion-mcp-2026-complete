// Notion Search tool: search
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const SearchSchema = z.object({
  query: z.string().optional().describe("Text to search for in page/database titles. Leave empty to list all accessible items."),
  filter_type: z.enum(["page", "database"]).optional().describe("Filter results to only pages or only databases"),
  sort_direction: z.enum(["ascending", "descending"]).optional().default("descending").describe("Sort direction (default: descending)"),
  sort_timestamp: z.enum(["last_edited_time", "created_time"]).optional().default("last_edited_time").describe("Property to sort by (default: last_edited_time)"),
  start_cursor: z.string().optional().describe("Cursor for next page of results"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Results per page (1-100, default 25)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "search",
      title: "Search Pages & Databases",
      description:
        "Search across all Notion pages and databases accessible to the integration. Searches by title. Returns matching pages and databases with IDs, titles, and URLs. Supports cursor pagination. Use when you need to find a page or database by name.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for in titles (leave empty to list all)" },
          filter_type: { type: "string", enum: ["page", "database"], description: "Limit to pages or databases only" },
          sort_direction: { type: "string", enum: ["ascending", "descending"], description: "Sort direction (default: descending)" },
          sort_timestamp: { type: "string", enum: ["last_edited_time", "created_time"], description: "Sort by this timestamp (default: last_edited_time)" },
          start_cursor: { type: "string", description: "Cursor for next page of results" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
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
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    search: async (args) => {
      const params = SearchSchema.parse(args);
      const body: Record<string, unknown> = {
        page_size: params.page_size,
        sort: {
          direction: params.sort_direction,
          timestamp: params.sort_timestamp,
        },
      };
      if (params.query) body.query = params.query;
      if (params.filter_type) {
        body.filter = { value: params.filter_type, property: "object" };
      }
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.search", () =>
        client.post("/search", body)
      , { tool: "search", query: params.query });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
