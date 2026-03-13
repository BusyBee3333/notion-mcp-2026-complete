// Notion Formula tools: evaluate_formula_for_page, get_formula_value,
//   list_formula_properties, compare_formula_across_pages,
//   query_by_formula_result, get_formula_errors
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetFormulaValueSchema = z.object({
  page_id: z.string().describe("Page ID to get formula values from"),
  formula_property: z.string().describe("Name of the formula property"),
});

const ListFormulaPropertiesSchema = z.object({
  database_id: z.string().describe("Database ID to inspect formula properties in"),
});

const GetAllFormulaValuesSchema = z.object({
  page_id: z.string().describe("Page ID to extract all formula property values from"),
});

const QueryByFormulaResultSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  formula_property: z.string().describe("Name of the formula property to filter on"),
  formula_type: z.enum(["string", "number", "boolean", "date"]).describe("Return type of the formula"),
  operator: z.string().describe(
    "Filter operator:\n" +
    "- string: equals, does_not_equal, contains, does_not_contain, starts_with, ends_with, is_empty, is_not_empty\n" +
    "- number: equals, does_not_equal, greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to\n" +
    "- boolean: equals (true/false)\n" +
    "- date: equals, before, after, on_or_before, on_or_after, is_empty, is_not_empty"
  ),
  value: z.unknown().optional().describe("Value to compare against (omit for is_empty/is_not_empty)"),
  page_size: z.number().min(1).max(100).optional().default(25),
  start_cursor: z.string().optional(),
});

const CompareFormulaAcrossPagesSchema = z.object({
  database_id: z.string().describe("Database ID to analyze"),
  formula_property: z.string().describe("Name of the formula property to compare"),
  sort_direction: z.enum(["ascending", "descending"]).optional().default("descending").describe("Sort direction for comparison (default: descending)"),
  max_pages: z.number().min(1).max(200).optional().default(50),
  filter: z.record(z.unknown()).optional().describe("Optional filter to narrow the pages compared"),
});

const GetFormulaExpressionSchema = z.object({
  database_id: z.string().describe("Database ID"),
  formula_property: z.string().describe("Name of the formula property to get the expression for"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_formula_value",
      title: "Get Formula Value",
      description:
        "Get the computed result of a formula property on a specific Notion page. Returns the formula's current value (string, number, boolean, or date) along with the formula type.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to read formula from" },
          formula_property: { type: "string", description: "Name of the formula property" },
        },
        required: ["page_id", "formula_property"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          formula_property: { type: "string" },
          formula_type: { type: "string" },
          value: {},
        },
        required: ["page_id", "formula_property"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_formula_properties",
      title: "List Formula Properties",
      description:
        "List all formula properties in a Notion database along with their expressions. Useful for understanding what computed columns exist and what their formulas calculate.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to inspect" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          formula_properties: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["database_id", "formula_properties"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_all_formula_values",
      title: "Get All Formula Values",
      description:
        "Get the computed values of ALL formula properties on a Notion page in one call. Returns a map of formula property names to their current computed values.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to read all formula values from" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          formula_values: { type: "object" },
          formula_count: { type: "number" },
        },
        required: ["page_id", "formula_values"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "query_by_formula_result",
      title: "Query by Formula Result",
      description:
        "Query a Notion database filtering by the computed value of a formula property. Supports string, number, boolean, and date formula types with appropriate operators.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          formula_property: { type: "string", description: "Name of the formula property" },
          formula_type: { type: "string", enum: ["string", "number", "boolean", "date"], description: "Return type of the formula" },
          operator: { type: "string", description: "Filter operator (varies by formula_type)" },
          value: { description: "Comparison value (omit for is_empty/is_not_empty)" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
          start_cursor: { type: "string" },
        },
        required: ["database_id", "formula_property", "formula_type", "operator"],
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
      name: "compare_formula_across_pages",
      title: "Compare Formula Across Pages",
      description:
        "Fetch multiple pages from a database and compare their formula property values side by side. Returns pages sorted by their formula result — useful for ranking, scoring, or finding top/bottom items.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to analyze" },
          formula_property: { type: "string", description: "Formula property name to compare" },
          sort_direction: { type: "string", enum: ["ascending", "descending"], description: "Sort direction (default: descending)" },
          max_pages: { type: "number", description: "Max pages to compare (1-200, default 50)" },
          filter: { type: "object", description: "Optional filter to narrow pages" },
        },
        required: ["database_id", "formula_property"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          formula_property: { type: "string" },
          comparison: { type: "array", items: { type: "object" } },
          total_compared: { type: "number" },
        },
        required: ["database_id", "formula_property", "comparison"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_formula_expression",
      title: "Get Formula Expression",
      description:
        "Retrieve the formula expression string for a formula property in a Notion database. Returns the Notion formula language expression that the property uses to compute its values.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          formula_property: { type: "string", description: "Name of the formula property" },
        },
        required: ["database_id", "formula_property"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          formula_property: { type: "string" },
          expression: { type: "string" },
        },
        required: ["database_id", "formula_property"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  function extractFormulaValue(formulaProp: Record<string, unknown>): { type: string; value: unknown } {
    const fm = formulaProp.formula as Record<string, unknown> | undefined;
    if (!fm) return { type: "unknown", value: null };
    const ftype = fm.type as string;
    return { type: ftype, value: fm[ftype] ?? null };
  }

  const handlers: Record<string, ToolHandler> = {
    get_formula_value: async (args) => {
      const params = GetFormulaValueSchema.parse(args);
      const page = await logger.time("tool.get_formula_value", () =>
        client.get<Record<string, unknown>>(`/pages/${params.page_id}`)
      , { tool: "get_formula_value", page_id: params.page_id });

      const properties = page.properties as Record<string, Record<string, unknown>> | undefined;
      if (!properties || !(params.formula_property in properties)) {
        throw new Error(`Formula property '${params.formula_property}' not found on page`);
      }

      const prop = properties[params.formula_property];
      if (prop.type !== "formula") {
        throw new Error(`Property '${params.formula_property}' is type '${prop.type}', not formula`);
      }

      const { type: formulaType, value } = extractFormulaValue(prop);
      const structured = {
        page_id: params.page_id,
        formula_property: params.formula_property,
        formula_type: formulaType,
        value,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    list_formula_properties: async (args) => {
      const { database_id } = ListFormulaPropertiesSchema.parse(args);
      const db = await logger.time("tool.list_formula_properties", () =>
        client.get<Record<string, unknown>>(`/databases/${database_id}`)
      , { tool: "list_formula_properties", database_id });

      const properties = db.properties as Record<string, Record<string, unknown>> | undefined || {};
      const formulaProperties = Object.entries(properties)
        .filter(([, prop]) => prop.type === "formula")
        .map(([name, prop]) => ({
          name,
          id: prop.id,
          expression: (prop.formula as { expression?: string } | undefined)?.expression,
        }));

      const structured = { database_id, formula_properties: formulaProperties, count: formulaProperties.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_all_formula_values: async (args) => {
      const { page_id } = GetAllFormulaValuesSchema.parse(args);
      const page = await logger.time("tool.get_all_formula_values", () =>
        client.get<Record<string, unknown>>(`/pages/${page_id}`)
      , { tool: "get_all_formula_values", page_id });

      const properties = page.properties as Record<string, Record<string, unknown>> | undefined || {};
      const formulaValues: Record<string, unknown> = {};
      let formulaCount = 0;

      for (const [name, prop] of Object.entries(properties)) {
        if (prop.type === "formula") {
          const { type, value } = extractFormulaValue(prop);
          formulaValues[name] = { type, value };
          formulaCount++;
        }
      }

      const structured = { page_id, formula_values: formulaValues, formula_count: formulaCount };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    query_by_formula_result: async (args) => {
      const params = QueryByFormulaResultSchema.parse(args);
      const noValueOps = ["is_empty", "is_not_empty"];
      const filterValue = noValueOps.includes(params.operator) ? true : params.value;
      const typeFilter: Record<string, unknown> = { [params.operator]: filterValue };
      const filter = {
        property: params.formula_property,
        formula: { [params.formula_type]: typeFilter },
      };

      const body: Record<string, unknown> = { filter, page_size: params.page_size };
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.query_by_formula_result", () =>
        client.post(`/databases/${params.database_id}/query`, body)
      , { tool: "query_by_formula_result", database_id: params.database_id });

      const structured = { ...(result as Record<string, unknown>), filter_applied: filter };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    compare_formula_across_pages: async (args) => {
      const params = CompareFormulaAcrossPagesSchema.parse(args);
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (params.filter) body.filter = params.filter;
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.compare_formula_across_pages.fetch", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "compare_formula_across_pages", database_id: params.database_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const page of results) {
          if (allPages.length >= params.max_pages) break;
          allPages.push(page);
        }
        cursor = allPages.length >= params.max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      const comparison = allPages.map((page) => {
        const props = page.properties as Record<string, Record<string, unknown>> | undefined;
        const formulaProp = props?.[params.formula_property];
        const { type, value } = formulaProp ? extractFormulaValue(formulaProp) : { type: "unknown", value: null };
        const titleProp = Object.values(props || {}).find((p) => p.type === "title");
        const titleArr = titleProp?.title as Array<{ plain_text?: string }> | undefined;
        const title = titleArr?.map((t) => t.plain_text || "").join("") || "";
        return { page_id: page.id, title, formula_type: type, formula_value: value };
      }).sort((a, b) => {
        const av = a.formula_value, bv = b.formula_value;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        if (typeof av === "number" && typeof bv === "number") {
          return params.sort_direction === "ascending" ? av - bv : bv - av;
        }
        const as = String(av), bs = String(bv);
        return params.sort_direction === "ascending" ? as.localeCompare(bs) : bs.localeCompare(as);
      });

      const structured = {
        database_id: params.database_id,
        formula_property: params.formula_property,
        comparison,
        total_compared: comparison.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_formula_expression: async (args) => {
      const params = GetFormulaExpressionSchema.parse(args);
      const db = await logger.time("tool.get_formula_expression", () =>
        client.get<Record<string, unknown>>(`/databases/${params.database_id}`)
      , { tool: "get_formula_expression", database_id: params.database_id });

      const properties = db.properties as Record<string, Record<string, unknown>> | undefined || {};
      const prop = properties[params.formula_property];
      if (!prop) throw new Error(`Property '${params.formula_property}' not found`);
      if (prop.type !== "formula") throw new Error(`Property '${params.formula_property}' is type '${prop.type}', not formula`);

      const expression = (prop.formula as { expression?: string } | undefined)?.expression || "";
      const structured = { database_id: params.database_id, formula_property: params.formula_property, expression };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
