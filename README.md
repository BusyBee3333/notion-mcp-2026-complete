# Notion MCP Server — 2026 Complete

Production-quality MCP (Model Context Protocol) server for the Notion API v1. Implements 18 tools covering databases, pages, blocks, users, comments, and search.

## Features

- **18 tools** — complete coverage of Notion API v1
- **Circuit breaker** — auto-pauses on repeated failures, self-heals
- **Retry with exponential backoff + jitter** — survives transient errors
- **30-second request timeout** — never hangs indefinitely
- **Cursor pagination** — handles large datasets with Notion's `start_cursor`/`has_more` pattern
- **stdio + HTTP transport** — local and remote deployment
- **Structured logging** — JSON logs to stderr, never pollutes MCP protocol
- **Full TypeScript** — strict mode, ESM modules

## Setup

### 1. Get a Notion Integration Token

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Create a new integration
3. Copy the **Internal Integration Token** (starts with `secret_`)
4. Share your Notion pages/databases with the integration

### 2. Configure

```bash
cp .env.example .env
# Edit .env and set NOTION_API_KEY=secret_your_token_here
```

### 3. Build and Run

```bash
npm install
npm run build
NOTION_API_KEY=secret_... node dist/index.js
```

## Tools

### Database Tools
| Tool | Description |
|------|-------------|
| `list_databases` | Search for accessible databases |
| `get_database` | Get database schema and property definitions |
| `query_database` | Query database with filters and sorts |
| `create_database` | Create a new database in a parent page |

### Page Tools
| Tool | Description |
|------|-------------|
| `get_page` | Get page properties and metadata |
| `create_page` | Create page in database or as sub-page |
| `update_page` | Update page properties, icon, or cover |
| `archive_page` | Soft-delete a page |

### Block Tools
| Tool | Description |
|------|-------------|
| `get_block` | Get block content by ID |
| `append_blocks` | Append content blocks to a page |
| `get_block_children` | List child blocks of a page |
| `delete_block` | Permanently delete a block |

### User Tools
| Tool | Description |
|------|-------------|
| `get_user` | Get user profile by ID (or 'me') |
| `list_users` | List all workspace users |

### Other Tools
| Tool | Description |
|------|-------------|
| `search` | Search pages and databases by title |
| `create_comment` | Add comment to a page |
| `list_comments` | List comments on a page |
| `health_check` | Validate config, connectivity, and auth |

## Supported Block Types

`paragraph`, `heading_1`, `heading_2`, `heading_3`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle`, `code`, `quote`, `divider`, `callout`

## Claude Desktop Configuration

```json
{
  "mcpServers": {
    "notion": {
      "command": "node",
      "args": ["/path/to/notion-mcp-2026-complete/dist/index.js"],
      "env": {
        "NOTION_API_KEY": "secret_your_token_here"
      }
    }
  }
}
```

## HTTP Transport

For remote/production deployment:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3000 NOTION_API_KEY=secret_... node dist/index.js
```

Endpoints:
- `POST /mcp` — MCP protocol (creates new session if no `mcp-session-id` header)
- `GET /mcp` — SSE stream for server-initiated messages
- `DELETE /mcp` — Close session
- `GET /health` — Server health check

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NOTION_API_KEY` | ✅ | Notion integration token (`secret_...`) |
| `MCP_TRANSPORT` | ❌ | `stdio` (default) or `http` |
| `MCP_HTTP_PORT` | ❌ | HTTP port (default: 3000) |

## License

MIT
