// Notion Workspace tools: get_workspace_info, list_integrations
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetWorkspaceInfoSchema = z.object({});

const ListIntegrationsSchema = z.object({
  page_size: z.number().min(1).max(100).optional().default(50).describe("Max results to fetch for accessible content summary (1-100, default 50)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_workspace_info",
      description:
        "Get information about the Notion workspace and the current integration (bot user). Returns the workspace name, workspace ID, bot user ID, integration name, and owner details. Useful for verifying which workspace you are connected to and confirming the integration identity.",
      title: "Get Workspace Info",
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          workspace_name: { type: "string" },
          workspace_id: { type: "string" },
          bot_id: { type: "string" },
          bot_name: { type: "string" },
          owner: { type: "object" },
          raw: { type: "object" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_integrations",
      description:
        "List a summary of all content (pages and databases) accessible to this Notion integration. Returns counts and a sample of accessible pages and databases to help understand the scope of what this integration can read/write. Useful for auditing access and discovering what's available.",
      title: "List Integrations",
      inputSchema: {
        type: "object",
        properties: {
          page_size: { type: "number", description: "Max results per type to fetch for the summary (1-100, default 50)" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          workspace_name: { type: "string" },
          bot_name: { type: "string" },
          accessible_pages_count: { type: "number" },
          accessible_databases_count: { type: "number" },
          sample_pages: { type: "array", items: { type: "object" } },
          sample_databases: { type: "array", items: { type: "object" } },
          has_more_pages: { type: "boolean" },
          has_more_databases: { type: "boolean" },
        },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_workspace_info: async (args) => {
      GetWorkspaceInfoSchema.parse(args);
      const result = await logger.time("tool.get_workspace_info", () =>
        client.get<Record<string, unknown>>("/users/me")
      , { tool: "get_workspace_info" });

      const structured = {
        workspace_name: (result.bot as Record<string, unknown> | undefined)?.workspace_name ?? null,
        workspace_id: (result.bot as Record<string, unknown> | undefined)?.workspace_id ?? null,
        bot_id: result.id,
        bot_name: (result.name as string) ?? null,
        owner: (result.bot as Record<string, unknown> | undefined)?.owner ?? null,
        raw: result,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    list_integrations: async (args) => {
      const { page_size } = ListIntegrationsSchema.parse(args);

      // Fetch bot info
      const botUser = await logger.time("tool.list_integrations.bot", () =>
        client.get<Record<string, unknown>>("/users/me")
      , { tool: "list_integrations.bot" });

      // Search all pages
      const pagesResult = await logger.time("tool.list_integrations.pages", () =>
        client.post<Record<string, unknown>>("/search", {
          filter: { value: "page", property: "object" },
          page_size,
          sort: { direction: "descending", timestamp: "last_edited_time" },
        })
      , { tool: "list_integrations.pages" });

      // Search all databases
      const dbResult = await logger.time("tool.list_integrations.databases", () =>
        client.post<Record<string, unknown>>("/search", {
          filter: { value: "database", property: "object" },
          page_size,
          sort: { direction: "descending", timestamp: "last_edited_time" },
        })
      , { tool: "list_integrations.databases" });

      const pages = (pagesResult.results as Array<Record<string, unknown>>) || [];
      const databases = (dbResult.results as Array<Record<string, unknown>>) || [];

      const samplePages = pages.slice(0, 10).map((p) => ({
        id: p.id,
        title: extractTitle(p),
        url: p.url,
        last_edited_time: p.last_edited_time,
      }));

      const sampleDatabases = databases.slice(0, 10).map((d) => ({
        id: d.id,
        title: extractTitle(d),
        url: d.url,
        last_edited_time: d.last_edited_time,
      }));

      const structured = {
        workspace_name: (botUser.bot as Record<string, unknown> | undefined)?.workspace_name ?? null,
        bot_name: botUser.name as string,
        accessible_pages_count: pages.length,
        accessible_databases_count: databases.length,
        sample_pages: samplePages,
        sample_databases: sampleDatabases,
        has_more_pages: pagesResult.has_more as boolean,
        has_more_databases: dbResult.has_more as boolean,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}

// ============ Helpers ============

function extractTitle(obj: Record<string, unknown>): string {
  try {
    if (obj.object === "database") {
      const titleArr = obj.title as Array<{ plain_text?: string }>;
      return titleArr?.map((t) => t.plain_text || "").join("") || "(Untitled)";
    }
    const props = obj.properties as Record<string, Record<string, unknown>> | undefined;
    if (props) {
      for (const key of ["title", "Name", "Title"]) {
        const p = props[key];
        if (p?.type === "title") {
          const rt = p.title as Array<{ plain_text?: string }>;
          return rt?.map((t) => t.plain_text || "").join("") || "(Untitled)";
        }
      }
    }
  } catch {}
  return "(Untitled)";
}
