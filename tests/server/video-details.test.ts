import { describe, expect, it, vi } from "vitest";

import {
  createFailureResult,
  createSuccessResult
} from "../../src/contracts/tool-result.js";
import { InvalidInputError } from "../../src/lib/mcp-errors.js";
import { createServer } from "../../src/server/create-server.js";

type RegisteredTool = {
  annotations?: Record<string, unknown>;
  description?: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

describe("get_video_details tool", () => {
  it("registers a read-only video detail tool that can use an injected youtube service", async () => {
    const youtubeService = {
      getVideo: vi.fn().mockResolvedValue({
        kind: "video",
        id: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        source: "watch",
        title: "Build an MCP Server",
        description: "A practical walkthrough.",
        channelId: "UC123",
        channelTitle: "Example Dev",
        durationSeconds: 754,
        viewCount: 123456,
        likeCount: 7890,
        thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
        keywords: ["mcp", "typescript"],
        category: "Education",
        isFamilySafe: true,
        isUnlisted: false,
        isLive: false,
        isUpcoming: false,
        chapters: [
          {
            title: "Introduction",
            startTimeSeconds: 0,
            thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/chapter1.jpg"
          },
          {
            title: "Shared server wiring",
            startTimeSeconds: 120
          }
        ],
        startTimeSeconds: 43
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_video_details;

    expect(tool).toBeDefined();
    expect(tool.description).toContain("Fetch compact details");
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    await expect(
      tool.handler({
        video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43"
      })
    ).resolves.toEqual(
      createSuccessResult({
        summary: 'Loaded public video details for "Build an MCP Server".',
        data: {
          id: "dQw4w9WgXcQ",
          canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Build an MCP Server",
          description: "A practical walkthrough.",
          channelTitle: "Example Dev",
          durationSeconds: 754,
          viewCount: 123456,
          likeCount: 7890,
          thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
          keywords: ["mcp", "typescript"],
          category: "Education",
          isFamilySafe: true,
          isUnlisted: false,
          isLive: false,
          isUpcoming: false,
          chapters: [
            {
              title: "Introduction",
              startTimeSeconds: 0,
              thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/chapter1.jpg"
            },
            {
              title: "Shared server wiring",
              startTimeSeconds: 120
            }
          ],
          startTimeSeconds: 43
        }
      })
    );
    expect(youtubeService.getVideo).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43"
    );
  });

  it("returns actionable invalid-input failures for malformed video detail requests", async () => {
    const server = createServer({
      youtubeService: {
        getVideo: vi.fn()
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_video_details;

    await expect(tool.handler({})).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide a YouTube video URL or bare 11-character video ID in `video`."
        )
      )
    );
    await expect(tool.handler({ video: "   " })).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide a YouTube video URL or bare 11-character video ID in `video`."
        )
      )
    );
    await expect(tool.handler({ video: 42 })).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide a YouTube video URL or bare 11-character video ID in `video`."
        )
      )
    );
  });

  it("keeps the video detail payload compact for long descriptions and omits internal fields", async () => {
    const server = createServer({
      youtubeService: {
        getVideo: vi.fn().mockResolvedValue({
          kind: "video",
          id: "dQw4w9WgXcQ",
          canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          source: "id",
          title: "Long-form walkthrough",
          description: "A".repeat(620),
          channelId: "UC123",
          thumbnails: [],
          isLive: false,
          isUpcoming: false
        })
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_video_details;
    const result = (await tool.handler({
      video: "dQw4w9WgXcQ"
    })) as {
      structuredContent: {
        status: string;
        data: Record<string, unknown>;
      };
    };

    expect(result.structuredContent.status).toBe("ok");
    expect(result.structuredContent.data).toMatchObject({
      id: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Long-form walkthrough",
      isLive: false,
      isUpcoming: false,
      chapters: []
    });
    expect(result.structuredContent.data.description).toHaveLength(600);
    expect(result.structuredContent.data.description).toMatch(/\.\.\.$/);
    expect(result.structuredContent.data).not.toHaveProperty("source");
    expect(result.structuredContent.data).not.toHaveProperty("channelId");
  });
});
