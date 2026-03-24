import type {
  YouTubeChannelVideoItem,
  YouTubePlaylistItem,
  YouTubeSearchFilters,
  YouTubeSearchPage,
  YouTubeSearchQuery,
  YouTubeSearchResult,
  YouTubeTranscriptLanguage,
  YouTubeTranscriptRetrievalMethod,
  YouTubeTranscriptRecord,
  YouTubeTranscriptSegment,
  YouTubeVideoChapter,
  YouTubeChannelLookup,
  YouTubeChannelRecord,
  YouTubePlaylistLookup,
  YouTubePlaylistRecord,
  YouTubeVideoLookup,
  YouTubeVideoRecord
} from "./contracts.js";
import type { InnertubeClientLike } from "./client.js";
import { createCanonicalVideoUrl } from "./reference.js";

type UnknownRecord = Record<string, unknown>;
type InnertubeSearchFilters = Parameters<InnertubeClientLike["search"]>[1];
const SEARCH_REFINEMENT_LIMIT = 3;
const SEARCH_SNIPPET_MAX_LENGTH = 160;
const SEARCH_THUMBNAIL_LIMIT = 1;
const PLAYLIST_THUMBNAIL_LIMIT = 1;

export function normalizeVideoRecord(
  response: unknown,
  reference: YouTubeVideoLookup
): YouTubeVideoRecord {
  const basicInfo = asRecord(getValue(response, "basic_info"));
  const channel = asRecord(getValue(basicInfo, "channel"));
  const chapters = extractVideoChapters(response);

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
    category: pickText(getValue(basicInfo, "category")),
    isFamilySafe: pickBoolean(getValue(basicInfo, "is_family_safe")),
    isUnlisted: pickBoolean(getValue(basicInfo, "is_unlisted")),
    isLive: pickBoolean(
      getValue(basicInfo, "is_live"),
      getValue(basicInfo, "is_live_content")
    ),
    isUpcoming: pickBoolean(getValue(basicInfo, "is_upcoming")),
    ...(chapters ? { chapters } : {}),
    ...(reference.playlistId ? { playlistId: reference.playlistId } : {}),
    ...(typeof reference.startTimeSeconds === "number"
      ? { startTimeSeconds: reference.startTimeSeconds }
      : {})
  };
}

export function normalizePlaylistRecord(
  response: unknown,
  reference: YouTubePlaylistLookup,
  options: {
    maxResults?: number;
  } = {}
): YouTubePlaylistRecord {
  const info = asRecord(getValue(response, "info"));
  const author = asRecord(getValue(info, "author"));
  const items = extractPlaylistItems(getValue(response, "items")).slice(
    0,
    options.maxResults ?? Number.POSITIVE_INFINITY
  );

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
    thumbnails: extractThumbnailUrls(getValue(info, "thumbnails")),
    pageSize: items.length,
    items
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
      extractHandleFromUrl(
        pickText(
          getValue(metadata, "vanity_channel_url"),
          getValue(metadata, "url_canonical"),
          getValue(metadata, "url")
        )
      ),
      reference.handle
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

export function extractChannelVideos(response: unknown): YouTubeChannelVideoItem[] {
  const videos = getValue(response, "videos");

  if (!Array.isArray(videos)) {
    return [];
  }

  return videos
    .map(item => normalizeChannelVideoItem(item))
    .filter((item): item is YouTubeChannelVideoItem => Boolean(item));
}

function normalizeChannelVideoItem(value: unknown): YouTubeChannelVideoItem | null {
  const item = asRecord(value);

  if (!item) {
    return null;
  }

  const id = pickText(item.video_id, item.videoId, item.id);

  if (!id) {
    return null;
  }

  const title = pickText(item.title);

  if (!title) {
    return null;
  }

  return {
    id,
    canonicalUrl: createCanonicalVideoUrl(id),
    title,
    thumbnails: extractThumbnailUrls(item.thumbnails).slice(0, 1),
    publishedText: pickText(item.published),
    durationText: pickText(item.duration, item.length_text),
    viewCountText: pickText(item.views, item.view_count, item.short_view_count)
  };
}

export function toInnertubeSearchFilters(
  filters?: YouTubeSearchFilters
): InnertubeSearchFilters {
  if (!filters) {
    return undefined;
  }

  const normalizedFeatures = filters.features?.filter(
    (feature, index, values) => values.indexOf(feature) === index
  );

  const mapped: NonNullable<InnertubeSearchFilters> = {
    ...(filters.uploadDate ? { upload_date: filters.uploadDate } : {}),
    ...(filters.duration ? { duration: filters.duration } : {}),
    ...(filters.sortBy ? { sort_by: filters.sortBy } : {}),
    ...(normalizedFeatures && normalizedFeatures.length > 0
      ? { features: normalizedFeatures }
      : {})
  };

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

export function normalizeSearchPage(
  response: unknown,
  query: Extract<YouTubeSearchQuery, { query: string }>
): YouTubeSearchPage {
  const videos = extractSearchResults(getValue(response, "videos"));
  const boundedResults = videos.slice(0, query.maxResults ?? videos.length);
  const estimatedResults = pickNumber(getValue(response, "estimated_results"));
  const refinements = extractTextList(getValue(response, "refinements"))?.slice(
    0,
    SEARCH_REFINEMENT_LIMIT
  );

  return {
    query: query.query,
    pageSize: boundedResults.length,
    ...(typeof estimatedResults === "number" ? { estimatedResults } : {}),
    ...(refinements && refinements.length > 0 ? { refinements } : {}),
    ...(query.filters ? { filters: query.filters } : {}),
    results: boundedResults
  };
}

export function normalizeTranscriptRecord(
  transcript: unknown,
  reference: YouTubeVideoLookup,
  videoResponse?: unknown,
  options: {
    includeTimestamps?: boolean;
    retrievalMethod?: YouTubeTranscriptRetrievalMethod;
  } = {}
): YouTubeTranscriptRecord {
  const segments = extractTranscriptSegments(transcript);
  const languages = extractTranscriptLanguages(
    transcript,
    getValue(videoResponse, "captions")
  );
  const selectedLanguage =
    pickText(getValue(transcript, "selectedLanguage")) ??
    languages.find(language => language.isSelected)?.label ??
    "Unknown";

  return createTranscriptRecord({
    reference,
    videoResponse,
    language: selectedLanguage,
    languages,
    segments,
    includeTimestamps: options.includeTimestamps,
    retrievalMethod: options.retrievalMethod
  });
}

export function createTranscriptRecord(options: {
  reference: YouTubeVideoLookup;
  videoResponse?: unknown;
  language: string;
  languages: YouTubeTranscriptLanguage[];
  segments: YouTubeTranscriptSegment[];
  includeTimestamps?: boolean;
  retrievalMethod?: YouTubeTranscriptRetrievalMethod;
}): YouTubeTranscriptRecord {
  const basicInfo = asRecord(getValue(options.videoResponse, "basic_info"));
  const channel = asRecord(getValue(basicInfo, "channel"));

  return {
    kind: "transcript",
    videoId: options.reference.id,
    canonicalUrl: options.reference.canonicalUrl,
    source: options.reference.source,
    title: pickText(getValue(basicInfo, "title")),
    channelTitle: pickText(
      getValue(channel, "name"),
      getValue(basicInfo, "author")
    ),
    language: options.language,
    languages: options.languages,
    includeTimestamps: options.includeTimestamps ?? false,
    retrievalMethod: options.retrievalMethod ?? "primary",
    segmentCount: options.segments.length,
    segments: options.segments,
    text: formatTranscriptText(options.segments, {
      includeTimestamps: options.includeTimestamps
    })
  };
}

export function formatTranscriptText(
  segments: YouTubeTranscriptSegment[],
  options: {
    includeTimestamps?: boolean;
  } = {}
): string {
  if (options.includeTimestamps) {
    return segments
      .map(segment => `${segment.startTimeText} ${segment.text}`)
      .join("\n");
  }

  return segments.map(segment => segment.text).join("\n");
}

export function formatTranscriptTimestamp(totalSeconds: number): string {
  const boundedSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(boundedSeconds / 3600);
  const minutes = Math.floor((boundedSeconds % 3600) / 60);
  const seconds = boundedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
      .map(item => {
        const run = asRecord(item);

        if (typeof run?.text === "string") {
          return run.text;
        }

        if (typeof run?.simpleText === "string") {
          return run.simpleText;
        }

        return toText(item);
      })
      .filter((item): item is string => Boolean(item))
      .join("")
      .trim();

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

function extractVideoChapters(value: unknown): YouTubeVideoChapter[] | undefined {
  const markers = getValue(
    getValue(
      getValue(getValue(value, "player_overlays"), "decorated_player_bar"),
      "player_bar"
    ),
    "markers_map"
  );

  if (!Array.isArray(markers)) {
    return undefined;
  }

  const chapters = markers
    .flatMap(marker => {
      const chapterNodes = getValue(asRecord(marker)?.value, "chapters");

      return Array.isArray(chapterNodes) ? chapterNodes : [];
    })
    .map(chapter => normalizeVideoChapter(chapter))
    .filter((chapter): chapter is YouTubeVideoChapter => Boolean(chapter));

  return chapters.length > 0 ? chapters : undefined;
}

function normalizeVideoChapter(value: unknown): YouTubeVideoChapter | null {
  const chapter = asRecord(value);

  if (!chapter) {
    return null;
  }

  const title = pickText(getValue(chapter, "title"));
  const startMillis = pickNumber(getValue(chapter, "time_range_start_millis"));

  if (!title || typeof startMillis !== "number") {
    return null;
  }

  const thumbnailUrl = extractThumbnailUrls(getValue(chapter, "thumbnail"))[0];

  return {
    title,
    startTimeSeconds: Math.max(0, Math.floor(startMillis / 1000)),
    ...(thumbnailUrl ? { thumbnailUrl } : {})
  };
}

function extractTranscriptSegments(value: unknown): YouTubeTranscriptSegment[] {
  const transcriptBody = getValue(
    getValue(getValue(getValue(value, "transcript"), "content"), "body"),
    "initial_segments"
  );

  if (!Array.isArray(transcriptBody)) {
    return [];
  }

  return transcriptBody
    .map(segment => normalizeTranscriptSegment(segment))
    .filter((segment): segment is YouTubeTranscriptSegment => Boolean(segment));
}

function normalizeTranscriptSegment(value: unknown): YouTubeTranscriptSegment | null {
  const segment = asRecord(value);

  if (!segment) {
    return null;
  }

  const text = pickText(getValue(segment, "snippet"));
  const startMs = pickNumber(getValue(segment, "start_ms"));
  const endMs = pickNumber(getValue(segment, "end_ms"));
  const startTimeText = pickText(getValue(segment, "start_time_text"));

  if (
    !text ||
    typeof startMs !== "number" ||
    typeof endMs !== "number" ||
    !startTimeText
  ) {
    return null;
  }

  return {
    startMs,
    endMs,
    startTimeSeconds: Math.max(0, Math.floor(startMs / 1000)),
    endTimeSeconds: Math.max(0, Math.floor(endMs / 1000)),
    startTimeText,
    text
  };
}

function extractTranscriptLanguages(
  transcript: unknown,
  captions: unknown
): YouTubeTranscriptLanguage[] {
  const selectedLanguage = pickText(getValue(transcript, "selectedLanguage"));
  const names = extractTextList(getValue(transcript, "languages")) ?? [];
  const captionTracks = extractCaptionTracks(captions);
  const translationLanguages = extractTranslationLanguages(captions);
  const languages = new Map<string, YouTubeTranscriptLanguage>();

  for (const name of names) {
    const metadata = findLanguageMetadata(name, captionTracks, translationLanguages);

    languages.set(normalizeLanguageKey(name), {
      label: name,
      isSelected: name === selectedLanguage,
      ...(metadata?.languageCode ? { languageCode: metadata.languageCode } : {}),
      ...(typeof metadata?.isAutoGenerated === "boolean"
        ? { isAutoGenerated: metadata.isAutoGenerated }
        : {}),
      ...(typeof metadata?.isTranslatable === "boolean"
        ? { isTranslatable: metadata.isTranslatable }
        : {})
    });
  }

  for (const track of captionTracks) {
    const key = normalizeLanguageKey(track.label);

    if (!languages.has(key)) {
      languages.set(key, {
        label: track.label,
        isSelected: track.label === selectedLanguage,
        ...(track.languageCode ? { languageCode: track.languageCode } : {}),
        ...(typeof track.isAutoGenerated === "boolean"
          ? { isAutoGenerated: track.isAutoGenerated }
          : {}),
        ...(typeof track.isTranslatable === "boolean"
          ? { isTranslatable: track.isTranslatable }
          : {})
      });
    }
  }

  return [...languages.values()];
}

function extractSearchResults(value: unknown): YouTubeSearchResult[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => normalizeSearchResult(item))
    .filter((item): item is YouTubeSearchResult => Boolean(item));
}

function extractPlaylistItems(value: unknown): YouTubePlaylistItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => normalizePlaylistItem(item))
    .filter((item): item is YouTubePlaylistItem => Boolean(item));
}

function normalizePlaylistItem(value: unknown): YouTubePlaylistItem | null {
  const item = asRecord(value);

  if (!item) {
    return null;
  }

  const id = pickText(item.id, item.video_id, item.videoId);
  const title = pickText(item.title);

  if (!id || !title) {
    return null;
  }

  const author = asRecord(item.author);
  const duration = asRecord(item.duration);
  const positionText = pickText(item.index, getValue(item, "index"));
  const position = pickNumber(item.position, positionText);

  return {
    kind: "video",
    id,
    canonicalUrl: createCanonicalVideoUrl(id),
    title,
    channelTitle: pickText(getValue(author, "name"), author),
    durationText: pickText(getValue(duration, "text"), item.length_text),
    durationSeconds: pickNumber(getValue(duration, "seconds"), item.length_seconds),
    ...(typeof position === "number" ? { position } : {}),
    thumbnails: extractThumbnailUrls(item.thumbnails).slice(0, PLAYLIST_THUMBNAIL_LIMIT),
    isPlayable: pickBoolean(item.is_playable) ?? true,
    isLive: pickBoolean(item.is_live) ?? false,
    isUpcoming: pickBoolean(item.is_upcoming) ?? false
  };
}

function normalizeSearchResult(value: unknown): YouTubeSearchResult | null {
  const item = asRecord(value);

  if (!item) {
    return null;
  }

  const id = pickText(item.video_id, item.id);
  const title = pickText(item.title);

  if (!id || !title) {
    return null;
  }

  const author = asRecord(item.author);
  const duration = asRecord(item.duration);

  return {
    kind: "video",
    id,
    canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
    title,
    channelId: pickText(
      getValue(author, "id"),
      getValue(getValue(author, "endpoint"), "browseId"),
      getValue(getValue(getValue(author, "endpoint"), "payload"), "browseId")
    ),
    channelTitle: pickText(getValue(author, "name"), author),
    publishedText: pickText(item.published),
    viewCountText: pickText(item.view_count, item.short_view_count),
    durationText: pickText(item.length_text, getValue(duration, "text")),
    durationSeconds: pickNumber(getValue(duration, "seconds")),
    snippet: truncateText(pickText(item.description_snippet), SEARCH_SNIPPET_MAX_LENGTH),
    thumbnails: extractThumbnailUrls(item.thumbnails).slice(0, SEARCH_THUMBNAIL_LIMIT),
    isLive: pickBoolean(item.is_live) ?? false,
    isUpcoming: pickBoolean(item.is_upcoming) ?? false
  };
}

function extractThumbnailUrls(value: unknown): string[] {
  const urls = new Set<string>();

  collectThumbnailUrls(value, urls);

  return [...urls];
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
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

function extractCaptionTracks(value: unknown): Array<{
  label: string;
  languageCode?: string;
  isAutoGenerated?: boolean;
  isTranslatable?: boolean;
}> {
  const tracks = getValue(value, "caption_tracks");

  if (!Array.isArray(tracks)) {
    return [];
  }

  return tracks
    .map(track => {
      const item = asRecord(track);

      if (!item) {
        return null;
      }

      const label = pickText(getValue(item, "name"));

      if (!label) {
        return null;
      }

      return {
        label,
        ...(pickText(getValue(item, "language_code"))
          ? { languageCode: pickText(getValue(item, "language_code")) }
          : {}),
        ...(pickText(getValue(item, "kind")) === "asr"
          ? { isAutoGenerated: true }
          : {}),
        ...(pickBoolean(getValue(item, "is_translatable")) === true
          ? { isTranslatable: true }
          : {})
      };
    })
    .filter((track): track is NonNullable<typeof track> => track !== null);
}

function extractTranslationLanguages(value: unknown): Array<{
  label: string;
  languageCode?: string;
}> {
  const languages = getValue(value, "translation_languages");

  if (!Array.isArray(languages)) {
    return [];
  }

  return languages
    .map(language => {
      const item = asRecord(language);

      if (!item) {
        return null;
      }

      const label = pickText(getValue(item, "language_name"));

      if (!label) {
        return null;
      }

      return {
        label,
        ...(pickText(getValue(item, "language_code"))
          ? { languageCode: pickText(getValue(item, "language_code")) }
          : {})
      };
    })
    .filter((language): language is NonNullable<typeof language> => language !== null);
}

function findLanguageMetadata(
  label: string,
  captionTracks: Array<{
    label: string;
    languageCode?: string;
    isAutoGenerated?: boolean;
    isTranslatable?: boolean;
  }>,
  translationLanguages: Array<{
    label: string;
    languageCode?: string;
  }>
): {
  languageCode?: string;
  isAutoGenerated?: boolean;
  isTranslatable?: boolean;
} | null {
  const key = normalizeLanguageKey(label);
  const captionTrack = captionTracks.find(track => normalizeLanguageKey(track.label) === key);

  if (captionTrack) {
    return captionTrack;
  }

  const translationLanguage = translationLanguages.find(
    language => normalizeLanguageKey(language.label) === key
  );

  if (translationLanguage) {
    return {
      languageCode: translationLanguage.languageCode,
      isTranslatable: true
    };
  }

  return null;
}

function normalizeLanguageKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function extractHandleFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/\/(@[A-Za-z0-9._-]{3,30})(?:[/?#]|$)/);

  return match?.[1];
}
