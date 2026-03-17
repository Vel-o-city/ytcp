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
    const youtubeService = {
      getPlaylist: vi.fn().mockResolvedValue({
        kind: "playlist",
        id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        canonicalUrl:
          "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
        source: "watch",
        title: "Song Queue",
        description: "Up next",
        channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
        channelTitle: "Google Developers",
        itemCountText: "12 videos",
        privacy: "PUBLIC",
        viewCountText: "1,234 views",
        lastUpdatedText: "Updated today",
        thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_playlist;

    expect(tool).toBeDefined();
    expect(tool.description).toContain("Fetch compact metadata for a public YouTube playlist");
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    await expect(
      tool.handler({
        playlist:
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
      })
    ).resolves.toEqual(
      createSuccessResult({
        summary: 'Loaded public playlist details for "Song Queue".',
        data: {
          id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
          canonicalUrl:
            "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
          title: "Song Queue",
          description: "Up next",
          channelTitle: "Google Developers",
          itemCountText: "12 videos",
          privacy: "PUBLIC",
          viewCountText: "1,234 views",
          lastUpdatedText: "Updated today",
          thumbnails: ["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]
        }
      })
    );
    expect(youtubeService.getPlaylist).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    );
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
          "Provide a YouTube playlist URL, a watch URL with `list=...`, or a bare playlist ID in `playlist`."
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
  });

  it("keeps the playlist payload compact and surfaces unavailable states cleanly", async () => {
    const longDescription = "A".repeat(420);
    const server = createServer({
      youtubeService: {
        getPlaylist: vi
          .fn()
          .mockResolvedValueOnce({
            kind: "playlist",
            id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
            canonicalUrl:
              "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
            source: "id",
            channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
            title: "Song Queue",
            description: longDescription,
            itemCountText: "12 videos",
            thumbnails: []
          })
          .mockRejectedValueOnce(
            new NotAvailableError("No public playlist is available for this ID.", {
              cause: "playlist_unavailable",
              details: {
                playlistId: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
              }
            })
          )
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_playlist;
    const success = (await tool.handler({
      playlist: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    })) as {
      structuredContent: {
        status: string;
        data: Record<string, unknown>;
      };
    };

    expect(success.structuredContent.status).toBe("ok");
    expect(success.structuredContent.data).toMatchObject({
      id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      title: "Song Queue",
      itemCountText: "12 videos"
    });
    expect(success.structuredContent.data.description).toBe(`${"A".repeat(397)}...`);
    expect(success.structuredContent.data).not.toHaveProperty("source");
    expect(success.structuredContent.data).not.toHaveProperty("channelId");

    await expect(
      tool.handler({
        playlist: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
      })
    ).resolves.toEqual(
      createNotAvailableResult({
        summary: "No public playlist is available for this ID.",
        reason: "playlist_unavailable",
        data: {
          playlistId: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
        }
      })
    );
  });
});
