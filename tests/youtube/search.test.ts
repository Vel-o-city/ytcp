import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SEARCH_RESULTS,
  type YouTubeSearchPage,
  type YouTubeSearchResult
} from "../../src/youtube/contracts.js";
import { createYouTubeService } from "../../src/youtube/service.js";
import {
  normalizeSearchPage,
  toInnertubeSearchFilters
} from "../../src/youtube/normalize.js";

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("youtube search normalization", () => {
  it("maps the compact public filter shape to youtubei search filters", () => {
    expect(
      toInnertubeSearchFilters({
        uploadDate: "week",
        duration: "long",
        sortBy: "view_count",
        features: ["hd", "live", "hd"]
      })
    ).toEqual({
      upload_date: "week",
      duration: "long",
      sort_by: "view_count",
      features: ["hd", "live"]
    });
    expect(toInnertubeSearchFilters()).toBeUndefined();
  });

  it("normalizes first-page search videos into compact disambiguation rows", () => {
    const page = normalizeSearchPage(
      {
        estimated_results: 5000,
        refinements: ["typescript mcp", "youtube mcp"],
        videos: [
          {
            video_id: "dQw4w9WgXcQ",
            title: "Never Gonna Give You Up",
            description_snippet: "Official music video",
            author: {
              id: "UCuAXFkgsw1L7xaCfnd5JJOw",
              name: "Rick Astley"
            },
            published: "15 years ago",
            view_count: "1.5B views",
            length_text: "3:33",
            duration: { text: "3:33", seconds: 213 },
            thumbnails: [
              { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }
            ],
            is_live: false,
            is_upcoming: false
          }
        ]
      },
      {
        query: "rick astley never gonna give you up",
        maxResults: 5,
        filters: {
          uploadDate: "all",
          duration: "long"
        }
      }
    );

    expect(page satisfies YouTubeSearchPage).toBe(page);
    expect(page).toEqual({
      query: "rick astley never gonna give you up",
      pageSize: 1,
      estimatedResults: 5000,
      refinements: ["typescript mcp", "youtube mcp"],
      filters: {
        uploadDate: "all",
        duration: "long"
      },
      results: [
        {
          kind: "video",
          id: "dQw4w9WgXcQ",
          canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Never Gonna Give You Up",
          channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
          channelTitle: "Rick Astley",
          publishedText: "15 years ago",
          viewCountText: "1.5B views",
          durationText: "3:33",
          durationSeconds: 213,
          snippet: "Official music video",
          thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
          isLive: false,
          isUpcoming: false
        }
      ]
    });
  });

  it("drops malformed upstream rows and respects maxResults bounds", () => {
    const page = normalizeSearchPage(
      {
        videos: [
          {
            title: "missing id"
          },
          {
            video_id: "dQw4w9WgXcQ",
            title: "Video one",
            thumbnails: [{ url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }]
          },
          {
            video_id: "9bZkp7q19f0",
            title: "Video two",
            thumbnails: [{ url: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg" }]
          }
        ]
      },
      {
        query: "test query",
        maxResults: 1
      }
    );

    expect(page.results).toHaveLength(1);
    expect(page.results[0] satisfies YouTubeSearchResult).toBe(page.results[0]);
    expect(page.results[0]).toMatchObject({
      id: "dQw4w9WgXcQ",
      title: "Video one"
    });
  });
});

describe("youtube search service", () => {
  it("executes search through the wrapped client and returns normalized first-page results", async () => {
    const createContinuationToken = vi.fn().mockReturnValue("page-1");
    const upstream = {
      getBasicInfo: vi.fn(),
      getPlaylist: vi.fn(),
      getChannel: vi.fn(),
      search: vi.fn().mockResolvedValue({
        estimated_results: 42,
        refinements: ["mcp server", "typescript mcp"],
        videos: [
          {
            video_id: "dQw4w9WgXcQ",
            title: "Build an MCP Server",
            description_snippet: "A practical walkthrough",
            author: {
              id: "UC123",
              name: "Example Dev"
            },
            published: "2 days ago",
            view_count: "12K views",
            length_text: "12:34",
            duration: { text: "12:34", seconds: 754 },
            thumbnails: [
              { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }
            ],
            is_live: false,
            is_upcoming: false
          }
        ],
        has_continuation: true,
        getContinuation: vi.fn()
      })
    };
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      createContinuationToken,
      logger: createSilentLogger()
    });

    await expect(
      service.searchVideos({
        query: "  mcp server  ",
        filters: {
          uploadDate: "week",
          sortBy: "view_count",
          features: ["live", "live", "hd"]
        }
      })
    ).resolves.toEqual({
      query: "mcp server",
      pageSize: 1,
      estimatedResults: 42,
      refinements: ["mcp server", "typescript mcp"],
      filters: {
        uploadDate: "week",
        sortBy: "view_count",
        features: ["live", "hd"]
      },
      nextPageToken: "page-1",
      results: [
        {
          kind: "video",
          id: "dQw4w9WgXcQ",
          canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "Build an MCP Server",
          channelId: "UC123",
          channelTitle: "Example Dev",
          publishedText: "2 days ago",
          viewCountText: "12K views",
          durationText: "12:34",
          durationSeconds: 754,
          snippet: "A practical walkthrough",
          thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
          isLive: false,
          isUpcoming: false
        }
      ]
    });

    expect(upstream.search).toHaveBeenCalledWith("mcp server", {
      upload_date: "week",
      sort_by: "view_count",
      features: ["live", "hd"]
    });
    expect(createContinuationToken).toHaveBeenCalledTimes(1);
  });

  it("uses the default first-page size when maxResults is omitted", async () => {
    const upstream = {
      getBasicInfo: vi.fn(),
      getPlaylist: vi.fn(),
      getChannel: vi.fn(),
      search: vi.fn().mockResolvedValue({
        videos: Array.from({ length: DEFAULT_SEARCH_RESULTS + 2 }, (_, index) => ({
          video_id: `${index}`.padStart(11, "0"),
          title: `Video ${index}`,
          thumbnails: []
        }))
      })
    };
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger()
    });

    const page = await service.searchVideos({ query: "mcp server" });

    expect(page.pageSize).toBe(DEFAULT_SEARCH_RESULTS);
    expect(page.results).toHaveLength(DEFAULT_SEARCH_RESULTS);
  });

  it("issues opaque continuation tokens that resolve follow-up pages", async () => {
    const secondPage = {
      videos: [
        {
          video_id: "9bZkp7q19f0",
          title: "Video two",
          thumbnails: [{ url: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg" }]
        }
      ],
      has_continuation: false,
      getContinuation: vi.fn()
    };
    const firstPage = {
      videos: [
        {
          video_id: "dQw4w9WgXcQ",
          title: "Video one",
          thumbnails: [{ url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" }]
        }
      ],
      has_continuation: true,
      getContinuation: vi.fn().mockResolvedValue(secondPage)
    };
    const upstream = {
      getBasicInfo: vi.fn(),
      getPlaylist: vi.fn(),
      getChannel: vi.fn(),
      search: vi.fn().mockResolvedValue(firstPage)
    };
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      createContinuationToken: vi
        .fn()
        .mockReturnValueOnce("page-1")
        .mockReturnValueOnce("page-2"),
      logger: createSilentLogger()
    });

    const initialPage = await service.searchVideos({ query: "mcp server", maxResults: 1 });
    const followUpPage = await service.searchVideos({
      pageToken: initialPage.nextPageToken ?? ""
    });

    expect(initialPage.nextPageToken).toBe("page-1");
    expect(followUpPage).toEqual({
      query: "mcp server",
      pageSize: 1,
      results: [
        {
          kind: "video",
          id: "9bZkp7q19f0",
          canonicalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
          title: "Video two",
          thumbnails: ["https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg"],
          isLive: false,
          isUpcoming: false
        }
      ]
    });
    expect(firstPage.getContinuation).toHaveBeenCalledTimes(1);
    expect(upstream.search).toHaveBeenCalledTimes(1);
  });
});
