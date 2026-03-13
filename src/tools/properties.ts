// Notion Property tools: get_page_property, update_database_properties, add_database_property, remove_database_property
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetPagePropertySchema = z.object({
  page_id: z.string().describe("Notion page ID (UUID format)"),
  property_id: z.string().describe("Property ID or name (use property ID from get_database schema for reliability). Examples: 'title', '%3AUlp', 'Name'"),
  start_cursor: z.string().optional().describe("Cursor for next page (for paginated properties like relation, people, rich_text)"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Items per page (1-100, default 25) — only for paginated properties"),
});

const UpdateDatabasePropertiesSchema = z.object({
  database_id: z.string().describe("Notion database ID to update properties on"),
  properties: z.record(z.unknown()).describe(
    `Property schema updates keyed by property name. Pass the full schema for each property to update.
Examples:
- Rename a property: {"Old Name": {"name": "New Name"}}
- Change select options: {"Status": {"select": {"options": [{"name": "Backlog"},{"name": "In Progress"},{"name": "Done"}]}}}
- Add a number property: {"Score": {"number": {"format": "number"}}}
- Update date property: {"Due": {"date": {}}}
Only properties included in this object are modified — other properties are unchanged.`
  ),
});

const AddDatabasePropertySchema = z.object({
  database_id: z.string().describe("Notion database ID to add a property to"),
  property_name: z.string().describe("Name of the new property to add"),
  property_schema: z.record(z.unknown()).describe(
    `Property type schema. Examples:
- Text: {"rich_text": {}}
- Number: {"number": {"format": "number"}}
- Select: {"select": {"options": [{"name": "Option A"},{"name": "Option B"}]}}
- Multi-select: {"multi_select": {"options": [{"name": "Tag1"},{"name": "Tag2"}]}}
- Date: {"date": {}}
- Checkbox: {"checkbox": {}}
- URL: {"url": {}}
- Email: {"email": {}}
- Phone: {"phone_number": {}}
- People: {"people": {}}
- Files: {"files": {}}
- Relation: {"relation": {"database_id": "<other_database_id>", "type": "single_property", "single_property": {}}}
- Formula: {"formula": {"expression": "prop(\\"Name\\")"}}
`
  ),
});

const RemoveDatabasePropertySchema = z.object({
  database_id: z.string().describe("Notion database ID"),
  property_name: z.string().describe("Exact name of the property to remove from the database schema"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_page_property",
      description:
        "Get the value of a specific property on a Notion page. Works for all property types including relation (returns paginated list of related page IDs), rollup, rich_text, title, select, multi_select, number, date, people, files, checkbox, url, email, phone_number, formula. Use property_id from get_database schema for reliability.",
      title: "Get Page Property",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID (UUID format)" },
          property_id: { type: "string", description: "Property ID or name — use ID from get_database for reliability" },
          start_cursor: { type: "string", description: "Cursor for paginated properties (relation, people, rich_text, title)" },
          page_size: { type: "number", description: "Items per page (1-100, default 25)" },
        },
        required: ["page_id", "property_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          object: { type: "string" },
          type: { type: "string" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_database_properties",
      description:
        "Update the schema of existing properties in a Notion database — rename them, change options, modify formats. Only the properties you pass are affected. To add a new property, use add_database_property. To remove, use remove_database_property.",
      title: "Update Database Properties",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID" },
          properties: { type: "object", description: "Property updates keyed by name. E.g. {\"Status\": {\"name\": \"State\"}} to rename, or {\"Priority\": {\"select\": {\"options\": [{\"name\": \"High\"},{\"name\": \"Low\"}]}}}" },
        },
        required: ["database_id", "properties"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          properties: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "add_database_property",
      description:
        "Add a new property (column) to a Notion database schema. Supports all Notion property types: rich_text, number, select, multi_select, date, people, files, checkbox, url, email, phone_number, formula, relation, rollup. Returns the updated database schema.",
      title: "Add Database Property",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID" },
          property_name: { type: "string", description: "Name for the new property" },
          property_schema: { type: "object", description: "Property type definition. E.g. {\"select\": {\"options\": [{\"name\": \"Yes\"},{\"name\": \"No\"}]}} or {\"number\": {\"format\": \"dollar\"}} or {\"date\": {}}" },
        },
        required: ["database_id", "property_name", "property_schema"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          properties: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "remove_database_property",
      description:
        "Remove (delete) a property from a Notion database schema. This permanently removes the column and all its values from every page in the database. Cannot be undone. Provide the exact property name as it appears in the database.",
      title: "Remove Database Property",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID" },
          property_name: { type: "string", description: "Exact name of the property to remove" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          properties: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_page_property: async (args) => {
      const params = GetPagePropertySchema.parse(args);
      const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
      if (params.start_cursor) queryParams.set("start_cursor", params.start_cursor);

      const result = await logger.time("tool.get_page_property", () =>
        client.get(`/pages/${params.page_id}/properties/${encodeURIComponent(params.property_id)}?${queryParams}`)
      , { tool: "get_page_property", page_id: params.page_id, property_id: params.property_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_database_properties: async (args) => {
      const params = UpdateDatabasePropertiesSchema.parse(args);
      const result = await logger.time("tool.update_database_properties", () =>
        client.patch(`/databases/${params.database_id}`, { properties: params.properties })
      , { tool: "update_database_properties", database_id: params.database_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    add_database_property: async (args) => {
      const params = AddDatabasePropertySchema.parse(args);
      const result = await logger.time("tool.add_database_property", () =>
        client.patch(`/databases/${params.database_id}`, {
          properties: { [params.property_name]: params.property_schema },
        })
      , { tool: "add_database_property", database_id: params.database_id, property_name: params.property_name });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    remove_database_property: async (args) => {
      const params = RemoveDatabasePropertySchema.parse(args);
      const result = await logger.time("tool.remove_database_property", () =>
        client.patch(`/databases/${params.database_id}`, {
          properties: { [params.property_name]: null },
        })
      , { tool: "remove_database_property", database_id: params.database_id, property_name: params.property_name });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
