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

describe("get_channel tool", () => {
  it("registers a read-only channel tool with readOnlyHint: true", () => {
    const server = createServer({
      youtubeService: {
        getChannel: vi.fn()
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_channel;

    expect(tool).toBeDefined();
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    expect(tool.description).toContain("channel");
  });

  it("returns compact channel metadata for a handle URL request", async () => {
    const longDescription = "A".repeat(420);
    const youtubeService = {
      getChannel: vi.fn().mockResolvedValue({
        kind: "channel",
        canonicalUrl: "https://www.youtube.com/@mkbhd",
        source: "handle",
        id: "UCBJycsmduvYEL83R_U4JriQ",
        handle: "@MKBHD",
        title: "Marques Brownlee",
        description: longDescription,
        subscriberCountText: "18.4M subscribers",
        videoCountText: "1,234 videos",
        viewCountText: "3.2B views",
        thumbnails: ["https://yt3.ggpht.com/avatar.jpg"],
        recentVideos: [
          {
            id: "dQw4w9WgXcQ",
            canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title: "Latest Video",
            thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
            publishedText: "2 days ago",
            durationText: "10:30",
            viewCountText: "1.2M views"
          }
        ]
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_channel;

    await expect(
      tool.handler({ channel: "https://www.youtube.com/@mkbhd" })
    ).resolves.toEqual(
      createSuccessResult({
        summary: 'Loaded public channel metadata for "Marques Brownlee".',
        data: {
          id: "UCBJycsmduvYEL83R_U4JriQ",
          canonicalUrl: "https://www.youtube.com/@mkbhd",
          handle: "@MKBHD",
          title: "Marques Brownlee",
          description: `${"A".repeat(397)}...`,
          subscriberCountText: "18.4M subscribers",
          videoCountText: "1,234 videos",
          viewCountText: "3.2B views",
          thumbnails: ["https://yt3.ggpht.com/avatar.jpg"],
          recentVideos: [
            {
              id: "dQw4w9WgXcQ",
              canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              title: "Latest Video",
              thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
              publishedText: "2 days ago",
              durationText: "10:30",
              viewCountText: "1.2M views"
            }
          ]
        }
      })
    );
    expect(youtubeService.getChannel).toHaveBeenCalledWith(
      "https://www.youtube.com/@mkbhd"
    );
  });

  it("summary string contains 'Loaded public channel'", async () => {
    const youtubeService = {
      getChannel: vi.fn().mockResolvedValue({
        kind: "channel",
        canonicalUrl: "https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ",
        source: "channel",
        id: "UCBJycsmduvYEL83R_U4JriQ",
        thumbnails: [],
        recentVideos: []
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_channel;

    const result = (await tool.handler({ channel: "UCBJycsmduvYEL83R_U4JriQ" })) as {
      content: Array<{ text: string }>;
    };

    expect(result.content[0].text).toContain("Loaded public channel");
  });

  it("shaped data includes id, canonicalUrl, title, subscriberCountText, thumbnails, and recentVideos", async () => {
    const youtubeService = {
      getChannel: vi.fn().mockResolvedValue({
        kind: "channel",
        canonicalUrl: "https://www.youtube.com/@mkbhd",
        source: "handle",
        id: "UCBJycsmduvYEL83R_U4JriQ",
        title: "Marques Brownlee",
        subscriberCountText: "18.4M subscribers",
        thumbnails: ["https://yt3.ggpht.com/avatar.jpg"],
        recentVideos: []
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_channel;

    const result = (await tool.handler({ channel: "@mkbhd" })) as {
      structuredContent: { status: string; data: Record<string, unknown> };
    };

    expect(result.structuredContent.status).toBe("ok");
    expect(result.structuredContent.data).toMatchObject({
      id: "UCBJycsmduvYEL83R_U4JriQ",
      canonicalUrl: "https://www.youtube.com/@mkbhd",
      title: "Marques Brownlee",
      subscriberCountText: "18.4M subscribers",
      thumbnails: ["https://yt3.ggpht.com/avatar.jpg"],
      recentVideos: []
    });
  });

  it("description is truncated to MAX_CHANNEL_DESCRIPTION_LENGTH", async () => {
    const longDescription = "B".repeat(500);
    const youtubeService = {
      getChannel: vi.fn().mockResolvedValue({
        kind: "channel",
        canonicalUrl: "https://www.youtube.com/@test",
        source: "handle",
        title: "Test Channel",
        description: longDescription,
        thumbnails: [],
        recentVideos: []
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_channel;

    const result = (await tool.handler({ channel: "@test" })) as {
      structuredContent: { status: string; data: Record<string, unknown> };
    };

    expect(result.structuredContent.status).toBe("ok");
    const description = result.structuredContent.data.description as string;
    expect(description.length).toBeLessThanOrEqual(400);
    expect(description).toMatch(/\.\.\.$/);
  });

  it("source field is omitted from shaped output", async () => {
    const youtubeService = {
      getChannel: vi.fn().mockResolvedValue({
        kind: "channel",
        canonicalUrl: "https://www.youtube.com/@mkbhd",
        source: "handle",
        id: "UCBJycsmduvYEL83R_U4JriQ",
        thumbnails: [],
        recentVideos: []
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_channel;

    const result = (await tool.handler({ channel: "@mkbhd" })) as {
      structuredContent: { status: string; data: Record<string, unknown> };
    };

    expect(result.structuredContent.data).not.toHaveProperty("source");
    expect(result.structuredContent.data).not.toHaveProperty("kind");
  });

  it("recentVideos items include durationText but not durationSeconds", async () => {
    const youtubeService = {
      getChannel: vi.fn().mockResolvedValue({
        kind: "channel",
        canonicalUrl: "https://www.youtube.com/@mkbhd",
        source: "handle",
        thumbnails: [],
        recentVideos: [
          {
            id: "dQw4w9WgXcQ",
            canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title: "Test Video",
            thumbnails: [],
            durationText: "5:00",
            durationSeconds: 300
          }
        ]
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_channel;

    const result = (await tool.handler({ channel: "@mkbhd" })) as {
      structuredContent: { status: string; data: { recentVideos: Array<Record<string, unknown>> } };
    };

    expect(result.structuredContent.status).toBe("ok");
    const firstVideo = result.structuredContent.data.recentVideos[0];
    expect(firstVideo).toHaveProperty("durationText", "5:00");
    expect(firstVideo).not.toHaveProperty("durationSeconds");
  });

  it("returns actionable invalid-input errors for empty channel input", async () => {
    const server = createServer({
      youtubeService: {
        getChannel: vi.fn()
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_channel;

    await expect(tool.handler({})).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide a YouTube channel handle (e.g. @name), bare channel ID, or canonical channel URL in `channel`."
        )
      )
    );
    await expect(tool.handler({ channel: "   " })).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide a YouTube channel handle (e.g. @name), bare channel ID, or canonical channel URL in `channel`."
        )
      )
    );
  });

  it("surfaces NotAvailableError cleanly for unavailable channels", async () => {
    const server = createServer({
      youtubeService: {
        getChannel: vi.fn().mockRejectedValue(
          new NotAvailableError(
            "This YouTube channel is not available or does not exist.",
            {
              cause: "channel_unavailable"
            }
          )
        )
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_channel;

    await expect(
      tool.handler({ channel: "UCBJycsmduvYEL83R_U4JriQ" })
    ).resolves.toEqual(
      createNotAvailableResult({
        summary: "This YouTube channel is not available or does not exist.",
        reason: "channel_unavailable"
      })
    );
  });

  it("get_channel is reachable through the shared server factory (transport parity)", () => {
    const server = createServer({
      youtubeService: {
        getChannel: vi.fn()
      }
    });
    const tools = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools;

    expect(tools.get_channel).toBeDefined();
    expect(typeof tools.get_channel.handler).toBe("function");
  });
});
