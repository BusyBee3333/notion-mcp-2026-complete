// Notion File Management tools: list_page_files, get_file_urls,
//   append_multiple_files, update_file_property, clear_file_property,
//   get_page_attachments, add_external_file_to_page
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ListPageFilesSchema = z.object({
  page_id: z.string().describe("Page ID to list file attachments from"),
});

const GetFileUrlsSchema = z.object({
  page_id: z.string().describe("Page ID"),
  property_name: z.string().describe("Name of the files property to get URLs from"),
});

const UpdateFilePropertySchema = z.object({
  page_id: z.string().describe("Page ID to update"),
  property_name: z.string().describe("Name of the files property to update"),
  files: z.array(z.object({
    name: z.string().describe("Display name for the file"),
    url: z.string().url().describe("External URL of the file (must be publicly accessible)"),
  })).describe("Array of file references to set on the property"),
});

const ClearFilePropertySchema = z.object({
  page_id: z.string().describe("Page ID to update"),
  property_name: z.string().describe("Name of the files property to clear"),
});

const AddExternalFileToPageSchema = z.object({
  page_id: z.string().describe("Page ID to add file blocks to"),
  files: z.array(z.object({
    url: z.string().url().describe("External URL of the file"),
    name: z.string().optional().describe("Display name for the file"),
    caption: z.string().optional().describe("Optional caption text"),
    type: z.enum(["file", "pdf", "image", "video"]).optional().default("file").describe("Block type to use for the file"),
  })).min(1).describe("Files to add as blocks to the page"),
  after: z.string().optional().describe("Block ID to insert after (default: end)"),
});

const GetPageAttachmentsSchema = z.object({
  page_id: z.string().describe("Page ID to scan for attachments (both block-level and property-level)"),
  scan_blocks: z.boolean().optional().default(true).describe("Scan block content for file/image/video/pdf blocks"),
  scan_properties: z.boolean().optional().default(true).describe("Scan page properties for files properties"),
});

const AppendMultipleFilesSchema = z.object({
  page_id: z.string().describe("Page ID to append files to"),
  files: z.array(z.object({
    url: z.string().url().describe("External file URL"),
    name: z.string().optional().describe("Display name"),
    caption: z.string().optional().describe("Optional caption"),
  })).min(1).max(20).describe("Files to append as file blocks (1-20)"),
  after: z.string().optional().describe("Block ID to insert after (default: end)"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "list_page_files",
      title: "List Page Files",
      description:
        "List all file-type properties on a Notion page and their current values. Returns a summary of all file attachments stored in properties (not block-level files). Use get_page_attachments for a comprehensive scan.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to list file properties from" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          file_properties: { type: "array", items: { type: "object" } },
          total_files: { type: "number" },
        },
        required: ["page_id", "file_properties"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_file_urls",
      title: "Get File URLs",
      description:
        "Get the download URLs for all files in a specific files property on a Notion page. Returns both the file name and URL for each attachment. Note: Notion-hosted file URLs are temporary and expire.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID" },
          property_name: { type: "string", description: "Name of the files property" },
        },
        required: ["page_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          property_name: { type: "string" },
          files: { type: "array", items: { type: "object" } },
          count: { type: "number" },
        },
        required: ["page_id", "property_name", "files"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "update_file_property",
      title: "Update File Property",
      description:
        "Set external file URLs on a Notion page's files property. Replaces all existing files in the property with the new set. Only external URLs are supported via the API (Notion-hosted uploads require the UI).",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to update" },
          property_name: { type: "string", description: "Name of the files property" },
          files: {
            type: "array",
            items: { type: "object" },
            description: "File references: [{name, url}]. URL must be publicly accessible.",
          },
        },
        required: ["page_id", "property_name", "files"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          property_name: { type: "string" },
          files_set: { type: "number" },
        },
        required: ["id", "property_name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "clear_file_property",
      title: "Clear File Property",
      description:
        "Remove all files from a Notion page's files property, leaving it empty. Use this to reset a file attachment property.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to update" },
          property_name: { type: "string", description: "Name of the files property to clear" },
        },
        required: ["page_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          property_name: { type: "string" },
          cleared: { type: "boolean" },
        },
        required: ["id", "property_name", "cleared"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_page_attachments",
      title: "Get Page Attachments",
      description:
        "Comprehensively scan a Notion page for all file attachments — both in block content (file, image, video, pdf blocks) and in page properties (files-type properties). Returns a unified list of all attachments with their URLs.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to scan" },
          scan_blocks: { type: "boolean", description: "Scan block content (default: true)" },
          scan_properties: { type: "boolean", description: "Scan page properties (default: true)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          block_attachments: { type: "array", items: { type: "object" } },
          property_attachments: { type: "array", items: { type: "object" } },
          total_count: { type: "number" },
        },
        required: ["page_id", "block_attachments", "property_attachments", "total_count"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "add_external_file_to_page",
      title: "Add External File to Page",
      description:
        "Add one or more external file references as blocks on a Notion page. Each file can be added as a file, pdf, image, or video block depending on its type. Supports captions.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to add files to" },
          files: {
            type: "array",
            items: { type: "object" },
            description: "Files to add: [{url, name?, caption?, type?}]. type: 'file'|'pdf'|'image'|'video'",
          },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["page_id", "files"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          blocks_added: { type: "number" },
        },
        required: ["results", "blocks_added"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "append_multiple_files",
      title: "Append Multiple Files",
      description:
        "Append multiple file blocks to a Notion page in one call. Each file is added as a file block with an external URL, optional display name, and optional caption. Supports up to 20 files at once.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to append file blocks to" },
          files: {
            type: "array",
            items: { type: "object" },
            description: "Files to append (1-20): [{url, name?, caption?}]",
          },
          after: { type: "string", description: "Insert after this block ID (default: end)" },
        },
        required: ["page_id", "files"],
      },
      outputSchema: {
        type: "object",
        properties: {
          results: { type: "array", items: { type: "object" } },
          files_added: { type: "number" },
        },
        required: ["results", "files_added"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    list_page_files: async (args) => {
      const { page_id } = ListPageFilesSchema.parse(args);
      const page = await logger.time("tool.list_page_files", () =>
        client.get<Record<string, unknown>>(`/pages/${page_id}`)
      , { tool: "list_page_files", page_id });

      const properties = page.properties as Record<string, Record<string, unknown>> | undefined || {};
      const fileProperties: Record<string, unknown>[] = [];

      for (const [name, prop] of Object.entries(properties)) {
        if (prop.type === "files") {
          const files = prop.files as Array<{ name?: string; type?: string; external?: { url?: string }; file?: { url?: string } }> | undefined;
          fileProperties.push({
            property_name: name,
            files: (files || []).map((f) => ({
              name: f.name,
              type: f.type,
              url: f.external?.url || f.file?.url,
            })),
            file_count: (files || []).length,
          });
        }
      }

      const totalFiles = fileProperties.reduce((sum, p) => sum + ((p as { file_count: number }).file_count || 0), 0);
      const structured = { page_id, file_properties: fileProperties, total_files: totalFiles };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_file_urls: async (args) => {
      const params = GetFileUrlsSchema.parse(args);
      const page = await logger.time("tool.get_file_urls", () =>
        client.get<Record<string, unknown>>(`/pages/${params.page_id}`)
      , { tool: "get_file_urls", page_id: params.page_id });

      const properties = page.properties as Record<string, Record<string, unknown>> | undefined || {};
      const prop = properties[params.property_name];
      if (!prop) throw new Error(`Property '${params.property_name}' not found`);

      const rawFiles = prop.files as Array<{ name?: string; type?: string; external?: { url?: string }; file?: { url?: string; expiry_time?: string } }> | undefined;
      const files = (rawFiles || []).map((f) => ({
        name: f.name,
        type: f.type,
        url: f.external?.url || f.file?.url,
        expiry_time: f.file?.expiry_time,
      }));

      const structured = { page_id: params.page_id, property_name: params.property_name, files, count: files.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    update_file_property: async (args) => {
      const params = UpdateFilePropertySchema.parse(args);
      const fileValues = params.files.map((f) => ({
        name: f.name,
        type: "external",
        external: { url: f.url },
      }));

      const result = await logger.time("tool.update_file_property", () =>
        client.patch(`/pages/${params.page_id}`, {
          properties: { [params.property_name]: { files: fileValues } },
        })
      , { tool: "update_file_property", page_id: params.page_id });

      const page = result as Record<string, unknown>;
      const structured = { id: page.id, property_name: params.property_name, files_set: fileValues.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    clear_file_property: async (args) => {
      const params = ClearFilePropertySchema.parse(args);
      const result = await logger.time("tool.clear_file_property", () =>
        client.patch(`/pages/${params.page_id}`, {
          properties: { [params.property_name]: { files: [] } },
        })
      , { tool: "clear_file_property", page_id: params.page_id });

      const page = result as Record<string, unknown>;
      const structured = { id: page.id, property_name: params.property_name, cleared: true };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_page_attachments: async (args) => {
      const params = GetPageAttachmentsSchema.parse(args);
      const page = await logger.time("tool.get_page_attachments.page", () =>
        client.get<Record<string, unknown>>(`/pages/${params.page_id}`)
      , { tool: "get_page_attachments", page_id: params.page_id });

      const propertyAttachments: Record<string, unknown>[] = [];
      if (params.scan_properties) {
        const properties = page.properties as Record<string, Record<string, unknown>> | undefined || {};
        for (const [name, prop] of Object.entries(properties)) {
          if (prop.type === "files") {
            const files = prop.files as Array<{ name?: string; external?: { url?: string }; file?: { url?: string } }> | undefined;
            for (const f of (files || [])) {
              propertyAttachments.push({
                source: "property",
                property_name: name,
                name: f.name,
                url: f.external?.url || f.file?.url,
              });
            }
          }
        }
      }

      const blockAttachments: Record<string, unknown>[] = [];
      if (params.scan_blocks) {
        const mediaTypes = new Set(["file", "image", "video", "pdf"]);
        let cursor: string | undefined;
        do {
          const qs = new URLSearchParams({ page_size: "100" });
          if (cursor) qs.set("start_cursor", cursor);
          const response = await logger.time("tool.get_page_attachments.blocks", () =>
            client.get<Record<string, unknown>>(`/blocks/${params.page_id}/children?${qs}`)
          , { tool: "get_page_attachments.blocks", page_id: params.page_id });

          const results = (response.results as Record<string, unknown>[]) || [];
          for (const block of results) {
            const btype = block.type as string;
            if (mediaTypes.has(btype)) {
              const content = block[btype] as Record<string, unknown> | undefined;
              const ext = content?.external as Record<string, string> | undefined;
              const file = content?.file as Record<string, string> | undefined;
              const caption = content?.caption as Array<{ plain_text?: string }> | undefined;
              blockAttachments.push({
                source: "block",
                block_id: block.id,
                block_type: btype,
                url: ext?.url || file?.url,
                caption: caption?.map((c) => c.plain_text || "").join(""),
              });
            }
          }
          cursor = response.next_cursor as string | undefined;
        } while (cursor);
      }

      const structured = {
        page_id: params.page_id,
        block_attachments: blockAttachments,
        property_attachments: propertyAttachments,
        total_count: blockAttachments.length + propertyAttachments.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    add_external_file_to_page: async (args) => {
      const params = AddExternalFileToPageSchema.parse(args);
      const children = params.files.map((f) => {
        const blockType = f.type || "file";
        const content: Record<string, unknown> = {
          type: "external",
          external: { url: f.url },
        };
        if (f.caption) content.caption = [{ type: "text", text: { content: f.caption } }];
        if (f.name && blockType === "file") content.name = f.name;
        return { object: "block", type: blockType, [blockType]: content };
      });

      const body: Record<string, unknown> = { children };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.add_external_file_to_page", () =>
        client.patch(`/blocks/${params.page_id}/children`, body)
      , { tool: "add_external_file_to_page", page_id: params.page_id });

      const resultObj = result as Record<string, unknown>;
      const structured = { results: resultObj.results, blocks_added: children.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    append_multiple_files: async (args) => {
      const params = AppendMultipleFilesSchema.parse(args);
      const children = params.files.map((f) => {
        const fileContent: Record<string, unknown> = {
          type: "external",
          external: { url: f.url },
        };
        if (f.caption) fileContent.caption = [{ type: "text", text: { content: f.caption } }];
        if (f.name) fileContent.name = f.name;
        return { object: "block", type: "file", file: fileContent };
      });

      const body: Record<string, unknown> = { children };
      if (params.after) body.after = params.after;

      const result = await logger.time("tool.append_multiple_files", () =>
        client.patch(`/blocks/${params.page_id}/children`, body)
      , { tool: "append_multiple_files", page_id: params.page_id });

      const resultObj = result as Record<string, unknown>;
      const structured = { results: resultObj.results, files_added: children.length };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
