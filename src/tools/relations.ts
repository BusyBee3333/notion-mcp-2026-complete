// Notion Relation tools: get_relation_pages, update_relation, add_relation_item
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetRelationPagesSchema = z.object({
  page_id: z.string().describe("Notion page ID that has the relation property"),
  property_id: z.string().describe("Property ID or name of the relation property (get from get_database schema)"),
  start_cursor: z.string().optional().describe("Cursor for next page of related items"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Number of related pages to return (1-100, default 25)"),
});

const UpdateRelationSchema = z.object({
  page_id: z.string().describe("Notion page ID to update the relation on"),
  property_name: z.string().describe("Name of the relation property to update (as shown in the database)"),
  related_page_ids: z.array(z.string()).describe(
    "Array of page IDs to set as the relation value. This REPLACES the current relation — pass all desired related page IDs. Pass empty array [] to clear the relation."
  ),
});

const AddRelationItemSchema = z.object({
  page_id: z.string().describe("Notion page ID to add a relation item to"),
  property_name: z.string().describe("Name of the relation property"),
  related_page_id: z.string().describe("Page ID to add to the existing relation (appended, does not replace existing items)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_relation_pages",
      description:
        "Get the list of related pages for a relation property on a Notion page. Returns an array of related page IDs with pagination support. Use property_id from get_database schema. Follow up with get_page for each ID to fetch full details.",
      title: "Get Relation Pages",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID with the relation property" },
          property_id: { type: "string", description: "Property ID or name of the relation (from get_database schema)" },
          start_cursor: { type: "string", description: "Cursor for next page of results" },
          page_size: { type: "number", description: "Related pages per page (1-100, default 25)" },
        },
        required: ["page_id", "property_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          next_cursor: { type: "string" },
          has_more: { type: "boolean" },
          type: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_relation",
      description:
        "Set (replace) the entire value of a relation property on a Notion page. Provide all the page IDs you want related — this overwrites the current relation completely. To add a single item without removing others, use add_relation_item instead.",
      title: "Update Relation",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to update" },
          property_name: { type: "string", description: "Relation property name" },
          related_page_ids: { type: "array", items: { type: "string" }, description: "Array of page IDs to set (replaces current relation). Pass [] to clear." },
        },
        required: ["page_id", "property_name", "related_page_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          properties: { type: "object" },
          last_edited_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "add_relation_item",
      description:
        "Add a single page to a relation property on a Notion page without removing existing relations. This first fetches the current relation, then appends the new item. More reliable than update_relation when you only want to add one item.",
      title: "Add Relation Item",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to update" },
          property_name: { type: "string", description: "Relation property name" },
          related_page_id: { type: "string", description: "Page ID to add to the relation" },
        },
        required: ["page_id", "property_name", "related_page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          properties: { type: "object" },
          last_edited_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_relation_pages: async (args) => {
      const params = GetRelationPagesSchema.parse(args);
      const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
      if (params.start_cursor) queryParams.set("start_cursor", params.start_cursor);

      const result = await logger.time("tool.get_relation_pages", () =>
        client.get(`/pages/${params.page_id}/properties/${encodeURIComponent(params.property_id)}?${queryParams}`)
      , { tool: "get_relation_pages", page_id: params.page_id, property_id: params.property_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_relation: async (args) => {
      const params = UpdateRelationSchema.parse(args);
      const relationValue = params.related_page_ids.map((id) => ({ id }));

      const result = await logger.time("tool.update_relation", () =>
        client.patch(`/pages/${params.page_id}`, {
          properties: {
            [params.property_name]: { relation: relationValue },
          },
        })
      , { tool: "update_relation", page_id: params.page_id, property_name: params.property_name });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    add_relation_item: async (args) => {
      const params = AddRelationItemSchema.parse(args);

      // Fetch the current page to read existing relation values
      const page = await logger.time("tool.add_relation_item.get_page", () =>
        client.get<Record<string, unknown>>(`/pages/${params.page_id}`)
      , { tool: "add_relation_item.get_page", page_id: params.page_id });

      // Extract existing relation IDs
      const properties = (page.properties as Record<string, Record<string, unknown>>) || {};
      const prop = properties[params.property_name];
      let existingIds: string[] = [];

      if (prop && Array.isArray(prop.relation)) {
        existingIds = (prop.relation as Array<{ id: string }>).map((r) => r.id);
      }

      // Avoid duplicates
      if (!existingIds.includes(params.related_page_id)) {
        existingIds.push(params.related_page_id);
      }

      const result = await logger.time("tool.add_relation_item.patch", () =>
        client.patch(`/pages/${params.page_id}`, {
          properties: {
            [params.property_name]: { relation: existingIds.map((id) => ({ id })) },
          },
        })
      , { tool: "add_relation_item.patch", page_id: params.page_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
