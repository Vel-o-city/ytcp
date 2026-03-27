# Self-Hosting on Fly.io

Deploy your own ytcp instance on Fly.io. The free tier is sufficient for personal use.

## Prerequisites

- A [Fly.io](https://fly.io) account (free tier works)
- `flyctl` CLI installed:
  ```bash
  curl -L https://fly.io/install.sh | sh
  ```
- Authenticated:
  ```bash
  fly auth login
  ```

## Deploy

```bash
# 1. Fork and clone the repo
git clone https://github.com/YOUR_USERNAME/ytcp.git
cd ytcp

# 2. Launch on Fly.io (creates app, picks region)
fly launch --no-deploy

# 3. Deploy
fly deploy

# 4. Verify health
curl https://YOUR_APP.fly.dev/health
# Expected: {"status":"ok","uptime":N}
```

`fly launch` detects the existing `fly.toml` and `Dockerfile` automatically. Pick a region close to you when prompted.

## Verify with MCP Client

Once deployed, run the built-in verifier against your instance:

```bash
YTCP_HTTP_HOST=YOUR_APP.fly.dev YTCP_HTTP_PORT=443 npm run live:verify:http
```

Or point Claude Desktop at it:

```json
{
  "mcpServers": {
    "ytcp": {
      "type": "streamableHttp",
      "url": "https://YOUR_APP.fly.dev/mcp"
    }
  }
}
```

## Configuration

Environment variables are set in `fly.toml` or via `fly secrets set`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port (Fly.io sets this automatically) |
| `NODE_ENV` | `production` | Set in fly.toml |
| `YTCP_HTTP_PATH` | `/mcp` | MCP endpoint path |

The Dockerfile exposes port 3001 and `fly.toml` maps it as the internal port. No changes needed for a standard deployment.

## What's Included

The Docker image ships with everything needed for a production deployment:

- **In-memory TTL cache** -- 5 min for video/channel/search, 2 min for continuations
- **Request coalescing** -- concurrent identical requests share one upstream fetch
- **Per-IP rate limiting** -- 30 req/min, HTTP 429 on breach
- **Health check** at `/health` -- used by Fly.io for liveness monitoring
- **Non-root container user** -- runs as `app` for security

## Updating

Pull the latest changes and redeploy:

```bash
git pull origin main
fly deploy
```

## Resources

- [fly.toml](../fly.toml) -- deployment configuration
- [Dockerfile](../Dockerfile) -- multi-stage build
- [HTTP Transport docs](./http-transport.md) -- rate limiting and health check details
