import { describe, expect, it } from "vitest";

import {
  isChannelHandle,
  isChannelId,
  isPlaylistId,
  isVideoId
} from "../../src/youtube/reference.js";

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
