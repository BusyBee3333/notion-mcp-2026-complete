// Notion Search tools: search, search_databases_only, search_pages_only, search_by_title
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

const SearchDatabasesOnlySchema = z.object({
  query: z.string().optional().describe("Text to search for in database titles. Leave empty to list all accessible databases."),
  sort_direction: z.enum(["ascending", "descending"]).optional().default("descending").describe("Sort direction (default: descending)"),
  sort_timestamp: z.enum(["last_edited_time", "created_time"]).optional().default("last_edited_time").describe("Property to sort by (default: last_edited_time)"),
  start_cursor: z.string().optional().describe("Cursor for next page of results"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Results per page (1-100, default 25)"),
});

const SearchPagesOnlySchema = z.object({
  query: z.string().optional().describe("Text to search for in page titles. Leave empty to list all accessible pages."),
  sort_direction: z.enum(["ascending", "descending"]).optional().default("descending").describe("Sort direction (default: descending)"),
  sort_timestamp: z.enum(["last_edited_time", "created_time"]).optional().default("last_edited_time").describe("Property to sort by (default: last_edited_time)"),
  start_cursor: z.string().optional().describe("Cursor for next page of results"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Results per page (1-100, default 25)"),
});

const SearchByTitleSchema = z.object({
  title: z.string().describe("Title text to search for. Returns items whose title contains this string (case-insensitive partial match)."),
  type: z.enum(["page", "database", "all"]).optional().default("all").describe("Limit results to pages, databases, or all (default: all)"),
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
    {
      name: "search_databases_only",
      title: "Search Databases Only",
      description:
        "Search for Notion databases accessible to the integration by title. Returns only databases (not pages). Useful when you specifically want to find a database to query or update. Returns IDs, titles, and property schemas.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Database title to search for (leave empty to list all accessible databases)" },
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
          result_count: { type: "number" },
        },
        required: ["results", "has_more"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    {
      name: "search_pages_only",
      title: "Search Pages Only",
      description:
        "Search for Notion pages (not databases) accessible to the integration by title. Returns only page objects with their IDs, titles, parent info, and URLs. Useful when you want to find a specific page to read or edit.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Page title to search for (leave empty to list all accessible pages)" },
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
          result_count: { type: "number" },
        },
        required: ["results", "has_more"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    {
      name: "search_by_title",
      title: "Search by Title",
      description:
        "Find Notion pages and/or databases whose title contains a given string. Optionally limit to pages or databases. Returns matching results with extracted titles, IDs, and URLs. More focused than the generic search tool for title-based lookups.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title string to search for (partial match, case-insensitive)" },
          type: { type: "string", enum: ["page", "database", "all"], description: "Limit to pages, databases, or all (default: all)" },
          sort_direction: { type: "string", enum: ["ascending", "descending"], description: "Sort direction (default: descending)" },
          sort_timestamp: { type: "string", enum: ["last_edited_time", "created_time"], description: "Sort by (default: last_edited_time)" },
          start_cursor: { type: "string", description: "Cursor for next page of results" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["title"],
      },
      outputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                object: { type: "string" },
                title: { type: "string" },
                url: { type: "string" },
                created_time: { type: "string" },
                last_edited_time: { type: "string" },
              },
            },
          },
          next_cursor: { type: "string" },
          has_more: { type: "boolean" },
          result_count: { type: "number" },
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

    search_databases_only: async (args) => {
      const params = SearchDatabasesOnlySchema.parse(args);
      const body: Record<string, unknown> = {
        filter: { value: "database", property: "object" },
        page_size: params.page_size,
        sort: { direction: params.sort_direction, timestamp: params.sort_timestamp },
      };
      if (params.query) body.query = params.query;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.search_databases_only", () =>
        client.post<Record<string, unknown>>("/search", body)
      , { tool: "search_databases_only", query: params.query });

      const enriched = {
        ...(result as Record<string, unknown>),
        result_count: ((result as Record<string, unknown>).results as unknown[])?.length ?? 0,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }],
        structuredContent: enriched,
      };
    },

    search_pages_only: async (args) => {
      const params = SearchPagesOnlySchema.parse(args);
      const body: Record<string, unknown> = {
        filter: { value: "page", property: "object" },
        page_size: params.page_size,
        sort: { direction: params.sort_direction, timestamp: params.sort_timestamp },
      };
      if (params.query) body.query = params.query;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.search_pages_only", () =>
        client.post<Record<string, unknown>>("/search", body)
      , { tool: "search_pages_only", query: params.query });

      const enriched = {
        ...(result as Record<string, unknown>),
        result_count: ((result as Record<string, unknown>).results as unknown[])?.length ?? 0,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }],
        structuredContent: enriched,
      };
    },

    search_by_title: async (args) => {
      const params = SearchByTitleSchema.parse(args);
      const body: Record<string, unknown> = {
        query: params.title,
        page_size: params.page_size,
        sort: { direction: params.sort_direction, timestamp: params.sort_timestamp },
      };
      if (params.type !== "all") {
        body.filter = { value: params.type, property: "object" };
      }
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const raw = await logger.time("tool.search_by_title", () =>
        client.post<Record<string, unknown>>("/search", body)
      , { tool: "search_by_title", title: params.title });

      const rawResults = (raw.results as Array<Record<string, unknown>>) || [];

      // Extract and normalize titles
      const results = rawResults.map((item) => ({
        id: item.id,
        object: item.object,
        title: extractTitle(item),
        url: item.url,
        created_time: item.created_time,
        last_edited_time: item.last_edited_time,
        parent: item.parent,
      }));

      const structured = {
        query: params.title,
        results,
        next_cursor: raw.next_cursor,
        has_more: raw.has_more,
        result_count: results.length,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}

// ============ Helpers ============

function extractTitle(obj: Record<string, unknown>): string {
  try {
    if (obj.object === "database") {
      const titleArr = obj.title as Array<{ plain_text?: string }>;
      return titleArr?.map((t) => t.plain_text || "").join("") || "(Untitled)";
    }
    const props = obj.properties as Record<string, Record<string, unknown>> | undefined;
    if (props) {
      for (const key of ["title", "Name", "Title"]) {
        const p = props[key];
        if (p?.type === "title") {
          const rt = p.title as Array<{ plain_text?: string }>;
          return rt?.map((t) => t.plain_text || "").join("") || "(Untitled)";
        }
      }
      // Fallback: find any title-type property
      for (const p of Object.values(props)) {
        if (p.type === "title") {
          const rt = p.title as Array<{ plain_text?: string }>;
          return rt?.map((t) => t.plain_text || "").join("") || "(Untitled)";
        }
      }
    }
  } catch {}
  return "(Untitled)";
}
