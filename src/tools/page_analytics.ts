// Notion Page Analytics tools: get_page_activity_summary, compare_pages,
//   find_recently_edited_pages, find_recently_created_pages,
//   get_page_word_count, find_empty_pages, get_database_activity
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetPageActivitySummarySchema = z.object({
  page_id: z.string().describe("Page ID to get activity summary for"),
});

const FindRecentlyEditedPagesSchema = z.object({
  database_id: z.string().optional().describe("Database ID to search within (omit to search all accessible pages)"),
  since_hours: z.number().min(1).max(8760).optional().default(24).describe("Look back this many hours (default: 24)"),
  max_results: z.number().min(1).max(200).optional().default(25),
});

const FindRecentlyCreatedPagesSchema = z.object({
  database_id: z.string().optional().describe("Database ID to search within (omit to search all accessible pages)"),
  max_results: z.number().min(1).max(200).optional().default(25),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const GetPageWordCountSchema = z.object({
  page_id: z.string().describe("Page ID to count words in"),
  max_depth: z.number().min(1).max(5).optional().default(3).describe("Max nesting depth to scan (default 3)"),
});

const FindEmptyPagesSchema = z.object({
  database_id: z.string().describe("Database ID to scan for empty pages"),
  check_content: z.boolean().optional().default(true).describe("Check if the page body is empty (requires extra API calls)"),
  max_pages: z.number().min(1).max(200).optional().default(100),
});

const ComparePagesSchema = z.object({
  page_ids: z.array(z.string()).min(2).max(10).describe("Array of 2-10 page IDs to compare"),
  compare_properties: z.array(z.string()).optional().describe("Property names to compare (omit to compare all properties)"),
});

const GetDatabaseActivitySchema = z.object({
  database_id: z.string().describe("Database ID to get activity stats for"),
  group_by: z.enum(["day", "week", "month"]).optional().default("day").describe("Time grouping for activity (default: day)"),
  max_pages: z.number().min(1).max(2000).optional().default(500),
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

function extractPlainText(block: Record<string, unknown>): string {
  const btype = block.type as string;
  if (!btype) return "";
  const content = block[btype] as Record<string, unknown> | undefined;
  if (!content) return "";
  const richText = content.rich_text as Array<{ plain_text?: string }> | undefined;
  if (!richText) return "";
  return richText.map((rt) => rt.plain_text || "").join("");
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_page_activity_summary",
      title: "Get Page Activity Summary",
      description:
        "Get a summary of a Notion page's metadata and activity: created time, last edited time, creator, last editor, parent info, and archive status. Useful for auditing page activity without fetching full content.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to summarize" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          title: { type: "string" },
          created_time: { type: "string" },
          last_edited_time: { type: "string" },
          created_by: { type: "object" },
          last_edited_by: { type: "object" },
          parent: { type: "object" },
          archived: { type: "boolean" },
          url: { type: "string" },
        },
        required: ["page_id", "created_time", "last_edited_time"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "find_recently_edited_pages",
      title: "Find Recently Edited Pages",
      description:
        "Find pages that were edited within the last N hours. Can search within a specific database or across all accessible pages. Returns pages sorted by last edit time (most recent first).",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Optional: limit search to this database" },
          since_hours: { type: "number", description: "Look back this many hours (default: 24)" },
          max_results: { type: "number", description: "Max results (1-200, default 25)" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          pages: { type: "array", items: { type: "object" } },
          count: { type: "number" },
          since_hours: { type: "number" },
        },
        required: ["pages", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "find_recently_created_pages",
      title: "Find Recently Created Pages",
      description:
        "Find the most recently created pages, sorted by creation time. Can be scoped to a specific database or search across all accessible pages.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Optional: limit to this database" },
          max_results: { type: "number", description: "Max results (1-200, default 25)" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          pages: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["pages", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_page_word_count",
      title: "Get Page Word Count",
      description:
        "Count the total number of words and characters in a Notion page's text content. Recursively scans all text blocks up to max_depth. Useful for writers, content audits, or checking if content exists.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to count words in" },
          max_depth: { type: "number", description: "Max nesting depth (1-5, default 3)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          word_count: { type: "number" },
          character_count: { type: "number" },
          block_count: { type: "number" },
          is_empty: { type: "boolean" },
        },
        required: ["page_id", "word_count", "character_count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "find_empty_pages",
      title: "Find Empty Pages",
      description:
        "Scan a Notion database for pages with no content (empty body). Optionally checks actual block content. Returns a list of empty pages for cleanup or content auditing.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to scan" },
          check_content: { type: "boolean", description: "Actually check block content (slower but accurate, default: true)" },
          max_pages: { type: "number", description: "Max pages to scan (1-200, default 100)" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          empty_pages: { type: "array", items: { type: "object" } },
          empty_count: { type: "number" },
          total_scanned: { type: "number" },
        },
        required: ["database_id", "empty_pages", "empty_count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "compare_pages",
      title: "Compare Pages",
      description:
        "Compare 2-10 Notion pages side by side — shows their metadata (created/edited times, creator) and selected property values in a comparison table. Useful for duplicate detection or content auditing.",
      inputSchema: {
        type: "object",
        properties: {
          page_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of 2-10 page IDs to compare",
          },
          compare_properties: {
            type: "array",
            items: { type: "string" },
            description: "Property names to compare (omit for metadata only)",
          },
        },
        required: ["page_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          comparison: { type: "array", items: { type: "object" } },
          page_count: { type: "number" },
        },
        required: ["comparison", "page_count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_database_activity",
      title: "Get Database Activity",
      description:
        "Analyze editing activity in a Notion database over time — shows when pages were created and edited, grouped by day, week, or month. Returns activity counts to identify busy periods.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to analyze" },
          group_by: { type: "string", enum: ["day", "week", "month"], description: "Time grouping (default: day)" },
          max_pages: { type: "number", description: "Max pages to analyze (default 500)" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          group_by: { type: "string" },
          creation_activity: { type: "object" },
          edit_activity: { type: "object" },
          total_pages: { type: "number" },
        },
        required: ["database_id", "creation_activity", "edit_activity"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  function getDateKey(isoDate: string, groupBy: "day" | "week" | "month"): string {
    const d = new Date(isoDate);
    if (groupBy === "month") return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (groupBy === "week") {
      const startOfWeek = new Date(d);
      startOfWeek.setUTCDate(d.getUTCDate() - d.getUTCDay());
      return startOfWeek.toISOString().split("T")[0];
    }
    return isoDate.split("T")[0];
  }

  const handlers: Record<string, ToolHandler> = {
    get_page_activity_summary: async (args) => {
      const { page_id } = GetPageActivitySummarySchema.parse(args);
      const page = await logger.time("tool.get_page_activity_summary", () =>
        client.get<Record<string, unknown>>(`/pages/${page_id}`)
      , { tool: "get_page_activity_summary", page_id });

      const structured = {
        page_id,
        title: getPageTitle(page),
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
        created_by: page.created_by,
        last_edited_by: page.last_edited_by,
        parent: page.parent,
        archived: page.archived,
        url: page.url,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    find_recently_edited_pages: async (args) => {
      const params = FindRecentlyEditedPagesSchema.parse(args);
      const sinceDate = new Date(Date.now() - params.since_hours * 3600 * 1000).toISOString();
      const pages: Record<string, unknown>[] = [];

      if (params.database_id) {
        // Query specific database
        const body = {
          filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: sinceDate } },
          sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
          page_size: Math.min(params.max_results, 100),
        };
        const response = await logger.time("tool.find_recently_edited_pages.db", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "find_recently_edited_pages" });
        pages.push(...((response.results as Record<string, unknown>[]) || []));
      } else {
        // Search all pages
        const body = {
          filter: { value: "page", property: "object" },
          sort: { direction: "descending", timestamp: "last_edited_time" },
          page_size: 100,
        };
        let cursor: string | undefined;
        do {
          const reqBody = cursor ? { ...body, start_cursor: cursor } : body;
          const response = await logger.time("tool.find_recently_edited_pages.search", () =>
            client.post<Record<string, unknown>>("/search", reqBody)
          , { tool: "find_recently_edited_pages" });
          const results = (response.results as Record<string, unknown>[]) || [];
          for (const page of results) {
            if (pages.length >= params.max_results) break;
            const editedTime = page.last_edited_time as string | undefined;
            if (editedTime && editedTime >= sinceDate) pages.push(page);
          }
          cursor = pages.length >= params.max_results ? undefined : (response.next_cursor as string | undefined) ?? undefined;
        } while (cursor);
      }

      const simplified = pages.slice(0, params.max_results).map((p) => ({
        page_id: p.id, title: getPageTitle(p), last_edited_time: p.last_edited_time,
        last_edited_by: (p.last_edited_by as { id?: string } | undefined)?.id, url: p.url,
      }));

      const structured = { pages: simplified, count: simplified.length, since_hours: params.since_hours };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    find_recently_created_pages: async (args) => {
      const params = FindRecentlyCreatedPagesSchema.parse(args);
      const pages: Record<string, unknown>[] = [];

      if (params.database_id) {
        const body = {
          sorts: [{ timestamp: "created_time", direction: "descending" }],
          page_size: params.page_size,
        };
        const response = await logger.time("tool.find_recently_created_pages.db", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "find_recently_created_pages" });
        pages.push(...((response.results as Record<string, unknown>[]) || []).slice(0, params.max_results));
      } else {
        const body = {
          filter: { value: "page", property: "object" },
          sort: { direction: "descending", timestamp: "created_time" },
          page_size: params.page_size,
        };
        const response = await logger.time("tool.find_recently_created_pages.search", () =>
          client.post<Record<string, unknown>>("/search", body)
        , { tool: "find_recently_created_pages" });
        pages.push(...((response.results as Record<string, unknown>[]) || []).slice(0, params.max_results));
      }

      const simplified = pages.map((p) => ({
        page_id: p.id, title: getPageTitle(p), created_time: p.created_time,
        created_by: (p.created_by as { id?: string } | undefined)?.id, url: p.url,
      }));

      const structured = { pages: simplified, count: simplified.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_page_word_count: async (args) => {
      const params = GetPageWordCountSchema.parse(args);
      let totalWords = 0, totalChars = 0, blockCount = 0;

      const scanBlocks = async (blockId: string, depth: number) => {
        if (depth > params.max_depth) return;
        let cursor: string | undefined;
        do {
          const qs = new URLSearchParams({ page_size: "100" });
          if (cursor) qs.set("start_cursor", cursor);
          const response = await logger.time("tool.get_page_word_count.fetch", () =>
            client.get<Record<string, unknown>>(`/blocks/${blockId}/children?${qs}`)
          , { tool: "get_page_word_count", blockId, depth });
          const results = (response.results as Record<string, unknown>[]) || [];
          for (const block of results) {
            blockCount++;
            const text = extractPlainText(block);
            if (text) { totalWords += countWords(text); totalChars += text.length; }
            if (block.has_children && depth < params.max_depth) await scanBlocks(block.id as string, depth + 1);
          }
          cursor = response.next_cursor as string | undefined;
        } while (cursor);
      };

      await scanBlocks(params.page_id, 1);

      const structured = {
        page_id: params.page_id, word_count: totalWords, character_count: totalChars,
        block_count: blockCount, is_empty: totalWords === 0,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    find_empty_pages: async (args) => {
      const params = FindEmptyPagesSchema.parse(args);
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (cursor) body.start_cursor = cursor;
        const response = await logger.time("tool.find_empty_pages.query", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "find_empty_pages", database_id: params.database_id });
        const results = (response.results as Record<string, unknown>[]) || [];
        for (const p of results) {
          if (allPages.length >= params.max_pages) break;
          allPages.push(p);
        }
        cursor = allPages.length >= params.max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      const emptyPages: Record<string, unknown>[] = [];
      for (const page of allPages) {
        if (params.check_content) {
          try {
            const childResponse = await logger.time("tool.find_empty_pages.check", () =>
              client.get<Record<string, unknown>>(`/blocks/${page.id as string}/children?page_size=1`)
            , { tool: "find_empty_pages.check", page_id: page.id });
            const results = (childResponse.results as unknown[]) || [];
            if (results.length === 0) {
              emptyPages.push({ page_id: page.id, title: getPageTitle(page), url: page.url, created_time: page.created_time });
            }
          } catch { /* skip */ }
        } else {
          // Heuristic: check if title is empty
          const title = getPageTitle(page);
          if (!title) emptyPages.push({ page_id: page.id, title, url: page.url });
        }
      }

      const structured = {
        database_id: params.database_id, empty_pages: emptyPages,
        empty_count: emptyPages.length, total_scanned: allPages.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    compare_pages: async (args) => {
      const params = ComparePagesSchema.parse(args);
      const comparison = await Promise.all(params.page_ids.map(async (page_id) => {
        const page = await logger.time("tool.compare_pages.fetch", () =>
          client.get<Record<string, unknown>>(`/pages/${page_id}`)
        , { tool: "compare_pages", page_id });

        const entry: Record<string, unknown> = {
          page_id, title: getPageTitle(page), url: page.url,
          created_time: page.created_time, last_edited_time: page.last_edited_time,
          created_by: (page.created_by as { id?: string } | undefined)?.id,
        };

        if (params.compare_properties) {
          const props = page.properties as Record<string, Record<string, unknown>> | undefined || {};
          for (const propName of params.compare_properties) {
            const prop = props[propName];
            if (!prop) { entry[propName] = null; continue; }
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
      }));

      const structured = { comparison, page_count: comparison.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_database_activity: async (args) => {
      const params = GetDatabaseActivitySchema.parse(args);
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = {
          page_size: 100,
          sorts: [{ timestamp: "created_time", direction: "descending" }],
        };
        if (cursor) body.start_cursor = cursor;
        const response = await logger.time("tool.get_database_activity.fetch", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "get_database_activity", database_id: params.database_id });
        const results = (response.results as Record<string, unknown>[]) || [];
        for (const p of results) {
          if (allPages.length >= params.max_pages) break;
          allPages.push(p);
        }
        cursor = allPages.length >= params.max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      const creationActivity: Record<string, number> = {};
      const editActivity: Record<string, number> = {};

      for (const page of allPages) {
        const createdKey = getDateKey(page.created_time as string, params.group_by);
        const editedKey = getDateKey(page.last_edited_time as string, params.group_by);
        creationActivity[createdKey] = (creationActivity[createdKey] || 0) + 1;
        editActivity[editedKey] = (editActivity[editedKey] || 0) + 1;
      }

      const structured = {
        database_id: params.database_id, group_by: params.group_by,
        creation_activity: creationActivity, edit_activity: editActivity,
        total_pages: allPages.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
