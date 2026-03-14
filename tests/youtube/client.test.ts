import { describe, expect, it } from "vitest";

import {
  type YouTubeChannelRecord,
  type YouTubePlaylistRecord,
  type YouTubeVideoRecord
} from "../../src/youtube/contracts.js";
import {
  normalizeChannelRecord,
  normalizePlaylistRecord,
  normalizeVideoRecord
} from "../../src/youtube/normalize.js";
import { parseYouTubeInput } from "../../src/youtube/parser.js";

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
      reference
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
      reference
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
      reference
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
