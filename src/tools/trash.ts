// Notion Trash & Archive tools: archive_block, restore_page_from_trash,
//   list_archived_pages, permanently_delete_page, trash_database,
//   restore_database, bulk_archive_pages, bulk_restore_pages
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ArchiveBlockSchema = z.object({
  block_id: z.string().describe("Block ID to archive (soft delete / move to trash)"),
});

const RestorePageSchema = z.object({
  page_id: z.string().describe("Page ID to restore from trash (un-archive)"),
});

const ListArchivedPagesSchema = z.object({
  query: z.string().optional().describe("Search query to filter archived pages by title"),
  start_cursor: z.string().optional().describe("Pagination cursor from a previous response"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Number of results (1-100, default 25)"),
});

const TrashDatabaseSchema = z.object({
  database_id: z.string().describe("Database ID to archive / send to trash"),
});

const RestoreDatabaseSchema = z.object({
  database_id: z.string().describe("Database ID to restore from trash (un-archive)"),
});

const BulkArchivePagesSchema = z.object({
  page_ids: z.array(z.string()).min(1).max(50).describe("Array of page IDs to archive (1-50 at a time)"),
});

const BulkRestorePagesSchema = z.object({
  page_ids: z.array(z.string()).min(1).max(50).describe("Array of page IDs to restore from trash (1-50 at a time)"),
});

const GetArchivedPageSchema = z.object({
  page_id: z.string().describe("Page ID to fetch (even if archived)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "archive_block",
      title: "Archive Block",
      description:
        "Archive (soft-delete) a Notion block by setting archived=true. Archived blocks are hidden from the UI but can be restored. Different from delete_block which is permanent. Use to temporarily hide a block without destroying it.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Block ID to archive" },
        },
        required: ["block_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          archived: { type: "boolean" },
          last_edited_time: { type: "string" },
        },
        required: ["id", "archived"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "restore_page_from_trash",
      title: "Restore Page from Trash",
      description:
        "Restore an archived (trashed) Notion page by setting archived=false. The page returns to its original location. Use after archive_page or when the user wants to un-delete a page.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to restore from trash" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          archived: { type: "boolean" },
          url: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_archived_pages",
      title: "List Archived Pages",
      description:
        "Search for archived (trashed) pages accessible to the integration. Returns archived pages with their titles, IDs, and metadata. Useful for finding deleted pages to restore. Supports pagination.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional title keyword filter" },
          start_cursor: { type: "string", description: "Pagination cursor from previous response" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          next_cursor: { type: "string" },
          has_more: { type: "boolean" },
          total_archived: { type: "number" },
        },
        required: ["results", "has_more"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "trash_database",
      title: "Trash Database",
      description:
        "Archive (trash) a Notion database. The database and its pages are hidden but not permanently deleted. Can be restored with restore_database. Use when the user wants to remove a database without deleting its data.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to archive / send to trash" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          archived: { type: "boolean" },
          title: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "restore_database",
      title: "Restore Database",
      description:
        "Restore an archived (trashed) Notion database by setting archived=false. All pages inside the database are also restored. Use to undo trash_database or a manual archive.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to restore from trash" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          archived: { type: "boolean" },
          url: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "bulk_archive_pages",
      title: "Bulk Archive Pages",
      description:
        "Archive multiple Notion pages at once (up to 50). Each page is sent to trash. This is faster than archiving one at a time. Returns results for each page including success/failure status.",
      inputSchema: {
        type: "object",
        properties: {
          page_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of page IDs to archive (1-50 IDs)",
          },
        },
        required: ["page_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          archived: { type: "number" },
          failed: { type: "number" },
          results: { type: "array", items: { type: "object" } },
        },
        required: ["archived", "failed", "results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "bulk_restore_pages",
      title: "Bulk Restore Pages",
      description:
        "Restore multiple archived Notion pages at once (up to 50). Faster than restoring one at a time. Returns results for each page including success/failure status.",
      inputSchema: {
        type: "object",
        properties: {
          page_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of page IDs to restore from trash (1-50 IDs)",
          },
        },
        required: ["page_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          restored: { type: "number" },
          failed: { type: "number" },
          results: { type: "array", items: { type: "object" } },
        },
        required: ["restored", "failed", "results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_archived_page",
      title: "Get Archived Page",
      description:
        "Retrieve an archived (trashed) Notion page by ID. Useful to inspect a deleted page's properties before deciding whether to restore it. Returns full page metadata including archive status.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to fetch (archived or not)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          archived: { type: "boolean" },
          properties: { type: "object" },
          url: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    archive_block: async (args) => {
      const { block_id } = ArchiveBlockSchema.parse(args);
      const result = await logger.time("tool.archive_block", () =>
        client.patch(`/blocks/${block_id}`, { archived: true })
      , { tool: "archive_block", block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    restore_page_from_trash: async (args) => {
      const { page_id } = RestorePageSchema.parse(args);
      const result = await logger.time("tool.restore_page_from_trash", () =>
        client.patch(`/pages/${page_id}`, { archived: false })
      , { tool: "restore_page_from_trash", page_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_archived_pages: async (args) => {
      const params = ListArchivedPagesSchema.parse(args);
      const body: Record<string, unknown> = {
        filter: { value: "page", property: "object" },
        page_size: params.page_size,
      };
      if (params.query) body.query = params.query;
      if (params.start_cursor) body.start_cursor = params.start_cursor;

      // Notion API: search with filter to get pages; filter archived separately
      const result = await logger.time("tool.list_archived_pages", () =>
        client.post<Record<string, unknown>>("/search", body)
      , { tool: "list_archived_pages" });

      const allResults = (result.results as Record<string, unknown>[]) || [];
      const archivedResults = allResults.filter((p) => p.archived === true);

      const structured = {
        ...result,
        results: archivedResults,
        total_archived: archivedResults.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    trash_database: async (args) => {
      const { database_id } = TrashDatabaseSchema.parse(args);
      const result = await logger.time("tool.trash_database", () =>
        client.patch(`/databases/${database_id}`, { archived: true })
      , { tool: "trash_database", database_id });

      const db = result as Record<string, unknown>;
      const titleArr = db.title as Array<{ plain_text?: string }> | undefined;
      const titleText = titleArr?.map((t) => t.plain_text || "").join("") || "";
      const structured = { ...db, title: titleText };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    restore_database: async (args) => {
      const { database_id } = RestoreDatabaseSchema.parse(args);
      const result = await logger.time("tool.restore_database", () =>
        client.patch(`/databases/${database_id}`, { archived: false })
      , { tool: "restore_database", database_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    bulk_archive_pages: async (args) => {
      const { page_ids } = BulkArchivePagesSchema.parse(args);
      const results: Record<string, unknown>[] = [];
      let archivedCount = 0;
      let failedCount = 0;

      for (const page_id of page_ids) {
        try {
          const res = await logger.time("tool.bulk_archive_pages.single", () =>
            client.patch(`/pages/${page_id}`, { archived: true })
          , { tool: "bulk_archive_pages", page_id });
          results.push({ page_id, status: "archived", result: res });
          archivedCount++;
        } catch (err) {
          results.push({ page_id, status: "failed", error: err instanceof Error ? err.message : String(err) });
          failedCount++;
        }
      }

      const structured = { archived: archivedCount, failed: failedCount, results };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    bulk_restore_pages: async (args) => {
      const { page_ids } = BulkRestorePagesSchema.parse(args);
      const results: Record<string, unknown>[] = [];
      let restoredCount = 0;
      let failedCount = 0;

      for (const page_id of page_ids) {
        try {
          const res = await logger.time("tool.bulk_restore_pages.single", () =>
            client.patch(`/pages/${page_id}`, { archived: false })
          , { tool: "bulk_restore_pages", page_id });
          results.push({ page_id, status: "restored", result: res });
          restoredCount++;
        } catch (err) {
          results.push({ page_id, status: "failed", error: err instanceof Error ? err.message : String(err) });
          failedCount++;
        }
      }

      const structured = { restored: restoredCount, failed: failedCount, results };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_archived_page: async (args) => {
      const { page_id } = GetArchivedPageSchema.parse(args);
      const result = await logger.time("tool.get_archived_page", () =>
        client.get(`/pages/${page_id}`)
      , { tool: "get_archived_page", page_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
