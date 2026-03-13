// Notion AI features tool: describe_ai_features
// Notion's public API does not expose AI generation endpoints as of the Notion API v1.
// This tool documents what is and isn't available and provides context for AI-assisted workflows.
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const DescribeAiFeaturesSchema = z.object({
  check_live: z.boolean().optional().default(false).describe(
    "If true, attempt a live probe of undocumented AI endpoints to see if any respond. " +
    "Results are informational — Notion's AI is not exposed via the public API."
  ),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "describe_ai_features",
      title: "Describe Notion AI Features",
      description:
        "Describes the current state of Notion AI availability in the Notion public API. " +
        "As of the Notion API v1 (2022-06-28 and later), Notion AI features (AI block generation, AI autofill, AI summaries) " +
        "are NOT exposed via the public REST API — they are only accessible through the Notion app UI. " +
        "This tool returns a structured summary of what is possible, what is not, and recommended workarounds " +
        "for AI-assisted Notion workflows. Optionally probes live endpoints.",
      inputSchema: {
        type: "object",
        properties: {
          check_live: {
            type: "boolean",
            description: "If true, probe undocumented endpoints to see if any Notion AI API surface is accessible. Default: false.",
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          api_version: { type: "string" },
          ai_available_in_api: { type: "boolean" },
          ai_features_in_app: { type: "array", items: { type: "string" } },
          api_capabilities: { type: "array", items: { type: "string" } },
          workarounds: { type: "array", items: { type: "object" } },
          live_probe_results: { type: "object" },
          documentation_url: { type: "string" },
        },
        required: ["ai_available_in_api", "api_capabilities", "workarounds"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    describe_ai_features: async (args) => {
      const params = DescribeAiFeaturesSchema.parse(args);

      const staticInfo = {
        api_version: "2022-06-28",
        ai_available_in_api: false,
        summary:
          "Notion AI features are NOT exposed in the Notion public REST API (v1). " +
          "AI block generation, AI autofill, AI summaries, and AI Q&A are only accessible through the Notion web/desktop app UI. " +
          "There are no official public endpoints for triggering AI generation programmatically.",
        ai_features_in_app: [
          "AI-generated text/summaries (via /ai command in editor)",
          "AI autofill for database properties",
          "AI Q&A (ask questions about page/database content)",
          "AI action items extraction",
          "AI translation",
          "AI tone adjustment",
          "AI spell/grammar check",
          "AI key takeaways",
        ],
        api_capabilities: [
          "Create and manage pages, databases, and blocks (all block types)",
          "Full CRUD on any content type",
          "Search across workspace",
          "Read/write all property types",
          "Comments and discussions",
          "User and workspace info",
        ],
        workarounds: [
          {
            name: "Use an LLM (this MCP) to generate content, then write it to Notion via append_blocks",
            description:
              "Have the AI assistant (Claude, GPT-4, etc.) generate the content you want, " +
              "then use append_blocks or create_page_with_content to write it into Notion. " +
              "This achieves AI-augmented Notion workflows without any AI API from Notion itself.",
            tools_to_use: ["create_page_with_content", "append_blocks", "append_callout_block"],
          },
          {
            name: "Use get_full_page_content + LLM for summarization",
            description:
              "Fetch page content with get_full_page_content, pass the text to the AI assistant for summarization/analysis, " +
              "then write results back with append_blocks.",
            tools_to_use: ["get_full_page_content", "get_all_blocks_flat", "append_blocks"],
          },
          {
            name: "Use export_page_markdown + LLM for document Q&A",
            description:
              "Export page content as Markdown with export_page_markdown, feed to an LLM context window for Q&A.",
            tools_to_use: ["export_page_markdown"],
          },
          {
            name: "Notion API webhooks (unofficial/future)",
            description:
              "Monitor for Notion's upcoming official webhook/event API to trigger workflows on page changes.",
            tools_to_use: [],
          },
        ],
        documentation_url: "https://developers.notion.com/reference/intro",
        changelog_url: "https://developers.notion.com/page/changelog",
        notion_ai_info_url: "https://www.notion.so/product/ai",
      };

      let liveProbeResults: Record<string, unknown> = {};

      if (params.check_live) {
        // Probe a few undocumented paths that might expose AI functionality
        const probes = [
          "/ai/summary",
          "/ai/generate",
          "/ai/autofill",
        ];

        for (const probe of probes) {
          try {
            await logger.time("tool.describe_ai_features.probe", () =>
              client.get(probe)
            , { tool: "describe_ai_features", probe });
            liveProbeResults[probe] = { status: "responded", note: "Unexpected — endpoint may exist" };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            liveProbeResults[probe] = {
              status: "error",
              message: msg,
              note: msg.includes("404") ? "Not found (as expected)" : "Other error",
            };
          }
        }
      }

      const result = {
        ...staticInfo,
        ...(params.check_live ? { live_probe_results: liveProbeResults } : {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
