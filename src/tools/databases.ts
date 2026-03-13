// Notion Database tools: list_databases, get_database, query_database, create_database,
//   filter_database, sort_database, get_database_schema, update_database,
//   list_database_pages_with_all_filters, export_database_to_json, get_database_with_schema
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

// ============ Round 2 Schemas ============

const ListDatabasePagesWithAllFiltersSchema = z.object({
  database_id: z.string().describe("Notion database ID to query"),
  filters: z.array(z.object({
    property: z.string().describe("Property name to filter on"),
    type: z.enum(["title", "rich_text", "number", "select", "multi_select", "date", "checkbox", "url", "email", "phone_number", "people", "files", "relation", "formula"]).describe("Property type"),
    operator: z.string().describe(
      `Filter operator. By type:\n` +
      `- title/rich_text: equals, does_not_equal, contains, does_not_contain, starts_with, ends_with, is_empty, is_not_empty\n` +
      `- number: equals, does_not_equal, greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to, is_empty, is_not_empty\n` +
      `- select: equals, does_not_equal, is_empty, is_not_empty\n` +
      `- multi_select: contains, does_not_contain, is_empty, is_not_empty\n` +
      `- checkbox: equals (true/false)\n` +
      `- date: equals, before, after, on_or_before, on_or_after, is_empty, is_not_empty, past_week, past_month, past_year, next_week, next_month, next_year\n` +
      `- people: contains, does_not_contain, is_empty, is_not_empty`
    ),
    value: z.unknown().optional().describe("Value to compare against. For is_empty/is_not_empty operators, omit or pass true. For date operators like past_week, omit the value."),
  })).describe("Array of filter conditions"),
  compound: z.enum(["and", "or"]).optional().default("and").describe("Combine filters with AND (default) or OR logic"),
  sorts: z.array(z.record(z.unknown())).optional().describe("Sort array. E.g. [{property:'Name',direction:'ascending'}]"),
  start_cursor: z.string().optional().describe("Cursor for next page"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Results per page (1-100, default 25)"),
});

const ExportDatabaseToJsonSchema = z.object({
  database_id: z.string().describe("Notion database ID to export"),
  filter: z.record(z.unknown()).optional().describe("Optional Notion filter to limit which pages are exported"),
  sorts: z.array(z.record(z.unknown())).optional().describe("Optional sort order. E.g. [{property:'Name',direction:'ascending'}]"),
  max_pages: z.number().min(1).max(2000).optional().default(500).describe("Maximum number of pages to fetch (default 500, max 2000)"),
  include_properties: z.array(z.string()).optional().describe("Only include these property names in the output. Omit to include all properties."),
});

const GetDatabaseWithSchemaSchema = z.object({
  database_id: z.string().describe("Notion database ID (UUID format)"),
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

    // ============ Round 2 Tool Definitions ============

    {
      name: "list_database_pages_with_all_filters",
      title: "List Database Pages With All Filters",
      description:
        "Query a Notion database with a simplified filter spec — pass a flat array of {property, type, operator, value} conditions and specify whether to combine them with AND or OR. Handles building the correct compound Notion filter object automatically. Great for multi-condition queries without needing to know the exact Notion filter JSON structure.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID to query" },
          filters: {
            type: "array",
            items: { type: "object" },
            description: "Filter conditions. Each: {property, type, operator, value}. E.g. [{property:'Status',type:'select',operator:'equals',value:'Done'},{property:'Score',type:'number',operator:'greater_than',value:5}]",
          },
          compound: { type: "string", enum: ["and", "or"], description: "Combine filters with 'and' (default) or 'or'" },
          sorts: { type: "array", items: { type: "object" }, description: "Sort array. E.g. [{property:'Name',direction:'ascending'}]" },
          start_cursor: { type: "string", description: "Cursor for next page" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "filters"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          next_cursor: { type: "string" },
          has_more: { type: "boolean" },
          filter_applied: { type: "object" },
        },
        required: ["results", "has_more"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "export_database_to_json",
      title: "Export Database to JSON",
      description:
        "Fetch ALL pages from a Notion database and return them as a structured JSON array. Automatically handles cursor pagination to retrieve beyond the 100-item limit. Useful for bulk exports, backups, or feeding data to downstream tools. Supports optional filter and sort. Returns pages with their full property values.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID to export" },
          filter: { type: "object", description: "Optional Notion filter to limit exported pages. E.g. {property:'Status',select:{equals:'Done'}}" },
          sorts: { type: "array", items: { type: "object" }, description: "Optional sort. E.g. [{property:'Name',direction:'ascending'}]" },
          max_pages: { type: "number", description: "Max pages to fetch (1-2000, default 500)" },
          include_properties: { type: "array", items: { type: "string" }, description: "Only include these property names. Omit for all." },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          total_exported: { type: "number" },
          pages: { type: "array", items: { type: "object" } },
          truncated: { type: "boolean" },
        },
        required: ["database_id", "total_exported", "pages"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_database_with_schema",
      title: "Get Database With Schema",
      description:
        "Fetch a database and return its complete metadata PLUS a rich human-readable schema description of every property — including types, select/multi-select options, relation targets, formula expressions, rollup configs, and number formats. More informative than get_database alone. Use before building complex queries or creating pages.",
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
          url: { type: "string" },
          created_time: { type: "string" },
          last_edited_time: { type: "string" },
          properties: { type: "object" },
          schema_summary: { type: "array", items: { type: "object" } },
        },
        required: ["database_id", "properties", "schema_summary"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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

    // ============ Round 2 Handlers ============

    list_database_pages_with_all_filters: async (args) => {
      const params = ListDatabasePagesWithAllFiltersSchema.parse(args);

      // Build individual filter clauses
      const filterClauses = params.filters.map((f) => {
        const propType = f.type;
        const op = f.operator;

        // Operators that don't need a value
        const noValueOps = ["is_empty", "is_not_empty", "past_week", "past_month", "past_year", "next_week", "next_month", "next_year"];

        let typeFilter: Record<string, unknown>;
        if (noValueOps.includes(op)) {
          typeFilter = { [op]: true };
        } else {
          typeFilter = { [op]: f.value };
        }

        // formula needs a nested type
        if (propType === "formula") {
          // guess inner type from value
          const inner = typeof f.value === "boolean" ? "checkbox" : typeof f.value === "number" ? "number" : "string";
          return { property: f.property, formula: { [inner]: typeFilter } };
        }

        return { property: f.property, [propType]: typeFilter };
      });

      let notionFilter: Record<string, unknown>;
      if (filterClauses.length === 1) {
        notionFilter = filterClauses[0];
      } else {
        notionFilter = { [params.compound]: filterClauses };
      }

      const body: Record<string, unknown> = {
        filter: notionFilter,
        page_size: params.page_size,
      };
      if (params.sorts) body.sorts = params.sorts;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.list_database_pages_with_all_filters", () =>
        client.post(`/databases/${params.database_id}/query`, body)
      , { tool: "list_database_pages_with_all_filters", database_id: params.database_id });

      return {
        content: [{ type: "text", text: JSON.stringify({ ...(result as Record<string, unknown>), filter_applied: notionFilter }, null, 2) }],
        structuredContent: { ...(result as Record<string, unknown>), filter_applied: notionFilter },
      };
    },

    export_database_to_json: async (args) => {
      const params = ExportDatabaseToJsonSchema.parse(args);
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;
      let truncated = false;

      do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (params.filter) body.filter = params.filter;
        if (params.sorts) body.sorts = params.sorts;
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.export_database_to_json.fetch", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "export_database_to_json", database_id: params.database_id, fetched: allPages.length });

        const results = (response.results as Record<string, unknown>[]) || [];

        for (const page of results) {
          if (allPages.length >= params.max_pages) {
            truncated = true;
            break;
          }

          if (params.include_properties && params.include_properties.length > 0) {
            const props = page.properties as Record<string, unknown> | undefined;
            const filtered: Record<string, unknown> = {};
            if (props) {
              for (const key of params.include_properties) {
                if (key in props) filtered[key] = props[key];
              }
            }
            allPages.push({ ...page, properties: filtered });
          } else {
            allPages.push(page);
          }
        }

        cursor = truncated ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      const result = {
        database_id: params.database_id,
        total_exported: allPages.length,
        truncated,
        pages: allPages,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_database_with_schema: async (args) => {
      const { database_id } = GetDatabaseWithSchemaSchema.parse(args);
      const db = await logger.time("tool.get_database_with_schema", () =>
        client.get<Record<string, unknown>>(`/databases/${database_id}`)
      , { tool: "get_database_with_schema", database_id });

      const properties = (db.properties as Record<string, Record<string, unknown>>) || {};
      const titleArr = db.title as Array<{ plain_text?: string }> | undefined;
      const titleText = titleArr?.map((t) => t.plain_text || "").join("") || "";

      // Build a rich schema summary for each property
      const schemaSummary = Object.entries(properties).map(([name, prop]) => {
        const entry: Record<string, unknown> = {
          name,
          id: prop.id,
          type: prop.type,
        };
        const ptype = prop.type as string;

        switch (ptype) {
          case "select": {
            const sel = prop.select as { options?: Array<{ name: string; color?: string }> } | undefined;
            entry.options = sel?.options?.map((o) => ({ name: o.name, color: o.color })) || [];
            break;
          }
          case "multi_select": {
            const ms = prop.multi_select as { options?: Array<{ name: string; color?: string }> } | undefined;
            entry.options = ms?.options?.map((o) => ({ name: o.name, color: o.color })) || [];
            break;
          }
          case "status": {
            const st = prop.status as { options?: Array<{ name: string; color?: string }>; groups?: Array<{ name: string }> } | undefined;
            entry.options = st?.options?.map((o) => ({ name: o.name, color: o.color })) || [];
            entry.groups = st?.groups?.map((g) => g.name) || [];
            break;
          }
          case "relation": {
            const rel = prop.relation as { database_id?: string; type?: string; single_property?: unknown; dual_property?: unknown } | undefined;
            entry.related_database_id = rel?.database_id;
            entry.relation_type = rel?.type;
            break;
          }
          case "rollup": {
            const ru = prop.rollup as { relation_property_name?: string; rollup_property_name?: string; function?: string } | undefined;
            entry.relation_property = ru?.relation_property_name;
            entry.rollup_property = ru?.rollup_property_name;
            entry.rollup_function = ru?.function;
            break;
          }
          case "formula": {
            const fm = prop.formula as { expression?: string } | undefined;
            entry.expression = fm?.expression;
            break;
          }
          case "number": {
            const nm = prop.number as { format?: string } | undefined;
            entry.format = nm?.format;
            break;
          }
        }

        return entry;
      });

      const structured = {
        database_id: db.id,
        title: titleText,
        url: db.url,
        created_time: db.created_time,
        last_edited_time: db.last_edited_time,
        icon: db.icon,
        cover: db.cover,
        is_inline: db.is_inline,
        properties,
        schema_summary: schemaSummary,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
