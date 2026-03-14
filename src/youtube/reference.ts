export const YOUTUBE_CANONICAL_HOST = "https://www.youtube.com";

export type ParsedYouTubeReference =
  | YouTubeVideoReference
  | YouTubePlaylistReference
  | YouTubeChannelReference;

type ParsedReferenceBase = {
  input: string;
  canonicalUrl: string;
};

export type VideoUrlSource =
  | "id"
  | "watch"
  | "short_url"
  | "shorts"
  | "live"
  | "embed"
  | "legacy_embed"
  | "thumbnail";

export type PlaylistUrlSource = "id" | "playlist" | "watch";

export type ChannelUrlSource =
  | "id"
  | "handle"
  | "channel"
  | "custom"
  | "user"
  | "feed";

export type YouTubeVideoReference = ParsedReferenceBase & {
  kind: "video";
  id: string;
  source: VideoUrlSource;
  playlistId?: string;
  startTimeSeconds?: number;
};

export type YouTubePlaylistReference = ParsedReferenceBase & {
  kind: "playlist";
  id: string;
  source: PlaylistUrlSource;
  videoId?: string;
};

export type YouTubeChannelReference = ParsedReferenceBase & {
  kind: "channel";
  source: ChannelUrlSource;
  channelId?: string;
  handle?: string;
  customName?: string;
  username?: string;
};

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;
const CHANNEL_HANDLE_PATTERN = /^@[A-Za-z0-9._-]{3,30}$/;
const PLAYLIST_PATTERNS = [
  /^(PL|UU|LL|FL|WL)[A-Za-z0-9_-]{10,}$/,
  /^(RD|RDMM|RDEM|BLCM|RDCMUC)[A-Za-z0-9_-]{5,}$/,
  /^(OLAK5uy_|RDCLAK5uy_)[A-Za-z0-9_-]{5,}$/
];

export function isVideoId(value: string): boolean {
  return VIDEO_ID_PATTERN.test(value.trim());
}

export function isChannelId(value: string): boolean {
  return CHANNEL_ID_PATTERN.test(value.trim());
}

export function isChannelHandle(value: string): boolean {
  return CHANNEL_HANDLE_PATTERN.test(value.trim());
}

export function isPlaylistId(value: string): boolean {
  const candidate = value.trim();

  return PLAYLIST_PATTERNS.some(pattern => pattern.test(candidate));
}

export function createCanonicalVideoUrl(id: string): string {
  return `${YOUTUBE_CANONICAL_HOST}/watch?v=${id}`;
}

export function createCanonicalPlaylistUrl(id: string): string {
  return `${YOUTUBE_CANONICAL_HOST}/playlist?list=${id}`;
}

export function createCanonicalChannelIdUrl(channelId: string): string {
  return `${YOUTUBE_CANONICAL_HOST}/channel/${channelId}`;
}

export function createCanonicalHandleUrl(handle: string): string {
  return `${YOUTUBE_CANONICAL_HOST}/${handle}`;
}
