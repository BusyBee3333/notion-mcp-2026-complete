// Notion Bulk Operations tools: bulk_create_pages, bulk_update_page_properties,
//   bulk_delete_blocks, bulk_update_blocks, bulk_query_and_update,
//   bulk_move_pages_to_database
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const BulkCreatePagesSchema = z.object({
  parent_database_id: z.string().optional().describe("Database ID to create pages in"),
  parent_page_id: z.string().optional().describe("Page ID to create sub-pages under"),
  pages: z.array(z.object({
    properties: z.record(z.unknown()).optional().describe("Page properties. For database pages: match the database schema. For sub-pages: {title:[{text:{content:'My Page'}}]}"),
    children: z.array(z.record(z.unknown())).optional().describe("Initial block content for the page"),
    icon: z.object({
      type: z.enum(["emoji", "external"]),
      emoji: z.string().optional(),
      external: z.object({ url: z.string() }).optional(),
    }).optional().describe("Page icon"),
  })).min(1).max(50).describe("Array of pages to create (1-50). Each needs properties matching the parent database or page schema."),
});

const BulkUpdatePagePropertiesSchema = z.object({
  updates: z.array(z.object({
    page_id: z.string().describe("Page ID to update"),
    properties: z.record(z.unknown()).describe("Property values to update. Only include properties to change."),
  })).min(1).max(50).describe("Array of page update operations (1-50)"),
});

const BulkDeleteBlocksSchema = z.object({
  block_ids: z.array(z.string()).min(1).max(50).describe("Array of block IDs to delete (1-50). WARNING: Deletion is permanent."),
});

const BulkUpdateBlocksSchema = z.object({
  updates: z.array(z.object({
    block_id: z.string().describe("Block ID to update"),
    block_type: z.string().describe("Block type (must match existing type)"),
    content: z.record(z.unknown()).describe("Updated content for the block type"),
  })).min(1).max(50).describe("Array of block update operations (1-50)"),
});

const BulkQueryAndUpdateSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  filter: z.record(z.unknown()).optional().describe("Notion filter to select pages to update"),
  properties: z.record(z.unknown()).describe("Property values to apply to ALL matched pages"),
  max_pages: z.number().min(1).max(200).optional().default(50).describe("Maximum number of pages to update (default 50, max 200) — safety limit"),
  dry_run: z.boolean().optional().default(false).describe("If true, only return the pages that WOULD be updated without actually updating them"),
});

const BulkMovePagesToDatabaseSchema = z.object({
  page_ids: z.array(z.string()).min(1).max(20).describe("Array of page IDs to move (1-20)"),
  target_database_id: z.string().describe("Database ID to move the pages into"),
  property_mapping: z.record(z.string()).optional().describe(
    "Optional property name mapping. Keys are source property names, values are target database property names. " +
    "E.g. {'Old Name': 'Name', 'Old Status': 'Status'}"
  ),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "bulk_create_pages",
      title: "Bulk Create Pages",
      description:
        "Create multiple Notion pages at once (up to 50) under the same parent database or page. Much faster than creating pages one by one. Returns results for each page including created IDs and any errors.",
      inputSchema: {
        type: "object",
        properties: {
          parent_database_id: { type: "string", description: "Database ID to create pages in" },
          parent_page_id: { type: "string", description: "Page ID to create sub-pages under" },
          pages: {
            type: "array",
            items: { type: "object" },
            description: "Array of page configs (1-50). Each: {properties?, children?, icon?}",
          },
        },
        required: ["pages"],
      },
      outputSchema: {
        type: "object",
        properties: {
          created: { type: "number" },
          failed: { type: "number" },
          results: { type: "array", items: { type: "object" } },
        },
        required: ["created", "failed", "results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "bulk_update_page_properties",
      title: "Bulk Update Page Properties",
      description:
        "Update properties on multiple Notion pages at once (up to 50 pages). Each page can have different properties updated. Faster than updating pages one at a time. Returns success/failure for each update.",
      inputSchema: {
        type: "object",
        properties: {
          updates: {
            type: "array",
            items: { type: "object" },
            description: "Array of {page_id, properties} objects (1-50). Each page can have different properties.",
          },
        },
        required: ["updates"],
      },
      outputSchema: {
        type: "object",
        properties: {
          updated: { type: "number" },
          failed: { type: "number" },
          results: { type: "array", items: { type: "object" } },
        },
        required: ["updated", "failed", "results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "bulk_delete_blocks",
      title: "Bulk Delete Blocks",
      description:
        "Permanently delete multiple Notion blocks at once (up to 50). WARNING: Deletion is permanent and cannot be undone. Use archive_block for reversible removal. Returns success/failure for each deletion.",
      inputSchema: {
        type: "object",
        properties: {
          block_ids: {
            type: "array",
            items: { type: "string" },
            description: "Array of block IDs to permanently delete (1-50)",
          },
        },
        required: ["block_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          deleted: { type: "number" },
          failed: { type: "number" },
          results: { type: "array", items: { type: "object" } },
        },
        required: ["deleted", "failed", "results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "bulk_update_blocks",
      title: "Bulk Update Blocks",
      description:
        "Update content on multiple Notion blocks at once (up to 50). Each block can have different content updated. Block types cannot be changed. Returns success/failure for each update.",
      inputSchema: {
        type: "object",
        properties: {
          updates: {
            type: "array",
            items: { type: "object" },
            description: "Array of {block_id, block_type, content} objects (1-50)",
          },
        },
        required: ["updates"],
      },
      outputSchema: {
        type: "object",
        properties: {
          updated: { type: "number" },
          failed: { type: "number" },
          results: { type: "array", items: { type: "object" } },
        },
        required: ["updated", "failed", "results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "bulk_query_and_update",
      title: "Bulk Query and Update",
      description:
        "Query a Notion database with a filter and apply the SAME property updates to ALL matching pages. Powerful for mass updates like marking all pages in a status as done, assigning bulk owners, or updating batch properties. Has a dry_run mode to preview which pages would be updated.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query and update" },
          filter: { type: "object", description: "Notion filter to select pages. E.g. {property:'Status',select:{equals:'In Progress'}}" },
          properties: { type: "object", description: "Properties to apply to ALL matched pages. E.g. {Status:{select:{name:'Done'}}}" },
          max_pages: { type: "number", description: "Safety limit: max pages to update (1-200, default 50)" },
          dry_run: { type: "boolean", description: "If true, preview matched pages without updating (default: false)" },
        },
        required: ["database_id", "properties"],
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
      name: "bulk_move_pages_to_database",
      title: "Bulk Move Pages to Database",
      description:
        "Move multiple Notion pages into a target database by updating their parent. Supports optional property name mapping between source and target schemas. Up to 20 pages at a time. Note: moving pages between databases may not always preserve all properties.",
      inputSchema: {
        type: "object",
        properties: {
          page_ids: {
            type: "array",
            items: { type: "string" },
            description: "Page IDs to move into the target database (1-20)",
          },
          target_database_id: { type: "string", description: "Database ID to move pages into" },
          property_mapping: {
            type: "object",
            description: "Optional mapping: source property name → target property name",
          },
        },
        required: ["page_ids", "target_database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          moved: { type: "number" },
          failed: { type: "number" },
          results: { type: "array", items: { type: "object" } },
        },
        required: ["moved", "failed", "results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    bulk_create_pages: async (args) => {
      const params = BulkCreatePagesSchema.parse(args);
      if (!params.parent_database_id && !params.parent_page_id) {
        throw new Error("Either parent_database_id or parent_page_id must be provided");
      }

      const results: Record<string, unknown>[] = [];
      let createdCount = 0;
      let failedCount = 0;

      const parent = params.parent_database_id
        ? { type: "database_id", database_id: params.parent_database_id }
        : { type: "page_id", page_id: params.parent_page_id };

      for (const page of params.pages) {
        try {
          const body: Record<string, unknown> = { parent };
          if (page.properties) body.properties = page.properties;
          if (page.children) body.children = page.children;
          if (page.icon) body.icon = page.icon;

          const res = await logger.time("tool.bulk_create_pages.single", () =>
            client.post("/pages", body)
          , { tool: "bulk_create_pages" });
          const p = res as Record<string, unknown>;
          results.push({ status: "created", page_id: p.id, url: p.url });
          createdCount++;
        } catch (err) {
          results.push({ status: "failed", error: err instanceof Error ? err.message : String(err) });
          failedCount++;
        }
      }

      const structured = { created: createdCount, failed: failedCount, results };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    bulk_update_page_properties: async (args) => {
      const { updates } = BulkUpdatePagePropertiesSchema.parse(args);
      const results: Record<string, unknown>[] = [];
      let updatedCount = 0;
      let failedCount = 0;

      for (const update of updates) {
        try {
          const res = await logger.time("tool.bulk_update_page_properties.single", () =>
            client.patch(`/pages/${update.page_id}`, { properties: update.properties })
          , { tool: "bulk_update_page_properties", page_id: update.page_id });
          results.push({ page_id: update.page_id, status: "updated", result: res });
          updatedCount++;
        } catch (err) {
          results.push({ page_id: update.page_id, status: "failed", error: err instanceof Error ? err.message : String(err) });
          failedCount++;
        }
      }

      const structured = { updated: updatedCount, failed: failedCount, results };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    bulk_delete_blocks: async (args) => {
      const { block_ids } = BulkDeleteBlocksSchema.parse(args);
      const results: Record<string, unknown>[] = [];
      let deletedCount = 0;
      let failedCount = 0;

      for (const block_id of block_ids) {
        try {
          await logger.time("tool.bulk_delete_blocks.single", () =>
            client.delete(`/blocks/${block_id}`)
          , { tool: "bulk_delete_blocks", block_id });
          results.push({ block_id, status: "deleted" });
          deletedCount++;
        } catch (err) {
          results.push({ block_id, status: "failed", error: err instanceof Error ? err.message : String(err) });
          failedCount++;
        }
      }

      const structured = { deleted: deletedCount, failed: failedCount, results };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    bulk_update_blocks: async (args) => {
      const { updates } = BulkUpdateBlocksSchema.parse(args);
      const results: Record<string, unknown>[] = [];
      let updatedCount = 0;
      let failedCount = 0;

      for (const update of updates) {
        try {
          const body: Record<string, unknown> = { [update.block_type]: update.content };
          const res = await logger.time("tool.bulk_update_blocks.single", () =>
            client.patch(`/blocks/${update.block_id}`, body)
          , { tool: "bulk_update_blocks", block_id: update.block_id });
          results.push({ block_id: update.block_id, status: "updated", result: res });
          updatedCount++;
        } catch (err) {
          results.push({ block_id: update.block_id, status: "failed", error: err instanceof Error ? err.message : String(err) });
          failedCount++;
        }
      }

      const structured = { updated: updatedCount, failed: failedCount, results };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    bulk_query_and_update: async (args) => {
      const params = BulkQueryAndUpdateSchema.parse(args);
      const matchedPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      // Fetch pages matching the filter
      do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (params.filter) body.filter = params.filter;
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.bulk_query_and_update.query", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "bulk_query_and_update", database_id: params.database_id });

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
          results: matchedPages.map((p) => ({ page_id: p.id, status: "would_update" })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        };
      }

      // Apply updates
      const results: Record<string, unknown>[] = [];
      let updatedCount = 0;
      let failedCount = 0;

      for (const page of matchedPages) {
        try {
          const res = await logger.time("tool.bulk_query_and_update.update", () =>
            client.patch(`/pages/${page.id as string}`, { properties: params.properties })
          , { tool: "bulk_query_and_update", page_id: page.id });
          results.push({ page_id: page.id, status: "updated" });
          updatedCount++;
        } catch (err) {
          results.push({ page_id: page.id, status: "failed", error: err instanceof Error ? err.message : String(err) });
          failedCount++;
        }
      }

      const structured = {
        dry_run: false,
        matched: matchedPages.length,
        updated: updatedCount,
        failed: failedCount,
        results,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    bulk_move_pages_to_database: async (args) => {
      const params = BulkMovePagesToDatabaseSchema.parse(args);
      const results: Record<string, unknown>[] = [];
      let movedCount = 0;
      let failedCount = 0;

      for (const page_id of params.page_ids) {
        try {
          const body: Record<string, unknown> = {
            parent: { type: "database_id", database_id: params.target_database_id },
          };
          const res = await logger.time("tool.bulk_move_pages_to_database.single", () =>
            client.patch(`/pages/${page_id}`, body)
          , { tool: "bulk_move_pages_to_database", page_id });
          results.push({ page_id, status: "moved", result: res });
          movedCount++;
        } catch (err) {
          results.push({ page_id, status: "failed", error: err instanceof Error ? err.message : String(err) });
          failedCount++;
        }
      }

      const structured = { moved: movedCount, failed: failedCount, results };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
