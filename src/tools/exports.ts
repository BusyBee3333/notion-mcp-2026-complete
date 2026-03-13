// Notion Export tools: export_page_markdown, export_database_csv
// Converts Notion content to portable formats entirely client-side (no extra API calls beyond fetching blocks/pages).
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const ExportPageMarkdownSchema = z.object({
  page_id: z.string().describe("Notion page ID to export as Markdown"),
  include_page_title: z.boolean().optional().default(true).describe("Prefix the output with a # heading using the page title (default: true)"),
  max_depth: z.number().min(1).max(10).optional().default(5).describe("Max block nesting depth to recurse into (1-10, default 5)"),
  page_size: z.number().min(1).max(100).optional().default(50).describe("Blocks per API call (1-100, default 50)"),
});

const ExportDatabaseCsvSchema = z.object({
  database_id: z.string().describe("Notion database ID to export as CSV"),
  filter: z.record(z.unknown()).optional().describe("Optional Notion filter to limit exported rows. E.g. {property:'Status',select:{equals:'Done'}}"),
  sorts: z.array(z.record(z.unknown())).optional().describe("Optional sort. E.g. [{property:'Name',direction:'ascending'}]"),
  include_properties: z.array(z.string()).optional().describe("Property names to include as columns. Omit to include all properties. Order is preserved."),
  max_rows: z.number().min(1).max(5000).optional().default(1000).describe("Maximum rows to export (1-5000, default 1000)"),
  delimiter: z.enum([",", ";", "\t"]).optional().default(",").describe("CSV field delimiter: comma (default), semicolon, or tab"),
});

// ============ Helpers ============

/** Extract plain text from a Notion rich_text array */
function richTextToString(richText: Array<{ plain_text?: string; text?: { content?: string } }> | undefined): string {
  if (!Array.isArray(richText)) return "";
  return richText.map((rt) => rt.plain_text ?? rt.text?.content ?? "").join("");
}

/** Extract title text from a page's title property */
function extractPageTitle(page: Record<string, unknown>): string {
  const props = page.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return "Untitled";
  const titleProp = Object.values(props).find((p) => p.type === "title");
  if (!titleProp) return "Untitled";
  return richTextToString((titleProp.title as Array<{ plain_text?: string }>) || []) || "Untitled";
}

/** Convert a single Notion block to Markdown text, given its depth for indentation */
function blockToMarkdown(block: Record<string, unknown>, depth: number): string {
  const type = block.type as string;
  const indent = "  ".repeat(depth);

  const getContent = (key: string): string => {
    const b = block[key] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
    return richTextToString(b?.rich_text || []);
  };

  switch (type) {
    case "paragraph": {
      const text = getContent("paragraph");
      return text ? `${indent}${text}` : "";
    }
    case "heading_1": {
      return `# ${getContent("heading_1")}`;
    }
    case "heading_2": {
      return `## ${getContent("heading_2")}`;
    }
    case "heading_3": {
      return `### ${getContent("heading_3")}`;
    }
    case "bulleted_list_item": {
      return `${indent}- ${getContent("bulleted_list_item")}`;
    }
    case "numbered_list_item": {
      return `${indent}1. ${getContent("numbered_list_item")}`;
    }
    case "to_do": {
      const td = block.to_do as { rich_text?: Array<{ plain_text?: string }>; checked?: boolean } | undefined;
      const checked = td?.checked ? "[x]" : "[ ]";
      const text = richTextToString(td?.rich_text || []);
      return `${indent}- ${checked} ${text}`;
    }
    case "toggle": {
      return `${indent}> **${getContent("toggle")}**`;
    }
    case "quote": {
      return getContent("quote").split("\n").map((l) => `> ${l}`).join("\n");
    }
    case "callout": {
      const co = block.callout as { rich_text?: Array<{ plain_text?: string }>; icon?: { emoji?: string } } | undefined;
      const icon = co?.icon?.emoji || "💡";
      const text = richTextToString(co?.rich_text || []);
      return `> ${icon} **Note:** ${text}`;
    }
    case "code": {
      const cb = block.code as { rich_text?: Array<{ plain_text?: string }>; language?: string } | undefined;
      const lang = cb?.language || "";
      const code = richTextToString(cb?.rich_text || []);
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case "divider": {
      return "---";
    }
    case "equation": {
      const eq = block.equation as { expression?: string } | undefined;
      return `$$\n${eq?.expression || ""}\n$$`;
    }
    case "image": {
      const img = block.image as { external?: { url?: string }; file?: { url?: string }; caption?: Array<{ plain_text?: string }> } | undefined;
      const url = img?.external?.url || img?.file?.url || "";
      const caption = richTextToString(img?.caption || []);
      return `![${caption}](${url})`;
    }
    case "video": {
      const vid = block.video as { external?: { url?: string }; file?: { url?: string } } | undefined;
      const url = vid?.external?.url || vid?.file?.url || "";
      return `[Video](${url})`;
    }
    case "file": {
      const f = block.file as { external?: { url?: string }; file?: { url?: string }; name?: string } | undefined;
      const url = f?.external?.url || f?.file?.url || "";
      const name = f?.name || "File";
      return `[${name}](${url})`;
    }
    case "pdf": {
      const pdf = block.pdf as { external?: { url?: string }; file?: { url?: string } } | undefined;
      const url = pdf?.external?.url || pdf?.file?.url || "";
      return `[PDF](${url})`;
    }
    case "bookmark": {
      const bm = block.bookmark as { url?: string; caption?: Array<{ plain_text?: string }> } | undefined;
      const caption = richTextToString(bm?.caption || []) || bm?.url || "";
      return `[${caption}](${bm?.url || ""})`;
    }
    case "embed": {
      const em = block.embed as { url?: string } | undefined;
      return `[Embed](${em?.url || ""})`;
    }
    case "link_preview": {
      const lp = block.link_preview as { url?: string } | undefined;
      return `[Link Preview](${lp?.url || ""})`;
    }
    case "table": {
      // Table rows come as _children; we'll handle them separately
      return "";
    }
    case "table_row": {
      const tr = block.table_row as { cells?: Array<Array<{ plain_text?: string }>> } | undefined;
      if (!tr?.cells) return "";
      return "| " + tr.cells.map((cell) => richTextToString(cell)).join(" | ") + " |";
    }
    case "breadcrumb": {
      return "*[Breadcrumb navigation]*";
    }
    case "column_list": {
      return ""; // columns are handled via children
    }
    case "column": {
      return ""; // content rendered via children
    }
    case "synced_block": {
      return ""; // content rendered via children
    }
    case "template": {
      const tmpl = block.template as { rich_text?: Array<{ plain_text?: string }> } | undefined;
      return `*[Template: ${richTextToString(tmpl?.rich_text || [])}]*`;
    }
    case "child_page": {
      const cp = block.child_page as { title?: string } | undefined;
      return `📄 **${cp?.title || "Sub-page"}**`;
    }
    case "child_database": {
      const cd = block.child_database as { title?: string } | undefined;
      return `🗃️ **${cd?.title || "Database"}**`;
    }
    case "unsupported": {
      return "*[Unsupported block type]*";
    }
    default: {
      return `*[${type} block]*`;
    }
  }
}

/** Recursively convert blocks to markdown lines */
function blocksToMarkdownLines(
  blocks: Array<Record<string, unknown>>,
  depth: number
): string[] {
  const lines: string[] = [];
  let prevType = "";

  for (const block of blocks) {
    const type = block.type as string;

    // Add blank line between different block types or after certain types
    if (prevType && prevType !== type && !["bulleted_list_item", "numbered_list_item", "to_do"].includes(type)) {
      if (!["bulleted_list_item", "numbered_list_item", "to_do"].includes(prevType)) {
        lines.push("");
      }
    }

    const md = blockToMarkdown(block, depth);

    // Handle table: build header separator row after first row
    if (type === "table") {
      const children = (block._children as Array<Record<string, unknown>>) || [];
      const tableLines: string[] = [];
      children.forEach((row, idx) => {
        const rowMd = blockToMarkdown(row, 0);
        tableLines.push(rowMd);
        if (idx === 0) {
          // Insert separator row
          const tr = row.table_row as { cells?: unknown[] } | undefined;
          const colCount = tr?.cells?.length || 1;
          tableLines.push("| " + Array(colCount).fill("---").join(" | ") + " |");
        }
      });
      lines.push(...tableLines);
    } else {
      if (md) lines.push(md);

      // Recurse into children
      const children = (block._children as Array<Record<string, unknown>>) || [];
      if (children.length > 0) {
        const childLines = blocksToMarkdownLines(children, depth + 1);
        lines.push(...childLines);
      }
    }

    prevType = type;
  }

  return lines;
}

/** Serialize a Notion property value to a CSV-safe string */
function propertyValueToString(prop: Record<string, unknown>): string {
  const type = prop.type as string;

  switch (type) {
    case "title":
    case "rich_text": {
      const rt = prop[type] as Array<{ plain_text?: string }> | undefined;
      return richTextToString(rt);
    }
    case "number": {
      const n = prop.number;
      return n === null || n === undefined ? "" : String(n);
    }
    case "select": {
      const s = prop.select as { name?: string } | null;
      return s?.name || "";
    }
    case "multi_select": {
      const ms = prop.multi_select as Array<{ name?: string }> | undefined;
      return (ms || []).map((o) => o.name || "").join("; ");
    }
    case "status": {
      const st = prop.status as { name?: string } | null;
      return st?.name || "";
    }
    case "date": {
      const d = prop.date as { start?: string; end?: string } | null;
      if (!d) return "";
      return d.end ? `${d.start} → ${d.end}` : (d.start || "");
    }
    case "checkbox": {
      return prop.checkbox ? "true" : "false";
    }
    case "url": {
      return (prop.url as string) || "";
    }
    case "email": {
      return (prop.email as string) || "";
    }
    case "phone_number": {
      return (prop.phone_number as string) || "";
    }
    case "people": {
      const people = prop.people as Array<{ name?: string; id?: string }> | undefined;
      return (people || []).map((p) => p.name || p.id || "").join("; ");
    }
    case "files": {
      const files = prop.files as Array<{ name?: string; external?: { url?: string }; file?: { url?: string } }> | undefined;
      return (files || []).map((f) => f.name || f.external?.url || f.file?.url || "").join("; ");
    }
    case "relation": {
      const rel = prop.relation as Array<{ id?: string }> | undefined;
      return (rel || []).map((r) => r.id || "").join("; ");
    }
    case "formula": {
      const fm = prop.formula as { type?: string; string?: string; number?: number; boolean?: boolean; date?: { start?: string } } | undefined;
      if (!fm) return "";
      switch (fm.type) {
        case "string": return fm.string || "";
        case "number": return fm.number !== undefined ? String(fm.number) : "";
        case "boolean": return fm.boolean !== undefined ? String(fm.boolean) : "";
        case "date": return fm.date?.start || "";
        default: return "";
      }
    }
    case "rollup": {
      const ru = prop.rollup as { type?: string; number?: number; date?: { start?: string }; array?: unknown[] } | undefined;
      if (!ru) return "";
      switch (ru.type) {
        case "number": return ru.number !== undefined ? String(ru.number) : "";
        case "date": return ru.date?.start || "";
        case "array": return `[${(ru.array || []).length} items]`;
        default: return "";
      }
    }
    case "created_time":
    case "last_edited_time": {
      return (prop[type] as string) || "";
    }
    case "created_by":
    case "last_edited_by": {
      const person = prop[type] as { name?: string; id?: string } | undefined;
      return person?.name || person?.id || "";
    }
    case "unique_id": {
      const uid = prop.unique_id as { prefix?: string; number?: number } | undefined;
      return uid ? `${uid.prefix || ""}${uid.number ?? ""}` : "";
    }
    case "verification": {
      const v = prop.verification as { state?: string } | undefined;
      return v?.state || "";
    }
    default: {
      return JSON.stringify(prop[type] ?? "");
    }
  }
}

/** Escape a value for CSV output */
function csvEscape(value: string, delimiter: string): string {
  const needsQuoting = value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r");
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "export_page_markdown",
      title: "Export Page as Markdown",
      description:
        "Export a Notion page's content as a Markdown string. Converts all block types to their Markdown equivalents: headings, paragraphs, lists (bullet, numbered, to-do), code blocks, callouts, quotes, dividers, equations, images, videos, bookmarks, tables, and more. Recursively fetches nested blocks. No external API calls beyond reading the page — conversion happens locally. Ideal for sharing content, feeding to other tools, or archiving.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Notion page ID to convert to Markdown" },
          include_page_title: { type: "boolean", description: "Prefix output with # Page Title (default: true)" },
          max_depth: { type: "number", description: "Max nesting depth (1-10, default 5)" },
          page_size: { type: "number", description: "Blocks per API call (1-100, default 50)" },
        },
        required: ["page_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          title: { type: "string" },
          markdown: { type: "string" },
          total_blocks: { type: "number" },
          character_count: { type: "number" },
        },
        required: ["page_id", "markdown"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "export_database_csv",
      title: "Export Database as CSV",
      description:
        "Export all pages from a Notion database as a CSV string. Automatically paginating through all records. Each row represents a page; each column represents a database property. Supports all property types (text, number, select, multi-select, date, checkbox, URL, email, phone, people, files, relation, formula, rollup, etc.). Handles special characters with proper CSV escaping. Useful for spreadsheet imports, data analysis, and backups.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Notion database ID to export as CSV" },
          filter: { type: "object", description: "Optional Notion filter to limit exported rows" },
          sorts: { type: "array", items: { type: "object" }, description: "Optional sort. E.g. [{property:'Name',direction:'ascending'}]" },
          include_properties: { type: "array", items: { type: "string" }, description: "Property names to include as columns (in order). Omit for all." },
          max_rows: { type: "number", description: "Max rows to export (1-5000, default 1000)" },
          delimiter: { type: "string", enum: [",", ";", "\t"], description: "Field delimiter: comma (default), semicolon, or tab" },
        },
        required: ["database_id"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          total_rows: { type: "number" },
          columns: { type: "array", items: { type: "string" } },
          csv: { type: "string" },
          truncated: { type: "boolean" },
        },
        required: ["database_id", "total_rows", "columns", "csv"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    export_page_markdown: async (args) => {
      const params = ExportPageMarkdownSchema.parse(args);

      // Fetch page metadata for title
      const page = await logger.time("tool.export_page_markdown.page", () =>
        client.get<Record<string, unknown>>(`/pages/${params.page_id}`)
      , { tool: "export_page_markdown", page_id: params.page_id });

      const title = extractPageTitle(page);

      // Recursively fetch all blocks
      let totalBlocks = 0;

      const fetchBlocksRecursive = async (
        blockId: string,
        depth: number
      ): Promise<Array<Record<string, unknown>>> => {
        if (depth > params.max_depth) return [];
        const blocks: Array<Record<string, unknown>> = [];
        let cursor: string | undefined;

        do {
          const queryParams = new URLSearchParams({ page_size: String(params.page_size) });
          if (cursor) queryParams.set("start_cursor", cursor);

          const response = await logger.time("tool.export_page_markdown.blocks", () =>
            client.get<Record<string, unknown>>(`/blocks/${blockId}/children?${queryParams}`)
          , { tool: "export_page_markdown.blocks", blockId, depth });

          const results = (response.results as Array<Record<string, unknown>>) || [];
          totalBlocks += results.length;

          for (const block of results) {
            const enriched: Record<string, unknown> = { ...block };
            if (block.has_children && depth < params.max_depth) {
              enriched._children = await fetchBlocksRecursive(block.id as string, depth + 1);
            }
            blocks.push(enriched);
          }

          cursor = response.next_cursor as string | undefined;
        } while (cursor);

        return blocks;
      };

      const blocks = await fetchBlocksRecursive(params.page_id, 1);

      // Convert to Markdown
      const lines: string[] = [];
      if (params.include_page_title) {
        lines.push(`# ${title}`);
        lines.push("");
      }

      const contentLines = blocksToMarkdownLines(blocks, 0);
      lines.push(...contentLines);

      // Clean up multiple consecutive blank lines
      const cleaned: string[] = [];
      let blankCount = 0;
      for (const line of lines) {
        if (line === "") {
          blankCount++;
          if (blankCount <= 1) cleaned.push(line);
        } else {
          blankCount = 0;
          cleaned.push(line);
        }
      }

      const markdown = cleaned.join("\n").trimEnd();

      const result = {
        page_id: params.page_id,
        title,
        markdown,
        total_blocks: totalBlocks,
        character_count: markdown.length,
      };

      return {
        content: [{ type: "text", text: markdown }],
        structuredContent: result,
      };
    },

    export_database_csv: async (args) => {
      const params = ExportDatabaseCsvSchema.parse(args);
      const delimiter = params.delimiter;

      // Fetch all pages from the database
      const allPages: Record<string, unknown>[] = [];
      let cursor: string | undefined;
      let truncated = false;

      do {
        const body: Record<string, unknown> = { page_size: 100 };
        if (params.filter) body.filter = params.filter;
        if (params.sorts) body.sorts = params.sorts;
        if (cursor) body.start_cursor = cursor;

        const response = await logger.time("tool.export_database_csv.fetch", () =>
          client.post<Record<string, unknown>>(`/databases/${params.database_id}/query`, body)
        , { tool: "export_database_csv", database_id: params.database_id, fetched: allPages.length });

        const results = (response.results as Record<string, unknown>[]) || [];
        for (const page of results) {
          if (allPages.length >= params.max_rows) {
            truncated = true;
            break;
          }
          allPages.push(page);
        }

        cursor = truncated ? undefined : (response.next_cursor as string | undefined) ?? undefined;
      } while (cursor);

      if (allPages.length === 0) {
        const result = {
          database_id: params.database_id,
          total_rows: 0,
          columns: [],
          csv: "",
          truncated: false,
        };
        return {
          content: [{ type: "text", text: "" }],
          structuredContent: result,
        };
      }

      // Determine column order
      const firstPage = allPages[0];
      const allProps = (firstPage.properties as Record<string, unknown>) || {};

      let columns: string[];
      if (params.include_properties && params.include_properties.length > 0) {
        columns = params.include_properties.filter((c) => c in allProps);
      } else {
        // Put title property first, then the rest alphabetically
        const propEntries = Object.entries(allProps) as Array<[string, Record<string, unknown>]>;
        const titleCol = propEntries.find(([, v]) => (v as Record<string, unknown>).type === "title");
        const rest = propEntries
          .filter(([, v]) => (v as Record<string, unknown>).type !== "title")
          .map(([k]) => k)
          .sort();
        columns = titleCol ? [titleCol[0], ...rest] : rest;
      }

      // Build CSV
      const csvLines: string[] = [];

      // Header row — also include system columns
      const systemCols = ["notion_page_id", "notion_url", "created_time", "last_edited_time"];
      const allCols = [...systemCols, ...columns];

      csvLines.push(allCols.map((c) => csvEscape(c, delimiter)).join(delimiter));

      // Data rows
      for (const page of allPages) {
        const props = (page.properties as Record<string, Record<string, unknown>>) || {};
        const row: string[] = [
          csvEscape((page.id as string) || "", delimiter),
          csvEscape((page.url as string) || "", delimiter),
          csvEscape((page.created_time as string) || "", delimiter),
          csvEscape((page.last_edited_time as string) || "", delimiter),
        ];

        for (const col of columns) {
          const propObj = props[col];
          const value = propObj ? propertyValueToString(propObj) : "";
          row.push(csvEscape(value, delimiter));
        }

        csvLines.push(row.join(delimiter));
      }

      const csv = csvLines.join("\n");

      const result = {
        database_id: params.database_id,
        total_rows: allPages.length,
        columns: allCols,
        csv,
        truncated,
      };

      return {
        content: [{ type: "text", text: csv }],
        structuredContent: result,
      };
    },
  };

  return { tools, handlers };
}
