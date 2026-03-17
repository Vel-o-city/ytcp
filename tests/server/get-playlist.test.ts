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

describe("get_playlist tool", () => {
  it("registers a read-only playlist tool that can use an injected youtube service", async () => {
    const longDescription = "A".repeat(420);
    const youtubeService = {
      getPlaylist: vi.fn().mockResolvedValue({
        kind: "playlist",
        id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        canonicalUrl:
          "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        source: "watch",
        title: "Song Queue",
        description: longDescription,
        channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
        channelTitle: "Google Developers",
        itemCountText: "12 videos",
        privacy: "PUBLIC",
        viewCountText: "1,234 views",
        lastUpdatedText: "Updated today",
        thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
        pageSize: 1,
        nextPageToken: "playlist-page-1",
        items: [
          {
            kind: "video",
            id: "dQw4w9WgXcQ",
            canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            title: "Video one",
            channelTitle: "Google Developers",
            durationText: "12:34",
            durationSeconds: 754,
            position: 1,
            thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
            isPlayable: true,
            isLive: false,
            isUpcoming: false
          }
        ]
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_playlist;

    expect(tool).toBeDefined();
    expect(tool.description).toContain("Fetch compact details and playlist items");
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    await expect(
      tool.handler({
        playlist:
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        maxResults: 1
      })
    ).resolves.toEqual(
      createSuccessResult({
        summary: 'Loaded public playlist details for "Song Queue" with 1 item. More are available.',
        data: {
          id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
          canonicalUrl:
            "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
          title: "Song Queue",
          description: `${"A".repeat(397)}...`,
          channelTitle: "Google Developers",
          itemCountText: "12 videos",
          privacy: "PUBLIC",
          viewCountText: "1,234 views",
          lastUpdatedText: "Updated today",
          thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
          pageSize: 1,
          nextPageToken: "playlist-page-1",
          items: [
            {
              kind: "video",
              id: "dQw4w9WgXcQ",
              canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              title: "Video one",
              channelTitle: "Google Developers",
              durationText: "12:34",
              position: 1,
              thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
              isPlayable: true,
              isLive: false,
              isUpcoming: false
            }
          ]
        }
      })
    );
    expect(youtubeService.getPlaylist).toHaveBeenCalledWith({
      playlist:
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      maxResults: 1
    });
  });

  it("passes follow-up page tokens through while keeping the tool payload compact", async () => {
    const youtubeService = {
      getPlaylist: vi.fn().mockResolvedValue({
        kind: "playlist",
        id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        canonicalUrl:
          "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        source: "playlist",
        title: "Song Queue",
        pageSize: 1,
        items: [
          {
            kind: "video",
            id: "9bZkp7q19f0",
            canonicalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
            title: "Video two",
            durationSeconds: 245,
            thumbnails: [],
            isPlayable: true,
            isLive: false,
            isUpcoming: false
          }
        ],
        thumbnails: []
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_playlist;
    const result = (await tool.handler({
      pageToken: "playlist-page-1",
      maxResults: 2
    })) as {
      structuredContent: {
        status: string;
        data: Record<string, unknown>;
      };
    };

    expect(result.structuredContent.status).toBe("ok");
    expect(result.structuredContent.data).toMatchObject({
      id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      title: "Song Queue",
      pageSize: 1,
      items: [
        {
          id: "9bZkp7q19f0",
          title: "Video two",
          isPlayable: true,
          isLive: false,
          isUpcoming: false
        }
      ]
    });
    expect(result.structuredContent.data).not.toHaveProperty("source");
    expect(result.structuredContent.data.items[0]).not.toHaveProperty("durationSeconds");
    expect(youtubeService.getPlaylist).toHaveBeenCalledWith({
      pageToken: "playlist-page-1",
      maxResults: 2
    });
  });

  it("returns actionable invalid-input failures for malformed playlist requests", async () => {
    const server = createServer({
      youtubeService: {
        getPlaylist: vi.fn()
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_playlist;

    await expect(tool.handler({})).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide either a `playlist` string or a `pageToken` string to load a public playlist."
        )
      )
    );
    await expect(tool.handler({ playlist: "   " })).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide a YouTube playlist URL, a watch URL with `list=...`, or a bare playlist ID in `playlist`."
        )
      )
    );
    await expect(
      tool.handler({
        playlist: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        pageToken: "playlist-page-1"
      })
    ).resolves.toEqual(
      createFailureResult(
        new InvalidInputError(
          "Provide either `playlist` or `pageToken`, not both, when using `get_playlist`."
        )
      )
    );
    await expect(
      tool.handler({
        playlist: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        maxResults: 99
      })
    ).resolves.toEqual(
      createFailureResult(
        new InvalidInputError("`maxResults` must be between 1 and 25.")
      )
    );
  });

  it("surfaces unavailable states cleanly for expired playlist page tokens", async () => {
    const server = createServer({
      youtubeService: {
        getPlaylist: vi.fn().mockRejectedValue(
          new NotAvailableError(
            "This YouTube playlist page token is missing or expired. Run the playlist lookup again to continue.",
            {
              cause: "playlist_page_token_expired"
            }
          )
        )
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_playlist;

    await expect(
      tool.handler({
        pageToken: "playlist-page-1"
      })
    ).resolves.toEqual(
      createNotAvailableResult({
        summary:
          "This YouTube playlist page token is missing or expired. Run the playlist lookup again to continue.",
        reason: "playlist_page_token_expired"
      })
    );
  });
});
