import { InvalidInputError } from "../lib/mcp-errors.js";
import {
  createCanonicalChannelIdUrl,
  createCanonicalHandleUrl,
  createCanonicalPlaylistUrl,
  createCanonicalVideoUrl,
  isChannelHandle,
  isChannelId,
  isPlaylistId,
  isVideoId,
  type ChannelUrlSource,
  type ParsedYouTubeReference,
  type PlaylistUrlSource,
  type VideoUrlSource,
  YOUTUBE_CANONICAL_HOST
} from "./reference.js";

const MAX_UNWRAP_DEPTH = 3;
const CANONICAL_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com"
]);
const EMBED_HOSTS = new Set(["youtube-nocookie.com", "www.youtube-nocookie.com"]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);
const THUMBNAIL_HOSTS = new Set([
  "img.youtube.com",
  "i.ytimg.com",
  "www.i.ytimg.com"
]);
const GOOGLE_REDIRECT_HOSTS = new Set(["google.com", "www.google.com"]);
const SHARE_TRACKING_KEYS = ["si", "feature", "pp"];
const CANONICAL_CHANNEL_SUBPAGES = new Set([
  "videos",
  "shorts",
  "streams",
  "playlists",
  "community",
  "about"
]);

export function normalizeYouTubeUrl(input: string): string {
  return parseYouTubeInput(input).canonicalUrl;
}

export function parseYouTubeInput(input: string): ParsedYouTubeReference {
  const sanitizedInput = sanitizeInput(input);

  if (!sanitizedInput) {
    throw new InvalidInputError(
      "Provide a YouTube URL, a bare 11-character video ID, a playlist ID, or a channel handle/ID."
    );
  }

  return parseCandidate(sanitizedInput, sanitizedInput, 0);
}

function parseCandidate(
  candidate: string,
  originalInput: string,
  depth: number
): ParsedYouTubeReference {
  if (depth > MAX_UNWRAP_DEPTH) {
    throw new InvalidInputError(
      "That YouTube link is wrapped too many times to parse safely. Pass the direct YouTube URL instead."
    );
  }

  const directReference = parseBareReference(candidate, originalInput);

  if (directReference) {
    return directReference;
  }

  if (!candidate.includes("/") && !candidate.includes(".")) {
    throw new InvalidInputError(
      "That input is not a recognized YouTube URL or supported bare identifier. Pass a full YouTube URL, a playlist ID, a channel handle like @name, or an 11-character video ID."
    );
  }

  const url = tryParseUrl(candidate);

  if (!url) {
    throw new InvalidInputError(
      "That input is not a recognized YouTube URL or supported bare identifier. Pass a full YouTube URL, a playlist ID, a channel handle like @name, or an 11-character video ID."
    );
  }

  const unwrappedInput = unwrapNestedUrl(url);

  if (unwrappedInput) {
    return parseCandidate(unwrappedInput, originalInput, depth + 1);
  }

  return parseUrlReference(url, originalInput);
}

function sanitizeInput(input: string): string {
  return input.trim().replaceAll("&amp;", "&");
}

function parseBareReference(
  candidate: string,
  originalInput: string
): ParsedYouTubeReference | null {
  if (isVideoId(candidate)) {
    return {
      kind: "video",
      id: candidate,
      input: originalInput,
      source: "id",
      canonicalUrl: createCanonicalVideoUrl(candidate)
    };
  }

  if (isPlaylistId(candidate)) {
    return {
      kind: "playlist",
      id: candidate,
      input: originalInput,
      source: "id",
      canonicalUrl: createCanonicalPlaylistUrl(candidate)
    };
  }

  if (isChannelId(candidate)) {
    return {
      kind: "channel",
      input: originalInput,
      source: "id",
      channelId: candidate,
      canonicalUrl: createCanonicalChannelIdUrl(candidate)
    };
  }

  if (isChannelHandle(candidate)) {
    return {
      kind: "channel",
      input: originalInput,
      source: "handle",
      handle: candidate,
      canonicalUrl: createCanonicalHandleUrl(candidate)
    };
  }

  return null;
}

function tryParseUrl(candidate: string): URL | null {
  try {
    return new URL(candidate);
  } catch {
    try {
      return new URL(`https://${candidate}`);
    } catch {
      return null;
    }
  }
}

function unwrapNestedUrl(url: URL): string | null {
  const host = url.hostname.toLowerCase();

  if (GOOGLE_REDIRECT_HOSTS.has(host) && url.pathname === "/url") {
    return url.searchParams.get("url") ?? url.searchParams.get("q");
  }

  if (CANONICAL_HOSTS.has(host) || EMBED_HOSTS.has(host)) {
    if (url.pathname === "/attribution_link") {
      const innerPath = url.searchParams.get("u");

      if (!innerPath) {
        return null;
      }

      const decodedInnerPath = decodeURIComponent(innerPath);

      return decodedInnerPath.startsWith("/")
        ? `${YOUTUBE_CANONICAL_HOST}${decodedInnerPath}`
        : decodedInnerPath;
    }

    if (url.pathname === "/oembed") {
      return url.searchParams.get("url");
    }
  }

  return null;
}

function parseUrlReference(
  url: URL,
  originalInput: string
): ParsedYouTubeReference {
  const host = url.hostname.toLowerCase();

  if (SHORT_HOSTS.has(host)) {
    const shortVideoId = getPathSegment(url, 0);

    if (shortVideoId && isVideoId(shortVideoId)) {
      return createVideoReference(originalInput, shortVideoId, "short_url", {
        startTimeSeconds: extractStartTime(url)
      });
    }
  }

  if (THUMBNAIL_HOSTS.has(host)) {
    const thumbnailIdMatch = url.pathname.match(/^\/(?:vi|vi_webp)\/([A-Za-z0-9_-]{11})\//);

    if (thumbnailIdMatch) {
      return createVideoReference(originalInput, thumbnailIdMatch[1], "thumbnail");
    }
  }

  if (!(CANONICAL_HOSTS.has(host) || EMBED_HOSTS.has(host))) {
    throw new InvalidInputError(
      "That URL is not a supported YouTube host. Pass a youtube.com, youtu.be, youtube-nocookie.com, or ytimg.com URL."
    );
  }

  const pathname = trimTrailingSlash(url.pathname);
  const segments = pathname.split("/").filter(Boolean);

  if (pathname === "/watch") {
    return parseWatchReference(url, originalInput);
  }

  if (segments[0] === "watch" && segments[1] && isVideoId(segments[1])) {
    return createVideoReference(originalInput, segments[1], "watch", {
      playlistId: getPlaylistId(url),
      startTimeSeconds: extractStartTime(url)
    });
  }

  if (segments[0] === "playlist") {
    const playlistId = url.searchParams.get("list");

    if (!playlistId || !isPlaylistId(playlistId)) {
      throw new InvalidInputError(
        "Playlist URLs must include a valid `list=` parameter."
      );
    }

    return createPlaylistReference(originalInput, playlistId, "playlist");
  }

  if (segments[0] === "shorts" || segments[0] === "live") {
    const videoId = segments[1];

    if (videoId && isVideoId(videoId)) {
      return createVideoReference(
        originalInput,
        videoId,
        segments[0] === "shorts" ? "shorts" : "live",
        {
          startTimeSeconds: extractStartTime(url)
        }
      );
    }
  }

  if (
    (segments[0] === "embed" ||
      segments[0] === "v" ||
      segments[0] === "vi" ||
      segments[0] === "e") &&
    segments[1] &&
    isVideoId(segments[1])
  ) {
    const source: VideoUrlSource =
      segments[0] === "embed" ? "embed" : "legacy_embed";

    return createVideoReference(originalInput, segments[1], source, {
      startTimeSeconds: extractStartTime(url)
    });
  }

  if (segments[0] === "clip") {
    throw new InvalidInputError(
      "Clip URLs are not supported yet. Pass the source video URL or video ID instead."
    );
  }

  if (segments[0] === "channel" && segments[1] && isChannelId(segments[1])) {
    return createChannelReference(originalInput, "channel", {
      channelId: segments[1]
    });
  }

  if (segments[0]?.startsWith("@") && isChannelHandle(segments[0])) {
    return createChannelReference(originalInput, "handle", {
      handle: segments[0]
    });
  }

  if (segments[0] === "c" && segments[1]) {
    return createChannelReference(originalInput, "custom", {
      customName: segments[1]
    });
  }

  if (segments[0] === "user" && segments[1]) {
    return createChannelReference(originalInput, "user", {
      username: segments[1]
    });
  }

  if (pathname === "/feeds/videos.xml") {
    const channelId = url.searchParams.get("channel_id");

    if (channelId && isChannelId(channelId)) {
      return createChannelReference(originalInput, "feed", { channelId });
    }
  }

  throw new InvalidInputError(
    "That YouTube URL could not be normalized into a supported video, playlist, or channel reference."
  );
}

function parseWatchReference(
  url: URL,
  originalInput: string
): ParsedYouTubeReference {
  SHARE_TRACKING_KEYS.forEach(parameter => {
    url.searchParams.delete(parameter);
  });

  const videoId = url.searchParams.get("v");

  if (videoId && isVideoId(videoId)) {
    return createVideoReference(originalInput, videoId, "watch", {
      playlistId: getPlaylistId(url),
      startTimeSeconds: extractStartTime(url)
    });
  }

  const playlistId = url.searchParams.get("list");

  if (playlistId && isPlaylistId(playlistId)) {
    return createPlaylistReference(originalInput, playlistId, "watch", {
      videoId: undefined
    });
  }

  throw new InvalidInputError(
    "Watch URLs must include a valid `v=` video ID or `list=` playlist ID."
  );
}

function createVideoReference(
  input: string,
  id: string,
  source: VideoUrlSource,
  options: {
    playlistId?: string;
    startTimeSeconds?: number;
  } = {}
): ParsedYouTubeReference {
  return {
    kind: "video",
    id,
    input,
    source,
    canonicalUrl: createCanonicalVideoUrl(id),
    ...(options.playlistId ? { playlistId: options.playlistId } : {}),
    ...(typeof options.startTimeSeconds === "number"
      ? { startTimeSeconds: options.startTimeSeconds }
      : {})
  };
}

function createPlaylistReference(
  input: string,
  id: string,
  source: PlaylistUrlSource,
  options: {
    videoId?: string;
  } = {}
): ParsedYouTubeReference {
  return {
    kind: "playlist",
    id,
    input,
    source,
    canonicalUrl: createCanonicalPlaylistUrl(id),
    ...(options.videoId ? { videoId: options.videoId } : {})
  };
}

function createChannelReference(
  input: string,
  source: ChannelUrlSource,
  options: {
    channelId?: string;
    handle?: string;
    customName?: string;
    username?: string;
  }
): ParsedYouTubeReference {
  if (options.handle) {
    return {
      kind: "channel",
      input,
      source,
      handle: options.handle,
      canonicalUrl: createCanonicalHandleUrl(options.handle)
    };
  }

  if (options.channelId) {
    return {
      kind: "channel",
      input,
      source,
      channelId: options.channelId,
      canonicalUrl: createCanonicalChannelIdUrl(options.channelId)
    };
  }

  if (options.customName) {
    return {
      kind: "channel",
      input,
      source,
      customName: options.customName,
      canonicalUrl: `${YOUTUBE_CANONICAL_HOST}/c/${options.customName}`
    };
  }

  if (options.username) {
    return {
      kind: "channel",
      input,
      source,
      username: options.username,
      canonicalUrl: `${YOUTUBE_CANONICAL_HOST}/user/${options.username}`
    };
  }

  throw new InvalidInputError(
    "Channel inputs must include a channel ID, handle, custom URL name, or username."
  );
}

function getPathSegment(url: URL, index: number): string | undefined {
  return trimTrailingSlash(url.pathname).split("/").filter(Boolean)[index];
}

function getPlaylistId(url: URL): string | undefined {
  const playlistId = url.searchParams.get("list");

  return playlistId && isPlaylistId(playlistId) ? playlistId : undefined;
}

function extractStartTime(url: URL): number | undefined {
  const candidates = [
    url.searchParams.get("t"),
    url.searchParams.get("start"),
    url.searchParams.get("time_continue"),
    new URLSearchParams(url.hash.replace(/^#/, "")).get("t")
  ];

  for (const candidate of candidates) {
    const parsed = parseTimeCandidate(candidate);

    if (typeof parsed === "number") {
      return parsed;
    }
  }

  return undefined;
}

function parseTimeCandidate(candidate: string | null): number | undefined {
  if (!candidate) {
    return undefined;
  }

  if (/^\d+$/.test(candidate)) {
    return Number(candidate);
  }

  const pattern = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
  const match = candidate.match(pattern);

  if (!match) {
    return undefined;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  return totalSeconds > 0 ? totalSeconds : undefined;
}

function trimTrailingSlash(value: string): string {
  if (value.length > 1 && value.endsWith("/")) {
    return value.slice(0, -1);
  }

  return value;
}
