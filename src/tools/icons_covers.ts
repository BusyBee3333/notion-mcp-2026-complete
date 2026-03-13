// Notion Icons & Covers tools: set_page_emoji_icon, set_page_external_icon,
//   remove_page_icon, set_page_external_cover, remove_page_cover,
//   set_database_emoji_icon, set_database_external_icon, set_database_cover,
//   copy_icon_and_cover, get_page_icon_cover
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const SetPageEmojiIconSchema = z.object({
  page_id: z.string().describe("Page ID to set the emoji icon on"),
  emoji: z.string().describe("Emoji character to use as icon. E.g. '📌', '✅', '🚀', '📝', '💡', '⚡'"),
});

const SetPageExternalIconSchema = z.object({
  page_id: z.string().describe("Page ID to set the external image icon on"),
  url: z.string().url().describe("Publicly accessible image URL to use as icon. Recommended size: 280×280px minimum."),
});

const RemovePageIconSchema = z.object({
  page_id: z.string().describe("Page ID to remove the icon from"),
});

const SetPageExternalCoverSchema = z.object({
  page_id: z.string().describe("Page ID to set the cover image on"),
  url: z.string().url().describe("Publicly accessible image URL to use as cover. Recommended ratio: 16:9 or wider. E.g. 'https://images.unsplash.com/...'"),
});

const RemovePageCoverSchema = z.object({
  page_id: z.string().describe("Page ID to remove the cover image from"),
});

const SetDatabaseEmojiIconSchema = z.object({
  database_id: z.string().describe("Database ID to set the emoji icon on"),
  emoji: z.string().describe("Emoji character to use as icon. E.g. '📊', '📋', '🗂️', '📂'"),
});

const SetDatabaseExternalIconSchema = z.object({
  database_id: z.string().describe("Database ID to set the external image icon on"),
  url: z.string().url().describe("Publicly accessible image URL to use as icon"),
});

const SetDatabaseCoverSchema = z.object({
  database_id: z.string().describe("Database ID to set the cover image on"),
  url: z.string().url().describe("Publicly accessible image URL to use as cover"),
});

const CopyIconAndCoverSchema = z.object({
  source_page_id: z.string().describe("Page ID to copy icon and cover FROM"),
  target_page_id: z.string().describe("Page ID to copy icon and cover TO"),
  copy_icon: z.boolean().optional().default(true).describe("Whether to copy the icon (default: true)"),
  copy_cover: z.boolean().optional().default(true).describe("Whether to copy the cover (default: true)"),
});

const GetPageIconCoverSchema = z.object({
  page_id: z.string().describe("Page ID to retrieve icon and cover info from"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "set_page_emoji_icon",
      title: "Set Page Emoji Icon",
      description:
        "Set an emoji as the icon for a Notion page. The emoji appears in the page header and in parent page/sidebar navigation. Simple alternative to set_page_icon from the pages module — no need to construct the icon object manually.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to set icon on" },
          emoji: { type: "string", description: "Emoji character. E.g. '📌', '✅', '🚀', '📝', '💡'" },
        },
        required: ["page_id", "emoji"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          icon: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_page_external_icon",
      title: "Set Page External Icon",
      description:
        "Set an external image URL as the icon for a Notion page. Use a publicly accessible image (PNG, JPEG, GIF, WebP). Notion displays it as a small icon in the page header.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to set icon on" },
          url: { type: "string", description: "Publicly accessible image URL for the icon" },
        },
        required: ["page_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          icon: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "remove_page_icon",
      title: "Remove Page Icon",
      description:
        "Remove the icon (emoji or image) from a Notion page. The page will have no icon after this operation.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to remove icon from" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          icon: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_page_external_cover",
      title: "Set Page External Cover",
      description:
        "Set an external image URL as the cover image for a Notion page. Wide/landscape images work best (16:9 ratio or wider). Notion crops and positions the image automatically. Unsplash URLs work well.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to set cover on" },
          url: { type: "string", description: "Publicly accessible image URL for the cover" },
        },
        required: ["page_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          cover: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "remove_page_cover",
      title: "Remove Page Cover",
      description:
        "Remove the cover image from a Notion page. The page header will have no cover image after this operation.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to remove cover from" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          cover: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_database_emoji_icon",
      title: "Set Database Emoji Icon",
      description:
        "Set an emoji as the icon for a Notion database. The emoji appears in the database header, sidebar, and when the database is referenced.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to set icon on" },
          emoji: { type: "string", description: "Emoji character. E.g. '📊', '📋', '🗂️', '🏗️'" },
        },
        required: ["database_id", "emoji"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          icon: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_database_external_icon",
      title: "Set Database External Icon",
      description:
        "Set an external image URL as the icon for a Notion database. Use a publicly accessible image URL.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to set icon on" },
          url: { type: "string", description: "Publicly accessible image URL for the icon" },
        },
        required: ["database_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          icon: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_database_cover",
      title: "Set Database Cover",
      description:
        "Set an external image URL as the cover image for a Notion database. The cover appears at the top of the database page.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to set cover on" },
          url: { type: "string", description: "Publicly accessible image URL for the cover" },
        },
        required: ["database_id", "url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          cover: { type: "object" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "copy_icon_and_cover",
      title: "Copy Icon and Cover",
      description:
        "Copy the icon and/or cover image from one Notion page to another. Useful for creating consistent visual styles across related pages, or when duplicating a page's appearance.",
      inputSchema: {
        type: "object",
        properties: {
          source_page_id: { type: "string", description: "Page ID to copy icon/cover FROM" },
          target_page_id: { type: "string", description: "Page ID to copy icon/cover TO" },
          copy_icon: { type: "boolean", description: "Copy the icon (default: true)" },
          copy_cover: { type: "boolean", description: "Copy the cover (default: true)" },
        },
        required: ["source_page_id", "target_page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          source_page_id: { type: "string" },
          target_page_id: { type: "string" },
          icon_copied: { type: "boolean" },
          cover_copied: { type: "boolean" },
          result: { type: "object" },
        },
        required: ["source_page_id", "target_page_id", "icon_copied", "cover_copied"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_page_icon_cover",
      title: "Get Page Icon and Cover",
      description:
        "Retrieve the current icon and cover image configuration of a Notion page. Returns icon type (emoji or external), icon value, cover type, and cover URL. Useful before copying or modifying visual appearance.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to get icon and cover from" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          icon: { type: "object" },
          cover: { type: "object" },
          icon_type: { type: "string" },
          icon_value: { type: "string" },
          cover_url: { type: "string" },
        },
        required: ["page_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    set_page_emoji_icon: async (args) => {
      const { page_id, emoji } = SetPageEmojiIconSchema.parse(args);
      const result = await logger.time("tool.set_page_emoji_icon", () =>
        client.patch(`/pages/${page_id}`, { icon: { type: "emoji", emoji } })
      , { tool: "set_page_emoji_icon", page_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    set_page_external_icon: async (args) => {
      const { page_id, url } = SetPageExternalIconSchema.parse(args);
      const result = await logger.time("tool.set_page_external_icon", () =>
        client.patch(`/pages/${page_id}`, { icon: { type: "external", external: { url } } })
      , { tool: "set_page_external_icon", page_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    remove_page_icon: async (args) => {
      const { page_id } = RemovePageIconSchema.parse(args);
      const result = await logger.time("tool.remove_page_icon", () =>
        client.patch(`/pages/${page_id}`, { icon: null })
      , { tool: "remove_page_icon", page_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    set_page_external_cover: async (args) => {
      const { page_id, url } = SetPageExternalCoverSchema.parse(args);
      const result = await logger.time("tool.set_page_external_cover", () =>
        client.patch(`/pages/${page_id}`, { cover: { type: "external", external: { url } } })
      , { tool: "set_page_external_cover", page_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    remove_page_cover: async (args) => {
      const { page_id } = RemovePageCoverSchema.parse(args);
      const result = await logger.time("tool.remove_page_cover", () =>
        client.patch(`/pages/${page_id}`, { cover: null })
      , { tool: "remove_page_cover", page_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    set_database_emoji_icon: async (args) => {
      const { database_id, emoji } = SetDatabaseEmojiIconSchema.parse(args);
      const result = await logger.time("tool.set_database_emoji_icon", () =>
        client.patch(`/databases/${database_id}`, { icon: { type: "emoji", emoji } })
      , { tool: "set_database_emoji_icon", database_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    set_database_external_icon: async (args) => {
      const { database_id, url } = SetDatabaseExternalIconSchema.parse(args);
      const result = await logger.time("tool.set_database_external_icon", () =>
        client.patch(`/databases/${database_id}`, { icon: { type: "external", external: { url } } })
      , { tool: "set_database_external_icon", database_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    set_database_cover: async (args) => {
      const { database_id, url } = SetDatabaseCoverSchema.parse(args);
      const result = await logger.time("tool.set_database_cover", () =>
        client.patch(`/databases/${database_id}`, { cover: { type: "external", external: { url } } })
      , { tool: "set_database_cover", database_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    copy_icon_and_cover: async (args) => {
      const params = CopyIconAndCoverSchema.parse(args);
      const source = await logger.time("tool.copy_icon_and_cover.get_source", () =>
        client.get<Record<string, unknown>>(`/pages/${params.source_page_id}`)
      , { tool: "copy_icon_and_cover", source_page_id: params.source_page_id });

      const update: Record<string, unknown> = {};
      let iconCopied = false;
      let coverCopied = false;

      if (params.copy_icon && source.icon) {
        update.icon = source.icon;
        iconCopied = true;
      }
      if (params.copy_cover && source.cover) {
        update.cover = source.cover;
        coverCopied = true;
      }

      let result: Record<string, unknown> = {};
      if (Object.keys(update).length > 0) {
        result = await logger.time("tool.copy_icon_and_cover.apply", () =>
          client.patch<Record<string, unknown>>(`/pages/${params.target_page_id}`, update)
        , { tool: "copy_icon_and_cover", target_page_id: params.target_page_id });
      }

      const structured = {
        source_page_id: params.source_page_id,
        target_page_id: params.target_page_id,
        icon_copied: iconCopied,
        cover_copied: coverCopied,
        result,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_page_icon_cover: async (args) => {
      const { page_id } = GetPageIconCoverSchema.parse(args);
      const page = await logger.time("tool.get_page_icon_cover", () =>
        client.get<Record<string, unknown>>(`/pages/${page_id}`)
      , { tool: "get_page_icon_cover", page_id });

      const icon = page.icon as Record<string, unknown> | null | undefined;
      const cover = page.cover as Record<string, unknown> | null | undefined;

      let iconType: string | undefined;
      let iconValue: string | undefined;
      if (icon) {
        iconType = icon.type as string;
        if (iconType === "emoji") {
          iconValue = icon.emoji as string;
        } else if (iconType === "external") {
          const ext = icon.external as Record<string, string> | undefined;
          iconValue = ext?.url;
        } else if (iconType === "file") {
          const f = icon.file as Record<string, string> | undefined;
          iconValue = f?.url;
        }
      }

      let coverUrl: string | undefined;
      if (cover) {
        const coverType = cover.type as string;
        if (coverType === "external") {
          const ext = cover.external as Record<string, string> | undefined;
          coverUrl = ext?.url;
        } else if (coverType === "file") {
          const f = cover.file as Record<string, string> | undefined;
          coverUrl = f?.url;
        }
      }

      const structured = {
        page_id: page.id,
        icon,
        cover,
        icon_type: iconType,
        icon_value: iconValue,
        cover_url: coverUrl,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
