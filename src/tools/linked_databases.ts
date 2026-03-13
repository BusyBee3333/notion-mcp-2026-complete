// Notion Linked & Inline Database tools:
//   create_inline_database, get_linked_database_pages,
//   create_database_in_page, query_linked_pages,
//   get_child_databases, summarize_database_stats
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const CreateInlineDatabaseSchema = z.object({
  parent_page_id: z.string().describe("Page ID to create the inline database in"),
  title: z.string().describe("Database title"),
  properties: z.record(z.unknown()).describe(
    "Property schema. Must include a title property. Example: {Name:{title:{}},Status:{select:{options:[{name:'Open'},{name:'Done'}]}}}"
  ),
});

const GetChildDatabasesSchema = z.object({
  page_id: z.string().describe("Page ID to find child databases within"),
  start_cursor: z.string().optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const QueryLinkedPagesSchema = z.object({
  database_id: z.string().describe("Database ID to query"),
  relation_property: z.string().describe("Name of the relation property to follow"),
  source_page_id: z.string().describe("Page ID to find related pages for — returns pages that link to/from this page"),
  include_all: z.boolean().optional().default(false).describe("If true, return all related pages (auto-paginate). If false, return first page only."),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const SummarizeDatabaseStatsSchema = z.object({
  database_id: z.string().describe("Database ID to summarize"),
  include_property_stats: z.boolean().optional().default(true).describe("Include value distribution for select/status/checkbox properties"),
  max_pages: z.number().min(1).max(2000).optional().default(500).describe("Max pages to analyze (default 500)"),
});

const GetAllChildPagesSchema = z.object({
  parent_id: z.string().describe("Page or block ID to find all child pages of"),
  recursive: z.boolean().optional().default(false).describe("If true, recursively find child pages at all depths"),
  max_depth: z.number().min(1).max(5).optional().default(3).describe("Maximum depth when recursive=true (default 3)"),
});

const CreatePageInDatabaseWithTemplateSchema = z.object({
  database_id: z.string().describe("Database ID to create the page in"),
  title: z.string().describe("Title for the new page"),
  properties: z.record(z.unknown()).optional().describe("Additional properties to set. E.g. {Status:{select:{name:'In Progress'}}}"),
  template_blocks: z.array(z.record(z.unknown())).optional().describe("Block content to add to the new page as a template"),
  icon_emoji: z.string().optional().describe("Optional emoji icon for the new page"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "create_inline_database",
      title: "Create Inline Database",
      description:
        "Create a new inline database embedded within a Notion page. Unlike full-page databases, inline databases appear as a block within a page's content. Requires a parent page and property schema.",
      inputSchema: {
        type: "object",
        properties: {
          parent_page_id: { type: "string", description: "Page ID to embed the database in" },
          title: { type: "string", description: "Database title" },
          properties: { type: "object", description: "Property schema (must include a title property)" },
        },
        required: ["parent_page_id", "title", "properties"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          is_inline: { type: "boolean" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_child_databases",
      title: "Get Child Databases",
      description:
        "List all child databases (inline or linked) within a Notion page. Scans the page's block children for child_database blocks. Returns database IDs, titles, and metadata.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to scan for child databases" },
          start_cursor: { type: "string" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          databases: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["page_id", "databases", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "query_linked_pages",
      title: "Query Linked Pages",
      description:
        "Find all pages in a database that are related to a specific page via a relation property. Useful for finding all tasks linked to a project, or all notes linked to a contact.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to query" },
          relation_property: { type: "string", description: "Name of the relation property" },
          source_page_id: { type: "string", description: "Page ID to find related pages for" },
          include_all: { type: "boolean", description: "Auto-paginate to get all results (default: false)" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
        required: ["database_id", "relation_property", "source_page_id"],
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
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "summarize_database_stats",
      title: "Summarize Database Statistics",
      description:
        "Analyze a Notion database and return statistics: total page count, property value distributions for select/status/checkbox properties, date range of date properties, and more. Useful for dashboards and data overviews.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to analyze" },
          include_property_stats: { type: "boolean", description: "Include value distributions (default: true)" },
          max_pages: { type: "number", description: "Max pages to analyze (1-2000, default 500)" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          total_pages: { type: "number" },
          archived_pages: { type: "number" },
          property_stats: { type: "object" },
          date_range: { type: "object" },
        },
        required: ["database_id", "total_pages"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_all_child_pages",
      title: "Get All Child Pages",
      description:
        "Get all child pages nested under a Notion page. Optionally recurse through multiple levels of nesting to find deeply nested sub-pages. Returns page IDs, titles, and URLs.",
      inputSchema: {
        type: "object",
        properties: {
          parent_id: { type: "string", description: "Parent page or block ID" },
          recursive: { type: "boolean", description: "Recursively find child pages (default: false)" },
          max_depth: { type: "number", description: "Maximum recursion depth when recursive=true (1-5, default 3)" },
        },
        required: ["parent_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          parent_id: { type: "string" },
          pages: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["parent_id", "pages", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_page_in_database_with_template",
      title: "Create Page in Database with Template",
      description:
        "Create a new page in a Notion database with a title, optional properties, and optional initial block content (template). Combines page creation and content population in one call.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to create the page in" },
          title: { type: "string", description: "Title for the new page" },
          properties: { type: "object", description: "Additional properties to set" },
          template_blocks: { type: "array", items: { type: "object" }, description: "Block content to add to the new page" },
          icon_emoji: { type: "string", description: "Optional emoji icon" },
        },
        required: ["database_id", "title"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
          created_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    create_inline_database: async (args) => {
      const params = CreateInlineDatabaseSchema.parse(args);
      const body: Record<string, unknown> = {
        parent: { type: "page_id", page_id: params.parent_page_id },
        title: [{ type: "text", text: { content: params.title } }],
        properties: params.properties,
        is_inline: true,
      };
      const result = await logger.time("tool.create_inline_database", () =>
        client.post("/databases", body)
      , { tool: "create_inline_database" });
      const db = result as Record<string, unknown>;
      const titleArr = db.title as Array<{ plain_text?: string }> | undefined;
      const titleText = titleArr?.map((t) => t.plain_text || "").join("") || params.title;
      const structured = { ...db, title: titleText };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_child_databases: async (args) => {
      const params = GetChildDatabasesSchema.parse(args);
      const qs = new URLSearchParams({ page_size: String(params.page_size) });
      if (params.start_cursor) qs.set("start_cursor", params.start_cursor);

      const response = await logger.time("tool.get_child_databases", () =>
        client.get<Record<string, unknown>>(`/blocks/${params.page_id}/children?${qs}`)
      , { tool: "get_child_databases", page_id: params.page_id });

      const results = (response.results as Record<string, unknown>[]) || [];
      const databases = results
        .filter((b) => b.type === "child_database")
        .map((b) => {
          const cd = b.child_database as Record<string, unknown> | undefined;
          return {
            block_id: b.id,
            title: cd?.title,
            created_time: b.created_time,
            last_edited_time: b.last_edited_time,
          };
        });

      const structured = { page_id: params.page_id, databases, count: databases.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    query_linked_pages: async (args) => {
      const params = QueryLinkedPagesSchema.parse(args);
      const filter = {
        property: params.relation_property,
        relation: { contains: params.source_page_id },
      };

      const allResults: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = { filter, page_size: params.page_size };
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.query_linked_pages", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "query_linked_pages", database_id: params.database_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        allResults.push(...results);

        cursor = params.include_all ? (response.next_cursor as string | undefined) ?? undefined : undefined;
      } while (cursor);

      const structured = {
        results: allResults,
        count: allResults.length,
        has_more: !params.include_all,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    summarize_database_stats: async (args) => {
      const params = SummarizeDatabaseStatsSchema.parse(args);

      // Fetch database schema
      const db = await logger.time("tool.summarize_database_stats.schema", () =>
        client.get<Record<string, unknown>>(`/databases/${params.database_id}`)
      , { tool: "summarize_database_stats", database_id: params.database_id });

      const properties = db.properties as Record<string, Record<string, unknown>> | undefined || {};
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.summarize_database_stats.query", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "summarize_database_stats", database_id: params.database_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const p of results) {
          if (allPages.length >= params.max_pages) break;
          allPages.push(p);
        }
        cursor = allPages.length >= params.max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      const archivedCount = allPages.filter((p) => p.archived).length;

      // Property stats
      const propertyStats: Record<string, unknown> = {};
      if (params.include_property_stats) {
        for (const [propName, propDef] of Object.entries(properties)) {
          const ptype = propDef.type as string;
          if (["select", "multi_select", "status"].includes(ptype)) {
            const valueCounts: Record<string, number> = {};
            for (const page of allPages) {
              const props = page.properties as Record<string, Record<string, unknown>> | undefined;
              if (!props) continue;
              const prop = props[propName];
              if (!prop) continue;
              if (ptype === "select" || ptype === "status") {
                const val = (prop[ptype] as { name?: string } | null)?.name || "(empty)";
                valueCounts[val] = (valueCounts[val] || 0) + 1;
              } else if (ptype === "multi_select") {
                const vals = prop.multi_select as Array<{ name?: string }> | undefined;
                if (!vals || vals.length === 0) {
                  valueCounts["(empty)"] = (valueCounts["(empty)"] || 0) + 1;
                } else {
                  for (const v of vals) {
                    const name = v.name || "(empty)";
                    valueCounts[name] = (valueCounts[name] || 0) + 1;
                  }
                }
              }
            }
            propertyStats[propName] = { type: ptype, value_counts: valueCounts };
          } else if (ptype === "checkbox") {
            let trueCount = 0;
            let falseCount = 0;
            for (const page of allPages) {
              const props = page.properties as Record<string, Record<string, unknown>> | undefined;
              const val = props?.[propName]?.checkbox;
              if (val === true) trueCount++;
              else falseCount++;
            }
            propertyStats[propName] = { type: ptype, true: trueCount, false: falseCount };
          }
        }
      }

      const structured = {
        database_id: params.database_id,
        total_pages: allPages.length,
        archived_pages: archivedCount,
        property_stats: propertyStats,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_all_child_pages: async (args) => {
      const params = GetAllChildPagesSchema.parse(args);
      const pages: Record<string, unknown>[] = [];

      const fetchChildren = async (parentId: string, depth: number) => {
        if (depth > params.max_depth) return;
        let cursor: string | undefined;
        do {
          const qs = new URLSearchParams({ page_size: "100" });
          if (cursor) qs.set("start_cursor", cursor);
          const response = await logger.time("tool.get_all_child_pages.fetch", () =>
            client.get<Record<string, unknown>>(`/blocks/${parentId}/children?${qs}`)
          , { tool: "get_all_child_pages", parentId, depth });

          const results = (response.results as Record<string, unknown>[]) || [];
          for (const block of results) {
            if (block.type === "child_page") {
              const cp = block.child_page as Record<string, unknown> | undefined;
              pages.push({
                page_id: block.id,
                title: cp?.title,
                depth,
                parent_id: parentId,
                created_time: block.created_time,
              });
              if (params.recursive) {
                await fetchChildren(block.id as string, depth + 1);
              }
            }
          }
          cursor = response.next_cursor as string | undefined;
        } while (cursor);
      };

      await fetchChildren(params.parent_id, 1);

      const structured = { parent_id: params.parent_id, pages, count: pages.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    create_page_in_database_with_template: async (args) => {
      const params = CreatePageInDatabaseWithTemplateSchema.parse(args);
      const properties: Record<string, unknown> = {
        ...(params.properties || {}),
        title: [{ type: "text", text: { content: params.title } }],
      };

      const body: Record<string, unknown> = {
        parent: { type: "database_id", database_id: params.database_id },
        properties,
      };

      if (params.template_blocks && params.template_blocks.length > 0) {
        body.children = params.template_blocks;
      }
      if (params.icon_emoji) {
        body.icon = { type: "emoji", emoji: params.icon_emoji };
      }

      const result = await logger.time("tool.create_page_in_database_with_template", () =>
        client.post("/pages", body)
      , { tool: "create_page_in_database_with_template", database_id: params.database_id });

      const page = result as Record<string, unknown>;
      const structured = {
        id: page.id,
        url: page.url,
        title: params.title,
        created_time: page.created_time,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
