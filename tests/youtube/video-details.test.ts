import { describe, expect, it, vi } from "vitest";

import { InvalidInputError } from "../../src/lib/mcp-errors.js";
import { createYouTubeService } from "../../src/youtube/service.js";

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("video detail lookups", () => {
  it("prefers the richer video info path while resolving watch urls, shorts/live variants, mobile urls, and bare ids", async () => {
    const upstream = {
      getInfo: vi.fn().mockResolvedValue({
        basic_info: {
          title: "Build an MCP Server",
          short_description: "Practical implementation guide",
          channel: {
            id: "UC123",
            name: "Example Dev"
          },
          duration: 754,
          view_count: 123456,
          thumbnail: [
            { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }
          ],
          is_live: false
        }
      }),
      getBasicInfo: vi.fn().mockResolvedValue({
        basic_info: {
          title: "Build an MCP Server",
          short_description: "Practical implementation guide",
          channel: {
            id: "UC123",
            name: "Example Dev"
          },
          duration: 754,
          view_count: 123456,
          thumbnail: [
            { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }
          ],
          is_live: false
        }
      }),
      getPlaylist: vi.fn(),
      getChannel: vi.fn()
    };
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    await expect(
      service.getVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43")
    ).resolves.toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "watch",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Build an MCP Server",
      channelTitle: "Example Dev",
      durationSeconds: 754,
      startTimeSeconds: 43
    });
    await expect(
      service.getVideo("https://www.youtube.com/shorts/dQw4w9WgXcQ")
    ).resolves.toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "shorts",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
    await expect(
      service.getVideo("https://www.youtube.com/live/dQw4w9WgXcQ?t=120")
    ).resolves.toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "live",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      startTimeSeconds: 120
    });
    await expect(
      service.getVideo("https://m.youtube.com/watch?v=dQw4w9WgXcQ")
    ).resolves.toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "watch",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
    await expect(service.getVideo("dQw4w9WgXcQ")).resolves.toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "id",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });

    expect(upstream.getInfo).toHaveBeenCalledTimes(5);
    expect(upstream.getInfo).toHaveBeenNthCalledWith(1, "dQw4w9WgXcQ");
    expect(upstream.getInfo).toHaveBeenNthCalledWith(2, "dQw4w9WgXcQ");
    expect(upstream.getInfo).toHaveBeenNthCalledWith(3, "dQw4w9WgXcQ");
    expect(upstream.getInfo).toHaveBeenNthCalledWith(4, "dQw4w9WgXcQ");
    expect(upstream.getInfo).toHaveBeenNthCalledWith(5, "dQw4w9WgXcQ");
    expect(upstream.getBasicInfo).not.toHaveBeenCalled();
  });

  it("falls back to the basic video info path when richer chapter-capable lookups fail", async () => {
    const logger = createSilentLogger();
    const upstream = {
      getInfo: vi.fn().mockRejectedValue(new Error("watch-next unavailable")),
      getBasicInfo: vi.fn().mockResolvedValue({
        basic_info: {
          title: "Fallback video",
          short_description: "Recovered from basic info",
          channel: {
            id: "UC123",
            name: "Example Dev"
          },
          duration: 300,
          is_live: false
        }
      }),
      getPlaylist: vi.fn(),
      getChannel: vi.fn()
    };
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger
    });

    await expect(service.getVideo("dQw4w9WgXcQ")).resolves.toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      title: "Fallback video",
      source: "id"
    });

    expect(upstream.getInfo).toHaveBeenCalledWith("dQw4w9WgXcQ");
    expect(upstream.getBasicInfo).toHaveBeenCalledWith("dQw4w9WgXcQ");
    expect(logger.warn).toHaveBeenCalledWith(
      "youtube rich video lookup fell back to basic info",
      expect.objectContaining({
        id: "dQw4w9WgXcQ",
        source: "id"
      })
    );
  });

  it("rejects non-video references before calling the upstream client", async () => {
    const upstream = {
      getInfo: vi.fn(),
      getBasicInfo: vi.fn(),
      getPlaylist: vi.fn(),
      getChannel: vi.fn()
    };
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    await expect(
      service.getVideo("https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK")
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(upstream.getBasicInfo).not.toHaveBeenCalled();
  });
});
