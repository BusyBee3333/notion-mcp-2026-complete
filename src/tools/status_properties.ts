// Notion Status Property tools: get_status_groups, update_page_status,
//   list_pages_by_status, move_page_to_status_group, get_status_summary,
//   bulk_update_status, create_status_workflow
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetStatusGroupsSchema = z.object({
  database_id: z.string().describe("Database ID containing the status property"),
  property_name: z.string().describe("Name of the status property"),
});

const UpdatePageStatusSchema = z.object({
  page_id: z.string().describe("Page ID to update"),
  property_name: z.string().describe("Name of the status property"),
  status_name: z.string().describe("Name of the status option to set. Must match an existing option exactly."),
});

const ListPagesByStatusSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  property_name: z.string().describe("Name of the status property"),
  status_name: z.string().describe("Status option name to filter by"),
  sorts: z.array(z.record(z.unknown())).optional(),
  start_cursor: z.string().optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const GetStatusSummarySchema = z.object({
  database_id: z.string().describe("Database ID to summarize"),
  property_name: z.string().describe("Name of the status property"),
  filter: z.record(z.unknown()).optional().describe("Optional additional filter to scope the summary"),
});

const BulkUpdateStatusSchema = z.object({
  database_id: z.string().describe("Database ID containing the pages"),
  property_name: z.string().describe("Name of the status property"),
  from_status: z.string().describe("Status to move FROM (only pages with this status are updated)"),
  to_status: z.string().describe("Status to move TO"),
  additional_filter: z.record(z.unknown()).optional().describe("Additional filter to AND with the status filter"),
  max_pages: z.number().min(1).max(200).optional().default(50).describe("Max pages to update (safety limit)"),
  dry_run: z.boolean().optional().default(false),
});

const ListAllStatusesSchema = z.object({
  database_id: z.string().describe("Database ID"),
  property_name: z.string().describe("Name of the status property"),
  include_counts: z.boolean().optional().default(false).describe("If true, count pages in each status (makes additional API calls)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_status_groups",
      title: "Get Status Groups",
      description:
        "Get the status groups and options for a status property in a Notion database. Status properties have options organized into groups (e.g. 'To-do', 'In progress', 'Complete'). Returns the full group structure.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Name of the status property" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          options: { type: "array", items: { type: "object" } },
          groups: { type: "array", items: { type: "object" } },
          option_names: { type: "array", items: { type: "string" } },
        },
        required: ["database_id", "property_name", "options", "groups"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_page_status",
      title: "Update Page Status",
      description:
        "Set the status property of a Notion page. Simpler than update_page for status-only changes — just provide the page ID, property name, and the new status option name.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to update" },
          property_name: { type: "string", description: "Name of the status property" },
          status_name: { type: "string", description: "New status option name (must match an existing option)" },
        },
        required: ["page_id", "property_name", "status_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          last_edited_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_pages_by_status",
      title: "List Pages by Status",
      description:
        "List all pages in a Notion database with a specific status value. A convenient wrapper around query_database for status-based filtering.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          property_name: { type: "string", description: "Name of the status property" },
          status_name: { type: "string", description: "Status option name to filter by" },
          sorts: { type: "array", items: { type: "object" } },
          start_cursor: { type: "string" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "property_name", "status_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          status_name: { type: "string" },
          count: { type: "number" },
          has_more: { type: "boolean" },
        },
        required: ["results", "status_name", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_status_summary",
      title: "Get Status Summary",
      description:
        "Count how many pages are in each status for a status property in a Notion database. Returns a distribution table — great for progress tracking, kanban analytics, or status dashboards.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to analyze" },
          property_name: { type: "string", description: "Name of the status property" },
          filter: { type: "object", description: "Optional filter to scope the summary" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          total_pages: { type: "number" },
          status_counts: { type: "object" },
          group_counts: { type: "object" },
        },
        required: ["database_id", "property_name", "status_counts"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "bulk_update_status",
      title: "Bulk Update Status",
      description:
        "Move all pages with a specific status to a new status in a Notion database. Optionally combine with an additional filter. Has a dry_run mode to preview which pages would be affected. Safety limit on max pages.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Status property name" },
          from_status: { type: "string", description: "Current status to change FROM" },
          to_status: { type: "string", description: "New status to change TO" },
          additional_filter: { type: "object", description: "Extra filter to narrow which pages are updated" },
          max_pages: { type: "number", description: "Safety limit: max pages to update (1-200, default 50)" },
          dry_run: { type: "boolean", description: "Preview mode — no actual changes (default: false)" },
        },
        required: ["database_id", "property_name", "from_status", "to_status"],
      },
      outputSchema: {
        type: "object",
        properties: {
          dry_run: { type: "boolean" },
          matched: { type: "number" },
          updated: { type: "number" },
          failed: { type: "number" },
          results: { type: "array", items: { type: "object" } },
        },
        required: ["dry_run", "matched"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_all_statuses",
      title: "List All Statuses",
      description:
        "List all available status options for a status property in a Notion database. Optionally count how many pages are in each status. Useful before setting or filtering by status values.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Status property name" },
          include_counts: { type: "boolean", description: "Count pages in each status (default: false)" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          statuses: { type: "array", items: { type: "object" } },
        },
        required: ["database_id", "property_name", "statuses"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_status_groups: async (args) => {
      const params = GetStatusGroupsSchema.parse(args);
      const db = await logger.time("tool.get_status_groups", () =>
        client.get<Record<string, unknown>>(`/databases/${params.database_id}`)
      , { tool: "get_status_groups", database_id: params.database_id });

      const properties = db.properties as Record<string, Record<string, unknown>> | undefined || {};
      const prop = properties[params.property_name];
      if (!prop) throw new Error(`Property '${params.property_name}' not found`);
      if (prop.type !== "status") throw new Error(`Property '${params.property_name}' is not a status property`);

      const st = prop.status as { options?: Array<{ id?: string; name?: string; color?: string }>; groups?: Array<{ id?: string; name?: string; color?: string; option_ids?: string[] }> } | undefined;
      const options = st?.options || [];
      const groups = st?.groups || [];

      const structured = {
        database_id: params.database_id,
        property_name: params.property_name,
        options,
        groups,
        option_names: options.map((o) => o.name || ""),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    update_page_status: async (args) => {
      const params = UpdatePageStatusSchema.parse(args);
      const result = await logger.time("tool.update_page_status", () =>
        client.patch(`/pages/${params.page_id}`, {
          properties: { [params.property_name]: { status: { name: params.status_name } } },
        })
      , { tool: "update_page_status", page_id: params.page_id });

      const page = result as Record<string, unknown>;
      const structured = { id: page.id, status: params.status_name, last_edited_time: page.last_edited_time };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    list_pages_by_status: async (args) => {
      const params = ListPagesByStatusSchema.parse(args);
      const filter = { property: params.property_name, status: { equals: params.status_name } };
      const body: Record<string, unknown> = { filter, page_size: params.page_size };
      if (params.sorts) body.sorts = params.sorts;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.list_pages_by_status", () =>
        client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
      , { tool: "list_pages_by_status", database_id: params.database_id });

      const results = (result.results as unknown[]) || [];
      const structured = { results, status_name: params.status_name, count: results.length, has_more: result.has_more };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_status_summary: async (args) => {
      const params = GetStatusSummarySchema.parse(args);
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (params.filter) body.filter = params.filter;
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.get_status_summary.fetch", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "get_status_summary", database_id: params.database_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        allPages.push(...results);
        cursor = (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      // Get status schema for group info
      const db = await logger.time("tool.get_status_summary.schema", () =>
        client.get<Record<string, unknown>>(`/databases/${params.database_id}`)
      , { tool: "get_status_summary", database_id: params.database_id });
      const properties = db.properties as Record<string, Record<string, unknown>> | undefined || {};
      const prop = properties[params.property_name];
      const st = prop?.status as { options?: Array<{ id?: string; name?: string }>; groups?: Array<{ name?: string; option_ids?: string[] }> } | undefined;
      const optionGroups: Record<string, string> = {};
      for (const group of (st?.groups || [])) {
        for (const optId of (group.option_ids || [])) {
          optionGroups[optId] = group.name || "Unknown";
        }
      }
      const optionIdMap: Record<string, string> = {};
      for (const opt of (st?.options || [])) {
        if (opt.id && opt.name) optionIdMap[opt.id] = opt.name;
      }

      const statusCounts: Record<string, number> = {};
      const groupCounts: Record<string, number> = {};

      for (const page of allPages) {
        const props = page.properties as Record<string, Record<string, unknown>> | undefined;
        const statusProp = props?.[params.property_name];
        const statusVal = statusProp?.status as { name?: string; id?: string } | null | undefined;
        const statusName = statusVal?.name || "(empty)";
        statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;

        const statusId = statusVal?.id;
        const groupName = statusId ? (optionGroups[statusId] || "Unknown") : "(empty)";
        groupCounts[groupName] = (groupCounts[groupName] || 0) + 1;
      }

      const structured = {
        database_id: params.database_id,
        property_name: params.property_name,
        total_pages: allPages.length,
        status_counts: statusCounts,
        group_counts: groupCounts,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    bulk_update_status: async (args) => {
      const params = BulkUpdateStatusSchema.parse(args);
      const fromFilter = { property: params.property_name, status: { equals: params.from_status } };
      const filter = params.additional_filter
        ? { and: [fromFilter, params.additional_filter] }
        : fromFilter;

      const matchedPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = { filter, page_size: 100 };
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.bulk_update_status.query", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "bulk_update_status", database_id: params.database_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const page of results) {
          if (matchedPages.length >= params.max_pages) break;
          matchedPages.push(page);
        }
        cursor = matchedPages.length >= params.max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      if (params.dry_run) {
        const structured = {
          dry_run: true,
          matched: matchedPages.length,
          updated: 0,
          failed: 0,
          results: matchedPages.map((p) => ({ page_id: p.id, would_change: `${params.from_status} → ${params.to_status}` })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        };
      }

      const results: Record<string, unknown>[] = [];
      let updatedCount = 0, failedCount = 0;

      for (const page of matchedPages) {
        try {
          await logger.time("tool.bulk_update_status.update", () =>
            client.patch(`/pages/${page.id as string}`, {
              properties: { [params.property_name]: { status: { name: params.to_status } } },
            })
          , { tool: "bulk_update_status", page_id: page.id });
          results.push({ page_id: page.id, status: "updated" });
          updatedCount++;
        } catch (err) {
          results.push({ page_id: page.id, status: "failed", error: err instanceof Error ? err.message : String(err) });
          failedCount++;
        }
      }

      const structured = { dry_run: false, matched: matchedPages.length, updated: updatedCount, failed: failedCount, results };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    list_all_statuses: async (args) => {
      const params = ListAllStatusesSchema.parse(args);
      const db = await logger.time("tool.list_all_statuses", () =>
        client.get<Record<string, unknown>>(`/databases/${params.database_id}`)
      , { tool: "list_all_statuses", database_id: params.database_id });

      const properties = db.properties as Record<string, Record<string, unknown>> | undefined || {};
      const prop = properties[params.property_name];
      if (!prop) throw new Error(`Property '${params.property_name}' not found`);
      if (prop.type !== "status") throw new Error(`Property '${params.property_name}' is not a status property`);

      const st = prop.status as { options?: Array<{ name?: string; color?: string; id?: string }> } | undefined;
      const options = st?.options || [];

      let statuses = options.map((o) => ({ name: o.name, color: o.color, id: o.id }));

      if (params.include_counts) {
        for (const status of statuses) {
          const body = { filter: { property: params.property_name, status: { equals: status.name } }, page_size: 1 };
          try {
            const response = await logger.time("tool.list_all_statuses.count", () =>
              client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
            , { tool: "list_all_statuses.count", status: status.name });
            (status as Record<string, unknown>).count = (response.results as unknown[])?.length ?? 0;
          } catch {
            (status as Record<string, unknown>).count = 0;
          }
        }
      }

      const structured = { database_id: params.database_id, property_name: params.property_name, statuses };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
