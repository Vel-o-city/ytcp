import type {
  ParsedYouTubeReference,
  YouTubeChannelReference,
  YouTubePlaylistReference,
  YouTubeVideoReference
} from "./reference.js";

export type YouTubeLookupReference = ParsedYouTubeReference;

export type YouTubeVideoLookup = YouTubeVideoReference;

export type YouTubePlaylistLookup = YouTubePlaylistReference;

export type YouTubeChannelLookup = YouTubeChannelReference;

export type YouTubeLookupInput = string | YouTubeLookupReference;

export type YouTubeVideoInput = string | YouTubeVideoLookup;

export type YouTubePlaylistInput = string | YouTubePlaylistLookup;

export type YouTubeChannelInput = string | YouTubeChannelLookup;

export type YouTubeVideoRecord = {
  kind: "video";
  id: string;
  canonicalUrl: string;
  source: YouTubeVideoLookup["source"];
  title?: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  durationSeconds?: number;
  viewCount?: number;
  likeCount?: number;
  thumbnails: string[];
  keywords?: string[];
  isLive?: boolean;
  isUpcoming?: boolean;
  playlistId?: string;
  startTimeSeconds?: number;
};

export type YouTubePlaylistRecord = {
  kind: "playlist";
  id: string;
  canonicalUrl: string;
  source: YouTubePlaylistLookup["source"];
  title?: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  itemCountText?: string;
  privacy?: string;
  viewCountText?: string;
  lastUpdatedText?: string;
  thumbnails: string[];
};

export type YouTubeChannelRecord = {
  kind: "channel";
  canonicalUrl: string;
  source: YouTubeChannelLookup["source"];
  id?: string;
  handle?: string;
  title?: string;
  description?: string;
  subscriberCountText?: string;
  videoCountText?: string;
  viewCountText?: string;
  thumbnails: string[];
};

export type YouTubeService = {
  parseInput: (input: string) => YouTubeLookupReference;
  getVideo: (input: YouTubeVideoInput) => Promise<YouTubeVideoRecord>;
  getPlaylist: (input: YouTubePlaylistInput) => Promise<YouTubePlaylistRecord>;
  getChannel: (input: YouTubeChannelInput) => Promise<YouTubeChannelRecord>;
};
