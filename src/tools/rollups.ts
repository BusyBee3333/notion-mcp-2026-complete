// Notion Rollup tools: get_rollup_value
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetRollupValueSchema = z.object({
  page_id: z.string().describe("Notion page ID that has the rollup property"),
  property_id: z.string().describe("Property ID or name of the rollup (get from get_database schema). Rollup property IDs are returned by get_database in the properties object."),
  start_cursor: z.string().optional().describe("Cursor for paginated rollup results (when rollup type is 'array')"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Items per page for array rollups (1-100, default 25)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_rollup_value",
      description:
        "Get the computed value of a rollup property on a Notion page. Rollups aggregate data from related pages (count, sum, average, min, max, median, percentage, show_original, show_unique, etc.). The response type depends on the rollup function: 'number' for aggregate functions, 'date' for date functions, 'array' for show_original/show_unique (paginated). Use get_database to find rollup property IDs.",
      title: "Get Rollup Value",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID with the rollup property" },
          property_id: { type: "string", description: "Rollup property ID or name (from get_database schema)" },
          start_cursor: { type: "string", description: "Cursor for paginated array rollups" },
          page_size: { type: "number", description: "Items per page for array rollups (1-100, default 25)" },
        },
        required: ["page_id", "property_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          object: { type: "string" },
          type: { type: "string" },
          rollup: { type: "object" },
          results: { type: "array", items: { type: "object" } },
          next_cursor: { type: "string" },
          has_more: { type: "boolean" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_rollup_value: async (args) => {
      const params = GetRollupValueSchema.parse(args);
      const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
      if (params.start_cursor) queryParams.set("start_cursor", params.start_cursor);

      const result = await logger.time("tool.get_rollup_value", () =>
        client.get(`/pages/${params.page_id}/properties/${encodeURIComponent(params.property_id)}?${queryParams}`)
      , { tool: "get_rollup_value", page_id: params.page_id, property_id: params.property_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
