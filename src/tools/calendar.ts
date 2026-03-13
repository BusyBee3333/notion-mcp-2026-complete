// Notion Calendar & Date tools: query_database_by_date_range, get_today_pages,
//   get_upcoming_pages, get_overdue_pages, get_pages_in_month,
//   group_database_by_date, query_database_by_date_property
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const QueryByDateRangeSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  date_property: z.string().describe("Name of the date property to filter on"),
  start_date: z.string().describe("Start of date range (ISO 8601). E.g. '2024-01-01'"),
  end_date: z.string().describe("End of date range (ISO 8601). E.g. '2024-01-31'"),
  additional_filter: z.record(z.unknown()).optional().describe("Additional Notion filter to AND with the date filter"),
  sorts: z.array(z.record(z.unknown())).optional().describe("Sort array. E.g. [{property:'Due',direction:'ascending'}]"),
  start_cursor: z.string().optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const GetTodayPagesSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  date_property: z.string().describe("Name of the date property to check for today"),
  sorts: z.array(z.record(z.unknown())).optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const GetUpcomingPagesSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  date_property: z.string().describe("Name of the date property"),
  period: z.enum(["next_week", "next_month", "next_year"]).optional().default("next_week").describe("Future period to query (default: next_week)"),
  additional_filter: z.record(z.unknown()).optional(),
  sorts: z.array(z.record(z.unknown())).optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const GetOverduePagesSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  date_property: z.string().describe("Name of the date property (e.g. 'Due Date')"),
  exclude_done_property: z.string().optional().describe("Optional checkbox property name — exclude pages where this is checked (e.g. 'Done')"),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const GetPagesInMonthSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  date_property: z.string().describe("Name of the date property"),
  year: z.number().int().min(2000).max(2099).describe("Year (e.g. 2024)"),
  month: z.number().int().min(1).max(12).describe("Month number (1-12)"),
  page_size: z.number().min(1).max(100).optional().default(100),
});

const GroupDatabaseByDateSchema = z.object({
  database_id: z.string().describe("Database ID to query and group"),
  date_property: z.string().describe("Name of the date property to group by"),
  group_by: z.enum(["day", "week", "month", "year"]).optional().default("day").describe("How to group the results (default: day)"),
  filter: z.record(z.unknown()).optional(),
  max_pages: z.number().min(1).max(500).optional().default(200),
});

const QueryByRelativeDateSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  date_property: z.string().describe("Name of the date property"),
  relative_date: z.enum([
    "past_week", "past_month", "past_year",
    "next_week", "next_month", "next_year",
    "this_week"
  ]).describe("Relative date period"),
  sorts: z.array(z.record(z.unknown())).optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "query_database_by_date_range",
      title: "Query Database by Date Range",
      description:
        "Query a Notion database for pages where a date property falls within a specific date range. Builds the correct Notion date filter automatically. Supports AND-ing with additional filters.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          date_property: { type: "string", description: "Name of the date property to filter on" },
          start_date: { type: "string", description: "Start date (ISO 8601). E.g. '2024-01-01'" },
          end_date: { type: "string", description: "End date (ISO 8601). E.g. '2024-01-31'" },
          additional_filter: { type: "object", description: "Extra Notion filter to AND with date filter" },
          sorts: { type: "array", items: { type: "object" } },
          start_cursor: { type: "string" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "date_property", "start_date", "end_date"],
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
      name: "get_today_pages",
      title: "Get Today's Pages",
      description:
        "Get all pages in a Notion database whose date property is set to today. Perfect for daily dashboards, standup summaries, or finding tasks due today.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          date_property: { type: "string", description: "Name of the date property to check for today" },
          sorts: { type: "array", items: { type: "object" } },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "date_property"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          today: { type: "string" },
          count: { type: "number" },
          has_more: { type: "boolean" },
        },
        required: ["results", "today", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_upcoming_pages",
      title: "Get Upcoming Pages",
      description:
        "Get pages in a Notion database whose date property is in the upcoming period (next week, month, or year). Great for planning views and calendar summaries.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          date_property: { type: "string", description: "Name of the date property" },
          period: { type: "string", enum: ["next_week", "next_month", "next_year"], description: "Future period (default: next_week)" },
          additional_filter: { type: "object" },
          sorts: { type: "array", items: { type: "object" } },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "date_property"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          period: { type: "string" },
          count: { type: "number" },
          has_more: { type: "boolean" },
        },
        required: ["results", "period", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_overdue_pages",
      title: "Get Overdue Pages",
      description:
        "Get pages in a Notion database whose date property is in the past (overdue). Optionally exclude pages where a 'Done' checkbox is checked. Perfect for finding overdue tasks or past deadlines.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          date_property: { type: "string", description: "Name of the date property (e.g. 'Due Date')" },
          exclude_done_property: { type: "string", description: "Checkbox property name to exclude done items (e.g. 'Done')" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "date_property"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          has_more: { type: "boolean" },
        },
        required: ["results", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_pages_in_month",
      title: "Get Pages in Month",
      description:
        "Get all pages in a Notion database whose date property falls within a specific calendar month. Returns all matching pages with automatic date range calculation.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          date_property: { type: "string", description: "Name of the date property" },
          year: { type: "number", description: "Year (e.g. 2024)" },
          month: { type: "number", description: "Month number (1-12)" },
          page_size: { type: "number", description: "Results per page (1-100, default 100)" },
        },
        required: ["database_id", "date_property", "year", "month"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          year: { type: "number" },
          month: { type: "number" },
          start_date: { type: "string" },
          end_date: { type: "string" },
          count: { type: "number" },
          has_more: { type: "boolean" },
        },
        required: ["results", "year", "month", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "group_database_by_date",
      title: "Group Database by Date",
      description:
        "Query a Notion database and group the results by date (day, week, month, or year). Returns a structured object with date keys and arrays of pages under each date bucket. Useful for calendar-style summaries and date-based analytics.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          date_property: { type: "string", description: "Name of the date property to group by" },
          group_by: { type: "string", enum: ["day", "week", "month", "year"], description: "Grouping granularity (default: day)" },
          filter: { type: "object" },
          max_pages: { type: "number", description: "Max pages to fetch (1-500, default 200)" },
        },
        required: ["database_id", "date_property"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          group_by: { type: "string" },
          groups: { type: "object" },
          total_pages: { type: "number" },
          group_count: { type: "number" },
        },
        required: ["database_id", "group_by", "groups", "total_pages"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "query_database_by_relative_date",
      title: "Query Database by Relative Date",
      description:
        "Query a Notion database using a relative date filter (past_week, past_month, past_year, next_week, next_month, next_year). Notion calculates the date range relative to today automatically.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          date_property: { type: "string", description: "Name of the date property to filter on" },
          relative_date: {
            type: "string",
            enum: ["past_week", "past_month", "past_year", "next_week", "next_month", "next_year", "this_week"],
            description: "Relative date period",
          },
          sorts: { type: "array", items: { type: "object" } },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "date_property", "relative_date"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          relative_date: { type: "string" },
          count: { type: "number" },
          has_more: { type: "boolean" },
        },
        required: ["results", "relative_date", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    query_database_by_date_range: async (args) => {
      const params = QueryByDateRangeSchema.parse(args);
      const dateFilter = {
        and: [
          { property: params.date_property, date: { on_or_after: params.start_date } },
          { property: params.date_property, date: { on_or_before: params.end_date } },
        ],
      };

      const notionFilter = params.additional_filter
        ? { and: [dateFilter, params.additional_filter] }
        : dateFilter;

      const body: Record<string, unknown> = { filter: notionFilter, page_size: params.page_size };
      if (params.sorts) body.sorts = params.sorts;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.query_database_by_date_range", () =>
        client.post(`/databases/${params.database_id}/query`, body)
      , { tool: "query_database_by_date_range", database_id: params.database_id });

      const structured = { ...(result as Record<string, unknown>), filter_applied: notionFilter };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_today_pages: async (args) => {
      const params = GetTodayPagesSchema.parse(args);
      const today = new Date().toISOString().split("T")[0];
      const filter = { property: params.date_property, date: { equals: today } };
      const body: Record<string, unknown> = { filter, page_size: params.page_size };
      if (params.sorts) body.sorts = params.sorts;

      const result = await logger.time("tool.get_today_pages", () =>
        client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
      , { tool: "get_today_pages", database_id: params.database_id });

      const results = (result.results as unknown[]) || [];
      const structured = { results, today, count: results.length, has_more: result.has_more };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_upcoming_pages: async (args) => {
      const params = GetUpcomingPagesSchema.parse(args);
      const dateFilter = { property: params.date_property, date: { [params.period]: {} } };
      const filter = params.additional_filter
        ? { and: [dateFilter, params.additional_filter] }
        : dateFilter;

      const body: Record<string, unknown> = { filter, page_size: params.page_size };
      if (params.sorts) body.sorts = params.sorts;

      const result = await logger.time("tool.get_upcoming_pages", () =>
        client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
      , { tool: "get_upcoming_pages", database_id: params.database_id });

      const results = (result.results as unknown[]) || [];
      const structured = { results, period: params.period, count: results.length, has_more: result.has_more };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_overdue_pages: async (args) => {
      const params = GetOverduePagesSchema.parse(args);
      const today = new Date().toISOString().split("T")[0];

      const dateFilter = { property: params.date_property, date: { before: today } };
      let filter: Record<string, unknown> = dateFilter;

      if (params.exclude_done_property) {
        filter = {
          and: [
            dateFilter,
            { property: params.exclude_done_property, checkbox: { equals: false } },
          ],
        };
      }

      const body: Record<string, unknown> = {
        filter,
        page_size: params.page_size,
        sorts: [{ property: params.date_property, direction: "ascending" }],
      };

      const result = await logger.time("tool.get_overdue_pages", () =>
        client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
      , { tool: "get_overdue_pages", database_id: params.database_id });

      const results = (result.results as unknown[]) || [];
      const structured = { results, count: results.length, has_more: result.has_more };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_pages_in_month: async (args) => {
      const params = GetPagesInMonthSchema.parse(args);
      const startDate = `${params.year}-${String(params.month).padStart(2, "0")}-01`;
      const lastDay = new Date(params.year, params.month, 0).getDate();
      const endDate = `${params.year}-${String(params.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const filter = {
        and: [
          { property: params.date_property, date: { on_or_after: startDate } },
          { property: params.date_property, date: { on_or_before: endDate } },
        ],
      };
      const body: Record<string, unknown> = {
        filter,
        page_size: params.page_size,
        sorts: [{ property: params.date_property, direction: "ascending" }],
      };

      const result = await logger.time("tool.get_pages_in_month", () =>
        client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
      , { tool: "get_pages_in_month", database_id: params.database_id });

      const results = (result.results as unknown[]) || [];
      const structured = {
        results,
        year: params.year,
        month: params.month,
        start_date: startDate,
        end_date: endDate,
        count: results.length,
        has_more: result.has_more,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    group_database_by_date: async (args) => {
      const params = GroupDatabaseByDateSchema.parse(args);
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = {
          page_size: 100,
          sorts: [{ property: params.date_property, direction: "ascending" }],
        };
        if (params.filter) body.filter = params.filter;
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.group_database_by_date.fetch", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "group_database_by_date", database_id: params.database_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const page of results) {
          if (allPages.length >= params.max_pages) break;
          allPages.push(page);
        }
        cursor = allPages.length >= params.max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      // Group by date
      const groups: Record<string, Record<string, unknown>[]> = {};
      for (const page of allPages) {
        const props = page.properties as Record<string, Record<string, unknown>> | undefined;
        if (!props) continue;
        const dateProp = props[params.date_property];
        if (!dateProp) continue;
        const dateVal = dateProp.date as { start?: string } | null | undefined;
        if (!dateVal?.start) {
          const key = "no_date";
          if (!groups[key]) groups[key] = [];
          groups[key].push(page);
          continue;
        }

        const d = new Date(dateVal.start);
        let key: string;
        switch (params.group_by) {
          case "year":
            key = String(d.getUTCFullYear());
            break;
          case "month":
            key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
            break;
          case "week": {
            const startOfWeek = new Date(d);
            startOfWeek.setUTCDate(d.getUTCDate() - d.getUTCDay());
            key = startOfWeek.toISOString().split("T")[0];
            break;
          }
          default:
            key = dateVal.start.split("T")[0];
        }

        if (!groups[key]) groups[key] = [];
        groups[key].push(page);
      }

      const structured = {
        database_id: params.database_id,
        group_by: params.group_by,
        groups,
        total_pages: allPages.length,
        group_count: Object.keys(groups).length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    query_database_by_relative_date: async (args) => {
      const params = QueryByRelativeDateSchema.parse(args);

      // For "this_week", use past_week as approximation (Notion doesn't have "this_week")
      const filterPeriod = params.relative_date === "this_week" ? "past_week" : params.relative_date;
      const filter = { property: params.date_property, date: { [filterPeriod]: {} } };
      const body: Record<string, unknown> = { filter, page_size: params.page_size };
      if (params.sorts) body.sorts = params.sorts;

      const result = await logger.time("tool.query_database_by_relative_date", () =>
        client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
      , { tool: "query_database_by_relative_date", database_id: params.database_id });

      const results = (result.results as unknown[]) || [];
      const structured = {
        results,
        relative_date: params.relative_date,
        count: results.length,
        has_more: result.has_more,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
