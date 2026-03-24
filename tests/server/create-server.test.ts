import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { createServer, SERVER_INFO } from "../../src/server/create-server.js";

describe("createServer", () => {
  it("creates the shared MCP server without transport branching", () => {
    const server = createServer();
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const videoTool = tools.get_video_details as {
      annotations?: Record<string, unknown>;
      description?: string;
    };
    const playlistTool = tools.get_playlist as {
      annotations?: Record<string, unknown>;
      description?: string;
    };
    const channelTool = tools.get_channel as {
      annotations?: Record<string, unknown>;
      description?: string;
    };
    const transcriptTool = tools.get_transcript as {
      annotations?: Record<string, unknown>;
      description?: string;
    };
    const searchTool = tools.search_videos as {
      annotations?: Record<string, unknown>;
      description?: string;
    };

    expect(server).toBeInstanceOf(McpServer);
    expect(server).toBeTruthy();
    expect(server).toBeTypeOf("object");
    expect(server.isConnected()).toBe(false);
    expect(Object.keys(tools)).toEqual([
      "server_status",
      "get_video_details",
      "get_playlist",
      "get_channel",
      "get_transcript",
      "search_videos",
      "get_comments"
    ]);
    expect(videoTool.description).toContain("Fetch compact details");
    expect(videoTool.annotations).toEqual({ readOnlyHint: true });
    expect(playlistTool.description).toContain("Fetch compact details and playlist items");
    expect(playlistTool.annotations).toEqual({ readOnlyHint: true });
    expect(channelTool.description).toContain("channel");
    expect(channelTool.annotations).toEqual({ readOnlyHint: true });
    expect(transcriptTool.description).toContain("Fetch a public YouTube transcript");
    expect(transcriptTool.annotations).toEqual({ readOnlyHint: true });
    expect(searchTool.description).toContain("Search public YouTube videos");
    expect(searchTool.annotations).toEqual({ readOnlyHint: true });
    expect((server as unknown as { _registeredResources: Record<string, unknown> })._registeredResources).toEqual({});
    expect((server as unknown as { _registeredPrompts: Record<string, unknown> })._registeredPrompts).toEqual({});
    expect(SERVER_INFO).toEqual({
      name: "ytcp",
      version: "0.1.0"
    });
  });
});
