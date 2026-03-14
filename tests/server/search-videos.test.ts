import { describe, expect, it, vi } from "vitest";

import {
  createFailureResult,
  createNotAvailableResult,
  createSuccessResult
} from "../../src/contracts/tool-result.js";
import { InvalidInputError } from "../../src/lib/mcp-errors.js";
import { createServer } from "../../src/server/create-server.js";

type RegisteredTool = {
  annotations?: Record<string, unknown>;
  description?: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

describe("search_videos tool", () => {
  it("registers a read-only search tool that can use an injected youtube service", async () => {
    const youtubeService = {
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
            thumbnails: [],
            isLive: false,
            isUpcoming: false
          }
        ]
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.search_videos;

    expect(tool).toBeDefined();
    expect(tool.description).toContain("Search public YouTube videos");
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    await expect(tool.handler({ query: "mcp server" })).resolves.toEqual(
      createSuccessResult({
        summary: 'Found 1 matching video result for "mcp server".',
        data: {
          query: "mcp server",
          pageSize: 1,
          results: [
            {
              kind: "video",
              id: "dQw4w9WgXcQ",
              canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              title: "Build an MCP Server",
              channelTitle: "Example Dev",
              thumbnails: [],
              isLive: false,
              isUpcoming: false
            }
          ]
        }
      })
    );
    expect(youtubeService.searchVideos).toHaveBeenCalledWith({
      query: "mcp server"
    });
  });

  it("returns actionable invalid-input failures for malformed search requests", async () => {
    const server = createServer({
      youtubeService: {
        searchVideos: vi.fn()
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.search_videos;

    await expect(tool.handler({ query: "   " })).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide a non-empty `query` string to search public YouTube videos."
        )
      )
    );
    await expect(tool.handler({ query: "mcp", maxResults: 99 })).resolves.toEqual(
      createFailureResult(
        new InvalidInputError("`maxResults` must be between 1 and 10.")
      )
    );
  });

  it("surfaces an explicit not-available result when no search service is configured", async () => {
    const server = createServer();
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.search_videos;

    await expect(tool.handler({ query: "mcp server" })).resolves.toEqual(
      createNotAvailableResult({
        summary: "YouTube search is not configured in this build yet.",
        reason: "search_service_unconfigured",
        data: {
          server: "ytcp"
        }
      })
    );
  });
});
