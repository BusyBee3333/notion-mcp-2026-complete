// Notion Page tools: get_page, create_page, update_page, archive_page
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetPageSchema = z.object({
  page_id: z.string().describe("Notion page ID (UUID format)"),
});

const CreatePageSchema = z.object({
  parent_database_id: z.string().optional().describe("Parent database ID — create a new database entry"),
  parent_page_id: z.string().optional().describe("Parent page ID — create a sub-page"),
  properties: z.record(z.unknown()).optional().describe("Page properties object. For database pages, must match the database schema. For page children, typically just {title:[{text:{content:'My Page'}}]}"),
  children: z.array(z.record(z.unknown())).optional().describe("Initial block content to add to the page. Array of Notion block objects."),
  icon: z.object({
    type: z.enum(["emoji", "external"]),
    emoji: z.string().optional(),
    external: z.object({ url: z.string() }).optional(),
  }).optional().describe("Page icon — emoji or external URL"),
  cover: z.object({
    type: z.literal("external"),
    external: z.object({ url: z.string() }),
  }).optional().describe("Page cover image (external URL)"),
});

const UpdatePageSchema = z.object({
  page_id: z.string().describe("Notion page ID to update"),
  properties: z.record(z.unknown()).optional().describe("Properties to update. Only include properties to change. Must match the database schema if in a database."),
  icon: z.object({
    type: z.enum(["emoji", "external"]),
    emoji: z.string().optional(),
    external: z.object({ url: z.string() }).optional(),
  }).optional().describe("Update page icon"),
  cover: z.object({
    type: z.literal("external"),
    external: z.object({ url: z.string() }),
  }).optional().describe("Update page cover image"),
});

const ArchivePageSchema = z.object({
  page_id: z.string().describe("Notion page ID to archive (soft delete)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_page",
      title: "Get Page",
      description:
        "Get a Notion page's properties and metadata by ID. Returns page properties, title, icon, cover, and parent info. Does NOT return block content — use get_block_children for content. Use when you need page metadata or property values.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID (UUID format)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          object: { type: "string" },
          parent: { type: "object" },
          properties: { type: "object" },
          url: { type: "string" },
          created_time: { type: "string" },
          last_edited_time: { type: "string" },
          archived: { type: "boolean" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "create_page",
      title: "Create Page",
      description:
        "Create a new Notion page either as a database entry (provide parent_database_id + properties) or as a sub-page (provide parent_page_id). Optionally include initial block content via children. Returns created page with ID and URL.",
      inputSchema: {
        type: "object",
        properties: {
          parent_database_id: { type: "string", description: "Parent database ID — creates a database entry" },
          parent_page_id: { type: "string", description: "Parent page ID — creates a sub-page" },
          properties: { type: "object", description: "Page properties matching database schema, or title for sub-pages" },
          children: { type: "array", items: { type: "object" }, description: "Initial block content (Notion block objects)" },
          icon: { type: "object", description: "Page icon: {type:'emoji',emoji:'🚀'} or {type:'external',external:{url:'https://...'}}" },
          cover: { type: "object", description: "Cover image: {type:'external',external:{url:'https://...'}}" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          properties: { type: "object" },
          created_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_page",
      title: "Update Page",
      description:
        "Update a Notion page's properties, icon, or cover. Only pass the properties you want to change. Returns updated page. Does NOT update block content — use append_blocks for that.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID to update" },
          properties: { type: "object", description: "Properties to update — only include fields to change" },
          icon: { type: "object", description: "Update icon: {type:'emoji',emoji:'✅'}" },
          cover: { type: "object", description: "Update cover image" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          properties: { type: "object" },
          last_edited_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "archive_page",
      title: "Archive Page",
      description:
        "Archive (soft delete) a Notion page. Archived pages are hidden but not permanently deleted — they can be unarchived. Use when the user wants to remove a page from view.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID to archive" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          archived: { type: "boolean" },
        },
        required: ["id", "archived"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_page: async (args) => {
      const { page_id } = GetPageSchema.parse(args);
      const result = await logger.time("tool.get_page", () =>
        client.get(`/pages/${page_id}`)
      , { tool: "get_page", page_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    create_page: async (args) => {
      const params = CreatePageSchema.parse(args);

      if (!params.parent_database_id && !params.parent_page_id) {
        throw new Error("Either parent_database_id or parent_page_id is required");
      }

      const body: Record<string, unknown> = {};

      if (params.parent_database_id) {
        body.parent = { type: "database_id", database_id: params.parent_database_id };
      } else {
        body.parent = { type: "page_id", page_id: params.parent_page_id };
      }

      if (params.properties) body.properties = params.properties;
      if (params.children) body.children = params.children;
      if (params.icon) body.icon = params.icon;
      if (params.cover) body.cover = params.cover;

      const result = await logger.time("tool.create_page", () =>
        client.post("/pages", body)
      , { tool: "create_page" });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    update_page: async (args) => {
      const { page_id, ...params } = UpdatePageSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.properties) body.properties = params.properties;
      if (params.icon) body.icon = params.icon;
      if (params.cover) body.cover = params.cover;

      const result = await logger.time("tool.update_page", () =>
        client.patch(`/pages/${page_id}`, body)
      , { tool: "update_page", page_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    archive_page: async (args) => {
      const { page_id } = ArchivePageSchema.parse(args);
      const result = await logger.time("tool.archive_page", () =>
        client.patch(`/pages/${page_id}`, { archived: true })
      , { tool: "archive_page", page_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
