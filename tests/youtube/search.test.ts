import { describe, expect, it } from "vitest";

import {
  type YouTubeSearchPage,
  type YouTubeSearchResult
} from "../../src/youtube/contracts.js";
import {
  normalizeSearchPage,
  toInnertubeSearchFilters
} from "../../src/youtube/normalize.js";

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
