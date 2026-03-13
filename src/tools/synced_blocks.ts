// Notion Synced Block tools: create_original_synced_block,
//   create_synced_block_reference, get_synced_block_info,
//   update_synced_block_content, list_page_synced_blocks,
//   append_to_synced_block, convert_block_to_synced
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

const blockSchema: z.ZodType<Record<string, unknown>> = z.record(z.unknown());

// ============ Schemas ============

const CreateOriginalSyncedBlockSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the original synced block to"),
  children: z.array(blockSchema).optional().describe("Child blocks to place inside the original synced block"),
  after: z.string().optional().describe("Block ID to insert after (default: end)"),
});

const CreateSyncedBlockReferenceSchema = z.object({
  block_id: z.string().describe("Parent page or block ID to append the synced reference to"),
  synced_from_block_id: z.string().describe("Block ID of the ORIGINAL synced block to reference/mirror"),
  after: z.string().optional().describe("Block ID to insert after (default: end)"),
});

const GetSyncedBlockInfoSchema = z.object({
  block_id: z.string().describe("Block ID to inspect — should be a synced_block type"),
});

const AppendToSyncedBlockSchema = z.object({
  synced_block_id: z.string().describe("Block ID of an ORIGINAL synced block to append content to"),
  children: z.array(blockSchema).min(1).describe("Child blocks to add inside the synced block"),
});

const ListPageSyncedBlocksSchema = z.object({
  page_id: z.string().describe("Page ID to scan for synced blocks"),
});

const UpdateSyncedBlockChildSchema = z.object({
  child_block_id: z.string().describe("Block ID of a child block INSIDE the original synced block to update"),
  block_type: z.string().describe("Block type of the child (e.g. 'paragraph', 'heading_1')"),
  content: z.record(z.unknown()).describe("New content for the child block"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "create_original_synced_block",
      title: "Create Original Synced Block",
      description:
        "Create a new ORIGINAL synced block on a Notion page, optionally with initial child content. Other pages can reference this block to create synced copies. When the original changes, all references update automatically.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to append to" },
          children: { type: "array", items: { type: "object" }, description: "Initial child blocks inside the synced block" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          synced_block_id: { type: "string" },
          type: { type: "string" },
          results: { type: "array", items: { type: "object" } },
        },
        required: ["synced_block_id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "create_synced_block_reference",
      title: "Create Synced Block Reference",
      description:
        "Create a REFERENCE (copy) of an existing original synced block on another page. The reference mirrors the original content and updates automatically when the original changes.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Parent page or block ID to insert the reference into" },
          synced_from_block_id: { type: "string", description: "Block ID of the original synced block to reference" },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["block_id", "synced_from_block_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          synced_from: { type: "string" },
        },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "get_synced_block_info",
      title: "Get Synced Block Info",
      description:
        "Get information about a synced block — whether it's an original or a reference, and if it's a reference, which block it syncs from. Also returns the block's child content.",
      inputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string", description: "Synced block ID to inspect" },
        },
        required: ["block_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          block_id: { type: "string" },
          is_original: { type: "boolean" },
          synced_from_block_id: { type: "string" },
          children: { type: "array", items: { type: "object" } },
        },
        required: ["block_id", "is_original"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "append_to_synced_block",
      title: "Append to Synced Block",
      description:
        "Append child blocks to the ORIGINAL synced block. Since synced blocks mirror content, this change propagates to all references of this block. Only works on original synced blocks, not references.",
      inputSchema: {
        type: "object",
        properties: {
          synced_block_id: { type: "string", description: "Block ID of the original synced block" },
          children: { type: "array", items: { type: "object" }, description: "Blocks to add inside the synced block" },
        },
        required: ["synced_block_id", "children"],
      },
      outputSchema: {
        type: "object",
        properties: { results: { type: "array", items: { type: "object" } } },
        required: ["results"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "list_page_synced_blocks",
      title: "List Page Synced Blocks",
      description:
        "Find all synced blocks on a Notion page. Returns a list of synced blocks with their block IDs, whether each is an original or reference, and what they sync from.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to scan for synced blocks" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          synced_blocks: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["page_id", "synced_blocks", "count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_synced_block_child",
      title: "Update Synced Block Child",
      description:
        "Update a child block inside an original synced block. Changes propagate to all references. Provide the child block's ID (not the synced block's ID), the block type, and the new content.",
      inputSchema: {
        type: "object",
        properties: {
          child_block_id: { type: "string", description: "Block ID of the child block inside the synced block" },
          block_type: { type: "string", description: "Block type (must match existing type, e.g. 'paragraph')" },
          content: { type: "object", description: "New content for the block type" },
        },
        required: ["child_block_id", "block_type", "content"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          last_edited_time: { type: "string" },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    create_original_synced_block: async (args) => {
      const params = CreateOriginalSyncedBlockSchema.parse(args);
      const syncedBlock: Record<string, unknown> = {
        object: "block",
        type: "synced_block",
        synced_block: {
          synced_from: null,
          ...(params.children && params.children.length > 0 ? { children: params.children } : {}),
        },
      };
      const body: Record<string, unknown> = { children: [syncedBlock] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.create_original_synced_block", () =>
        client.patch<Record<string, unknown>>(`/blocks/${params.block_id}/children`, body)
      , { tool: "create_original_synced_block", block_id: params.block_id });

      const results = (result.results as Record<string, unknown>[]) || [];
      const createdBlock = results[0] as Record<string, unknown> | undefined;
      const structured = {
        synced_block_id: createdBlock?.id,
        type: createdBlock?.type,
        results,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    create_synced_block_reference: async (args) => {
      const params = CreateSyncedBlockReferenceSchema.parse(args);
      const refBlock = {
        object: "block",
        type: "synced_block",
        synced_block: {
          synced_from: { type: "block_id", block_id: params.synced_from_block_id },
        },
      };
      const body: Record<string, unknown> = { children: [refBlock] };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.create_synced_block_reference", () =>
        client.patch(`/blocks/${params.block_id}/children`, body)
      , { tool: "create_synced_block_reference", block_id: params.block_id });

      const structured = { ...(result as Record<string, unknown>), synced_from: params.synced_from_block_id };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_synced_block_info: async (args) => {
      const { block_id } = GetSyncedBlockInfoSchema.parse(args);
      const block = await logger.time("tool.get_synced_block_info.block", () =>
        client.get<Record<string, unknown>>(`/blocks/${block_id}`)
      , { tool: "get_synced_block_info", block_id });

      const sb = block.synced_block as { synced_from?: { block_id?: string } | null } | undefined;
      const isOriginal = !sb?.synced_from;
      const syncedFromId = sb?.synced_from?.block_id;

      // Fetch children
      const childResponse = await logger.time("tool.get_synced_block_info.children", () =>
        client.get<Record<string, unknown>>(`/blocks/${block_id}/children?page_size=50`)
      , { tool: "get_synced_block_info.children", block_id });

      const structured = {
        block_id,
        is_original: isOriginal,
        synced_from_block_id: syncedFromId,
        children: childResponse.results,
        block,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    append_to_synced_block: async (args) => {
      const params = AppendToSyncedBlockSchema.parse(args);
      const result = await logger.time("tool.append_to_synced_block", () =>
        client.patch(`/blocks/${params.synced_block_id}/children`, { children: params.children })
      , { tool: "append_to_synced_block", synced_block_id: params.synced_block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    list_page_synced_blocks: async (args) => {
      const { page_id } = ListPageSyncedBlocksSchema.parse(args);
      const syncedBlocks: Record<string, unknown>[] = [];
      let cursor: string | undefined;

      do {
        const qs = new URLSearchParams({ page_size: "100" });
        if (cursor) qs.set("start_cursor", cursor);
        const response = await logger.time("tool.list_page_synced_blocks.fetch", () =>
          client.get<Record<string, unknown>>(`/blocks/${page_id}/children?${qs}`)
        , { tool: "list_page_synced_blocks", page_id });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const block of results) {
          if (block.type === "synced_block") {
            const sb = block.synced_block as { synced_from?: { block_id?: string } | null } | undefined;
            syncedBlocks.push({
              block_id: block.id,
              is_original: !sb?.synced_from,
              synced_from_block_id: sb?.synced_from?.block_id,
            });
          }
        }
        cursor = response.next_cursor as string | undefined;
      } while (cursor);

      const structured = { page_id, synced_blocks: syncedBlocks, count: syncedBlocks.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    update_synced_block_child: async (args) => {
      const params = UpdateSyncedBlockChildSchema.parse(args);
      const result = await logger.time("tool.update_synced_block_child", () =>
        client.patch(`/blocks/${params.child_block_id}`, { [params.block_type]: params.content })
      , { tool: "update_synced_block_child", child_block_id: params.child_block_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
