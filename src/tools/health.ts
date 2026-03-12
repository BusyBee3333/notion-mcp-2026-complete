// Health check tool — validates env vars, API connectivity, and auth
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "health_check",
      title: "Health Check",
      description:
        "Validate server health: checks NOTION_API_KEY env var is set, Notion API is reachable, and auth token is valid. Returns integration bot user info on success. Use when diagnosing connection issues or verifying setup.",
      inputSchema: { type: "object", properties: {} },
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
          checks: {
            type: "object",
            properties: {
              envVars: { type: "object" },
              apiReachable: { type: "boolean" },
              authValid: { type: "boolean" },
              latencyMs: { type: "number" },
            },
          },
          integrationInfo: { type: "object" },
          error: { type: "string" },
        },
        required: ["status", "checks"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  const handlers: Record<string, ToolHandler> = {
    health_check: async () => {
      const checks: Record<string, unknown> = {};

      const requiredEnvVars = ["NOTION_API_KEY"];
      const missing = requiredEnvVars.filter((v) => !process.env[v]);
      checks.envVars = { ok: missing.length === 0, missing };

      const healthResult = await client.healthCheck();
      checks.apiReachable = healthResult.reachable;
      checks.authValid = healthResult.authenticated;
      checks.latencyMs = healthResult.latencyMs;

      let status: "healthy" | "degraded" | "unhealthy";
      if (missing.length > 0 || !healthResult.reachable) {
        status = "unhealthy";
      } else if (!healthResult.authenticated) {
        status = "degraded";
      } else {
        status = "healthy";
      }

      const result = {
        status,
        checks,
        ...(healthResult.integrationInfo ? { integrationInfo: healthResult.integrationInfo } : {}),
        ...(healthResult.error ? { error: healthResult.error } : {}),
      };

      logger.info("health_check", { status });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
