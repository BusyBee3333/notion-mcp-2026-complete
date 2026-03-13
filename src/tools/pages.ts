// Notion Page tools: get_page, create_page, update_page, archive_page,
//   update_page_properties, restore_page, get_page_property_item, duplicate_page,
//   create_page_with_content, get_full_page_content, set_page_icon, set_page_cover,
//   move_page_to_database
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

const UpdatePagePropertiesSchema = z.object({
  page_id: z.string().describe("Notion page ID to update"),
  properties: z.record(z.unknown()).describe(
    `Property values to update, keyed by property name. Only pass the properties you want to change.
Examples by property type:
- Title: {"Name": {"title": [{"text": {"content": "New Title"}}]}}
- Rich text: {"Notes": {"rich_text": [{"text": {"content": "Some notes"}}]}}
- Number: {"Score": {"number": 42}}
- Select: {"Status": {"select": {"name": "Done"}}}
- Multi-select: {"Tags": {"multi_select": [{"name": "Frontend"},{"name": "Bug"}]}}
- Date: {"Due": {"date": {"start": "2024-12-31"}}} or with time: {"date": {"start": "2024-12-31T10:00:00Z","end": null}}
- Checkbox: {"Done": {"checkbox": true}}
- URL: {"Website": {"url": "https://example.com"}}
- Email: {"Contact": {"email": "user@example.com"}}
- Phone: {"Phone": {"phone_number": "+1-555-555-5555"}}
- People: {"Assigned": {"people": [{"object": "user","id": "user_id"}]}}
- Relation: {"Project": {"relation": [{"id": "page_id"}]}}
- Files: {"Attachment": {"files": [{"name": "file.pdf","external": {"url": "https://..."}}]}}`
  ),
});

const RestorePageSchema = z.object({
  page_id: z.string().describe("Notion page ID to restore from archive (unarchive)"),
});

const GetPagePropertyItemSchema = z.object({
  page_id: z.string().describe("Notion page ID"),
  property_id: z.string().describe("Property ID or name (get IDs from get_database schema — IDs are more reliable than names)"),
  start_cursor: z.string().optional().describe("Cursor for paginated properties (relation, people, rich_text, title)"),
  page_size: z.number().min(1).max(100).optional().default(25).describe("Items per page (1-100, default 25)"),
});

const DuplicatePageSchema = z.object({
  page_id: z.string().describe("Notion page ID to duplicate"),
  parent_page_id: z.string().optional().describe("Parent page ID for the duplicate — defaults to same parent as source page"),
  parent_database_id: z.string().optional().describe("Parent database ID for the duplicate — use if duplicating a database entry"),
  new_title: z.string().optional().describe("Title for the duplicated page. Defaults to original title with '(Copy)' suffix."),
  include_content: z.boolean().optional().default(true).describe("Whether to copy block content (children) into the duplicate (default: true). NOTE: Only top-level blocks are copied — nested children are not recursively copied."),
});

// ============ Round 2 Schemas ============

const CreatePageWithContentSchema = z.object({
  parent_database_id: z.string().optional().describe("Parent database ID — creates a new database entry"),
  parent_page_id: z.string().optional().describe("Parent page ID — creates a sub-page"),
  properties: z.record(z.unknown()).optional().describe("Page properties. For database pages must match schema. For sub-pages use {title:[{text:{content:'My Page'}}]}"),
  blocks: z.array(z.record(z.unknown())).describe(
    "Block content to append after page creation. Array of Notion block objects. Limited to 100 blocks in one call (Notion API limit). " +
    "Example: [{type:'heading_1',heading_1:{rich_text:[{type:'text',text:{content:'Introduction'}}]}},{type:'paragraph',paragraph:{rich_text:[{type:'text',text:{content:'Hello world'}}]}}]"
  ),
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

const GetFullPageContentSchema = z.object({
  page_id: z.string().describe("Notion page ID (UUID format)"),
  max_depth: z.number().min(1).max(10).optional().default(5).describe("Maximum nesting depth for block recursion (1-10, default 5)"),
  page_size: z.number().min(1).max(100).optional().default(50).describe("Blocks per API call (1-100, default 50)"),
});

const SetPageIconSchema = z.object({
  page_id: z.string().describe("Notion page ID to update"),
  icon_type: z.enum(["emoji", "external"]).describe("Icon type: 'emoji' for an emoji character, 'external' for an image URL"),
  emoji: z.string().optional().describe("Emoji character to use as icon (when icon_type is 'emoji'). E.g. '🚀', '📝', '✅'"),
  url: z.string().optional().describe("External image URL to use as icon (when icon_type is 'external'). Must be publicly accessible."),
});

const SetPageCoverSchema = z.object({
  page_id: z.string().describe("Notion page ID to update"),
  url: z.string().url().describe("External image URL for the page cover. Must be a publicly accessible image URL. E.g. 'https://images.unsplash.com/photo-...'"),
});

const MovePageToDatabaseSchema = z.object({
  page_id: z.string().describe("Notion page ID to move"),
  database_id: z.string().describe("Target database ID. The page will become an entry in this database."),
  properties: z.record(z.unknown()).optional().describe(
    "Properties to set in the new parent database. Should match the target database schema. " +
    "If omitted, only the parent is changed — existing page properties are preserved where compatible."
  ),
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
        "Archive (soft delete) a Notion page. Archived pages are hidden but not permanently deleted — they can be unarchived with restore_page. Use when the user wants to remove a page from view.",
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
    {
      name: "update_page_properties",
      title: "Update Page Properties",
      description:
        "Update one or more property values on a Notion page. Handles all property types: title, rich_text, number, select, multi_select, date, checkbox, url, email, phone_number, people, relation, files. Only the properties you pass are updated — all others remain unchanged.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID to update" },
          properties: {
            type: "object",
            description: "Property values to update. Examples: {\"Status\":{\"select\":{\"name\":\"Done\"}}, \"Due\":{\"date\":{\"start\":\"2024-12-31\"}}, \"Score\":{\"number\":42}}",
          },
        },
        required: ["page_id", "properties"],
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
      name: "restore_page",
      title: "Restore Page",
      description:
        "Restore (unarchive) a previously archived Notion page. The page will become visible again in the workspace. Use after archive_page to undo the archiving.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID to restore from archive" },
        },
        required: ["page_id"],
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
      name: "get_page_property_item",
      title: "Get Page Property Item",
      description:
        "Get the value of a specific property on a Notion page using the Notion property item endpoint. Supports all property types with pagination for relation, rich_text, title, and people properties. Use property IDs from get_database schema for best reliability.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID" },
          property_id: { type: "string", description: "Property ID or name (IDs from get_database are more reliable)" },
          start_cursor: { type: "string", description: "Cursor for paginated properties (relation, people, rich_text, title)" },
          page_size: { type: "number", description: "Items per page (1-100, default 25)" },
        },
        required: ["page_id", "property_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          object: { type: "string" },
          type: { type: "string" },
          results: { type: "array", items: { type: "object" } },
          next_cursor: { type: "string" },
          has_more: { type: "boolean" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "duplicate_page",
      title: "Duplicate Page",
      description:
        "Create a copy of an existing Notion page. Copies the page's properties and optionally its top-level block content. You can specify a new parent and/or a new title. NOTE: Only top-level blocks are copied; nested children blocks are not recursively duplicated (Notion API limitation).",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Source page ID to duplicate" },
          parent_page_id: { type: "string", description: "Parent page ID for the copy — defaults to same parent as source" },
          parent_database_id: { type: "string", description: "Parent database ID for the copy (for database entries)" },
          new_title: { type: "string", description: "Title for the duplicated page (defaults to '<original> (Copy)')" },
          include_content: { type: "boolean", description: "Copy top-level block content (default: true)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string" },
          created_time: { type: "string" },
          source_page_id: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },

    // ============ Round 2 Tool Definitions ============

    {
      name: "create_page_with_content",
      title: "Create Page With Content",
      description:
        "Create a new Notion page AND immediately populate it with block content in one logical operation. First creates the page (optionally in a database or as a sub-page), then appends the provided blocks. Eliminates the need for a separate append_blocks call after create_page. Returns both the created page metadata and the appended blocks.",
      inputSchema: {
        type: "object",
        properties: {
          parent_database_id: { type: "string", description: "Parent database ID — creates a database entry" },
          parent_page_id: { type: "string", description: "Parent page ID — creates a sub-page" },
          properties: { type: "object", description: "Page properties matching the database schema, or title for sub-pages" },
          blocks: {
            type: "array",
            items: { type: "object" },
            description: "Block content to append. Array of Notion block objects (up to 100). E.g. [{type:'heading_1',heading_1:{rich_text:[{type:'text',text:{content:'Hello'}}]}}]",
          },
          icon: { type: "object", description: "Page icon: {type:'emoji',emoji:'🚀'} or {type:'external',external:{url:'https://...'}}" },
          cover: { type: "object", description: "Cover image: {type:'external',external:{url:'https://...'}}" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          page: { type: "object" },
          blocks_appended: { type: "object" },
          page_id: { type: "string" },
          url: { type: "string" },
        },
        required: ["page", "page_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_full_page_content",
      title: "Get Full Page Content",
      description:
        "Fetch a page's properties AND all its block content (recursively) in a single call. Combines get_page + get_block_children_recursive into one convenient tool. Returns the page metadata, all properties, and the complete block tree. Ideal for 'read the whole page' use cases.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID to read completely" },
          max_depth: { type: "number", description: "Max nesting depth for blocks (1-10, default 5)" },
          page_size: { type: "number", description: "Blocks per API call (1-100, default 50)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page: { type: "object" },
          blocks: { type: "array", items: { type: "object" } },
          total_blocks: { type: "number" },
          depth_reached: { type: "number" },
        },
        required: ["page", "blocks", "total_blocks"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_page_icon",
      title: "Set Page Icon",
      description:
        "Set or update the icon of a Notion page. Supports emoji icons (e.g. '🚀', '📝') and external image URLs. Replaces any existing icon. Works on both regular pages and database entries.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID to update" },
          icon_type: { type: "string", enum: ["emoji", "external"], description: "'emoji' for an emoji character or 'external' for an image URL" },
          emoji: { type: "string", description: "Emoji character (when icon_type is 'emoji'). E.g. '🚀', '📝', '✅', '🎯'" },
          url: { type: "string", description: "Image URL (when icon_type is 'external'). Must be publicly accessible." },
        },
        required: ["page_id", "icon_type"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          icon: { type: "object" },
          last_edited_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_page_cover",
      title: "Set Page Cover",
      description:
        "Set or update the cover image of a Notion page. Accepts any publicly accessible image URL. Replaces any existing cover. Works on both regular pages and database entries.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID to update" },
          url: { type: "string", description: "Publicly accessible image URL for the cover. E.g. 'https://images.unsplash.com/photo-...'" },
        },
        required: ["page_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          cover: { type: "object" },
          last_edited_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "move_page_to_database",
      title: "Move Page to Database",
      description:
        "Move a Notion page into a database by updating its parent. The page becomes a database entry. Optionally set properties to match the target database schema. Note: Notion API requires the page and database to be in the same workspace.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID to move" },
          database_id: { type: "string", description: "Target database ID — the page will become an entry here" },
          properties: { type: "object", description: "Properties matching the target database schema. E.g. {Status:{select:{name:'To Do'}}}. Optional — omit to use defaults." },
        },
        required: ["page_id", "database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          parent: { type: "object" },
          properties: { type: "object" },
          last_edited_time: { type: "string" },
        },
        required: ["id", "parent"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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

    update_page_properties: async (args) => {
      const params = UpdatePagePropertiesSchema.parse(args);
      const result = await logger.time("tool.update_page_properties", () =>
        client.patch(`/pages/${params.page_id}`, { properties: params.properties })
      , { tool: "update_page_properties", page_id: params.page_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    restore_page: async (args) => {
      const { page_id } = RestorePageSchema.parse(args);
      const result = await logger.time("tool.restore_page", () =>
        client.patch(`/pages/${page_id}`, { archived: false })
      , { tool: "restore_page", page_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_page_property_item: async (args) => {
      const params = GetPagePropertyItemSchema.parse(args);
      const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
      if (params.start_cursor) queryParams.set("start_cursor", params.start_cursor);

      const result = await logger.time("tool.get_page_property_item", () =>
        client.get(`/pages/${params.page_id}/properties/${encodeURIComponent(params.property_id)}?${queryParams}`)
      , { tool: "get_page_property_item", page_id: params.page_id, property_id: params.property_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    duplicate_page: async (args) => {
      const params = DuplicatePageSchema.parse(args);

      // Fetch the source page
      const sourcePage = await logger.time("tool.duplicate_page.get_source", () =>
        client.get<Record<string, unknown>>(`/pages/${params.page_id}`)
      , { tool: "duplicate_page.get_source", page_id: params.page_id });

      // Determine parent
      let parent: Record<string, unknown>;
      if (params.parent_database_id) {
        parent = { type: "database_id", database_id: params.parent_database_id };
      } else if (params.parent_page_id) {
        parent = { type: "page_id", page_id: params.parent_page_id };
      } else {
        // Use the source page's parent
        parent = sourcePage.parent as Record<string, unknown>;
      }

      // Build properties — try to copy them, updating the title if requested
      let properties = sourcePage.properties as Record<string, unknown> | undefined;

      if (params.new_title && properties) {
        // Find the title property and update it
        const props = properties as Record<string, Record<string, unknown>>;
        const titleKey = Object.keys(props).find((k) => props[k].type === "title") || "title";
        properties = {
          ...props,
          [titleKey]: {
            title: [{ type: "text", text: { content: params.new_title } }],
          },
        };
      } else if (params.new_title === undefined && properties) {
        // Append "(Copy)" to the existing title
        const props = properties as Record<string, Record<string, unknown>>;
        const titleKey = Object.keys(props).find((k) => props[k].type === "title") || "title";
        const titleProp = props[titleKey];
        const existingText =
          (titleProp?.title as Array<{ plain_text?: string }> | undefined)
            ?.map((t) => t.plain_text || "")
            .join("") || "Untitled";

        properties = {
          ...props,
          [titleKey]: {
            title: [{ type: "text", text: { content: `${existingText} (Copy)` } }],
          },
        };
      }

      const body: Record<string, unknown> = { parent, properties };

      // Copy icon and cover if present
      if (sourcePage.icon) body.icon = sourcePage.icon;
      if (sourcePage.cover) body.cover = sourcePage.cover;

      // Optionally fetch and include top-level block content
      if (params.include_content !== false) {
        const childrenResult = await logger.time("tool.duplicate_page.get_children", () =>
          client.get<Record<string, unknown>>(`/blocks/${params.page_id}/children?page_size=100`)
        , { tool: "duplicate_page.get_children", page_id: params.page_id });

        const blocks = childrenResult.results as Array<Record<string, unknown>> | undefined;
        if (blocks && blocks.length > 0) {
          // Strip read-only fields from each block
          body.children = blocks.map(stripBlockReadOnlyFields);
        }
      }

      const newPage = await logger.time("tool.duplicate_page.create", () =>
        client.post("/pages", body)
      , { tool: "duplicate_page.create" });

      const result = {
        ...(newPage as Record<string, unknown>),
        source_page_id: params.page_id,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    // ============ Round 2 Handlers ============

    create_page_with_content: async (args) => {
      const params = CreatePageWithContentSchema.parse(args);

      if (!params.parent_database_id && !params.parent_page_id) {
        throw new Error("Either parent_database_id or parent_page_id is required");
      }

      // Step 1: Create the page
      const pageBody: Record<string, unknown> = {};
      if (params.parent_database_id) {
        pageBody.parent = { type: "database_id", database_id: params.parent_database_id };
      } else {
        pageBody.parent = { type: "page_id", page_id: params.parent_page_id };
      }
      if (params.properties) pageBody.properties = params.properties;
      if (params.icon) pageBody.icon = params.icon;
      if (params.cover) pageBody.cover = params.cover;

      const page = await logger.time("tool.create_page_with_content.create", () =>
        client.post<Record<string, unknown>>("/pages", pageBody)
      , { tool: "create_page_with_content" });

      const pageId = page.id as string;

      // Step 2: Append blocks
      let blocksResult: Record<string, unknown> | null = null;
      if (params.blocks && params.blocks.length > 0) {
        blocksResult = await logger.time("tool.create_page_with_content.append", () =>
          client.patch<Record<string, unknown>>(`/blocks/${pageId}/children`, { children: params.blocks })
        , { tool: "create_page_with_content.append", page_id: pageId });
      }

      const result = {
        page,
        blocks_appended: blocksResult,
        page_id: pageId,
        url: page.url,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_full_page_content: async (args) => {
      const params = GetFullPageContentSchema.parse(args);

      // Fetch page metadata
      const page = await logger.time("tool.get_full_page_content.page", () =>
        client.get<Record<string, unknown>>(`/pages/${params.page_id}`)
      , { tool: "get_full_page_content", page_id: params.page_id });

      // Recursively fetch blocks
      let totalBlocks = 0;
      let depthReached = 0;

      const fetchBlocks = async (blockId: string, depth: number): Promise<Record<string, unknown>[]> => {
        if (depth > params.max_depth) return [];
        if (depth > depthReached) depthReached = depth;

        const blocks: Record<string, unknown>[] = [];
        let cursor: string | undefined;

        do {
          const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
          if (cursor) queryParams.set("start_cursor", cursor);

          const response = await logger.time("tool.get_full_page_content.blocks", () =>
            client.get<Record<string, unknown>>(`/blocks/${blockId}/children?${queryParams}`)
          , { tool: "get_full_page_content.blocks", blockId, depth });

          const results = (response.results as Record<string, unknown>[]) || [];
          totalBlocks += results.length;

          for (const block of results) {
            const enriched: Record<string, unknown> = { ...block };
            if (block.has_children && depth < params.max_depth) {
              enriched._children = await fetchBlocks(block.id as string, depth + 1);
            }
            blocks.push(enriched);
          }

          cursor = response.next_cursor as string | undefined;
        } while (cursor);

        return blocks;
      };

      const blocks = await fetchBlocks(params.page_id, 1);

      const result = {
        page,
        blocks,
        total_blocks: totalBlocks,
        depth_reached: depthReached,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    set_page_icon: async (args) => {
      const params = SetPageIconSchema.parse(args);

      let icon: Record<string, unknown>;
      if (params.icon_type === "emoji") {
        if (!params.emoji) throw new Error("emoji is required when icon_type is 'emoji'");
        icon = { type: "emoji", emoji: params.emoji };
      } else {
        if (!params.url) throw new Error("url is required when icon_type is 'external'");
        icon = { type: "external", external: { url: params.url } };
      }

      const result = await logger.time("tool.set_page_icon", () =>
        client.patch(`/pages/${params.page_id}`, { icon })
      , { tool: "set_page_icon", page_id: params.page_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    set_page_cover: async (args) => {
      const params = SetPageCoverSchema.parse(args);

      const cover = { type: "external", external: { url: params.url } };

      const result = await logger.time("tool.set_page_cover", () =>
        client.patch(`/pages/${params.page_id}`, { cover })
      , { tool: "set_page_cover", page_id: params.page_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    move_page_to_database: async (args) => {
      const params = MovePageToDatabaseSchema.parse(args);

      const body: Record<string, unknown> = {
        parent: { type: "database_id", database_id: params.database_id },
      };
      if (params.properties) body.properties = params.properties;

      const result = await logger.time("tool.move_page_to_database", () =>
        client.patch(`/pages/${params.page_id}`, body)
      , { tool: "move_page_to_database", page_id: params.page_id, database_id: params.database_id });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}

// ============ Helpers ============

function stripBlockReadOnlyFields(block: Record<string, unknown>): Record<string, unknown> {
  const readOnlyKeys = ["id", "created_time", "last_edited_time", "created_by", "last_edited_by", "parent", "has_children", "archived", "in_trash"];
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(block)) {
    if (!readOnlyKeys.includes(key)) {
      cleaned[key] = val;
    }
  }
  return cleaned;
}
