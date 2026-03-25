# ytcp — YouTube MCP Server

A **no-API-key** MCP server that gives Claude (and any MCP client) deep YouTube access: search, transcripts, comments, playlists, channels, and more.

Works locally over stdio or remotely over HTTP. No YouTube Data API key needed — ever.

---

## What you can do

Once connected, Claude can work with YouTube like a research tool:

> *"Find the best talks on Rust async programming from the last year"*

> *"Get the full transcript of this video and summarize the key steps"*

> *"What are people saying in the comments on this video? Show me the top threads."*

> *"List all videos in this playlist and tell me which ones cover database indexing"*

> *"What has this channel published recently? Give me an overview."*

> *"Walk me through this tutorial step by step — pull the transcript and turn it into a checklist"*

---

## Quick start (Claude Desktop — stdio)

**1. Install**

```bash
git clone https://github.com/yourusername/ytcp
cd ytcp
npm install
npm run build
```

**2. Add to Claude Desktop config**

Open `~/Library/Application Support/Claude/claude_desktop_config.json` and add:

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

Restart Claude Desktop. You're done — ask Claude anything about YouTube.

---

## Remote hosting (HTTP transport)

Run ytcp on a server so any MCP client can connect:

```bash
# Start HTTP server
YTCP_HTTP_HOST=0.0.0.0 YTCP_HTTP_PORT=3001 npm run live:http
```

The MCP endpoint is available at `http://your-host:3001/mcp`.

Connect from any MCP client that supports streamable HTTP transport.

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `YTCP_HTTP_HOST` | `127.0.0.1` | Bind address |
| `YTCP_HTTP_PORT` | `3001` | Port |
| `YTCP_HTTP_PATH` | `/mcp` | Endpoint path |

---

## Tools

### `search_videos`

Search YouTube with filters — no API key, no quota limits.

```
query: "rust async programming"
uploadDate: year          # all / hour / today / week / month / year
duration: medium          # all / short / medium / long
sortBy: view_count        # relevance / rating / upload_date / view_count
features: subtitles       # hd / subtitles / creative_commons / live / 4k / hdr
```

Returns up to 10 results per page with a `nextPageToken` for pagination.

---

### `get_video_details`

Fetch full metadata for any public video — by URL or ID.

```
input: "https://youtube.com/watch?v=dQw4w9WgXcQ"
```

Returns: title, description, channel, duration, view count, likes, thumbnails, keywords, category, chapters with timestamps.

Accepts every URL format YouTube supports: `youtube.com/watch`, `youtu.be/`, `/shorts/`, `/live/`, `/embed/`, music.youtube.com, and bare 11-character IDs.

---

### `get_transcript`

Pull the full spoken transcript of any video with captions.

```
input: "dQw4w9WgXcQ"
language: "en"             # optional — defaults to video's primary language
includeTimestamps: true    # optional — include [0:00] markers
```

Uses a dual-extraction strategy — primary Innertube API with an InnerTube `/player` fallback — so transcripts work even when YouTube's primary endpoint is flaky.

**What you can build on top of this:**
- Step-by-step guides from tutorial videos
- Searchable lecture notes from long talks
- Quote extraction from interviews
- Translation-ready raw text

---

### `get_comments`

Fetch comment threads with like counts, reply counts, and pin status.

```
input: "dQw4w9WgXcQ"
sortBy: top_comments       # top_comments / new_comments
maxResults: 20             # up to 50 per page
```

Returns thread metadata: text, author, like count, reply count, whether pinned.

---

### `get_playlist`

Browse playlist contents with video metadata and playability status.

```
input: "https://youtube.com/playlist?list=PLxxxxxxxx"
maxResults: 10             # up to 25 per page
```

Accepts playlist URLs, `watch?v=...&list=...` URLs, and bare playlist IDs.

---

### `get_channel`

Channel overview with subscriber count, video count, total views, and recent uploads.

```
input: "@mkbhd"            # handle, channel ID, or canonical URL
```

---

### `server_status`

Confirm the server is running and which transports are active.

---

## Resources

ytcp also exposes MCP **resource templates** for clients that prefer the resource interface:

| URI | Returns |
|---|---|
| `youtube://video/{videoId}` | Video metadata |
| `youtube://transcript/{videoId}` | Full transcript |
| `youtube://channel/{channelId}` | Channel metadata |

---

## Prompts

Two built-in **reusable prompts** guide Claude through common workflows:

**`extract_transcript_workflow`** — Turn any video into a structured output.

```
videoId: "dQw4w9WgXcQ"
outputFormat: steps        # steps / bullets / summary
```

Fetches the transcript, identifies the main topic, extracts the key steps or points, and formats them cleanly. Falls back to title/description/chapters if no transcript is available.

**`analyze_video`** — Generate a structured analysis of any video.

```
videoId: "dQw4w9WgXcQ"
focus: technical           # general / technical / sentiment / summary
```

Produces: content summary, key topics, target audience assessment.

---

## No API key — here's how

ytcp uses [`youtubei.js`](https://github.com/LuanRT/YouTube.js), a reverse-engineered implementation of Google's internal Innertube API — the same API the YouTube web app uses. No YouTube Data API key, no OAuth, no external binaries required.

This means:
- No quota limits from Google
- No credential management
- Works out of the box on any machine with Node.js 18+

---

## Requirements

- Node.js 18+
- npm

---

## Docs

- [Claude Desktop setup](docs/claude-desktop-setup.md) — step-by-step local setup
- [HTTP transport](docs/http-transport.md) — remote hosting, reverse proxy, session details
- [Example workflows](docs/examples.md) — real prompts and what they do

---

## Development

```bash
npm run dev              # Run with tsx (no build step)
npm test                 # Run unit tests
npm run live:stdio       # Start stdio server
npm run live:http        # Start HTTP server
npm run live:verify      # Run live MCP verifier against both transports
```

---

## License

MIT
