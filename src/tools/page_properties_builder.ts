// Notion Page Properties Builder tools — high-level helpers for constructing
// Notion page property values for every property type:
//   build_title_property, build_rich_text_property, build_number_property,
//   build_select_property, build_multi_select_property, build_date_property,
//   build_checkbox_property, build_url_property, build_email_property,
//   build_phone_property, build_people_property, build_files_property,
//   build_relation_property, build_status_property,
//   set_page_property, get_page_property_value
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const BuildTitleSchema = z.object({
  text: z.string().describe("Plain text content for the title"),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  link: z.string().optional().describe("URL link for the title text"),
});

const BuildRichTextPropSchema = z.object({
  text: z.string().describe("Plain text content for the rich text property"),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  code: z.boolean().optional(),
  link: z.string().optional().describe("URL link"),
});

const BuildNumberPropSchema = z.object({
  number: z.number().nullable().describe("Numeric value, or null to clear the property"),
});

const BuildSelectPropSchema = z.object({
  name: z.string().nullable().describe("Option name to select, or null to clear"),
});

const BuildMultiSelectPropSchema = z.object({
  names: z.array(z.string()).describe("Array of option names to select. E.g. ['Frontend', 'Bug', 'P1']"),
});

const BuildDatePropSchema = z.object({
  start: z.string().describe("ISO 8601 start date/datetime. E.g. '2024-12-31' or '2024-12-31T10:00:00.000-08:00'"),
  end: z.string().optional().describe("ISO 8601 end date/datetime for date ranges"),
  time_zone: z.string().optional().describe("IANA timezone string. E.g. 'America/New_York'"),
});

const BuildCheckboxPropSchema = z.object({
  checked: z.boolean().describe("true = checked, false = unchecked"),
});

const BuildUrlPropSchema = z.object({
  url: z.string().nullable().describe("URL value, or null to clear"),
});

const BuildEmailPropSchema = z.object({
  email: z.string().nullable().describe("Email address value, or null to clear"),
});

const BuildPhonePropSchema = z.object({
  phone: z.string().nullable().describe("Phone number string, or null to clear"),
});

const BuildPeoplePropSchema = z.object({
  user_ids: z.array(z.string()).describe("Array of Notion user IDs to assign. E.g. ['abc123', 'def456']"),
});

const BuildFilesPropSchema = z.object({
  files: z.array(z.object({
    name: z.string().describe("Display name for the file"),
    url: z.string().url().describe("External URL of the file"),
  })).describe("Array of external file references"),
});

const BuildRelationPropSchema = z.object({
  page_ids: z.array(z.string()).describe("Array of related page IDs to link to"),
});

const BuildStatusPropSchema = z.object({
  name: z.string().nullable().describe("Status option name, or null to clear"),
});

const SetPagePropertySchema = z.object({
  page_id: z.string().describe("Page ID to update"),
  property_name: z.string().describe("Name of the property to set"),
  property_type: z.enum([
    "title", "rich_text", "number", "select", "multi_select", "date",
    "checkbox", "url", "email", "phone_number", "people", "files",
    "relation", "status"
  ]).describe("Type of the property"),
  value: z.unknown().describe(
    "Value appropriate for the property type:\n" +
    "- title/rich_text: string or [{text:{content:'...'}}]\n" +
    "- number: number or null\n" +
    "- select/status: string (option name) or null\n" +
    "- multi_select: ['option1','option2'] (array of names)\n" +
    "- date: {start:'2024-01-01',end?:'2024-01-31'} or null\n" +
    "- checkbox: true/false\n" +
    "- url/email/phone_number: string or null\n" +
    "- people: ['user_id_1','user_id_2'] (array of user IDs)\n" +
    "- files: [{name:'file.pdf',url:'https://...'}]\n" +
    "- relation: ['page_id_1','page_id_2'] (array of page IDs)"
  ),
});

const GetPagePropertyValueSchema = z.object({
  page_id: z.string().describe("Page ID"),
  property_name: z.string().describe("Property name to extract value from"),
});

// ============ Helpers ============

function makeTitleProp(text: string, bold?: boolean, italic?: boolean, link?: string) {
  const annotations: Record<string, unknown> = {};
  if (bold) annotations.bold = true;
  if (italic) annotations.italic = true;
  const textObj: Record<string, unknown> = { content: text };
  if (link) textObj.link = { url: link };
  return {
    title: [{
      type: "text",
      text: textObj,
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    }],
  };
}

function makeRichTextProp(text: string, bold?: boolean, italic?: boolean, code?: boolean, link?: string) {
  const annotations: Record<string, unknown> = {};
  if (bold) annotations.bold = true;
  if (italic) annotations.italic = true;
  if (code) annotations.code = true;
  const textObj: Record<string, unknown> = { content: text };
  if (link) textObj.link = { url: link };
  return {
    rich_text: [{
      type: "text",
      text: textObj,
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    }],
  };
}

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "build_title_property",
      title: "Build Title Property",
      description:
        "Build a Notion title property value object from a plain string. Returns the property object you can use directly in create_page or update_page calls. Optionally add bold, italic, or a link.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Title text content" },
          bold: { type: "boolean", description: "Bold the title text" },
          italic: { type: "boolean", description: "Italicize the title text" },
          link: { type: "string", description: "Optional URL link for the title text" },
        },
        required: ["text"],
      },
      outputSchema: {
        type: "object",
        properties: {
          property_value: { type: "object" },
          property_type: { type: "string" },
        },
        required: ["property_value", "property_type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_rich_text_property",
      title: "Build Rich Text Property",
      description:
        "Build a Notion rich_text property value object from a plain string. Returns the property object ready for create_page or update_page. Optionally add bold, italic, code, or link formatting.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Rich text content" },
          bold: { type: "boolean" },
          italic: { type: "boolean" },
          code: { type: "boolean" },
          link: { type: "string", description: "Optional URL link" },
        },
        required: ["text"],
      },
      outputSchema: {
        type: "object",
        properties: {
          property_value: { type: "object" },
          property_type: { type: "string" },
        },
        required: ["property_value", "property_type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_date_property",
      title: "Build Date Property",
      description:
        "Build a Notion date property value object. Supports single dates and date ranges. ISO 8601 format. Can include timezone. Returns the property object ready for create_page or update_page.",
      inputSchema: {
        type: "object",
        properties: {
          start: { type: "string", description: "Start date in ISO 8601 format. E.g. '2024-12-31' or '2024-12-31T10:00:00.000-08:00'" },
          end: { type: "string", description: "End date for a date range (optional)" },
          time_zone: { type: "string", description: "IANA timezone. E.g. 'America/New_York'" },
        },
        required: ["start"],
      },
      outputSchema: {
        type: "object",
        properties: {
          property_value: { type: "object" },
          property_type: { type: "string" },
        },
        required: ["property_value", "property_type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_select_property",
      title: "Build Select Property",
      description:
        "Build a Notion select property value object from an option name. Returns the property object ready for create_page or update_page. Pass null to clear the selection.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Option name to select, or null to clear" },
        },
        required: ["name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          property_value: { type: "object" },
          property_type: { type: "string" },
        },
        required: ["property_value", "property_type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_multi_select_property",
      title: "Build Multi-Select Property",
      description:
        "Build a Notion multi_select property value object from an array of option names. Returns the property object ready for create_page or update_page.",
      inputSchema: {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" }, description: "Array of option names to select" },
        },
        required: ["names"],
      },
      outputSchema: {
        type: "object",
        properties: {
          property_value: { type: "object" },
          property_type: { type: "string" },
        },
        required: ["property_value", "property_type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_people_property",
      title: "Build People Property",
      description:
        "Build a Notion people property value object from an array of user IDs. Returns the property object ready for create_page or update_page. Use list_users to find user IDs.",
      inputSchema: {
        type: "object",
        properties: {
          user_ids: { type: "array", items: { type: "string" }, description: "Array of Notion user IDs" },
        },
        required: ["user_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          property_value: { type: "object" },
          property_type: { type: "string" },
        },
        required: ["property_value", "property_type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "build_relation_property",
      title: "Build Relation Property",
      description:
        "Build a Notion relation property value object from an array of related page IDs. Returns the property object ready for create_page or update_page.",
      inputSchema: {
        type: "object",
        properties: {
          page_ids: { type: "array", items: { type: "string" }, description: "Array of related page IDs to link" },
        },
        required: ["page_ids"],
      },
      outputSchema: {
        type: "object",
        properties: {
          property_value: { type: "object" },
          property_type: { type: "string" },
        },
        required: ["property_value", "property_type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_page_property",
      title: "Set Page Property",
      description:
        "Set a single property on a Notion page with automatic value formatting. Handles all property types — just provide the type and value in a natural format (string for text, number for numeric, array for multi-select/people/relation, etc.). No need to build complex Notion property objects manually.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID to update" },
          property_name: { type: "string", description: "Property name to set" },
          property_type: {
            type: "string",
            enum: ["title", "rich_text", "number", "select", "multi_select", "date", "checkbox", "url", "email", "phone_number", "people", "files", "relation", "status"],
            description: "Property type",
          },
          value: { description: "Value for the property — format depends on type (see description)" },
        },
        required: ["page_id", "property_name", "property_type", "value"],
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
      name: "get_page_property_value",
      title: "Get Page Property Value",
      description:
        "Extract and return the human-readable value of a specific property on a Notion page. Returns a simplified value (string, number, array of names, etc.) instead of the raw Notion property object — easier to display or use downstream.",
      inputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "Page ID" },
          property_name: { type: "string", description: "Property name to read" },
        },
        required: ["page_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          property_name: { type: "string" },
          property_type: { type: "string" },
          value: {},
          raw_property: { type: "object" },
        },
        required: ["page_id", "property_name", "property_type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Helpers ============

  function buildPropertyValue(property_type: string, value: unknown): Record<string, unknown> {
    switch (property_type) {
      case "title": {
        const text = typeof value === "string" ? value : String(value);
        return { title: [{ type: "text", text: { content: text } }] };
      }
      case "rich_text": {
        const text = typeof value === "string" ? value : String(value);
        return { rich_text: [{ type: "text", text: { content: text } }] };
      }
      case "number":
        return { number: value === null ? null : Number(value) };
      case "select": {
        if (value === null) return { select: null };
        const name = typeof value === "string" ? value : String(value);
        return { select: { name } };
      }
      case "status": {
        if (value === null) return { status: null };
        const name = typeof value === "string" ? value : String(value);
        return { status: { name } };
      }
      case "multi_select": {
        const names = Array.isArray(value) ? value : [String(value)];
        return { multi_select: names.map((n: unknown) => ({ name: String(n) })) };
      }
      case "date": {
        if (value === null) return { date: null };
        if (typeof value === "string") return { date: { start: value } };
        const d = value as { start: string; end?: string; time_zone?: string };
        return { date: { start: d.start, ...(d.end ? { end: d.end } : {}), ...(d.time_zone ? { time_zone: d.time_zone } : {}) } };
      }
      case "checkbox":
        return { checkbox: Boolean(value) };
      case "url":
        return { url: value === null ? null : String(value) };
      case "email":
        return { email: value === null ? null : String(value) };
      case "phone_number":
        return { phone_number: value === null ? null : String(value) };
      case "people": {
        const ids = Array.isArray(value) ? value : [String(value)];
        return { people: ids.map((id: unknown) => ({ object: "user", id: String(id) })) };
      }
      case "files": {
        const files = Array.isArray(value) ? value : [];
        return { files: files.map((f: unknown) => {
          const file = f as { name: string; url: string };
          return { name: file.name, type: "external", external: { url: file.url } };
        })};
      }
      case "relation": {
        const ids = Array.isArray(value) ? value : [String(value)];
        return { relation: ids.map((id: unknown) => ({ id: String(id) })) };
      }
      default:
        throw new Error(`Unsupported property type: ${property_type}`);
    }
  }

  function extractPropertyValue(propType: string, prop: Record<string, unknown>): unknown {
    switch (propType) {
      case "title": {
        const rt = prop.title as Array<{ plain_text?: string }> | undefined;
        return rt?.map((t) => t.plain_text || "").join("") || "";
      }
      case "rich_text": {
        const rt = prop.rich_text as Array<{ plain_text?: string }> | undefined;
        return rt?.map((t) => t.plain_text || "").join("") || "";
      }
      case "number":
        return prop.number ?? null;
      case "select": {
        const sel = prop.select as { name?: string } | null | undefined;
        return sel?.name ?? null;
      }
      case "status": {
        const st = prop.status as { name?: string } | null | undefined;
        return st?.name ?? null;
      }
      case "multi_select": {
        const ms = prop.multi_select as Array<{ name?: string }> | undefined;
        return ms?.map((o) => o.name || "") || [];
      }
      case "date": {
        const d = prop.date as { start?: string; end?: string } | null | undefined;
        return d ? { start: d.start, end: d.end } : null;
      }
      case "checkbox":
        return prop.checkbox ?? false;
      case "url":
        return prop.url ?? null;
      case "email":
        return prop.email ?? null;
      case "phone_number":
        return prop.phone_number ?? null;
      case "people": {
        const people = prop.people as Array<{ id?: string; name?: string }> | undefined;
        return people?.map((u) => ({ id: u.id, name: u.name })) || [];
      }
      case "files": {
        const files = prop.files as Array<{ name?: string; external?: { url?: string }; file?: { url?: string } }> | undefined;
        return files?.map((f) => ({ name: f.name, url: f.external?.url || f.file?.url })) || [];
      }
      case "relation": {
        const rel = prop.relation as Array<{ id?: string }> | undefined;
        return rel?.map((r) => r.id) || [];
      }
      case "formula": {
        const fm = prop.formula as { type?: string; string?: string; number?: number; boolean?: boolean; date?: unknown } | undefined;
        if (!fm) return null;
        return fm.string ?? fm.number ?? fm.boolean ?? fm.date ?? null;
      }
      case "rollup": {
        const ru = prop.rollup as { type?: string; number?: number; array?: unknown[] } | undefined;
        return ru?.number ?? ru?.array ?? null;
      }
      case "created_time":
        return prop.created_time;
      case "last_edited_time":
        return prop.last_edited_time;
      case "created_by": {
        const u = prop.created_by as { id?: string; name?: string } | undefined;
        return u ? { id: u.id, name: u.name } : null;
      }
      case "last_edited_by": {
        const u = prop.last_edited_by as { id?: string; name?: string } | undefined;
        return u ? { id: u.id, name: u.name } : null;
      }
      case "unique_id": {
        const uid = prop.unique_id as { prefix?: string; number?: number } | undefined;
        return uid ? `${uid.prefix || ""}-${uid.number || ""}`.trim().replace(/^-/, "") : null;
      }
      default:
        return prop[propType] ?? null;
    }
  }

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    build_title_property: async (args) => {
      const params = BuildTitleSchema.parse(args);
      const pv = makeTitleProp(params.text, params.bold, params.italic, params.link);
      const structured = { property_value: pv, property_type: "title" };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    build_rich_text_property: async (args) => {
      const params = BuildRichTextPropSchema.parse(args);
      const pv = makeRichTextProp(params.text, params.bold, params.italic, params.code, params.link);
      const structured = { property_value: pv, property_type: "rich_text" };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    build_date_property: async (args) => {
      const params = BuildDatePropSchema.parse(args);
      const dateValue: Record<string, unknown> = { start: params.start };
      if (params.end) dateValue.end = params.end;
      if (params.time_zone) dateValue.time_zone = params.time_zone;
      const pv = { date: dateValue };
      const structured = { property_value: pv, property_type: "date" };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    build_select_property: async (args) => {
      const { name } = BuildSelectPropSchema.parse(args);
      const pv = { select: name === null ? null : { name } };
      const structured = { property_value: pv, property_type: "select" };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    build_multi_select_property: async (args) => {
      const { names } = BuildMultiSelectPropSchema.parse(args);
      const pv = { multi_select: names.map((n) => ({ name: n })) };
      const structured = { property_value: pv, property_type: "multi_select" };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    build_people_property: async (args) => {
      const { user_ids } = BuildPeoplePropSchema.parse(args);
      const pv = { people: user_ids.map((id) => ({ object: "user", id })) };
      const structured = { property_value: pv, property_type: "people" };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    build_relation_property: async (args) => {
      const { page_ids } = BuildRelationPropSchema.parse(args);
      const pv = { relation: page_ids.map((id) => ({ id })) };
      const structured = { property_value: pv, property_type: "relation" };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    set_page_property: async (args) => {
      const params = SetPagePropertySchema.parse(args);
      const propertyValue = buildPropertyValue(params.property_type, params.value);
      const result = await logger.time("tool.set_page_property", () =>
        client.patch(`/pages/${params.page_id}`, { properties: { [params.property_name]: propertyValue } })
      , { tool: "set_page_property", page_id: params.page_id, property_name: params.property_name });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },

    get_page_property_value: async (args) => {
      const params = GetPagePropertyValueSchema.parse(args);
      const page = await logger.time("tool.get_page_property_value", () =>
        client.get<Record<string, unknown>>(`/pages/${params.page_id}`)
      , { tool: "get_page_property_value", page_id: params.page_id });

      const properties = page.properties as Record<string, Record<string, unknown>> | undefined;
      if (!properties || !(params.property_name in properties)) {
        throw new Error(`Property '${params.property_name}' not found on page`);
      }

      const prop = properties[params.property_name];
      const propType = prop.type as string;
      const value = extractPropertyValue(propType, prop);

      const structured = {
        page_id: params.page_id,
        property_name: params.property_name,
        property_type: propType,
        value,
        raw_property: prop,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
