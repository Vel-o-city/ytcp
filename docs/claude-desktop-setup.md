# Claude Desktop Setup

Connect Claude Desktop to ytcp for YouTube search, video details, transcripts, comments, playlists, and channel data -- all through natural conversation.

## Remote Connection (Recommended)

The fastest way to get started. No install, no build, no API key.

Open your Claude Desktop config file:

**macOS**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows**
```
%APPDATA%\Claude\claude_desktop_config.json
```

Add the `ytcp` entry inside `mcpServers`:

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

Restart Claude Desktop. That's it -- no local install required.

## Local Setup (Alternative)

Run ytcp locally via stdio if you need offline access, want to develop, or prefer a self-contained setup.

### Prerequisites

- [Claude Desktop](https://claude.ai/download) installed
- Node.js 18 or newer (`node --version` to check)

### Step 1 -- Clone and build

```bash
git clone https://github.com/nicobailey/ytcp
cd ytcp
npm install
npm run build
```

Note the absolute path to the folder -- you'll need it in the next step.

### Step 2 -- Register the server

Open your Claude Desktop config file (same paths as above) and add the `ytcp` entry. Replace `/absolute/path/to/ytcp` with the real path:

```json
{
  "mcpServers": {
    "ytcp": {
      "command": "node",
      "args": ["/absolute/path/to/ytcp/build/transports/stdio.js"]
    }
  }
}
```

If you already have other MCP servers configured, just add the `"ytcp"` block alongside them.

### Step 3 -- Restart Claude Desktop

Fully quit and reopen Claude Desktop. The server starts automatically when Claude launches.

### Step 4 -- Verify it's working

In Claude, ask:

> *"Check the ytcp server status"*

Claude should call the `server_status` tool and confirm the server is running.

### When to prefer local

- **Offline use** -- works without internet (cached data only)
- **Development** -- test changes before deploying
- **Custom modifications** -- fork and extend the toolset

## Troubleshooting

**429 "Rate limit exceeded"**
- You're sending too many requests. Wait for the duration indicated in the Retry-After header, then retry. Claude Desktop sessions normally stay well within the 30 req/min limit.

**Connection refused or timeout (remote)**
- Check that the hosted service is running: `curl https://ytcp.fly.dev/health` should return `{"status":"ok","uptime":N}`
- If the service is temporarily down, try again in a few minutes.

**Claude doesn't see the server (local)**
- Make sure the path in `args` is absolute, not relative
- Confirm `npm run build` completed without errors (`build/` folder should exist)
- Check that Node.js 18+ is in your PATH: `node --version`

**"Cannot find module" error (local)**
- Re-run `npm install && npm run build`
- Confirm the path points to `build/transports/stdio.js`, not `src/`

**Server connects but tools fail**
- YouTube access requires an internet connection
- Some transcripts may be unavailable due to YouTube restrictions (not all videos have captions)

## Getting the most out of it

Once connected, Claude has access to these tools automatically -- just ask naturally:

- *"Search YouTube for recent talks on LLM evaluation"*
- *"Get the transcript of [YouTube URL] and summarize the main points"*
- *"What are the top comments on this video?"*
- *"List all videos in this playlist"*
- *"Tell me about this channel: @lexfridman"*
