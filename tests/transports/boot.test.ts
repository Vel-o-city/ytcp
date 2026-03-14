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
    expect(rootExports.normalizeVideoRecord).toBeDefined();
    expect(rootExports.normalizeSearchPage).toBeDefined();
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
    const stdioResult = await tool.handler({
      video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
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
    const httpResult = await httpTool.handler({
      video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });

    expect(serverFactory).toHaveBeenCalledTimes(2);
    expect(stdioResult).toEqual(httpResult);
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
    expect(youtubeService.getVideo).toHaveBeenNthCalledWith(
      1,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(youtubeService.getVideo).toHaveBeenNthCalledWith(
      2,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );

    await httpRuntime.close();
    await stdioRuntime.close();
  });
});
