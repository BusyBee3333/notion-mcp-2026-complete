// Notion Database Views tools: gallery view queries, list view queries,
//   timeline view queries, board (kanban) view queries, get_database_page_summary,
//   query_database_gallery, get_board_columns, query_timeline_range,
//   get_database_cover_images, batch_get_page_titles
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const QueryDatabaseGallerySchema = z.object({
  database_id: z.string().describe("Database ID to query for gallery view"),
  cover_property: z.string().optional().describe("Property name used for gallery covers (files property). If omitted, uses page cover."),
  title_property: z.string().optional().describe("Title property name (default: first title property)"),
  filter: z.record(z.unknown()).optional(),
  sorts: z.array(z.record(z.unknown())).optional(),
  start_cursor: z.string().optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const GetBoardColumnsSchema = z.object({
  database_id: z.string().describe("Database ID organized as a kanban/board (needs a select or status property for columns)"),
  group_by_property: z.string().describe("Name of the select or status property used to group into columns"),
  filter: z.record(z.unknown()).optional(),
  max_pages_per_column: z.number().min(1).max(100).optional().default(25),
});

const QueryTimelineRangeSchema = z.object({
  database_id: z.string().describe("Database ID with date properties for timeline view"),
  start_property: z.string().describe("Property name for the start date of timeline items"),
  end_property: z.string().optional().describe("Property name for the end date (if date range). Omit for single-date items."),
  range_start: z.string().describe("Timeline view start date (ISO 8601). E.g. '2024-01-01'"),
  range_end: z.string().describe("Timeline view end date (ISO 8601). E.g. '2024-03-31'"),
  filter: z.record(z.unknown()).optional(),
  page_size: z.number().min(1).max(100).optional().default(100),
});

const GetDatabasePageSummarySchema = z.object({
  database_id: z.string().describe("Database ID"),
  max_pages: z.number().min(1).max(200).optional().default(50),
  summary_properties: z.array(z.string()).optional().describe(
    "Property names to include in the summary (title always included). Omit for all properties."
  ),
  filter: z.record(z.unknown()).optional(),
  sorts: z.array(z.record(z.unknown())).optional(),
});

const GetDatabaseCoverImagesSchema = z.object({
  database_id: z.string().describe("Database ID"),
  filter: z.record(z.unknown()).optional(),
  max_pages: z.number().min(1).max(200).optional().default(50),
});

const BatchGetPageTitlesSchema = z.object({
  page_ids: z.array(z.string()).min(1).max(100).describe("Array of page IDs to get titles for (1-100)"),
});

const QueryListViewSchema = z.object({
  database_id: z.string().describe("Database ID"),
  display_properties: z.array(z.string()).optional().describe("Property names to include in list view output"),
  filter: z.record(z.unknown()).optional(),
  sorts: z.array(z.record(z.unknown())).optional().default([{ timestamp: "last_edited_time", direction: "descending" }]),
  start_cursor: z.string().optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

// ============ Helpers ============

function getPageTitle(page: Record<string, unknown>): string {
  const props = page.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return "";
  for (const prop of Object.values(props)) {
    if (prop.type === "title") {
      const titleArr = prop.title as Array<{ plain_text?: string }> | undefined;
      return titleArr?.map((t) => t.plain_text || "").join("") || "";
    }
  }
  return "";
}

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "query_database_gallery",
      title: "Query Database Gallery View",
      description:
        "Query a Notion database in gallery view style — returns pages with their titles, cover images, icons, and key properties in a format optimized for grid/gallery display. Great for media libraries, project boards, and card-based UIs.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          cover_property: { type: "string", description: "Files property used for gallery covers (optional)" },
          title_property: { type: "string", description: "Title property name (optional)" },
          filter: { type: "object" },
          sorts: { type: "array", items: { type: "object" } },
          start_cursor: { type: "string" },
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
      name: "get_board_columns",
      title: "Get Board Columns (Kanban)",
      description:
        "Get a Notion database organized as a kanban board. Groups pages by a select or status property into columns. Returns each column with its option name, color, and the pages it contains. Perfect for kanban/sprint board views.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          group_by_property: { type: "string", description: "Select or status property name for column grouping" },
          filter: { type: "object" },
          max_pages_per_column: { type: "number", description: "Max pages per column (1-100, default 25)" },
        },
        required: ["database_id", "group_by_property"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          group_by_property: { type: "string" },
          columns: { type: "array", items: { type: "object" } },
          total_pages: { type: "number" },
        },
        required: ["database_id", "columns"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "query_timeline_range",
      title: "Query Timeline Range",
      description:
        "Query a Notion database for items visible in a timeline view — finds pages whose date(s) overlap with a specified date range. Supports both single-date and date-range items. Returns items sorted by start date.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          start_property: { type: "string", description: "Start date property name" },
          end_property: { type: "string", description: "End date property name (for date ranges, optional)" },
          range_start: { type: "string", description: "Timeline view start date (ISO 8601)" },
          range_end: { type: "string", description: "Timeline view end date (ISO 8601)" },
          filter: { type: "object" },
          page_size: { type: "number", description: "Results per page (1-100, default 100)" },
        },
        required: ["database_id", "start_property", "range_start", "range_end"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          range_start: { type: "string" },
          range_end: { type: "string" },
          count: { type: "number" },
          has_more: { type: "boolean" },
        },
        required: ["results", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_database_page_summary",
      title: "Get Database Page Summary",
      description:
        "Get a concise summary of pages in a Notion database — returns only the key properties you specify (plus title) without the full raw property objects. Ideal for LLM context, summaries, or list views where you only need specific columns.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          max_pages: { type: "number", description: "Max pages to return (1-200, default 50)" },
          summary_properties: { type: "array", items: { type: "string" }, description: "Properties to include (title always included)" },
          filter: { type: "object" },
          sorts: { type: "array", items: { type: "object" } },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          pages: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          properties_included: { type: "array", items: { type: "string" } },
        },
        required: ["database_id", "pages", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_database_cover_images",
      title: "Get Database Cover Images",
      description:
        "Extract cover images and icons from pages in a Notion database. Returns a list of pages with their cover URLs and icon info — useful for building image galleries or media indexes.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          filter: { type: "object" },
          max_pages: { type: "number", description: "Max pages to scan (1-200, default 50)" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          pages: { type: "array", items: { type: "object" } },
          pages_with_cover: { type: "number" },
          pages_with_icon: { type: "number" },
        },
        required: ["database_id", "pages"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "batch_get_page_titles",
      title: "Batch Get Page Titles",
      description:
        "Get the titles of multiple Notion pages in one operation. Accepts up to 100 page IDs and returns a map of page ID to title. Faster than fetching pages individually when you just need titles.",
      inputSchema: {
        type: "object",
        properties: {
          page_ids: { type: "array", items: { type: "string" }, description: "Array of page IDs (1-100)" },
        },
        required: ["page_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          titles: { type: "object" },
          found: { type: "number" },
          not_found: { type: "number" },
        },
        required: ["titles", "found"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "query_list_view",
      title: "Query List View",
      description:
        "Query a Notion database in list-view style — returns a compact, flat list of pages with selected properties. Defaults to sorting by last edited time (most recently modified first). Supports pagination.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          display_properties: { type: "array", items: { type: "string" }, description: "Properties to include in output" },
          filter: { type: "object" },
          sorts: { type: "array", items: { type: "object" } },
          start_cursor: { type: "string" },
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
          count: { type: "number" },
        },
        required: ["results", "has_more"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    query_database_gallery: async (args) => {
      const params = QueryDatabaseGallerySchema.parse(args);
      const body: Record<string, unknown> = { page_size: params.page_size };
      if (params.filter) body.filter = params.filter;
      if (params.sorts) body.sorts = params.sorts;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.query_database_gallery", () =>
        client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
      , { tool: "query_database_gallery", database_id: params.database_id });

      const pages = (result.results as Record<string, unknown>[]) || [];
      const galleryResults = pages.map((page) => {
        const cover = page.cover as Record<string, unknown> | null | undefined;
        const icon = page.icon as Record<string, unknown> | null | undefined;
        const title = getPageTitle(page);
        let coverUrl: string | undefined;
        if (cover) {
          const ctype = cover.type as string;
          if (ctype === "external") coverUrl = (cover.external as { url?: string })?.url;
          else if (ctype === "file") coverUrl = (cover.file as { url?: string })?.url;
        }

        let iconValue: string | undefined;
        if (icon) {
          const itype = icon.type as string;
          if (itype === "emoji") iconValue = icon.emoji as string;
          else if (itype === "external") iconValue = (icon.external as { url?: string })?.url;
        }

        // If cover_property specified, look for it in files
        let propertyCoverUrl: string | undefined;
        if (params.cover_property) {
          const props = page.properties as Record<string, Record<string, unknown>> | undefined;
          const fileProp = props?.[params.cover_property];
          const files = fileProp?.files as Array<{ external?: { url?: string }; file?: { url?: string } }> | undefined;
          propertyCoverUrl = files?.[0]?.external?.url || files?.[0]?.file?.url;
        }

        return {
          page_id: page.id,
          title,
          url: page.url,
          cover_url: propertyCoverUrl || coverUrl,
          icon: iconValue,
          icon_type: (icon as Record<string, unknown> | null | undefined)?.type,
          created_time: page.created_time,
          last_edited_time: page.last_edited_time,
        };
      });

      const structured = { results: galleryResults, next_cursor: result.next_cursor, has_more: result.has_more };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_board_columns: async (args) => {
      const params = GetBoardColumnsSchema.parse(args);

      // Get database schema for column options
      const db = await logger.time("tool.get_board_columns.schema", () =>
        client.get<Record<string, unknown>>(`/databases/${params.database_id}`)
      , { tool: "get_board_columns", database_id: params.database_id });

      const dbProps = db.properties as Record<string, Record<string, unknown>> | undefined || {};
      const groupProp = dbProps[params.group_by_property];
      if (!groupProp) throw new Error(`Property '${params.group_by_property}' not found`);

      const ptype = groupProp.type as string;
      let options: Array<{ name?: string; color?: string }> = [];
      if (ptype === "select") options = (groupProp.select as { options?: typeof options })?.options || [];
      else if (ptype === "status") options = (groupProp.status as { options?: typeof options })?.options || [];
      else throw new Error(`Property '${params.group_by_property}' must be select or status, got: ${ptype}`);

      // Add "No status" for unset
      const allColumns = [...options, { name: "(Empty)", color: "default" }];
      const columns: Record<string, unknown>[] = [];
      let totalPages = 0;

      for (const option of allColumns) {
        const filter: Record<string, unknown> = option.name === "(Empty)"
          ? { property: params.group_by_property, [ptype]: { is_empty: true } }
          : { property: params.group_by_property, [ptype]: { equals: option.name } };

        if (params.filter) {
          const combinedFilter = { and: [filter, params.filter] };
          const body = { filter: combinedFilter, page_size: params.max_pages_per_column };
          const result = await logger.time("tool.get_board_columns.query", () =>
            client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
          , { tool: "get_board_columns", column: option.name });
          const pages = (result.results as Record<string, unknown>[]) || [];
          columns.push({ column_name: option.name, color: option.color, pages, page_count: pages.length, has_more: result.has_more });
          totalPages += pages.length;
        } else {
          const body = { filter, page_size: params.max_pages_per_column };
          try {
            const result = await logger.time("tool.get_board_columns.query", () =>
              client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
            , { tool: "get_board_columns", column: option.name });
            const pages = (result.results as Record<string, unknown>[]) || [];
            columns.push({ column_name: option.name, color: option.color, pages, page_count: pages.length, has_more: result.has_more });
            totalPages += pages.length;
          } catch {
            columns.push({ column_name: option.name, color: option.color, pages: [], page_count: 0, has_more: false });
          }
        }
      }

      const structured = { database_id: params.database_id, group_by_property: params.group_by_property, columns, total_pages: totalPages };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    query_timeline_range: async (args) => {
      const params = QueryTimelineRangeSchema.parse(args);
      const filters: Record<string, unknown>[] = [
        { property: params.start_property, date: { on_or_before: params.range_end } },
      ];

      if (params.end_property) {
        filters.push({ property: params.end_property, date: { on_or_after: params.range_start } });
      } else {
        filters.push({ property: params.start_property, date: { on_or_after: params.range_start } });
      }

      const filter = params.filter
        ? { and: [...filters, params.filter] }
        : { and: filters };

      const body: Record<string, unknown> = {
        filter,
        page_size: params.page_size,
        sorts: [{ property: params.start_property, direction: "ascending" }],
      };

      const result = await logger.time("tool.query_timeline_range", () =>
        client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
      , { tool: "query_timeline_range", database_id: params.database_id });

      const results = (result.results as unknown[]) || [];
      const structured = { results, range_start: params.range_start, range_end: params.range_end, count: results.length, has_more: result.has_more };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_database_page_summary: async (args) => {
      const params = GetDatabasePageSummarySchema.parse(args);
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (params.filter) body.filter = params.filter;
        if (params.sorts) body.sorts = params.sorts;
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.get_database_page_summary.fetch", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "get_database_page_summary", database_id: params.database_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const page of results) {
          if (allPages.length >= params.max_pages) break;
          allPages.push(page);
        }
        cursor = allPages.length >= params.max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      const summaries = allPages.map((page) => {
        const props = page.properties as Record<string, Record<string, unknown>> | undefined || {};
        const summary: Record<string, unknown> = { page_id: page.id, url: page.url, title: getPageTitle(page) };

        const propsToInclude = params.summary_properties || Object.keys(props);
        for (const propName of propsToInclude) {
          const prop = props[propName];
          if (!prop) continue;
          const ptype = prop.type as string;
          if (ptype === "title") continue; // already in title

          let value: unknown;
          switch (ptype) {
            case "rich_text": value = (prop.rich_text as Array<{ plain_text?: string }>)?.map((t) => t.plain_text || "").join("") || ""; break;
            case "number": value = prop.number; break;
            case "select": value = (prop.select as { name?: string } | null)?.name ?? null; break;
            case "status": value = (prop.status as { name?: string } | null)?.name ?? null; break;
            case "multi_select": value = (prop.multi_select as Array<{ name?: string }>)?.map((o) => o.name) || []; break;
            case "date": value = (prop.date as { start?: string; end?: string } | null) ?? null; break;
            case "checkbox": value = prop.checkbox; break;
            case "url": value = prop.url; break;
            case "email": value = prop.email; break;
            case "phone_number": value = prop.phone_number; break;
            default: value = prop[ptype];
          }
          summary[propName] = value;
        }
        return summary;
      });

      const propsIncluded = ["title", ...(params.summary_properties || [])];
      const structured = { database_id: params.database_id, pages: summaries, count: summaries.length, properties_included: propsIncluded };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_database_cover_images: async (args) => {
      const params = GetDatabaseCoverImagesSchema.parse(args);
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (params.filter) body.filter = params.filter;
        if (cursor) body.start_cursor = cursor;
        const response = await logger.time("tool.get_database_cover_images.fetch", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "get_database_cover_images", database_id: params.database_id });
        const results = (response.results as Record<string, unknown>[]) || [];
        for (const page of results) {
          if (allPages.length >= params.max_pages) break;
          allPages.push(page);
        }
        cursor = allPages.length >= params.max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      let pagesWithCover = 0, pagesWithIcon = 0;
      const pages = allPages.map((page) => {
        const cover = page.cover as Record<string, unknown> | null | undefined;
        const icon = page.icon as Record<string, unknown> | null | undefined;
        let coverUrl: string | undefined;
        if (cover) {
          pagesWithCover++;
          const ctype = cover.type as string;
          if (ctype === "external") coverUrl = (cover.external as { url?: string })?.url;
          else if (ctype === "file") coverUrl = (cover.file as { url?: string })?.url;
        }
        if (icon) pagesWithIcon++;
        return { page_id: page.id, title: getPageTitle(page), cover_url: coverUrl, icon: icon, url: page.url };
      });

      const structured = { database_id: params.database_id, pages, pages_with_cover: pagesWithCover, pages_with_icon: pagesWithIcon };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    batch_get_page_titles: async (args) => {
      const { page_ids } = BatchGetPageTitlesSchema.parse(args);
      const titles: Record<string, string | null> = {};
      let found = 0, notFound = 0;

      await Promise.all(page_ids.map(async (page_id) => {
        try {
          const page = await logger.time("tool.batch_get_page_titles.fetch", () =>
            client.get<Record<string, unknown>>(`/pages/${page_id}`)
          , { tool: "batch_get_page_titles", page_id });
          titles[page_id] = getPageTitle(page);
          found++;
        } catch {
          titles[page_id] = null;
          notFound++;
        }
      }));

      const structured = { titles, found, not_found: notFound };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    query_list_view: async (args) => {
      const params = QueryListViewSchema.parse(args);
      const body: Record<string, unknown> = { page_size: params.page_size };
      if (params.filter) body.filter = params.filter;
      if (params.sorts) body.sorts = params.sorts;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      const result = await logger.time("tool.query_list_view", () =>
        client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
      , { tool: "query_list_view", database_id: params.database_id });

      const pages = (result.results as Record<string, unknown>[]) || [];
      const listResults = pages.map((page) => {
        const props = page.properties as Record<string, Record<string, unknown>> | undefined || {};
        const entry: Record<string, unknown> = { page_id: page.id, title: getPageTitle(page), url: page.url, last_edited_time: page.last_edited_time };

        if (params.display_properties) {
          for (const propName of params.display_properties) {
            const prop = props[propName];
            if (!prop) continue;
            const ptype = prop.type as string;
            switch (ptype) {
              case "rich_text": entry[propName] = (prop.rich_text as Array<{ plain_text?: string }>)?.map((t) => t.plain_text || "").join("") || ""; break;
              case "number": entry[propName] = prop.number; break;
              case "select": entry[propName] = (prop.select as { name?: string } | null)?.name ?? null; break;
              case "status": entry[propName] = (prop.status as { name?: string } | null)?.name ?? null; break;
              case "multi_select": entry[propName] = (prop.multi_select as Array<{ name?: string }>)?.map((o) => o.name) || []; break;
              case "date": entry[propName] = (prop.date as { start?: string } | null)?.start ?? null; break;
              case "checkbox": entry[propName] = prop.checkbox; break;
              default: entry[propName] = prop[ptype];
            }
          }
        }
        return entry;
      });

      const structured = { results: listResults, next_cursor: result.next_cursor, has_more: result.has_more, count: listResults.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
