import { describe, expect, it, vi } from "vitest";

import {
  createFailureResult,
  createNotAvailableResult,
  createSuccessResult
} from "../../src/contracts/tool-result.js";
import { InvalidInputError, NotAvailableError } from "../../src/lib/mcp-errors.js";
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
        estimatedResults: 42,
        refinements: ["mcp", "typescript mcp"],
        nextPageToken: "page-2",
        results: [
          {
            kind: "video",
            id: "dQw4w9WgXcQ",
            canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title: "Build an MCP Server",
            channelId: "UC123",
            channelTitle: "Example Dev",
            durationSeconds: 754,
            thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
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
    await expect(
      tool.handler({
        query: "mcp server",
        maxResults: 3,
        filters: {
          uploadDate: "week",
          features: ["hd", "hd"]
        }
      })
    ).resolves.toEqual(
      createSuccessResult({
        summary: 'Showing 1 video match for "mcp server". More are available.',
        data: {
          query: "mcp server",
          pageSize: 1,
          estimatedResults: 42,
          nextPageToken: "page-2",
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
        }
      })
    );
    expect(youtubeService.searchVideos).toHaveBeenCalledWith({
      query: "mcp server",
      maxResults: 3,
      filters: {
        uploadDate: "week",
        features: ["hd"]
      }
    });
  });

  it("passes follow-up page tokens through while keeping the tool payload compact", async () => {
    const youtubeService = {
      searchVideos: vi.fn().mockResolvedValue({
        query: "mcp server",
        pageSize: 1,
        results: [
          {
            kind: "video",
            id: "9bZkp7q19f0",
            canonicalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
            title: "Video two",
            channelId: "UC999",
            durationSeconds: 245,
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

    await expect(
      tool.handler({
        pageToken: "page-1",
        maxResults: 2
      })
    ).resolves.toEqual(
      createSuccessResult({
        summary: 'Showing 1 video match for "mcp server".',
        data: {
          query: "mcp server",
          pageSize: 1,
          results: [
            {
              kind: "video",
              id: "9bZkp7q19f0",
              canonicalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
              title: "Video two",
              isLive: false,
              isUpcoming: false
            }
          ]
        }
      })
    );
    expect(youtubeService.searchVideos).toHaveBeenCalledWith({
      pageToken: "page-1",
      maxResults: 2
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
    await expect(tool.handler({})).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide either a `query` string or a `pageToken` string to search public YouTube videos."
        )
      )
    );
    await expect(tool.handler({ query: "mcp", maxResults: 99 })).resolves.toEqual(
      createFailureResult(
        new InvalidInputError("`maxResults` must be between 1 and 10.")
      )
    );
  });

  it("rejects unsupported filter values before the service is called", async () => {
    const youtubeService = {
      searchVideos: vi.fn()
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.search_videos;

    await expect(
      tool.handler({
        query: "mcp server",
        filters: {
          duration: "very-long"
        }
      })
    ).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Unsupported `filters.duration` value. Use all, short, medium, or long."
        )
      )
    );
    expect(youtubeService.searchVideos).not.toHaveBeenCalled();
  });

  it("rejects follow-up requests that mix pageToken and filters", async () => {
    const youtubeService = {
      searchVideos: vi.fn()
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.search_videos;

    await expect(
      tool.handler({
        pageToken: "page-1",
        filters: {
          uploadDate: "week"
        }
      })
    ).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Follow-up search page requests cannot include `filters`; use the returned `pageToken` by itself."
        )
      )
    );
    expect(youtubeService.searchVideos).not.toHaveBeenCalled();
  });

  it("returns a not-available result when a follow-up page token has expired", async () => {
    const youtubeService = {
      searchVideos: vi.fn().mockRejectedValue(
        new NotAvailableError(
          "This YouTube search page token is missing or expired. Run the search again to continue.",
          {
            cause: "search_page_token_expired"
          }
        )
      )
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.search_videos;

    await expect(
      tool.handler({
        pageToken: "expired-token"
      })
    ).resolves.toEqual(
      createNotAvailableResult({
        summary:
          "This YouTube search page token is missing or expired. Run the search again to continue.",
        reason: "search_page_token_expired"
      })
    );
  });
});
