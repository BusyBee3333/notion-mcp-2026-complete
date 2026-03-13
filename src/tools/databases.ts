// Notion Database tools: list_databases, get_database, query_database, create_database,
//   filter_database, sort_database, get_database_schema, update_database
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListDatabasesSchema = z.object({
  query: z.string().optional().describe("Filter by database title keyword"),
  start_cursor: z.string().optional().describe("Cursor for next page (from previous has_more response)"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Results per page (1-100, default 25)"),
});

const GetDatabaseSchema = z.object({
  database_id: z.string().describe("Notion database ID (UUID format)"),
});

const QueryDatabaseSchema = z.object({
  database_id: z.string().describe("Notion database ID to query"),
  filter: z.record(z.unknown()).optional().describe("Notion filter object. Example: {property:'Status',select:{equals:'Done'}}"),
  sorts: z.array(z.record(z.unknown())).optional().describe("Sort array. Example: [{property:'Name',direction:'ascending'}]"),
  start_cursor: z.string().optional().describe("Cursor for next page"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Results per page (1-100)"),
});

const CreateDatabaseSchema = z.object({
  parent_page_id: z.string().describe("ID of the parent page that will contain this database"),
  title: z.string().describe("Database title"),
  properties: z.record(z.unknown()).describe("Property schema object. Must include at least a title property. Example: {Name:{title:{}},Status:{select:{options:[{name:'To Do'},{name:'Done'}]}}}"),
  is_inline: z.boolean().optional().describe("Whether database is inline in the parent page"),
});

const FilterDatabaseSchema = z.object({
  database_id: z.string().describe("Notion database ID to filter"),
  filter: z.record(z.unknown()).describe(
    `Notion filter object. Supports:
Single property filters:
- Text/title: {property:'Name',title:{contains:'hello'}} or {property:'Notes',rich_text:{equals:'value'}}
- Number: {property:'Score',number:{greater_than:5}} — operators: equals, does_not_equal, greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to, is_empty, is_not_empty
- Select: {property:'Status',select:{equals:'Done'}} or {select:{is_empty:true}}
- Multi-select: {property:'Tags',multi_select:{contains:'frontend'}}
- Checkbox: {property:'Done',checkbox:{equals:true}}
- Date: {property:'Due',date:{on_or_before:'2024-12-31'}} — operators: equals, before, after, on_or_before, on_or_after, past_week, past_month, past_year, next_week, next_month, next_year, is_empty, is_not_empty
- People: {property:'Assigned',people:{contains:'user_id'}}
- Files: {property:'Attachment',files:{is_empty:false}}
- URL/email/phone: {property:'Website',url:{contains:'notion.so'}}
- Relation: {property:'Project',relation:{contains:'page_id'}}
- Formula: {property:'Formula',formula:{string:{equals:'value'}}}
Compound filters:
- AND: {and:[{property:'Status',select:{equals:'Done'}},{property:'Score',number:{greater_than:5}}]}
- OR: {or:[{property:'Priority',select:{equals:'High'}},{property:'Urgent',checkbox:{equals:true}}]}`
  ),
  start_cursor: z.string().optional().describe("Cursor for next page"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Results per page (1-100, default 25)"),
});

const SortDatabaseSchema = z.object({
  database_id: z.string().describe("Notion database ID to query with sorting"),
  sorts: z.array(z.record(z.unknown())).describe(
    `Array of sort objects. Up to 1 sort is supported by Notion API (use compound filters to narrow results).
Sort by property: [{property:'Name',direction:'ascending'}] or [{property:'Due Date',direction:'descending'}]
Sort by timestamp: [{timestamp:'created_time',direction:'descending'}] or [{timestamp:'last_edited_time',direction:'ascending'}]
direction must be 'ascending' or 'descending'.`
  ),
  filter: z.record(z.unknown()).optional().describe("Optional filter to apply alongside sorting. Example: {property:'Status',select:{equals:'Active'}}"),
  start_cursor: z.string().optional().describe("Cursor for next page"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Results per page (1-100, default 25)"),
});

const GetDatabaseSchemaSchema = z.object({
  database_id: z.string().describe("Notion database ID (UUID format)"),
});

const UpdateDatabaseSchema = z.object({
  database_id: z.string().describe("Notion database ID to update"),
  title: z.string().optional().describe("New title for the database"),
  description: z.string().optional().describe("New description text for the database"),
  icon: z.object({
    type: z.enum(["emoji", "external"]),
    emoji: z.string().optional().describe("Emoji character, e.g. '📋'"),
    external: z.object({ url: z.string() }).optional().describe("External icon URL"),
  }).optional().describe("Database icon — emoji or external URL"),
  cover: z.object({
    type: z.literal("external"),
    external: z.object({ url: z.string() }),
  }).optional().describe("Database cover image (external URL)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_databases",
      title: "List Databases",
      description:
        "Search for Notion databases accessible to the integration. Returns database titles, IDs, and property schemas. Use when the user wants to browse available databases. Supports pagination via start_cursor.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Filter by database title keyword" },
          start_cursor: { type: "string", description: "Cursor for next page (from previous has_more response)" },
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
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_database",
      title: "Get Database",
      description:
        "Get the full schema and properties of a specific Notion database by ID. Returns all property definitions (types, options, etc). Use when you need the database structure before querying or creating pages.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID (UUID format)" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "array" },
          properties: { type: "object" },
          created_time: { type: "string" },
          last_edited_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "query_database",
      title: "Query Database",
      description:
        "Query a Notion database with optional filters and sorts. Returns matching page entries with all properties. Use when the user wants to find pages matching criteria. Supports cursor pagination. Do NOT use to get database schema (use get_database).",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID to query" },
          filter: { type: "object", description: "Notion filter object. Example: {property:'Status',select:{equals:'Done'}}" },
          sorts: { type: "array", items: { type: "object" }, description: "Sort array. Example: [{property:'Name',direction:'ascending'}]" },
          start_cursor: { type: "string", description: "Cursor for next page" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id"],
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
      name: "create_database",
      title: "Create Database",
      description:
        "Create a new Notion database as a child of a parent page. Requires a property schema defining columns. Returns the created database with ID.",
      inputSchema: {
        type: "object",
        properties: {
          parent_page_id: { type: "string", description: "ID of the parent page that will contain this database" },
          title: { type: "string", description: "Database title" },
          properties: { type: "object", description: "Property schema. Must include a title property. Example: {Name:{title:{}},Status:{select:{options:[{name:'To Do'},{name:'Done'}]}}}" },
          is_inline: { type: "boolean", description: "Whether database is inline in the parent page" },
        },
        required: ["parent_page_id", "title", "properties"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "array" },
          properties: { type: "object" },
          url: { type: "string" },
          created_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "filter_database",
      title: "Filter Database",
      description:
        "Query a Notion database with a rich filter expression. Supports equality, contains, comparison, date range, empty checks, and compound AND/OR filters across all property types (text, number, select, multi_select, date, checkbox, people, relation, formula, files). Returns matching entries with pagination.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID to filter" },
          filter: {
            type: "object",
            description: "Notion filter object. Single: {property:'Status',select:{equals:'Done'}}. Compound: {and:[...]} or {or:[...]}. Date: {property:'Due',date:{on_or_before:'2024-12-31'}}. Number: {property:'Score',number:{greater_than:5}}.",
          },
          start_cursor: { type: "string", description: "Cursor for next page" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "filter"],
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
      name: "sort_database",
      title: "Sort Database",
      description:
        "Query a Notion database sorted by a property or timestamp. Sort by any property (ascending or descending) or by created_time/last_edited_time. Optionally combine with a filter. Returns sorted entries with pagination.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID to sort" },
          sorts: { type: "array", items: { type: "object" }, description: "Sort array. Property sort: [{property:'Name',direction:'ascending'}]. Timestamp sort: [{timestamp:'created_time',direction:'descending'}]." },
          filter: { type: "object", description: "Optional filter. E.g. {property:'Status',select:{equals:'Active'}}" },
          start_cursor: { type: "string", description: "Cursor for next page" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "sorts"],
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
      name: "get_database_schema",
      title: "Get Database Schema",
      description:
        "Get the property schema of a Notion database — returns all column names, types, and configuration (select options, relation targets, formula expressions, rollup configs, etc.). A focused version of get_database that highlights the schema for use when building filters, creating pages, or updating properties.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID (UUID format)" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          title: { type: "string" },
          properties: { type: "object" },
          property_names: { type: "array", items: { type: "string" } },
          property_types: { type: "object" },
          url: { type: "string" },
        },
        required: ["database_id", "properties"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_database",
      title: "Update Database",
      description:
        "Update a Notion database's metadata — rename it, change its description, update its icon or cover image. To update property schemas, use update_database_properties, add_database_property, or remove_database_property instead.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID to update" },
          title: { type: "string", description: "New title for the database" },
          description: { type: "string", description: "New description text" },
          icon: { type: "object", description: "New icon: {type:'emoji',emoji:'📋'} or {type:'external',external:{url:'https://...'}}" },
          cover: { type: "object", description: "New cover: {type:'external',external:{url:'https://...'}}" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "array" },
          last_edited_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_databases: async (args) => {
      const params = ListDatabasesSchema.parse(args);
      const body: Record<string, unknown> = {
        filter: { value: "database", property: "object" },
        page_size: params.page_size,
      };
      if (params.query) body.query = params.query;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.list_databases", () =>
        client.post("/search", body)
      , { tool: "list_databases" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_database: async (args) => {
      const { database_id } = GetDatabaseSchema.parse(args);
      const result = await logger.time("tool.get_database", () =>
        client.get(`/databases/${database_id}`)
      , { tool: "get_database", database_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    query_database: async (args) => {
      const params = QueryDatabaseSchema.parse(args);
      const body: Record<string, unknown> = { page_size: params.page_size };
      if (params.filter) body.filter = params.filter;
      if (params.sorts) body.sorts = params.sorts;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.query_database", () =>
        client.post(`/databases/${params.database_id}/query`, body)
      , { tool: "query_database", database_id: params.database_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_database: async (args) => {
      const params = CreateDatabaseSchema.parse(args);

      const body: Record<string, unknown> = {
        parent: { type: "page_id", page_id: params.parent_page_id },
        title: [{ type: "text", text: { content: params.title } }],
        properties: params.properties,
        ...(params.is_inline !== undefined ? { is_inline: params.is_inline } : {}),
      };

      const result = await logger.time("tool.create_database", () =>
        client.post("/databases", body)
      , { tool: "create_database" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    filter_database: async (args) => {
      const params = FilterDatabaseSchema.parse(args);
      const body: Record<string, unknown> = {
        filter: params.filter,
        page_size: params.page_size,
      };
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.filter_database", () =>
        client.post(`/databases/${params.database_id}/query`, body)
      , { tool: "filter_database", database_id: params.database_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    sort_database: async (args) => {
      const params = SortDatabaseSchema.parse(args);
      const body: Record<string, unknown> = {
        sorts: params.sorts,
        page_size: params.page_size,
      };
      if (params.filter) body.filter = params.filter;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.sort_database", () =>
        client.post(`/databases/${params.database_id}/query`, body)
      , { tool: "sort_database", database_id: params.database_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_database_schema: async (args) => {
      const { database_id } = GetDatabaseSchemaSchema.parse(args);
      const db = await logger.time("tool.get_database_schema", () =>
        client.get<Record<string, unknown>>(`/databases/${database_id}`)
      , { tool: "get_database_schema", database_id });

      const properties = (db.properties as Record<string, Record<string, unknown>>) || {};
      const propertyNames = Object.keys(properties);
      const propertyTypes: Record<string, string> = {};
      for (const [name, prop] of Object.entries(properties)) {
        propertyTypes[name] = prop.type as string;
      }

      const titleArr = db.title as Array<{ plain_text?: string }> | undefined;
      const titleText = titleArr?.map((t) => t.plain_text || "").join("") || "";

      const structured = {
        database_id: db.id,
        title: titleText,
        properties,
        property_names: propertyNames,
        property_types: propertyTypes,
        url: db.url,
        created_time: db.created_time,
        last_edited_time: db.last_edited_time,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    update_database: async (args) => {
      const params = UpdateDatabaseSchema.parse(args);
      const body: Record<string, unknown> = {};

      if (params.title !== undefined) {
        body.title = [{ type: "text", text: { content: params.title } }];
      }
      if (params.description !== undefined) {
        body.description = [{ type: "text", text: { content: params.description } }];
      }
      if (params.icon) body.icon = params.icon;
      if (params.cover) body.cover = params.cover;

      const result = await logger.time("tool.update_database", () =>
        client.patch(`/databases/${params.database_id}`, body)
      , { tool: "update_database", database_id: params.database_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
