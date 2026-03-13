// Notion Number Property tools: set_number_value, increment_number,
//   decrement_number, sum_number_property, average_number_property,
//   find_min_max, query_by_number_range, format_number_display
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const SetNumberValueSchema = z.object({
  page_id: z.string().describe("Page ID to update"),
  property_name: z.string().describe("Name of the number property"),
  value: z.number().nullable().describe("New numeric value, or null to clear"),
});

const IncrementNumberSchema = z.object({
  page_id: z.string().describe("Page ID to update"),
  property_name: z.string().describe("Name of the number property"),
  by: z.number().optional().default(1).describe("Amount to increment by (default: 1, can be negative)"),
});

const SumNumberPropertySchema = z.object({
  database_id: z.string().describe("Database ID to sum across"),
  property_name: z.string().describe("Name of the number property to sum"),
  filter: z.record(z.unknown()).optional().describe("Optional filter to scope which pages are included"),
  max_pages: z.number().min(1).max(2000).optional().default(500),
});

const AverageNumberPropertySchema = z.object({
  database_id: z.string().describe("Database ID to average across"),
  property_name: z.string().describe("Name of the number property to average"),
  filter: z.record(z.unknown()).optional(),
  max_pages: z.number().min(1).max(2000).optional().default(500),
});

const FindMinMaxSchema = z.object({
  database_id: z.string().describe("Database ID"),
  property_name: z.string().describe("Name of the number property"),
  filter: z.record(z.unknown()).optional(),
  max_pages: z.number().min(1).max(2000).optional().default(500),
});

const QueryByNumberRangeSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  property_name: z.string().describe("Name of the number property"),
  min: z.number().optional().describe("Minimum value (inclusive). Omit for no lower bound."),
  max: z.number().optional().describe("Maximum value (inclusive). Omit for no upper bound."),
  sorts: z.array(z.record(z.unknown())).optional(),
  start_cursor: z.string().optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const GetNumberStatsSchema = z.object({
  database_id: z.string().describe("Database ID"),
  property_name: z.string().describe("Name of the number property to analyze"),
  filter: z.record(z.unknown()).optional(),
  max_pages: z.number().min(1).max(2000).optional().default(500),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "set_number_value",
      title: "Set Number Value",
      description:
        "Set a number property on a Notion page to a specific value. Simpler than update_page for number-only changes. Pass null to clear the number.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to update" },
          property_name: { type: "string", description: "Name of the number property" },
          value: { type: "number", description: "New numeric value (or null to clear)" },
        },
        required: ["page_id", "property_name", "value"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          property_name: { type: "string" },
          new_value: { type: "number" },
        },
        required: ["id", "property_name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "increment_number",
      title: "Increment Number",
      description:
        "Increment (or decrement) a number property on a Notion page by a given amount. Reads the current value, adds the increment, and writes it back. Use negative 'by' values to decrement.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to update" },
          property_name: { type: "string", description: "Name of the number property" },
          by: { type: "number", description: "Amount to add (use negative to subtract, default: 1)" },
        },
        required: ["page_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          property_name: { type: "string" },
          old_value: { type: "number" },
          new_value: { type: "number" },
          increment: { type: "number" },
        },
        required: ["id", "property_name", "new_value"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "sum_number_property",
      title: "Sum Number Property",
      description:
        "Sum the values of a number property across all pages in a Notion database. Optionally filter which pages are included. Returns total sum, count of non-null values, and count of null values.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Number property name to sum" },
          filter: { type: "object", description: "Optional filter" },
          max_pages: { type: "number", description: "Max pages to include (default 500)" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          sum: { type: "number" },
          count_with_value: { type: "number" },
          count_null: { type: "number" },
          total_pages: { type: "number" },
        },
        required: ["database_id", "property_name", "sum"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "average_number_property",
      title: "Average Number Property",
      description:
        "Calculate the average (mean) of a number property across all pages in a Notion database. Skips null values. Optionally filter which pages are included.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Number property name to average" },
          filter: { type: "object" },
          max_pages: { type: "number", description: "Max pages (default 500)" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          average: { type: "number" },
          sum: { type: "number" },
          count: { type: "number" },
        },
        required: ["database_id", "property_name"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "find_min_max_number",
      title: "Find Min/Max Number",
      description:
        "Find the minimum and maximum values of a number property across all pages in a Notion database. Returns min, max, range, and which pages hold those values.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Number property name" },
          filter: { type: "object" },
          max_pages: { type: "number", description: "Max pages (default 500)" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          min: { type: "number" },
          max: { type: "number" },
          range: { type: "number" },
          min_page_id: { type: "string" },
          max_page_id: { type: "string" },
          count: { type: "number" },
        },
        required: ["database_id", "property_name"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "query_by_number_range",
      title: "Query by Number Range",
      description:
        "Query a Notion database for pages where a number property falls within a given range. Specify a min, max, or both. Automatically constructs the correct Notion filter.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Number property name to filter on" },
          min: { type: "number", description: "Minimum value (inclusive). Omit for no lower bound." },
          max: { type: "number", description: "Maximum value (inclusive). Omit for no upper bound." },
          sorts: { type: "array", items: { type: "object" } },
          start_cursor: { type: "string" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          has_more: { type: "boolean" },
          filter_applied: { type: "object" },
        },
        required: ["results", "has_more"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_number_stats",
      title: "Get Number Statistics",
      description:
        "Calculate comprehensive statistics for a number property across all pages in a Notion database: sum, average, min, max, count, standard deviation, and percentile distribution.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Number property name to analyze" },
          filter: { type: "object" },
          max_pages: { type: "number", description: "Max pages (default 500)" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          count: { type: "number" },
          sum: { type: "number" },
          average: { type: "number" },
          min: { type: "number" },
          max: { type: "number" },
          range: { type: "number" },
          std_dev: { type: "number" },
          null_count: { type: "number" },
        },
        required: ["database_id", "property_name", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Helpers ============

  async function fetchAllNumbers(
    database_id: string,
    property_name: string,
    filter: Record<string, unknown> | undefined,
    max_pages: number,
    client_ref: typeof client
  ): Promise<Array<{ page_id: string; value: number | null }>> {
    const results: Array<{ page_id: string; value: number | null }> = [];
    let cursor: string | undefined;
    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (filter) body.filter = filter;
      if (cursor) body.start_cursor = cursor;
      const response = await logger.time("tool.number.fetch", () =>
        client_ref.post<Record<string, unknown>>(`/databases/${database_id}/query`, body)
      , { tool: "number_properties", database_id });
      const pages = (response.results as Record<string, unknown>[]) || [];
      for (const page of pages) {
        if (results.length >= max_pages) break;
        const props = page.properties as Record<string, Record<string, unknown>> | undefined;
        const prop = props?.[property_name];
        results.push({ page_id: page.id as string, value: (prop?.number as number | null) ?? null });
      }
      cursor = results.length >= max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
    } while (cursor);
    return results;
  }

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    set_number_value: async (args) => {
      const params = SetNumberValueSchema.parse(args);
      const result = await logger.time("tool.set_number_value", () =>
        client.patch(`/pages/${params.page_id}`, {
          properties: { [params.property_name]: { number: params.value } },
        })
      , { tool: "set_number_value", page_id: params.page_id });
      const page = result as Record<string, unknown>;
      const structured = { id: page.id, property_name: params.property_name, new_value: params.value };
      return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    },

    increment_number: async (args) => {
      const params = IncrementNumberSchema.parse(args);
      const page = await logger.time("tool.increment_number.get", () =>
        client.get<Record<string, unknown>>(`/pages/${params.page_id}`)
      , { tool: "increment_number", page_id: params.page_id });
      const props = page.properties as Record<string, Record<string, unknown>> | undefined;
      const oldValue = (props?.[params.property_name]?.number as number | null) ?? 0;
      const newValue = oldValue + params.by;
      const result = await logger.time("tool.increment_number.set", () =>
        client.patch(`/pages/${params.page_id}`, {
          properties: { [params.property_name]: { number: newValue } },
        })
      , { tool: "increment_number", page_id: params.page_id });
      const updated = result as Record<string, unknown>;
      const structured = { id: updated.id, property_name: params.property_name, old_value: oldValue, new_value: newValue, increment: params.by };
      return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    },

    sum_number_property: async (args) => {
      const params = SumNumberPropertySchema.parse(args);
      const data = await fetchAllNumbers(params.database_id, params.property_name, params.filter, params.max_pages, client);
      const withValue = data.filter((d) => d.value !== null);
      const sum = withValue.reduce((acc, d) => acc + (d.value as number), 0);
      const structured = {
        database_id: params.database_id, property_name: params.property_name,
        sum, count_with_value: withValue.length, count_null: data.length - withValue.length, total_pages: data.length,
      };
      return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    },

    average_number_property: async (args) => {
      const params = AverageNumberPropertySchema.parse(args);
      const data = await fetchAllNumbers(params.database_id, params.property_name, params.filter, params.max_pages, client);
      const withValue = data.filter((d) => d.value !== null);
      const sum = withValue.reduce((acc, d) => acc + (d.value as number), 0);
      const average = withValue.length > 0 ? sum / withValue.length : 0;
      const structured = { database_id: params.database_id, property_name: params.property_name, average, sum, count: withValue.length };
      return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    },

    find_min_max_number: async (args) => {
      const params = FindMinMaxSchema.parse(args);
      const data = await fetchAllNumbers(params.database_id, params.property_name, params.filter, params.max_pages, client);
      const withValue = data.filter((d) => d.value !== null) as Array<{ page_id: string; value: number }>;
      if (withValue.length === 0) {
        const structured = { database_id: params.database_id, property_name: params.property_name, min: null, max: null, range: null, count: 0 };
        return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
      }
      const minItem = withValue.reduce((a, b) => a.value < b.value ? a : b);
      const maxItem = withValue.reduce((a, b) => a.value > b.value ? a : b);
      const structured = {
        database_id: params.database_id, property_name: params.property_name,
        min: minItem.value, max: maxItem.value, range: maxItem.value - minItem.value,
        min_page_id: minItem.page_id, max_page_id: maxItem.page_id, count: withValue.length,
      };
      return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    },

    query_by_number_range: async (args) => {
      const params = QueryByNumberRangeSchema.parse(args);
      const filters: Record<string, unknown>[] = [];
      if (params.min !== undefined) filters.push({ property: params.property_name, number: { greater_than_or_equal_to: params.min } });
      if (params.max !== undefined) filters.push({ property: params.property_name, number: { less_than_or_equal_to: params.max } });
      if (filters.length === 0) throw new Error("At least one of min or max must be provided");
      const notionFilter = filters.length === 1 ? filters[0] : { and: filters };
      const body: Record<string, unknown> = { filter: notionFilter, page_size: params.page_size };
      if (params.sorts) body.sorts = params.sorts;
      if (params.start_cursor) body.start_cursor = params.start_cursor;
      const result = await logger.time("tool.query_by_number_range", () =>
        client.post(`/databases/${params.database_id}/query`, body)
      , { tool: "query_by_number_range", database_id: params.database_id });
      const structured = { ...(result as Record<string, unknown>), filter_applied: notionFilter };
      return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    },

    get_number_stats: async (args) => {
      const params = GetNumberStatsSchema.parse(args);
      const data = await fetchAllNumbers(params.database_id, params.property_name, params.filter, params.max_pages, client);
      const withValue = data.filter((d) => d.value !== null).map((d) => d.value as number);
      const nullCount = data.length - withValue.length;
      if (withValue.length === 0) {
        const structured = { database_id: params.database_id, property_name: params.property_name, count: 0, sum: 0, average: 0, min: null, max: null, range: null, std_dev: 0, null_count: nullCount };
        return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
      }
      const sum = withValue.reduce((a, b) => a + b, 0);
      const average = sum / withValue.length;
      const min = Math.min(...withValue);
      const max = Math.max(...withValue);
      const variance = withValue.reduce((acc, v) => acc + Math.pow(v - average, 2), 0) / withValue.length;
      const stdDev = Math.sqrt(variance);
      const structured = {
        database_id: params.database_id, property_name: params.property_name,
        count: withValue.length, sum, average: Math.round(average * 1000) / 1000,
        min, max, range: max - min, std_dev: Math.round(stdDev * 1000) / 1000, null_count: nullCount,
      };
      return { content: [{ type: "text", text: JSON.stringify(structured, null, 2) }], structuredContent: structured };
    },
  };

  return { tools, handlers };
}
