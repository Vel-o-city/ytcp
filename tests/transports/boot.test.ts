import { PassThrough } from "node:stream";

import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import * as rootExports from "../../src/index.js";
import { createSuccessResult } from "../../src/contracts/tool-result.js";
import { createServer } from "../../src/server/create-server.js";
import {
  createStreamableHttpRuntime,
  type StreamableHttpTransport
} from "../../src/transports/http.js";
import { startStdioServer } from "../../src/transports/stdio.js";

type RegisteredTool = {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

class FakeStreamableHttpTransport implements StreamableHttpTransport {
  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;

  constructor(
    private readonly options: {
      sessionIdGenerator: () => string;
      onsessioninitialized?: (sessionId: string) => void;
      onsessionclosed?: (sessionId?: string) => void;
    }
  ) {}

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.options.onsessionclosed?.(this.sessionId);
    this.onclose?.();
  }

  async send(): Promise<void> {}

  async handleRequest(
    _req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown
  ): Promise<void> {
    if (!this.sessionId && parsedBody === initializePayload) {
      this.sessionId = this.options.sessionIdGenerator();
      this.options.onsessioninitialized?.(this.sessionId);
      res.setHeader("mcp-session-id", this.sessionId);
    }

    res.end(JSON.stringify({ ok: true }));
  }
}

function createInitializeRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "vitest",
        version: "1.0.0"
      }
    }
  };
}

const initializePayload = createInitializeRequest();

function createMockRequest(): IncomingMessage {
  return {
    method: "POST",
    url: "/mcp",
    headers: {}
  } as IncomingMessage;
}

function createMockResponse(): ServerResponse {
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 200,
    headersSent: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return response;
    },
    end() {
      response.headersSent = true;
      return response;
    }
  };

  return response as unknown as ServerResponse;
}

describe("root transport boot surface", () => {
  it("re-exports the explicit transport bootstraps and shared youtube surface", () => {
    expect(rootExports.startStdioServer).toBe(startStdioServer);
    expect(rootExports.startHttpServer).toBeDefined();
    expect(rootExports.createStreamableHttpRuntime).toBe(
      createStreamableHttpRuntime
    );
    expect(rootExports.createYouTubeService).toBeDefined();
    expect(rootExports.createTranscriptFallbackAdapter).toBeDefined();
    expect(rootExports.normalizePlaylistRecord).toBeDefined();
    expect(rootExports.normalizeTranscriptRecord).toBeDefined();
    expect(rootExports.formatTranscriptText).toBeDefined();
    expect(rootExports.normalizeVideoRecord).toBeDefined();
    expect(rootExports.normalizeSearchPage).toBeDefined();
    expect(rootExports.DEFAULT_PLAYLIST_RESULTS).toBe(10);
    expect(rootExports.DEFAULT_SEARCH_RESULTS).toBe(5);
  });

  it("boots stdio and hosted HTTP from the same shared server factory contract", async () => {
    const createdServers: ReturnType<typeof createServer>[] = [];
    const youtubeService = {
      getVideo: vi.fn().mockResolvedValue({
        kind: "video",
        id: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        source: "watch",
        title: "Build an MCP Server",
        description: "Practical walkthrough",
        channelTitle: "Example Dev",
        category: "Education",
        isFamilySafe: true,
        thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
        isLive: false,
        isUpcoming: false,
        chapters: [
          {
            title: "Introduction",
            startTimeSeconds: 0
          }
        ]
      }),
      getPlaylist: vi.fn().mockResolvedValue({
        kind: "playlist",
        id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        canonicalUrl:
          "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        source: "playlist",
        title: "Song Queue",
        channelTitle: "Google Developers",
        itemCountText: "12 videos",
        thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
        pageSize: 1,
        nextPageToken: "playlist-page-1",
        items: [
          {
            kind: "video",
            id: "dQw4w9WgXcQ",
            canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title: "Video one",
            channelTitle: "Google Developers",
            durationText: "12:34",
            durationSeconds: 754,
            position: 1,
            thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
            isPlayable: true,
            isLive: false,
            isUpcoming: false
          }
        ]
      }),
      getTranscript: vi.fn().mockResolvedValue({
        kind: "transcript",
        videoId: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        source: "watch",
        title: "Build an MCP Server",
        channelTitle: "Example Dev",
        language: "English",
        includeTimestamps: true,
        retrievalMethod: "fallback",
        languages: [
          {
            label: "English",
            languageCode: "en",
            isSelected: true
          }
        ],
        segmentCount: 1,
        text: "0:00 Hello world",
        segments: [
          {
            startMs: 0,
            endMs: 1000,
            startTimeSeconds: 0,
            endTimeSeconds: 1,
            startTimeText: "0:00",
            text: "Hello world"
          }
        ]
      }),
      searchVideos: vi.fn().mockResolvedValue({
        query: "mcp server",
        pageSize: 1,
        results: [
          {
            kind: "video",
            id: "dQw4w9WgXcQ",
            canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title: "Build an MCP Server",
            channelTitle: "Example Dev",
            thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
            isLive: false,
            isUpcoming: false
          }
        ]
      }),
      getChannel: vi.fn().mockResolvedValue({
        kind: "channel",
        canonicalUrl: "https://www.youtube.com/@exampledev",
        source: "handle",
        id: "UCBJycsmduvYEL83R_U4JriQ",
        handle: "@ExampleDev",
        title: "Example Dev",
        description: "Building things in public.",
        subscriberCountText: "50K subscribers",
        videoCountText: "120 videos",
        thumbnails: ["https://yt3.ggpht.com/exampledev.jpg"],
        recentVideos: [
          {
            id: "dQw4w9WgXcQ",
            canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title: "How to Build an MCP Server",
            thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
            publishedText: "1 week ago",
            durationText: "18:42",
            viewCountText: "12K views"
          }
        ]
      })
    };
    const serverFactory = vi.fn(() => {
      const server = createServer({ youtubeService });
      createdServers.push(server);
      return server;
    });
    const stdioRuntime = await startStdioServer({
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      serverFactory
    });
    const httpRuntime = createStreamableHttpRuntime({
      serverFactory,
      sessionIdGenerator: () => "boot-session",
      transportFactory: options => new FakeStreamableHttpTransport(options)
    });

    const tool = (
      stdioRuntime.server as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.get_video_details;
    const transcriptTool = (
      stdioRuntime.server as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.get_transcript;
    const playlistTool = (
      stdioRuntime.server as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.get_playlist;
    const channelTool = (
      stdioRuntime.server as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.get_channel;
    const stdioResult = await tool.handler({
      video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
    const stdioPlaylistResult = await playlistTool.handler({
      playlist: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      maxResults: 1
    });
    const stdioTranscriptResult = await transcriptTool.handler({
      video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      includeTimestamps: true
    });
    const stdioChannelResult = await channelTool.handler({
      channel: "https://www.youtube.com/@exampledev"
    });

    await httpRuntime.handleRequest(
      createMockRequest(),
      createMockResponse(),
      initializePayload
    );
    const httpTool = (
      createdServers[1] as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.get_video_details;
    const httpTranscriptTool = (
      createdServers[1] as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.get_transcript;
    const httpPlaylistTool = (
      createdServers[1] as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.get_playlist;
    const httpChannelTool = (
      createdServers[1] as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.get_channel;
    const httpResult = await httpTool.handler({
      video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
    const httpPlaylistResult = await httpPlaylistTool.handler({
      playlist: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      maxResults: 1
    });
    const httpTranscriptResult = await httpTranscriptTool.handler({
      video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      includeTimestamps: true
    });
    const httpChannelResult = await httpChannelTool.handler({
      channel: "https://www.youtube.com/@exampledev"
    });

    expect(serverFactory).toHaveBeenCalledTimes(2);
    expect(stdioResult).toEqual(httpResult);
    expect(stdioPlaylistResult).toEqual(httpPlaylistResult);
    expect(stdioTranscriptResult).toEqual(httpTranscriptResult);
    expect(stdioChannelResult).toEqual(httpChannelResult);
    expect(httpResult).toEqual(
      createSuccessResult({
        summary: 'Loaded public video details for "Build an MCP Server".',
        data: {
          id: "dQw4w9WgXcQ",
          canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Build an MCP Server",
          description: "Practical walkthrough",
          channelTitle: "Example Dev",
          category: "Education",
          isFamilySafe: true,
          thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
          isLive: false,
          isUpcoming: false,
          chapters: [
            {
              title: "Introduction",
              startTimeSeconds: 0
            }
          ]
        }
      })
    );
    expect(httpTranscriptResult).toEqual(
      createSuccessResult({
        summary:
          'Loaded public transcript for "Build an MCP Server" in English. Fallback extractor used.',
        data: {
          id: "dQw4w9WgXcQ",
          canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Build an MCP Server",
          channelTitle: "Example Dev",
          language: "English",
          includeTimestamps: true,
          retrievalMethod: "fallback",
          languages: [
            {
              label: "English",
              languageCode: "en",
              isSelected: true
            }
          ],
          segmentCount: 1,
          text: "0:00 Hello world",
          segments: [
            {
              startTimeText: "0:00",
              startTimeSeconds: 0,
              endTimeSeconds: 1,
              text: "Hello world"
            }
          ]
        }
      })
    );
    expect(httpPlaylistResult).toEqual(
      createSuccessResult({
        summary:
          'Loaded public playlist details for "Song Queue" with 1 item. More are available.',
        data: {
          id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
          canonicalUrl:
            "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
          title: "Song Queue",
          channelTitle: "Google Developers",
          itemCountText: "12 videos",
          thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
          pageSize: 1,
          nextPageToken: "playlist-page-1",
          items: [
            {
              kind: "video",
              id: "dQw4w9WgXcQ",
              canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              title: "Video one",
              channelTitle: "Google Developers",
              durationText: "12:34",
              position: 1,
              thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
              isPlayable: true,
              isLive: false,
              isUpcoming: false
            }
          ]
        }
      })
    );
    expect(httpChannelResult).toEqual(
      createSuccessResult({
        summary: 'Loaded public channel metadata for "Example Dev".',
        data: {
          id: "UCBJycsmduvYEL83R_U4JriQ",
          canonicalUrl: "https://www.youtube.com/@exampledev",
          handle: "@ExampleDev",
          title: "Example Dev",
          description: "Building things in public.",
          subscriberCountText: "50K subscribers",
          videoCountText: "120 videos",
          thumbnails: ["https://yt3.ggpht.com/exampledev.jpg"],
          recentVideos: [
            {
              id: "dQw4w9WgXcQ",
              canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              title: "How to Build an MCP Server",
              thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
              publishedText: "1 week ago",
              durationText: "18:42",
              viewCountText: "12K views"
            }
          ]
        }
      })
    );
    expect(youtubeService.getVideo).toHaveBeenNthCalledWith(
      1,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(youtubeService.getVideo).toHaveBeenNthCalledWith(
      2,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(youtubeService.getPlaylist).toHaveBeenNthCalledWith(1, {
      playlist: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      maxResults: 1
    });
    expect(youtubeService.getPlaylist).toHaveBeenNthCalledWith(2, {
      playlist: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      maxResults: 1
    });
    expect(youtubeService.getTranscript).toHaveBeenNthCalledWith(
      1,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      {
        includeTimestamps: true
      }
    );
    expect(youtubeService.getTranscript).toHaveBeenNthCalledWith(
      2,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      {
        includeTimestamps: true
      }
    );
    expect(youtubeService.getChannel).toHaveBeenNthCalledWith(
      1,
      "https://www.youtube.com/@exampledev"
    );
    expect(youtubeService.getChannel).toHaveBeenNthCalledWith(
      2,
      "https://www.youtube.com/@exampledev"
    );

    // Prove get_channel is exposed from the same shared server factory for both transports
    expect(channelTool).toBeDefined();
    expect(httpChannelTool).toBeDefined();
    expect(typeof channelTool.handler).toBe("function");
    expect(typeof httpChannelTool.handler).toBe("function");

    await httpRuntime.close();
    await stdioRuntime.close();
  });
});
