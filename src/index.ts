#!/usr/bin/env node
/**
 * Notion MCP Server — Production Quality
 * Implements 72 tools for Notion API v1
 *
 * Tools: health_check,
 *        list_databases, get_database, query_database, create_database, filter_database, sort_database, get_database_schema, update_database,
 *          list_database_pages_with_all_filters, export_database_to_json, get_database_with_schema,
 *        get_page, create_page, update_page, archive_page, update_page_properties, restore_page, get_page_property_item, duplicate_page,
 *          create_page_with_content, get_full_page_content, set_page_icon, set_page_cover, move_page_to_database,
 *        get_block, append_blocks, get_block_children, delete_block, update_block, get_block_children_recursive,
 *          append_code_block, append_callout_block, append_toggle_block, append_table_block,
 *          append_image_block, append_video_block, append_embed_block, append_bookmark_block, append_link_preview_block,
 *          append_divider_block, append_equation_block, append_file_block, append_pdf_block,
 *          append_synced_block, append_template_block, append_breadcrumb_block, append_column_list_block,
 *          get_all_blocks_flat,
 *        search, search_databases_only, search_pages_only, search_by_title,
 *        get_user, list_users,
 *        create_comment, list_comments,
 *        get_page_property, update_database_properties, add_database_property, remove_database_property,
 *        get_relation_pages, update_relation, add_relation_item,
 *        get_rollup_value,
 *        get_workspace_info, list_integrations,
 *        describe_ai_features,
 *        export_page_markdown, export_database_csv
 *
 * Auth: NOTION_API_KEY environment variable (Notion integration token)
 * Transport: stdio (default) or HTTP (MCP_TRANSPORT=http)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NotionClient } from "./client.js";
import { logger } from "./logger.js";
import type { ToolHandler } from "./types.js";

// ============================================
// SERVER SETUP
// ============================================

async function main() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    logger.error("startup.missing_env", { variable: "NOTION_API_KEY" });
    console.error("Error: NOTION_API_KEY environment variable required");
    console.error("Get your integration token from https://www.notion.so/my-integrations");
    process.exit(1);
  }

  const client = new NotionClient(apiKey);

  const server = new McpServer({
    name: "notion-mcp",
    version: "1.0.0",
  });

  // Load all tool groups
  const toolGroups = await Promise.all([
    import("./tools/health.js").then((m) => m.getTools(client)),
    import("./tools/databases.js").then((m) => m.getTools(client)),
    import("./tools/pages.js").then((m) => m.getTools(client)),
    import("./tools/blocks.js").then((m) => m.getTools(client)),
    import("./tools/users.js").then((m) => m.getTools(client)),
    import("./tools/search.js").then((m) => m.getTools(client)),
    import("./tools/comments.js").then((m) => m.getTools(client)),
    import("./tools/properties.js").then((m) => m.getTools(client)),
    import("./tools/relations.js").then((m) => m.getTools(client)),
    import("./tools/rollups.js").then((m) => m.getTools(client)),
    import("./tools/workspace.js").then((m) => m.getTools(client)),
    import("./tools/ai_blocks.js").then((m) => m.getTools(client)),
    import("./tools/exports.js").then((m) => m.getTools(client)),
  ]);

  // Build handler map
  const handlerMap = new Map<string, ToolHandler>();
  for (const group of toolGroups) {
    for (const [name, handler] of Object.entries(group.handlers)) {
      handlerMap.set(name, handler);
    }
  }

  // Register all tools with the MCP server
  for (const group of toolGroups) {
    for (const tool of group.tools) {
      const handler = handlerMap.get(tool.name);
      if (!handler) {
        logger.warn("tool.missing_handler", { tool: tool.name });
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server as any).registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
        },
        async (args: Record<string, unknown>) => {
          const requestId = logger.requestId();
          const start = performance.now();
          logger.info("tool.call", { requestId, tool: tool.name });

          try {
            const result = await handler(args);
            const durationMs = Math.round(performance.now() - start);
            logger.info("tool.done", { requestId, tool: tool.name, durationMs });
            return result;
          } catch (error) {
            const durationMs = Math.round(performance.now() - start);
            let message: string;

            if (error instanceof z.ZodError) {
              message = `Validation error: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`;
              logger.warn("tool.validation_error", { requestId, tool: tool.name, durationMs });
            } else {
              message = error instanceof Error ? error.message : String(error);
              logger.error("tool.error", { requestId, tool: tool.name, durationMs, error: message });
            }

            return {
              content: [{ type: "text" as const, text: `Error: ${message}` }],
              structuredContent: { error: message, tool: tool.name },
              isError: true,
            };
          }
        }
      );
    }
  }

  const totalTools = toolGroups.reduce((sum, g) => sum + g.tools.length, 0);
  logger.info("server.tools_registered", { count: totalTools });

  // === Transport Selection ===
  const transportMode = process.env.MCP_TRANSPORT || "stdio";

  if (transportMode === "http") {
    await startHttpTransport(server);
  } else {
    await startStdioTransport(server);
  }
}

// === Stdio Transport (default) ===
async function startStdioTransport(server: McpServer) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("server.started", { transport: "stdio", name: "notion-mcp" });
}

// === Streamable HTTP Transport ===
async function startHttpTransport(server: McpServer) {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { createServer } = await import("http");
  const { randomUUID } = await import("crypto");

  const port = parseInt(process.env.MCP_HTTP_PORT || "3000", 10);
  const sessions = new Map<string, { transport: InstanceType<typeof StreamableHTTPServerTransport>; lastActivity: number }>();
  const MAX_SESSIONS = 100;
  const SESSION_TTL_MS = 30 * 60 * 1000;

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      if (now - session.lastActivity > SESSION_TTL_MS) {
        logger.info("session.expired", { sessionId: id });
        sessions.delete(id);
      }
    }
  }, 60_000);

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: "notion-mcp", activeSessions: sessions.size }));
      return;
    }

    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        let transport: InstanceType<typeof StreamableHTTPServerTransport>;

        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          session.lastActivity = Date.now();
          transport = session.transport;
        } else {
          if (sessions.size >= MAX_SESSIONS) {
            let oldest: string | null = null;
            let oldestTime = Infinity;
            for (const [id, s] of sessions.entries()) {
              if (s.lastActivity < oldestTime) { oldestTime = s.lastActivity; oldest = id; }
            }
            if (oldest) sessions.delete(oldest);
          }

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          await server.connect(transport);
          const newId = (transport as unknown as { sessionId?: string }).sessionId;
          if (newId) sessions.set(newId, { transport, lastActivity: Date.now() });
        }

        await transport.handleRequest(req, res);
        return;
      }

      if (req.method === "GET" && sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.lastActivity = Date.now();
        await session.transport.handleRequest(req, res);
        return;
      }

      if (req.method === "DELETE" && sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        sessions.delete(sessionId);
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  process.on("SIGTERM", () => {
    clearInterval(cleanupInterval);
    sessions.clear();
  });

  httpServer.listen(port, () => {
    logger.info("server.started", { transport: "http", name: "notion-mcp", port, endpoint: "/mcp" });
    console.error(`Notion MCP HTTP server running on port ${port}`);
  });
}

main().catch((error) => {
  logger.error("server.fatal", { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
