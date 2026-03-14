import { describe, expect, it } from "vitest";

import {
  isChannelHandle,
  isChannelId,
  isPlaylistId,
  isVideoId
} from "../../src/youtube/reference.js";
import {
  normalizeYouTubeUrl,
  parseYouTubeInput
} from "../../src/youtube/parser.js";
import * as youtubeModule from "../../src/youtube/index.js";
import * as rootModule from "../../src/index.js";

describe("youtube reference validators", () => {
  it("accepts valid bare identifiers", () => {
    expect(isVideoId("dQw4w9WgXcQ")).toBe(true);
    expect(isPlaylistId("PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK")).toBe(true);
    expect(isChannelId("UC_x5XG1OV2P6uZZ5FSM9Ttw")).toBe(true);
    expect(isChannelHandle("@GoogleDevelopers")).toBe(true);
  });

  it("rejects malformed bare identifiers", () => {
    expect(isVideoId("too-short")).toBe(false);
    expect(isPlaylistId("not-a-playlist")).toBe(false);
    expect(isChannelId("@GoogleDevelopers")).toBe(false);
    expect(isChannelHandle("GoogleDevelopers")).toBe(false);
  });
});

describe("parseYouTubeInput", () => {
  it("parses bare identifiers into typed references", () => {
    expect(parseYouTubeInput("dQw4w9WgXcQ")).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "id",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });

    expect(parseYouTubeInput("PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK")).toMatchObject({
      kind: "playlist",
      id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      source: "id",
      canonicalUrl:
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    });

    expect(parseYouTubeInput("@GoogleDevelopers")).toMatchObject({
      kind: "channel",
      source: "handle",
      handle: "@GoogleDevelopers",
      canonicalUrl: "https://www.youtube.com/@GoogleDevelopers"
    });
  });

  it("normalizes watch and short links into canonical video references", () => {
    expect(
      parseYouTubeInput(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK&t=2m30s&si=share"
      )
    ).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "watch",
      playlistId: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      startTimeSeconds: 150,
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });

    expect(parseYouTubeInput("https://youtu.be/dQw4w9WgXcQ?t=88")).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "short_url",
      startTimeSeconds: 88,
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
  });

  it("unwraps attribution and redirect URLs before parsing", () => {
    expect(
      parseYouTubeInput(
        "https://www.youtube.com/attribution_link?u=%2Fwatch%3Fv%3DdQw4w9WgXcQ%26t%3D43"
      )
    ).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "watch",
      startTimeSeconds: 43,
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });

    expect(
      parseYouTubeInput(
        "https://www.google.com/url?url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ%3Ft%3D12"
      )
    ).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "short_url",
      startTimeSeconds: 12,
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
  });

  it("returns actionable errors for unsupported or ambiguous input", () => {
    expect(() => parseYouTubeInput("not-a-youtube-id")).toThrow(
      "not a recognized YouTube URL or supported bare identifier"
    );
    expect(() => parseYouTubeInput("https://www.youtube.com/clip/Ugkxabc")).toThrow(
      "Clip URLs are not supported yet"
    );
    expect(() => parseYouTubeInput("https://vimeo.com/123")).toThrow(
      "not a supported YouTube host"
    );
  });

  it("supports shorts, live, embed, music, mobile, and thumbnail URLs", () => {
    expect(parseYouTubeInput("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "shorts",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });

    expect(parseYouTubeInput("https://www.youtube.com/live/dQw4w9WgXcQ?t=120")).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "live",
      startTimeSeconds: 120,
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });

    expect(
      parseYouTubeInput("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30")
    ).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "embed",
      startTimeSeconds: 30,
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });

    expect(parseYouTubeInput("https://music.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "watch"
    });

    expect(parseYouTubeInput("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "watch"
    });

    expect(
      parseYouTubeInput("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg")
    ).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ",
      source: "thumbnail",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
  });

  it("supports representative playlist and channel URL families", () => {
    expect(
      parseYouTubeInput(
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
      )
    ).toMatchObject({
      kind: "playlist",
      id: "PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK",
      source: "playlist",
      canonicalUrl:
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    });

    expect(
      parseYouTubeInput(
        "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/videos"
      )
    ).toMatchObject({
      kind: "channel",
      source: "channel",
      channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      canonicalUrl: "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"
    });

    expect(parseYouTubeInput("https://www.youtube.com/@GoogleDevelopers/about")).toMatchObject({
      kind: "channel",
      source: "handle",
      handle: "@GoogleDevelopers",
      canonicalUrl: "https://www.youtube.com/@GoogleDevelopers"
    });

    expect(
      parseYouTubeInput(
        "https://www.youtube.com/feeds/videos.xml?channel_id=UC_x5XG1OV2P6uZZ5FSM9Ttw"
      )
    ).toMatchObject({
      kind: "channel",
      source: "feed",
      channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
      canonicalUrl: "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"
    });
  });
});

describe("normalizeYouTubeUrl", () => {
  it("returns the canonical lookup URL for supported inputs", () => {
    expect(normalizeYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=99")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(
      normalizeYouTubeUrl(
        "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
      )
    ).toBe(
      "https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F1F9QK3Zc7N0b9dYxK"
    );
  });
});

describe("youtube module exports", () => {
  it("re-exports the parser utilities through the youtube module surface", () => {
    expect(youtubeModule.parseYouTubeInput).toBe(parseYouTubeInput);
    expect(youtubeModule.normalizeYouTubeUrl).toBe(normalizeYouTubeUrl);
    expect(youtubeModule.isVideoId("dQw4w9WgXcQ")).toBe(true);
  });

  it("re-exports the youtube module surface from the package entry", () => {
    expect(rootModule.parseYouTubeInput("dQw4w9WgXcQ")).toMatchObject({
      kind: "video",
      id: "dQw4w9WgXcQ"
    });
    expect(rootModule.normalizeYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
  });
});
