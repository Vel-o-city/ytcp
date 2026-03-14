import type {
  YouTubeChannelLookup,
  YouTubeChannelRecord,
  YouTubePlaylistLookup,
  YouTubePlaylistRecord,
  YouTubeVideoLookup,
  YouTubeVideoRecord
} from "./contracts.js";

type UnknownRecord = Record<string, unknown>;

export function normalizeVideoRecord(
  response: unknown,
  reference: YouTubeVideoLookup
): YouTubeVideoRecord {
  const basicInfo = asRecord(getValue(response, "basic_info"));
  const channel = asRecord(getValue(basicInfo, "channel"));

  return {
    kind: "video",
    id: reference.id,
    canonicalUrl: reference.canonicalUrl,
    source: reference.source,
    title: pickText(getValue(basicInfo, "title")),
    description: pickText(
      getValue(basicInfo, "short_description"),
      getValue(response, "description")
    ),
    channelId: pickText(
      getValue(channel, "id"),
      getValue(basicInfo, "channel_id")
    ),
    channelTitle: pickText(
      getValue(channel, "name"),
      getValue(basicInfo, "author")
    ),
    durationSeconds: pickNumber(getValue(basicInfo, "duration")),
    viewCount: pickNumber(getValue(basicInfo, "view_count")),
    likeCount: pickNumber(getValue(basicInfo, "like_count")),
    thumbnails: extractThumbnailUrls(getValue(basicInfo, "thumbnail")),
    keywords: extractTextList(getValue(basicInfo, "keywords")),
    isLive: pickBoolean(
      getValue(basicInfo, "is_live"),
      getValue(basicInfo, "is_live_content")
    ),
    isUpcoming: pickBoolean(getValue(basicInfo, "is_upcoming")),
    ...(reference.playlistId ? { playlistId: reference.playlistId } : {}),
    ...(typeof reference.startTimeSeconds === "number"
      ? { startTimeSeconds: reference.startTimeSeconds }
      : {})
  };
}

export function normalizePlaylistRecord(
  response: unknown,
  reference: YouTubePlaylistLookup
): YouTubePlaylistRecord {
  const info = asRecord(getValue(response, "info"));
  const author = asRecord(getValue(info, "author"));

  return {
    kind: "playlist",
    id: reference.id,
    canonicalUrl: reference.canonicalUrl,
    source: reference.source,
    title: pickText(getValue(info, "title")),
    description: pickText(getValue(info, "description")),
    channelId: pickText(
      getValue(author, "id"),
      getValue(author, "channel_id")
    ),
    channelTitle: pickText(getValue(author, "name"), author),
    itemCountText: pickText(getValue(info, "total_items")),
    privacy: pickText(getValue(info, "privacy")),
    viewCountText: pickText(getValue(info, "views")),
    lastUpdatedText: pickText(getValue(info, "last_updated")),
    thumbnails: extractThumbnailUrls(getValue(info, "thumbnails"))
  };
}

export function normalizeChannelRecord(
  response: unknown,
  reference: YouTubeChannelLookup
): YouTubeChannelRecord {
  const metadata = asRecord(getValue(response, "metadata"));
  const header = asRecord(getValue(response, "header"));

  return {
    kind: "channel",
    canonicalUrl: reference.canonicalUrl,
    source: reference.source,
    id: pickText(
      getValue(metadata, "external_id"),
      reference.channelId
    ),
    handle: pickText(
      reference.handle,
      extractHandleFromUrl(
        pickText(
          getValue(metadata, "vanity_channel_url"),
          getValue(metadata, "url_canonical"),
          getValue(metadata, "url")
        )
      )
    ),
    title: pickText(
      getValue(metadata, "title"),
      getValue(header, "title")
    ),
    description: pickText(getValue(metadata, "description")),
    subscriberCountText: pickText(
      getValue(header, "subscriber_count_text"),
      getValue(header, "subscriber_count")
    ),
    videoCountText: pickText(
      getValue(header, "video_count_text"),
      getValue(header, "video_count")
    ),
    viewCountText: pickText(
      getValue(header, "view_count_text"),
      getValue(header, "view_count")
    ),
    thumbnails: extractThumbnailUrls(
      getValue(metadata, "avatar") ?? getValue(metadata, "thumbnail")
    )
  };
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" ? (value as UnknownRecord) : undefined;
}

function getValue(value: unknown, key: string): unknown {
  return asRecord(value)?.[key];
}

function pickText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = toText(value);

    if (text) {
      return text;
    }
  }

  return undefined;
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    const parts = value
      .map(item => toText(item))
      .filter((item): item is string => Boolean(item));

    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const directText = pickText(record.text, record.simpleText);

  if (directText) {
    return directText;
  }

  if (Array.isArray(record.runs)) {
    const runsText = record.runs
      .map(item => toText(item))
      .filter((item): item is string => Boolean(item))
      .join("");

    if (runsText) {
      return runsText;
    }
  }

  const stringified = String(record);

  return stringified !== "[object Object]" ? stringified : undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function pickBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

function extractTextList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .map(item => toText(item))
    .filter((item): item is string => Boolean(item));

  return values.length > 0 ? values : undefined;
}

function extractThumbnailUrls(value: unknown): string[] {
  const urls = new Set<string>();

  collectThumbnailUrls(value, urls);

  return [...urls];
}

function collectThumbnailUrls(value: unknown, urls: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach(item => collectThumbnailUrls(item, urls));
    return;
  }

  const record = asRecord(value);

  if (!record) {
    return;
  }

  if (typeof record.url === "string" && record.url.trim()) {
    urls.add(record.url);
  }

  if (record.thumbnails) {
    collectThumbnailUrls(record.thumbnails, urls);
  }
}

function extractHandleFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/\/(@[A-Za-z0-9._-]{3,30})(?:[/?#]|$)/);

  return match?.[1];
}
