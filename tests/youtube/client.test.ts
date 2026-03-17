import { describe, expect, it, vi } from "vitest";

import {
  type YouTubeChannelRecord,
  type YouTubePlaylistRecord,
  type YouTubeVideoRecord
} from "../../src/youtube/contracts.js";
import { createInnertubeClient } from "../../src/youtube/client.js";
import {
  normalizeChannelRecord,
  normalizePlaylistRecord,
  normalizeVideoRecord
} from "../../src/youtube/normalize.js";
import { parseYouTubeInput } from "../../src/youtube/parser.js";
import { createYouTubeService } from "../../src/youtube/service.js";
import type {
  YouTubeChannelReference,
  YouTubePlaylistReference,
  YouTubeVideoReference
} from "../../src/youtube/reference.js";
import * as youtubeModule from "../../src/youtube/index.js";
import * as rootModule from "../../src/index.js";

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function expectVideoReference(value: ReturnType<typeof parseYouTubeInput>): YouTubeVideoReference {
  expect(value.kind).toBe("video");

  if (value.kind !== "video") {
    throw new Error("Expected a video reference");
  }

  return value;
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

function expectChannelReference(
  value: ReturnType<typeof parseYouTubeInput>
): YouTubeChannelReference {
  expect(value.kind).toBe("channel");

  if (value.kind !== "channel") {
    throw new Error("Expected a channel reference");
  }

  return value;
}

describe("youtube normalization contracts", () => {
  it("normalizes compact video details into a stable record shape", () => {
    const reference = parseYouTubeInput(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43&list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    );

    const record = normalizeVideoRecord(
      {
        basic_info: {
          title: "Never Gonna Give You Up",
          short_description: "Official music video",
          channel: {
            id: "UCuAXFkgsw1L7xaCfnd5JJOw",
            name: "Rick Astley"
          },
          duration: 213,
          view_count: 123456789,
          like_count: 8900000,
          thumbnail: [
            { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }
          ],
          keywords: ["rick astley", "music"],
          is_live: false
        }
      },
      expectVideoReference(reference)
    );

    expect(record satisfies YouTubeVideoRecord).toBe(record);
    expect(record).toEqual({
      kind: "video",
      id: "dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      source: "watch",
      title: "Never Gonna Give You Up",
      description: "Official music video",
      channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
      channelTitle: "Rick Astley",
      durationSeconds: 213,
      viewCount: 123456789,
      likeCount: 8900000,
      thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
      keywords: ["rick astley", "music"],
      isLive: false,
      playlistId: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      startTimeSeconds: 43
    });
  });

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
      thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
      pageSize: 0,
      items: []
    });
  });

  it("normalizes channel metadata into a stable record shape", () => {
    const reference = parseYouTubeInput("https://www.youtube.com/@GoogleDevelopers");

    const record = normalizeChannelRecord(
      {
        metadata: {
          external_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
          title: "Google Developers",
          description: "Google developer channel",
          vanity_channel_url: "https://www.youtube.com/@GoogleDevelopers",
          avatar: [
            { url: "https://yt3.googleusercontent.com/channel-avatar=s88" }
          ]
        },
        header: {
          subscriber_count_text: "2.8M subscribers",
          video_count_text: "6.4K videos",
          view_count_text: "210M views"
        }
      },
      expectChannelReference(reference)
    );

    expect(record satisfies YouTubeChannelRecord).toBe(record);
    expect(record).toEqual({
      kind: "channel",
      canonicalUrl: "https://www.youtube.com/@GoogleDevelopers",
      source: "handle",
      id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      handle: "@GoogleDevelopers",
      title: "Google Developers",
      description: "Google developer channel",
      subscriberCountText: "2.8M subscribers",
      videoCountText: "6.4K videos",
      viewCountText: "210M views",
      thumbnails: ["https://yt3.googleusercontent.com/channel-avatar=s88"]
    });
  });
});

describe("createInnertubeClient", () => {
  it("reuses one youtubei session and forwards the configured seams", async () => {
    const upstream = {
      getBasicInfo: vi.fn(),
      getPlaylist: vi.fn(),
      getChannel: vi.fn()
    };
    const createClient = vi.fn().mockResolvedValue(upstream);
    const customFetch = vi.fn();
    const logger = createSilentLogger();

    const client = createInnertubeClient({
      createClient,
      fetch: customFetch,
      logger,
      visitorData: "visitor-data",
      poToken: "po-token",
      userAgent: "ytcp-test-agent"
    });

    expect(await client.getClient()).toBe(upstream);
    expect(await client.getClient()).toBe(upstream);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        fetch: customFetch,
        visitor_data: "visitor-data",
        po_token: "po-token",
        user_agent: "ytcp-test-agent",
        retrieve_player: false,
        cache: expect.any(Object)
      })
    );
  });

  it("keeps the default client boundary free of api keys and external binaries", () => {
    const client = createInnertubeClient({
      createClient: vi.fn().mockResolvedValue({
        getBasicInfo: vi.fn(),
        getPlaylist: vi.fn(),
        getChannel: vi.fn()
      }),
      logger: createSilentLogger()
    });
    const config = client.getConfig() as Record<string, unknown>;

    expect(config.retrieve_player).toBe(false);
    expect(config).not.toHaveProperty("apiKey");
    expect(config).not.toHaveProperty("youtubeApiKey");
    expect(config).not.toHaveProperty("ytDlpPath");
    expect(config).not.toHaveProperty("ytdlp");
    expect(config).not.toHaveProperty("binary");
  });
});

describe("createYouTubeService", () => {
  it("uses the client boundary to return normalized video and playlist records", async () => {
    const upstream = {
      getBasicInfo: vi.fn().mockResolvedValue({
        basic_info: {
          title: "Never Gonna Give You Up",
          short_description: "Official music video",
          channel: {
            id: "UCuAXFkgsw1L7xaCfnd5JJOw",
            name: "Rick Astley"
          },
          duration: 213,
          view_count: 123456789,
          thumbnail: [
            { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }
          ]
        }
      }),
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
    const logger = createSilentLogger();
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger
    });

    expect(
      await service.getVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    ).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      channelTitle: "Rick Astley"
    });
    expect(await service.getPlaylist("PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK")).toMatchObject({
      kind: "playlist",
      id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      title: "Song Queue",
      channelTitle: "Google Developers"
    });

    expect(upstream.getBasicInfo).toHaveBeenCalledWith("dQw4w9WgXcQ");
    expect(upstream.getPlaylist).toHaveBeenCalledWith(
      "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    );
  });

  it("resolves handle-based channels before requesting normalized channel data", async () => {
    const upstream = {
      getBasicInfo: vi.fn(),
      getPlaylist: vi.fn(),
      getChannel: vi.fn().mockResolvedValue({
        metadata: {
          external_id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
          title: "Google Developers",
          vanity_channel_url: "https://www.youtube.com/@GoogleDevelopers"
        }
      }),
      resolveURL: vi.fn().mockResolvedValue({
        payload: {
          browseId: "UC_x5XG1OV2P6uZZ5FSM9Ttw"
        }
      })
    };
    const logger = createSilentLogger();
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger
    });

    await expect(
      service.getChannel("https://www.youtube.com/@GoogleDevelopers")
    ).resolves.toMatchObject({
      kind: "channel",
      handle: "@GoogleDevelopers",
      id: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      title: "Google Developers"
    });

    expect(upstream.resolveURL).toHaveBeenCalledWith(
      "https://www.youtube.com/@GoogleDevelopers"
    );
    expect(upstream.getChannel).toHaveBeenCalledWith(
      "UC_x5XG1OV2P6uZZ5FSM9Ttw"
    );
  });
});

describe("youtube module exports", () => {
  it("re-exports the client and service helpers from the youtube module surface", () => {
    expect(youtubeModule.createInnertubeClient).toBe(createInnertubeClient);
    expect(youtubeModule.createYouTubeService).toBe(createYouTubeService);
    expect(youtubeModule.normalizeVideoRecord).toBe(normalizeVideoRecord);
  });

  it("re-exports the youtube access layer from the package entry", async () => {
    const logger = createSilentLogger();
    const upstream = {
      getBasicInfo: vi.fn().mockResolvedValue({
        basic_info: {
          title: "Never Gonna Give You Up"
        }
      }),
      getPlaylist: vi.fn(),
      getChannel: vi.fn()
    };
    const service = rootModule.createYouTubeService({
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
      title: "Never Gonna Give You Up"
    });
    expect(rootModule.createInnertubeClient).toBe(createInnertubeClient);
  });
});
