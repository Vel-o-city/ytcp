import { describe, expect, it, vi } from "vitest";

import { InvalidInputError } from "../../src/lib/mcp-errors.js";
import { normalizePlaylistRecord } from "../../src/youtube/normalize.js";
import { parseYouTubeInput } from "../../src/youtube/parser.js";
import { createYouTubeService } from "../../src/youtube/service.js";
import type { YouTubePlaylistRecord } from "../../src/youtube/contracts.js";
import type { YouTubePlaylistReference } from "../../src/youtube/reference.js";

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function expectPlaylistReference(
  value: ReturnType<typeof parseYouTubeInput>
): YouTubePlaylistReference {
  expect(value.kind).toBe("playlist");

  if (value.kind !== "playlist") {
    throw new Error("Expected a playlist reference");
  }

  return value;
}

describe("playlist normalization contracts", () => {
  it("normalizes playlist metadata into a stable record shape", () => {
    const reference = parseYouTubeInput(
      "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    );

    const record = normalizePlaylistRecord(
      {
        info: {
          title: "Song Queue",
          description: "Up next",
          author: {
            id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
            name: "Google Developers"
          },
          total_items: "12 videos",
          privacy: "PUBLIC",
          views: "1,234 views",
          last_updated: "Updated today",
          thumbnails: [
            { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }
          ]
        }
      },
      expectPlaylistReference(reference)
    );

    expect(record satisfies YouTubePlaylistRecord).toBe(record);
    expect(record).toEqual({
      kind: "playlist",
      id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      canonicalUrl:
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      source: "playlist",
      title: "Song Queue",
      description: "Up next",
      channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      channelTitle: "Google Developers",
      itemCountText: "12 videos",
      privacy: "PUBLIC",
      viewCountText: "1,234 views",
      lastUpdatedText: "Updated today",
      thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]
    });
  });
});

describe("playlist lookups", () => {
  it("resolves bare ids, playlist urls, and watch urls with list params through one shared service path", async () => {
    const upstream = {
      getBasicInfo: vi.fn(),
      getPlaylist: vi.fn().mockResolvedValue({
        info: {
          title: "Song Queue",
          author: {
            id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
            name: "Google Developers"
          },
          total_items: "12 videos",
          thumbnails: [
            { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }
          ]
        }
      }),
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
      service.getPlaylist("PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK")
    ).resolves.toMatchObject({
      kind: "playlist",
      id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      source: "id",
      canonicalUrl:
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      title: "Song Queue",
      channelTitle: "Google Developers"
    });
    await expect(
      service.getPlaylist(
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
      )
    ).resolves.toMatchObject({
      kind: "playlist",
      id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      source: "playlist",
      canonicalUrl:
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    });
    await expect(
      service.getPlaylist(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
      )
    ).resolves.toMatchObject({
      kind: "playlist",
      id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      source: "watch",
      canonicalUrl:
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    });

    expect(upstream.getPlaylist).toHaveBeenCalledTimes(3);
    expect(upstream.getPlaylist).toHaveBeenNthCalledWith(
      1,
      "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    );
    expect(upstream.getPlaylist).toHaveBeenNthCalledWith(
      2,
      "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    );
    expect(upstream.getPlaylist).toHaveBeenNthCalledWith(
      3,
      "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    );
  });

  it("rejects non-playlist references before calling the upstream client", async () => {
    const upstream = {
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

    await expect(service.getPlaylist("dQw4w9WgXcQ")).rejects.toEqual(
      new InvalidInputError(
        "Expected a YouTube playlist reference, but received a video reference instead."
      )
    );
    expect(upstream.getPlaylist).not.toHaveBeenCalled();
  });
});
