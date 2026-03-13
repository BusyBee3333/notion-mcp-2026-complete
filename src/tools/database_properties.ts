// Notion Database Property management tools:
//   add_select_option, add_multi_select_option, update_select_option,
//   reorder_database_properties, get_property_config,
//   set_number_format, add_status_option, configure_relation_property,
//   update_formula_property, clone_property_to_database
import { z } from "zod";
import type { NotionClient } from "../client.js";
import type { ToolDefinition, ToolHandler } from "../types.js";
import { logger } from "../logger.js";

// ============ Schemas ============

const AddSelectOptionSchema = z.object({
  database_id: z.string().describe("Database ID to update"),
  property_name: z.string().describe("Name of the select property to add an option to"),
  option_name: z.string().describe("Name of the new option to add"),
  color: z.enum([
    "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"
  ]).optional().default("default").describe("Color for the new option (default: 'default')"),
});

const AddMultiSelectOptionSchema = z.object({
  database_id: z.string().describe("Database ID to update"),
  property_name: z.string().describe("Name of the multi_select property to add an option to"),
  option_name: z.string().describe("Name of the new option to add"),
  color: z.enum([
    "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"
  ]).optional().default("default").describe("Color for the new option"),
});

const UpdateSelectOptionSchema = z.object({
  database_id: z.string().describe("Database ID containing the property"),
  property_name: z.string().describe("Name of the select or multi_select property"),
  old_option_name: z.string().describe("Current name of the option to update"),
  new_option_name: z.string().optional().describe("New name for the option (omit to keep current name)"),
  new_color: z.enum([
    "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"
  ]).optional().describe("New color for the option"),
});

const GetPropertyConfigSchema = z.object({
  database_id: z.string().describe("Database ID"),
  property_name: z.string().describe("Property name to get configuration for"),
});

const SetNumberFormatSchema = z.object({
  database_id: z.string().describe("Database ID containing the number property"),
  property_name: z.string().describe("Name of the number property to update format for"),
  format: z.enum([
    "number", "number_with_commas", "percent", "dollar", "canadian_dollar", "singapore_dollar",
    "euro", "pound", "yen", "ruble", "rupee", "won", "yuan", "real", "lira", "rupiah",
    "franc", "hong_kong_dollar", "new_zealand_dollar", "krona", "norwegian_krone", "mexican_peso",
    "rand", "new_taiwan_dollar", "danish_krone", "zloty", "baht", "forint", "koruna",
    "shekel", "chilean_peso", "philippine_peso", "dirham", "colombian_peso",
    "riyal", "ringgit", "leu", "argentine_peso", "uruguayan_peso", "singapore_dollar"
  ]).describe("Number format to apply"),
});

const AddStatusOptionSchema = z.object({
  database_id: z.string().describe("Database ID containing the status property"),
  property_name: z.string().describe("Name of the status property"),
  option_name: z.string().describe("Name of the new status option"),
  color: z.enum([
    "default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"
  ]).optional().default("default").describe("Color for the new status option"),
  group_name: z.string().optional().describe("Name of the status group to add the option to (e.g. 'To-do', 'In progress', 'Complete')"),
});

const ConfigureRelationPropertySchema = z.object({
  database_id: z.string().describe("Database ID containing the relation property"),
  property_name: z.string().describe("Name of the relation property to configure"),
  related_database_id: z.string().describe("ID of the database this property should relate to"),
  relation_type: z.enum(["single_property", "dual_property"]).optional().default("single_property").describe(
    "Relation type: 'single_property' (one-way) or 'dual_property' (two-way, creates synced property in related DB)"
  ),
  synced_property_name: z.string().optional().describe("Name for the synced property in the related database (only for dual_property)"),
});

const UpdateFormulaPropertySchema = z.object({
  database_id: z.string().describe("Database ID containing the formula property"),
  property_name: z.string().describe("Name of the formula property to update"),
  expression: z.string().describe(
    "New formula expression. Notion formula syntax. Examples:\n" +
    "- prop(\"Name\") — reference a property\n" +
    "- length(prop(\"Description\")) — string length\n" +
    "- if(prop(\"Done\"), \"✅\", \"❌\") — conditional\n" +
    "- dateBetween(now(), prop(\"Due Date\"), \"days\") — date math\n" +
    "- concat(prop(\"First Name\"), \" \", prop(\"Last Name\")) — concatenate"
  ),
});

const ListPropertyOptionsSchema = z.object({
  database_id: z.string().describe("Database ID"),
  property_name: z.string().describe("Name of a select, multi_select, or status property"),
});

// ============ Tool Definitions ============

export function getTools(client: NotionClient): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [
    {
      name: "add_select_option",
      title: "Add Select Option",
      description:
        "Add a new option to a select property in a Notion database. Preserves all existing options and appends the new one. Specify a color for consistent visual styling.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to update" },
          property_name: { type: "string", description: "Name of the select property" },
          option_name: { type: "string", description: "Name of the new option to add" },
          color: { type: "string", description: "Color: default, gray, brown, orange, yellow, green, blue, purple, pink, red" },
        },
        required: ["database_id", "property_name", "option_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          options: { type: "array", items: { type: "object" } },
        },
        required: ["database_id", "property_name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "add_multi_select_option",
      title: "Add Multi-Select Option",
      description:
        "Add a new option to a multi_select property in a Notion database. Preserves all existing options and appends the new one. Use to extend a multi-select with new tag values.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID to update" },
          property_name: { type: "string", description: "Name of the multi_select property" },
          option_name: { type: "string", description: "Name of the new option" },
          color: { type: "string", description: "Color: default, gray, brown, orange, yellow, green, blue, purple, pink, red" },
        },
        required: ["database_id", "property_name", "option_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          options: { type: "array", items: { type: "object" } },
        },
        required: ["database_id", "property_name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_select_option",
      title: "Update Select Option",
      description:
        "Update an existing select or multi_select option in a Notion database — rename it and/or change its color. Safely patches only the specified option while preserving all others.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Name of the select or multi_select property" },
          old_option_name: { type: "string", description: "Current name of the option to update" },
          new_option_name: { type: "string", description: "New name (omit to keep current name)" },
          new_color: { type: "string", description: "New color (omit to keep current color)" },
        },
        required: ["database_id", "property_name", "old_option_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          options: { type: "array", items: { type: "object" } },
        },
        required: ["database_id", "property_name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "get_property_config",
      title: "Get Property Configuration",
      description:
        "Get the full configuration of a single property in a Notion database — including options for select/multi_select/status, relation target, formula expression, rollup settings, number format, etc. More focused than get_database_schema.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Property name to inspect" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          property_id: { type: "string" },
          type: { type: "string" },
          config: { type: "object" },
        },
        required: ["database_id", "property_name", "type"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "set_number_format",
      title: "Set Number Format",
      description:
        "Update the display format of a number property in a Notion database. Supports 30+ formats including currencies (dollar, euro, yen, etc.), percentages, and plain number formats.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Name of the number property" },
          format: {
            type: "string",
            description: "Number format: number, number_with_commas, percent, dollar, euro, pound, yen, yuan, won, rupee, ruble, franc, etc.",
          },
        },
        required: ["database_id", "property_name", "format"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          format: { type: "string" },
        },
        required: ["database_id", "property_name", "format"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "add_status_option",
      title: "Add Status Option",
      description:
        "Add a new option to a status property in a Notion database. Status properties have options grouped into categories (To-do, In progress, Complete). You can optionally specify which group the new option belongs to.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Name of the status property" },
          option_name: { type: "string", description: "Name of the new status option" },
          color: { type: "string", description: "Color for the option" },
          group_name: { type: "string", description: "Status group to add to (e.g. 'In progress'). Omit to keep in existing group structure." },
        },
        required: ["database_id", "property_name", "option_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          options: { type: "array", items: { type: "object" } },
        },
        required: ["database_id", "property_name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: "update_formula_property",
      title: "Update Formula Property",
      description:
        "Update the formula expression of a formula property in a Notion database. Supports the full Notion formula language including property references, arithmetic, string functions, date functions, and conditionals.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Name of the formula property to update" },
          expression: { type: "string", description: "Notion formula expression. E.g. 'prop(\"Name\")' or 'if(prop(\"Done\"), \"✅\", \"❌\")'" },
        },
        required: ["database_id", "property_name", "expression"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          expression: { type: "string" },
        },
        required: ["database_id", "property_name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "list_property_options",
      title: "List Property Options",
      description:
        "List all options for a select, multi_select, or status property in a Notion database. Returns option names, colors, and IDs. Use before adding pages to know valid option values.",
      inputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string", description: "Database ID" },
          property_name: { type: "string", description: "Name of the select, multi_select, or status property" },
        },
        required: ["database_id", "property_name"],
      },
      outputSchema: {
        type: "object",
        properties: {
          database_id: { type: "string" },
          property_name: { type: "string" },
          property_type: { type: "string" },
          options: { type: "array", items: { type: "object" } },
          option_count: { type: "number" },
        },
        required: ["database_id", "property_name", "options"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];

  // ============ Helpers ============

  async function fetchDatabase(database_id: string): Promise<Record<string, unknown>> {
    return logger.time("tool.db_props.fetch_database", () =>
      client.get<Record<string, unknown>>(`/databases/${database_id}`)
    , { tool: "database_properties", database_id }) as Promise<Record<string, unknown>>;
  }

  async function updateDatabaseProperty(database_id: string, property_name: string, schema: Record<string, unknown>) {
    return logger.time("tool.db_props.update", () =>
      client.patch(`/databases/${database_id}`, { properties: { [property_name]: schema } })
    , { tool: "database_properties", database_id, property_name });
  }

  // ============ Handlers ============

  const handlers: Record<string, ToolHandler> = {
    add_select_option: async (args) => {
      const params = AddSelectOptionSchema.parse(args);
      const db = await fetchDatabase(params.database_id);
      const props = db.properties as Record<string, Record<string, unknown>>;
      const prop = props[params.property_name];
      if (!prop) throw new Error(`Property '${params.property_name}' not found`);

      const sel = prop.select as { options?: Array<{ name: string; color?: string }> } | undefined;
      const existing = sel?.options || [];
      const newOptions = [...existing, { name: params.option_name, color: params.color }];

      await updateDatabaseProperty(params.database_id, params.property_name, {
        select: { options: newOptions },
      });

      const structured = { database_id: params.database_id, property_name: params.property_name, options: newOptions };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    add_multi_select_option: async (args) => {
      const params = AddMultiSelectOptionSchema.parse(args);
      const db = await fetchDatabase(params.database_id);
      const props = db.properties as Record<string, Record<string, unknown>>;
      const prop = props[params.property_name];
      if (!prop) throw new Error(`Property '${params.property_name}' not found`);

      const ms = prop.multi_select as { options?: Array<{ name: string; color?: string }> } | undefined;
      const existing = ms?.options || [];
      const newOptions = [...existing, { name: params.option_name, color: params.color }];

      await updateDatabaseProperty(params.database_id, params.property_name, {
        multi_select: { options: newOptions },
      });

      const structured = { database_id: params.database_id, property_name: params.property_name, options: newOptions };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    update_select_option: async (args) => {
      const params = UpdateSelectOptionSchema.parse(args);
      const db = await fetchDatabase(params.database_id);
      const props = db.properties as Record<string, Record<string, unknown>>;
      const prop = props[params.property_name];
      if (!prop) throw new Error(`Property '${params.property_name}' not found`);

      const ptype = prop.type as string;
      const optionsContainer = prop[ptype] as { options?: Array<{ id?: string; name: string; color?: string }> } | undefined;
      const existing = optionsContainer?.options || [];

      const updated = existing.map((o) => {
        if (o.name === params.old_option_name) {
          return {
            ...o,
            name: params.new_option_name ?? o.name,
            color: params.new_color ?? o.color,
          };
        }
        return o;
      });

      await updateDatabaseProperty(params.database_id, params.property_name, {
        [ptype]: { options: updated },
      });

      const structured = { database_id: params.database_id, property_name: params.property_name, options: updated };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    get_property_config: async (args) => {
      const params = GetPropertyConfigSchema.parse(args);
      const db = await fetchDatabase(params.database_id);
      const props = db.properties as Record<string, Record<string, unknown>>;
      const prop = props[params.property_name];
      if (!prop) throw new Error(`Property '${params.property_name}' not found`);

      const ptype = prop.type as string;
      const structured = {
        database_id: params.database_id,
        property_name: params.property_name,
        property_id: prop.id,
        type: ptype,
        config: prop[ptype],
        full_property: prop,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    set_number_format: async (args) => {
      const params = SetNumberFormatSchema.parse(args);
      await updateDatabaseProperty(params.database_id, params.property_name, {
        number: { format: params.format },
      });
      const structured = { database_id: params.database_id, property_name: params.property_name, format: params.format };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    add_status_option: async (args) => {
      const params = AddStatusOptionSchema.parse(args);
      const db = await fetchDatabase(params.database_id);
      const props = db.properties as Record<string, Record<string, unknown>>;
      const prop = props[params.property_name];
      if (!prop) throw new Error(`Property '${params.property_name}' not found`);

      const st = prop.status as {
        options?: Array<{ id?: string; name: string; color?: string }>;
        groups?: Array<{ id?: string; name: string; color?: string; option_ids?: string[] }>;
      } | undefined;

      const existingOptions = st?.options || [];
      const existingGroups = st?.groups || [];
      const newOption = { name: params.option_name, color: params.color };
      const updatedOptions = [...existingOptions, newOption];

      // If group_name specified, add to that group (by name)
      const updatedGroups = existingGroups.map((g) => {
        if (params.group_name && g.name === params.group_name) {
          return { ...g, option_ids: [...(g.option_ids || []), `__new__${params.option_name}`] };
        }
        return g;
      });

      await updateDatabaseProperty(params.database_id, params.property_name, {
        status: { options: updatedOptions, groups: updatedGroups },
      });

      const structured = { database_id: params.database_id, property_name: params.property_name, options: updatedOptions };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    update_formula_property: async (args) => {
      const params = UpdateFormulaPropertySchema.parse(args);
      await updateDatabaseProperty(params.database_id, params.property_name, {
        formula: { expression: params.expression },
      });
      const structured = { database_id: params.database_id, property_name: params.property_name, expression: params.expression };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },

    list_property_options: async (args) => {
      const params = ListPropertyOptionsSchema.parse(args);
      const db = await fetchDatabase(params.database_id);
      const props = db.properties as Record<string, Record<string, unknown>>;
      const prop = props[params.property_name];
      if (!prop) throw new Error(`Property '${params.property_name}' not found`);

      const ptype = prop.type as string;
      let options: unknown[] = [];

      if (ptype === "select") {
        const sel = prop.select as { options?: unknown[] } | undefined;
        options = sel?.options || [];
      } else if (ptype === "multi_select") {
        const ms = prop.multi_select as { options?: unknown[] } | undefined;
        options = ms?.options || [];
      } else if (ptype === "status") {
        const st = prop.status as { options?: unknown[] } | undefined;
        options = st?.options || [];
      } else {
        throw new Error(`Property '${params.property_name}' is type '${ptype}', not select/multi_select/status`);
      }

      const structured = {
        database_id: params.database_id,
        property_name: params.property_name,
        property_type: ptype,
        options,
        option_count: options.length,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
        structuredContent: structured,
      };
    },
  };

  return { tools, handlers };
}
