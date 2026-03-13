// Notion Permissions tools: get_page_permissions, check_page_access,
//   list_shared_users, get_workspace_members, verify_integration_access,
//   get_user_pages
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const GetPagePermissionsSchema = z.object({
  page_id: z.string().describe("Page ID to get permission info about"),
});

const CheckPageAccessSchema = z.object({
  page_id: z.string().describe("Page ID to check access for"),
});

const GetUserPagesSchema = z.object({
  user_id: z.string().describe("User ID to find pages for"),
  max_pages: z.number().min(1).max(500).optional().default(50).describe("Maximum pages to return (default 50)"),
});

const GetWorkspaceMembersSchema = z.object({
  start_cursor: z.string().optional(),
  page_size: z.number().min(1).max(100).optional().default(25),
});

const VerifyIntegrationAccessSchema = z.object({
  page_or_database_id: z.string().describe("Page or database ID to verify access for"),
  object_type: z.enum(["page", "database"]).describe("Type of Notion object"),
});

const GetCreatedByInfoSchema = z.object({
  page_id: z.string().describe("Page ID to get creator info from"),
});

const GetEditedByInfoSchema = z.object({
  page_id: z.string().describe("Page ID to get last editor info from"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "get_page_permissions",
      title: "Get Page Permissions",
      description:
        "Get metadata about a Notion page's access and sharing status. Returns the page's parent, archive status, created/edited by user info, and whether the integration has access. Note: the Notion API does not expose full ACL/sharing lists — this returns what's accessible.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to inspect" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          parent: { type: "object" },
          created_by: { type: "object" },
          last_edited_by: { type: "object" },
          archived: { type: "boolean" },
          url: { type: "string" },
        },
        required: ["page_id"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "check_page_access",
      title: "Check Page Access",
      description:
        "Check whether the integration has access to a specific Notion page or database. Returns true if accessible, false with an error reason if not. Useful to validate IDs before operations.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to check access for" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          accessible: { type: "boolean" },
          page_type: { type: "string" },
          error: { type: "string" },
        },
        required: ["page_id", "accessible"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_workspace_members",
      title: "Get Workspace Members",
      description:
        "List all users (members) in the Notion workspace accessible to the integration. Returns user IDs, names, emails, and avatar URLs. Useful for finding user IDs for people/assigned-to properties.",
      inputSchema: {
        type: "object",
        properties: {
          start_cursor: { type: "string", description: "Pagination cursor" },
          page_size: { type: "number", description: "Results per page (1-100, default 25)" },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          next_cursor: { type: "string" },
          has_more: { type: "boolean" },
          member_count: { type: "number" },
        },
        required: ["results", "has_more"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "verify_integration_access",
      title: "Verify Integration Access",
      description:
        "Verify that the integration has access to a specific page or database, and return its metadata. If the integration doesn't have access, returns an error with diagnosis. Use to troubleshoot 'object not found' errors.",
      inputSchema: {
        type: "object",
        properties: {
          page_or_database_id: { type: "string", description: "Page or database ID to verify" },
          object_type: { type: "string", enum: ["page", "database"], description: "Type: 'page' or 'database'" },
        },
        required: ["page_or_database_id", "object_type"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          accessible: { type: "boolean" },
          object_type: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          error: { type: "string" },
          diagnosis: { type: "string" },
        },
        required: ["id", "accessible"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_created_by_info",
      title: "Get Created By Info",
      description:
        "Get information about who created a Notion page — their user ID, name, avatar URL, and email. Useful for auditing and attribution.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to get creator info from" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          created_by: { type: "object" },
          created_time: { type: "string" },
        },
        required: ["page_id", "created_by"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_last_edited_by_info",
      title: "Get Last Edited By Info",
      description:
        "Get information about who last edited a Notion page — their user ID, name, avatar URL, and email — plus the timestamp of the last edit. Useful for collaboration tracking.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to get last editor info from" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          last_edited_by: { type: "object" },
          last_edited_time: { type: "string" },
        },
        required: ["page_id", "last_edited_by"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_user_pages",
      title: "Get Pages by User",
      description:
        "Find pages created by or assigned to a specific user. Searches accessible pages and filters by the created_by field. Useful for finding a user's work or assigned items.",
      inputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "User ID to find pages for" },
          max_pages: { type: "number", description: "Max pages to return (1-500, default 50)" },
        },
        required: ["user_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          pages: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["user_id", "pages", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    get_page_permissions: async (args) => {
      const { page_id } = GetPagePermissionsSchema.parse(args);
      const page = await logger.time("tool.get_page_permissions", () =>
        client.get<Record<string, unknown>>(`/pages/${page_id}`)
      , { tool: "get_page_permissions", page_id });

      const structured = {
        page_id,
        parent: page.parent,
        created_by: page.created_by,
        last_edited_by: page.last_edited_by,
        created_time: page.created_time,
        last_edited_time: page.last_edited_time,
        archived: page.archived,
        url: page.url,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    check_page_access: async (args) => {
      const { page_id } = CheckPageAccessSchema.parse(args);
      try {
        const page = await logger.time("tool.check_page_access", () =>
          client.get<Record<string, unknown>>(`/pages/${page_id}`)
        , { tool: "check_page_access", page_id });

        const structured = {
          page_id,
          accessible: true,
          page_type: page.object as string,
          url: page.url,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        };
      } catch (err) {
        const structured = {
          page_id,
          accessible: false,
          error: err instanceof Error ? err.message : String(err),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        };
      }
    },

    get_workspace_members: async (args) => {
      const params = GetWorkspaceMembersSchema.parse(args);
      const qs = new URLSearchParams({ page_size: String(params.page_size) });
      if (params.start_cursor) qs.set("start_cursor", params.start_cursor);

      const result = await logger.time("tool.get_workspace_members", () =>
        client.get<Record<string, unknown>>(`/users?${qs}`)
      , { tool: "get_workspace_members" });

      const results = (result.results as unknown[]) || [];
      const structured = {
        ...result,
        member_count: results.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    verify_integration_access: async (args) => {
      const params = VerifyIntegrationAccessSchema.parse(args);
      const endpoint = params.object_type === "database"
        ? `/databases/${params.page_or_database_id}`
        : `/pages/${params.page_or_database_id}`;

      try {
        const obj = await logger.time("tool.verify_integration_access", () =>
          client.get<Record<string, unknown>>(endpoint)
        , { tool: "verify_integration_access", id: params.page_or_database_id });

        let title = "";
        if (params.object_type === "database") {
          const titleArr = obj.title as Array<{ plain_text?: string }> | undefined;
          title = titleArr?.map((t) => t.plain_text || "").join("") || "";
        } else {
          const props = obj.properties as Record<string, Record<string, unknown>> | undefined;
          const titleProp = Object.values(props || {}).find((p) => p.type === "title");
          const titleArr = titleProp?.title as Array<{ plain_text?: string }> | undefined;
          title = titleArr?.map((t) => t.plain_text || "").join("") || "";
        }

        const structured = {
          id: params.page_or_database_id,
          accessible: true,
          object_type: params.object_type,
          title,
          url: obj.url,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const diagnosis = msg.includes("Could not find") || msg.includes("not found")
          ? "The object doesn't exist or hasn't been shared with this integration. Ensure the page/database is shared with your integration in Notion."
          : msg.includes("unauthorized") || msg.includes("Unauthorized")
          ? "The integration token is invalid or has expired."
          : "Unknown access error — check the ID and integration permissions.";

        const structured = {
          id: params.page_or_database_id,
          accessible: false,
          object_type: params.object_type,
          error: msg,
          diagnosis,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        };
      }
    },

    get_created_by_info: async (args) => {
      const { page_id } = GetCreatedByInfoSchema.parse(args);
      const page = await logger.time("tool.get_created_by_info", () =>
        client.get<Record<string, unknown>>(`/pages/${page_id}`)
      , { tool: "get_created_by_info", page_id });

      const createdBy = page.created_by as Record<string, unknown> | undefined;
      if (createdBy?.id) {
        try {
          const user = await logger.time("tool.get_created_by_info.user", () =>
            client.get<Record<string, unknown>>(`/users/${createdBy.id}`)
          , { tool: "get_created_by_info.user" });
          const structured = { page_id, created_by: user, created_time: page.created_time };
          return {
            content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
            structuredContent: structured,
          };
        } catch { /* fall through */ }
      }

      const structured = { page_id, created_by: createdBy, created_time: page.created_time };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_last_edited_by_info: async (args) => {
      const { page_id } = GetEditedByInfoSchema.parse(args);
      const page = await logger.time("tool.get_last_edited_by_info", () =>
        client.get<Record<string, unknown>>(`/pages/${page_id}`)
      , { tool: "get_last_edited_by_info", page_id });

      const lastEditedBy = page.last_edited_by as Record<string, unknown> | undefined;
      if (lastEditedBy?.id) {
        try {
          const user = await logger.time("tool.get_last_edited_by_info.user", () =>
            client.get<Record<string, unknown>>(`/users/${lastEditedBy.id}`)
          , { tool: "get_last_edited_by_info.user" });
          const structured = { page_id, last_edited_by: user, last_edited_time: page.last_edited_time };
          return {
            content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
            structuredContent: structured,
          };
        } catch { /* fall through */ }
      }

      const structured = { page_id, last_edited_by: lastEditedBy, last_edited_time: page.last_edited_time };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_user_pages: async (args) => {
      const params = GetUserPagesSchema.parse(args);
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const body: Record<string, unknown> = {
          filter: { value: "page", property: "object" },
          page_size: 100,
        };
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.get_user_pages.search", () =>
          client.post<Record<string, unknown>>("/search", body)
        , { tool: "get_user_pages" });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const page of results) {
          if (allPages.length >= params.max_pages) break;
          const createdBy = page.created_by as { id?: string } | undefined;
          if (createdBy?.id === params.user_id) {
            allPages.push(page);
          }
        }

        cursor = allPages.length >= params.max_pages ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      const structured = { user_id: params.user_id, pages: allPages, count: allPages.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
