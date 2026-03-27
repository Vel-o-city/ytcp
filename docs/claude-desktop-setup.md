# Claude Desktop Setup

Connect Claude Desktop to ytcp for YouTube search, video details, transcripts, comments, playlists, and channel data -- all through natural conversation.

Run ytcp locally via stdio if you want a self-contained setup while hosted deployment is being finalized.

### Prerequisites

- [Claude Desktop](https://claude.ai/download) installed
- Node.js 18 or newer (`node --version` to check)

### Claude Desktop config file

**macOS**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows**
```
%APPDATA%\Claude\claude_desktop_config.json
```

## Local Setup

### Step 1 -- Clone and build

```bash
git clone https://github.com/nicobailey/ytcp
cd ytcp
npm install
npm run build
```

Note the absolute path to the folder -- you'll need it in the next step.

### Step 2 -- Register the server

Open your Claude Desktop config file and add the `ytcp` entry. Replace `/absolute/path/to/ytcp` with the real path:

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

### Why local is the current documented path

- **Development** -- test changes before deploying
- **Custom modifications** -- fork and extend the toolset
- **Stable setup** -- hosted connection instructions will be added after deployment is finalized

## Troubleshooting

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
