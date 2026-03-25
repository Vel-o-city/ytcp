# HTTP Transport (Remote Hosting)

ytcp ships a **Streamable HTTP transport** so you can host it on a server and connect any MCP client remotely — no Claude Desktop required.

## Starting the server

```bash
npm run live:http
```

Default endpoint: `http://127.0.0.1:3001/mcp`

## Configuration

All config is via environment variables:

```bash
YTCP_HTTP_HOST=0.0.0.0 \
YTCP_HTTP_PORT=3001 \
YTCP_HTTP_PATH=/mcp \
npm run live:http
```

| Variable | Default | Description |
|---|---|---|
| `YTCP_HTTP_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` to accept external connections. |
| `YTCP_HTTP_PORT` | `3001` | Port to listen on. |
| `YTCP_HTTP_PATH` | `/mcp` | URL path for the MCP endpoint. |

## Sessions

Each connecting client gets an isolated MCP session. Sessions are independent — tool calls from one client don't affect another. The server manages session lifecycle automatically.

## Connecting from Claude Desktop

To point Claude Desktop at a remote ytcp instance instead of a local one:

```json
{
  "mcpServers": {
    "ytcp": {
      "url": "http://your-server:3001/mcp"
    }
  }
}
```

## Connecting from other MCP clients

Any client that supports the MCP Streamable HTTP transport can connect:

```
POST http://your-server:3001/mcp
Content-Type: application/json
```

Follow the MCP protocol spec for session initialization and tool calls.

## Verifying the deployment

Run the built-in verifier against your HTTP server:

```bash
# Verify local HTTP server
npm run live:verify:http

# Verify both stdio and HTTP
npm run live:verify
```

The verifier connects as an MCP client, calls each tool with valid inputs, and confirms expected response shapes.

## Reverse proxy (production)

For production deployments, put ytcp behind a reverse proxy (nginx, Caddy, etc.) to handle TLS and access control:

**Caddy example:**
```
your-domain.com {
    reverse_proxy /mcp localhost:3001
}
```

**nginx example:**
```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
}
```

Disable response buffering — the streamable HTTP transport uses server-sent events and requires streaming to reach the client promptly.
