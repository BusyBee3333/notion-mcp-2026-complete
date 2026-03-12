// Notion Database tools: list_databases, get_database, query_database, create_database
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
  };

  return { tools, handlers };
}
