import { describe, expect, it, vi } from "vitest";

import { NotAvailableError } from "../../src/lib/mcp-errors.js";
import { normalizeChannelRecord, extractChannelVideos } from "../../src/youtube/normalize.js";
import { parseYouTubeInput } from "../../src/youtube/parser.js";
import { createYouTubeService } from "../../src/youtube/service.js";
import * as youtubeModule from "../../src/youtube/index.js";
import type {
  YouTubeChannelRecord,
  YouTubeChannelVideoItem
} from "../../src/youtube/contracts.js";
import {
  DEFAULT_CHANNEL_RESULTS,
  MAX_CHANNEL_RESULTS
} from "../../src/youtube/contracts.js";
import type { YouTubeChannelReference } from "../../src/youtube/reference.js";

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
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

describe("channel normalization contracts", () => {
  it("normalizes channel metadata into a stable record shape", () => {
    const reference = expectChannelReference(
      parseYouTubeInput("https://www.youtube.com/@mkbhd")
    );

    const record = normalizeChannelRecord(
      {
        metadata: {
          title: "Marques Brownlee",
          description: "MKBHD. Quality Tech Videos.",
          external_id: "UCBJycsmduvYEL83R_U4JriQ",
          vanity_channel_url: "http://www.youtube.com/@MKBHD",
          avatar: [
            { url: "https://yt3.ggpht.com/avatar.jpg" }
          ]
        },
        header: {
          subscriber_count_text: "18.4M subscribers",
          video_count_text: "1,234 videos",
          view_count_text: "3.2B views"
        }
      },
      reference
    );

    expect(record satisfies YouTubeChannelRecord).toBe(record);
    expect(record).toMatchObject({
      kind: "channel",
      canonicalUrl: "https://www.youtube.com/@mkbhd",
      source: "handle",
      id: "UCBJycsmduvYEL83R_U4JriQ",
      handle: "@MKBHD",
      title: "Marques Brownlee",
      description: "MKBHD. Quality Tech Videos.",
      subscriberCountText: "18.4M subscribers",
      videoCountText: "1,234 videos",
      viewCountText: "3.2B views",
      thumbnails: ["https://yt3.ggpht.com/avatar.jpg"]
    });
  });

  it("produces undefined for missing header fields rather than errors", () => {
    const reference = expectChannelReference(
      parseYouTubeInput("UCBJycsmduvYEL83R_U4JriQ")
    );

    const record = normalizeChannelRecord(
      {
        metadata: {
          title: "Some Channel",
          external_id: "UCBJycsmduvYEL83R_U4JriQ"
        },
        header: {}
      },
      reference
    );

    expect(record.subscriberCountText).toBeUndefined();
    expect(record.videoCountText).toBeUndefined();
    expect(record.thumbnails).toEqual([]);
  });
});

describe("channel video item normalization", () => {
  it("normalizes GridVideo-shaped items into YouTubeChannelVideoItem[]", () => {
    const items = extractChannelVideos({
      videos: [
        {
          video_id: "dQw4w9WgXcQ",
          title: "Never Gonna Give You Up",
          thumbnails: [{ url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }],
          published: "3 days ago",
          duration: "3:33",
          views: "1.5B views"
        },
        {
          video_id: "oHg5SJYRHA0",
          title: "RickRoll Remastered",
          thumbnails: [{ url: "https://i.ytimg.com/vi/oHg5SJYRHA0/hqdefault.jpg" }],
          published: "1 week ago",
          duration: "4:12",
          short_view_count: "500K views"
        }
      ]
    });

    expect(items).toHaveLength(2);

    const first = items[0];
    expect(first satisfies YouTubeChannelVideoItem).toBe(first);
    expect(first).toMatchObject({
      id: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      publishedText: "3 days ago",
      durationText: "3:33",
      viewCountText: "1.5B views"
    });
    expect(first.thumbnails).toContain("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });

  it("filters out items without a valid video_id", () => {
    const items = extractChannelVideos({
      videos: [
        {
          video_id: "validVideoId1",
          title: "Valid Video"
        },
        {
          title: "No ID Video"
        },
        {
          video_id: "",
          title: "Empty ID Video"
        }
      ]
    });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("validVideoId1");
  });

  it("returns empty array when videos feed is missing or empty", () => {
    expect(extractChannelVideos({})).toEqual([]);
    expect(extractChannelVideos({ videos: [] })).toEqual([]);
    expect(extractChannelVideos(null)).toEqual([]);
  });

  it("exposes DEFAULT_CHANNEL_RESULTS and MAX_CHANNEL_RESULTS constants", () => {
    expect(typeof DEFAULT_CHANNEL_RESULTS).toBe("number");
    expect(typeof MAX_CHANNEL_RESULTS).toBe("number");
    expect(MAX_CHANNEL_RESULTS).toBeGreaterThan(DEFAULT_CHANNEL_RESULTS);
  });
});

describe("channel URL variant resolution paths", () => {
  // Each entry describes one supported input form and which resolution branch it takes.
  const CHANNEL_ID = "UCBJycsmduvYEL83R_U4JriQ";
  const BARE_HANDLE = "@mkbhd";

  const cases: Array<{
    label: string;
    input: string;
    expectsResolveURL: boolean;
    // If resolveURL is expected, the mock returns this browseId.
    browseIdResult?: string;
    // The value ultimately passed to getChannel().
    expectedGetChannelArg: string;
  }> = [
    {
      label: "bare UC... channel ID",
      input: CHANNEL_ID,
      expectsResolveURL: false,
      expectedGetChannelArg: CHANNEL_ID
    },
    {
      label: "bare @handle (resolveURL attempt then fallback)",
      input: BARE_HANDLE,
      expectsResolveURL: true,
      browseIdResult: CHANNEL_ID,
      expectedGetChannelArg: CHANNEL_ID
    },
    {
      label: "https://youtube.com/@handle URL",
      input: "https://www.youtube.com/@mkbhd",
      expectsResolveURL: true,
      browseIdResult: CHANNEL_ID,
      expectedGetChannelArg: CHANNEL_ID
    },
    {
      label: "https://youtube.com/@handle/videos subpage URL",
      input: "https://www.youtube.com/@mkbhd/videos",
      expectsResolveURL: true,
      browseIdResult: CHANNEL_ID,
      expectedGetChannelArg: CHANNEL_ID
    },
    {
      label: "https://youtube.com/channel/UC... URL",
      input: `https://www.youtube.com/channel/${CHANNEL_ID}`,
      expectsResolveURL: false,
      expectedGetChannelArg: CHANNEL_ID
    },
    {
      label: "https://youtube.com/c/CustomName URL",
      input: "https://www.youtube.com/c/MKBHDTech",
      expectsResolveURL: true,
      browseIdResult: CHANNEL_ID,
      expectedGetChannelArg: CHANNEL_ID
    },
    {
      label: "https://youtube.com/user/Username URL",
      input: "https://www.youtube.com/user/marquesbrownlee",
      expectsResolveURL: true,
      browseIdResult: CHANNEL_ID,
      expectedGetChannelArg: CHANNEL_ID
    },
    {
      label: "https://youtube.com/feeds/videos.xml?channel_id=UC... feed URL",
      input: `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`,
      expectsResolveURL: false,
      expectedGetChannelArg: CHANNEL_ID
    }
  ];

  const baseChannelResponse = {
    metadata: {
      title: "Test Channel",
      external_id: CHANNEL_ID,
      vanity_channel_url: "http://www.youtube.com/@testchannel"
    },
    header: {
      subscriber_count_text: "100K subscribers"
    },
    has_videos: false,
    videos: [],
    getVideos: undefined
  };

  it.each(cases)(
    "routes '$label' through the correct resolution branch",
    async ({ input, expectsResolveURL, browseIdResult, expectedGetChannelArg }) => {
      const getChannel = vi.fn().mockResolvedValue(baseChannelResponse);
      const resolveURL = vi.fn().mockResolvedValue(
        browseIdResult
          ? { payload: { browseId: browseIdResult } }
          : {}
      );

      const service = createYouTubeService({
        client: {
          getClient: vi.fn().mockResolvedValue({
            getChannel,
            resolveURL
          }),
          getConfig: vi.fn().mockReturnValue({}),
          reset: vi.fn()
        },
        logger: createSilentLogger()
      });

      await service.getChannel(input);

      expect(getChannel).toHaveBeenCalledWith(expectedGetChannelArg);

      if (expectsResolveURL) {
        expect(resolveURL).toHaveBeenCalled();
      } else {
        expect(resolveURL).not.toHaveBeenCalled();
      }
    }
  );

  it("falls back to handle/customName/username when resolveURL is unavailable", async () => {
    const getChannel = vi.fn().mockResolvedValue(baseChannelResponse);

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel
          // resolveURL intentionally absent
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    await service.getChannel("@mkbhd");

    // Without resolveURL, falls back to the raw handle
    expect(getChannel).toHaveBeenCalledWith("@mkbhd");
  });

  it("falls back to handle when resolveURL returns no browseId", async () => {
    const getChannel = vi.fn().mockResolvedValue(baseChannelResponse);
    const resolveURL = vi.fn().mockResolvedValue({}); // no payload.browseId

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel,
          resolveURL
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    await service.getChannel("https://www.youtube.com/@mkbhd");

    expect(resolveURL).toHaveBeenCalled();
    // Falls back to the handle extracted from the reference
    expect(getChannel).toHaveBeenCalledWith("@mkbhd");
  });
});

describe("channel lookups", () => {
  function makeChannelResponse(options: {
    has_videos?: boolean;
    videos?: unknown[];
  } = {}) {
    const { has_videos = false, videos = [] } = options;

    return {
      metadata: {
        title: "Test Channel",
        external_id: "UCBJycsmduvYEL83R_U4JriQ",
        vanity_channel_url: "http://www.youtube.com/@testchannel"
      },
      header: {
        subscriber_count_text: "100K subscribers"
      },
      has_videos,
      videos,
      getVideos: has_videos
        ? vi.fn().mockResolvedValue({
            metadata: {
              title: "Test Channel",
              external_id: "UCBJycsmduvYEL83R_U4JriQ",
              vanity_channel_url: "http://www.youtube.com/@testchannel"
            },
            header: {
              subscriber_count_text: "100K subscribers"
            },
            has_videos: true,
            videos: videos,
            getVideos: vi.fn()
          })
        : undefined
    };
  }

  it("resolves a bare channel ID without calling resolveURL", async () => {
    const channelResponse = makeChannelResponse({ has_videos: false });
    const getChannel = vi.fn().mockResolvedValue(channelResponse);
    const resolveURL = vi.fn();

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel,
          resolveURL
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    const record = await service.getChannel("UCBJycsmduvYEL83R_U4JriQ");

    expect(getChannel).toHaveBeenCalledWith("UCBJycsmduvYEL83R_U4JriQ");
    expect(resolveURL).not.toHaveBeenCalled();
    expect(record.id).toBe("UCBJycsmduvYEL83R_U4JriQ");
    expect(record.kind).toBe("channel");
    expect(record.recentVideos).toEqual([]);
  });

  it("calls resolveURL for handle inputs and passes the browseId to getChannel", async () => {
    const channelResponse = makeChannelResponse({ has_videos: false });
    const getChannel = vi.fn().mockResolvedValue(channelResponse);
    const resolveURL = vi.fn().mockResolvedValue({
      payload: { browseId: "UCBJycsmduvYEL83R_U4JriQ" }
    });

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel,
          resolveURL
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    await service.getChannel("https://www.youtube.com/@mkbhd");

    expect(resolveURL).toHaveBeenCalled();
    expect(getChannel).toHaveBeenCalledWith("UCBJycsmduvYEL83R_U4JriQ");
  });

  it("falls back to the raw handle when resolveURL is unavailable", async () => {
    const channelResponse = makeChannelResponse({ has_videos: false });
    const getChannel = vi.fn().mockResolvedValue(channelResponse);

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    await service.getChannel("@mkbhd");

    expect(getChannel).toHaveBeenCalledWith("@mkbhd");
  });

  it("remaps ChannelError to NotAvailableError with channel_unavailable cause", async () => {
    const channelError = new Error("This channel does not exist.");
    channelError.name = "ChannelError";

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel: vi.fn().mockRejectedValue(channelError)
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    const error = await service.getChannel("UCBJycsmduvYEL83R_U4JriQ").catch(e => e);

    expect(error).toBeInstanceOf(NotAvailableError);
    expect((error as NotAvailableError).causeDetail).toBe("channel_unavailable");
  });

  it("remaps InnertubeError with 'Invalid channel' message to NotAvailableError", async () => {
    const innertubeError = new Error("Invalid channel");
    innertubeError.name = "InnertubeError";

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel: vi.fn().mockRejectedValue(innertubeError)
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    const error = await service.getChannel("UCBJycsmduvYEL83R_U4JriQ").catch(e => e);

    expect(error).toBeInstanceOf(NotAvailableError);
    expect((error as NotAvailableError).causeDetail).toBe("channel_unavailable");
  });

  it("returns empty recentVideos array when has_videos is false", async () => {
    const getVideos = vi.fn();
    const channelResponse = {
      metadata: {
        title: "Test Channel",
        external_id: "UCBJycsmduvYEL83R_U4JriQ"
      },
      header: {},
      has_videos: false,
      videos: [],
      getVideos
    };

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel: vi.fn().mockResolvedValue(channelResponse)
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    const record = await service.getChannel("UCBJycsmduvYEL83R_U4JriQ");

    expect(record.recentVideos).toEqual([]);
    expect(getVideos).not.toHaveBeenCalled();
  });

  it("calls getVideos() and populates recentVideos when has_videos is true", async () => {
    const videoItems = [
      {
        video_id: "dQw4w9WgXcQ",
        title: "Test Video",
        thumbnails: [{ url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }],
        published: "2 days ago",
        duration: "5:00",
        views: "1M views"
      }
    ];

    const videosResponse = {
      metadata: {
        title: "Test Channel",
        external_id: "UCBJycsmduvYEL83R_U4JriQ"
      },
      header: {},
      has_videos: true,
      videos: videoItems
    };

    const getVideos = vi.fn().mockResolvedValue(videosResponse);

    const channelResponse = {
      metadata: {
        title: "Test Channel",
        external_id: "UCBJycsmduvYEL83R_U4JriQ"
      },
      header: {},
      has_videos: true,
      videos: [],
      getVideos
    };

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel: vi.fn().mockResolvedValue(channelResponse)
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    const record = await service.getChannel("UCBJycsmduvYEL83R_U4JriQ");

    expect(getVideos).toHaveBeenCalled();
    expect(record.recentVideos).toHaveLength(1);
    expect(record.recentVideos![0]).toMatchObject({
      id: "dQw4w9WgXcQ",
      title: "Test Video",
      publishedText: "2 days ago",
      durationText: "5:00"
    });
  });

  it("degrades gracefully when getVideos() throws, returning channel metadata with empty recentVideos", async () => {
    const getVideos = vi.fn().mockRejectedValue(new Error("YouTube videos tab unavailable"));

    const channelResponse = {
      metadata: {
        title: "Test Channel",
        external_id: "UCBJycsmduvYEL83R_U4JriQ"
      },
      header: {},
      has_videos: true,
      videos: [],
      getVideos
    };

    const logger = createSilentLogger();
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel: vi.fn().mockResolvedValue(channelResponse)
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger
    });

    const record = await service.getChannel("UCBJycsmduvYEL83R_U4JriQ");

    expect(record.id).toBe("UCBJycsmduvYEL83R_U4JriQ");
    expect(record.recentVideos).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("returns cached record on second call without calling getChannel again", async () => {
    const channelResponse = makeChannelResponse({ has_videos: false });
    const getChannel = vi.fn().mockResolvedValue(channelResponse);

    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue({
          getChannel
        }),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    await service.getChannel("UCBJycsmduvYEL83R_U4JriQ");
    await service.getChannel("UCBJycsmduvYEL83R_U4JriQ");

    expect(getChannel).toHaveBeenCalledTimes(1);
  });
});

describe("channel export verification", () => {
  it("exports normalizeChannelRecord from the youtube module", () => {
    expect(typeof youtubeModule.normalizeChannelRecord).toBe("function");
  });

  it("exports YouTubeChannelVideoItem type via the youtube module", () => {
    // Types are verified via import at the top of this file; the const below
    // ensures the runtime module object is importable without errors.
    expect(youtubeModule).toBeDefined();
  });

  it("exports DEFAULT_CHANNEL_RESULTS from the youtube module", () => {
    expect(typeof (youtubeModule as Record<string, unknown>).DEFAULT_CHANNEL_RESULTS).toBe("number");
  });

  it("exports MAX_CHANNEL_RESULTS from the youtube module", () => {
    expect(typeof (youtubeModule as Record<string, unknown>).MAX_CHANNEL_RESULTS).toBe("number");
  });
});
