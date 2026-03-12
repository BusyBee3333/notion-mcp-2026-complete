// Shared TypeScript interfaces for Notion MCP server

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  outputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export type ToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

// Notion cursor pagination
export interface NotionPaginatedResponse<T> {
  object: "list";
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
  type?: string;
}

// Notion block types
export type BlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "toggle"
  | "code"
  | "quote"
  | "divider"
  | "callout"
  | "image"
  | "video"
  | "file"
  | "pdf"
  | "bookmark"
  | "child_page"
  | "child_database"
  | "embed"
  | "table_of_contents"
  | "breadcrumb"
  | "column_list"
  | "column"
  | "link_preview"
  | "synced_block"
  | "template"
  | "link_to_page"
  | "table"
  | "table_row"
  | "unsupported";
