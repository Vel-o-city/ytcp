# HTTP Transport

ytcp ships a **Streamable HTTP transport** so you can connect any MCP client remotely -- no local install required.

## Hosted Endpoint

A public hosted instance is available at:

```
https://ytcp.fly.dev/mcp
```

- No API key or authentication required -- the service is read-only and public
- Requests are rate-limited to 30 per minute per IP (see [Rate Limiting](#rate-limiting))
- Repeated lookups benefit from in-memory caching (5 min TTL for video/channel/search, 2 min for continuations)
- Health check: `GET https://ytcp.fly.dev/health` returns `{"status":"ok","uptime":N}`

## Rate Limiting

The HTTP transport enforces a per-IP rate limit to keep the service available for everyone:

- **30 requests** per 60-second sliding window per client IP
- Exceeding the limit returns HTTP **429** with a `Retry-After` header indicating how many seconds to wait
- Claude Desktop sessions naturally pace well within this limit during normal use
- Rate limiting applies only to the HTTP transport; stdio is unaffected
- The `/health` endpoint is not rate-limited

## Health Check

```
GET /health
```

Returns:

```json
{"status":"ok","uptime":123}
```

- `uptime` is the server uptime in seconds
- Used by Fly.io for liveness monitoring (checked every 30s)
- Not rate-limited

## Local Development

### Starting the server

```bash
npm run live:http
```

Default endpoint: `http://127.0.0.1:3001/mcp`

### Configuration

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

### Sessions

Each connecting client gets an isolated MCP session. Sessions are independent -- tool calls from one client don't affect another. The server manages session lifecycle automatically.

## Connecting from Claude Desktop

To point Claude Desktop at the hosted instance (or your own deployment):

```json
{
  "mcpServers": {
    "ytcp": {
      "type": "streamableHttp",
      "url": "https://ytcp.fly.dev/mcp"
    }
  }
}
```

See [Claude Desktop Setup](./claude-desktop-setup.md) for the full guide.

## Connecting from other MCP clients

Any client that supports the MCP Streamable HTTP transport can connect:

```
POST https://ytcp.fly.dev/mcp
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

For custom deployments behind a reverse proxy (nginx, Caddy, etc.) to handle TLS and access control:

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

Disable response buffering -- the streamable HTTP transport uses server-sent events and requires streaming to reach the client promptly.
