import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  createResultFromError,
  createSuccessResult
} from "../contracts/tool-result.js";
import { InvalidInputError, NotAvailableError } from "../lib/mcp-errors.js";
import {
  DEFAULT_COMMENT_RESULTS,
  MAX_COMMENT_RESULTS,
  MAX_PLAYLIST_RESULTS,
  MAX_SEARCH_RESULTS,
  type YouTubeChannelRecord,
  type YouTubeChannelVideoItem,
  type YouTubeCommentPage,
  type YouTubeCommentQuery,
  type YouTubeCommentThread,
  type YouTubePlaylistItem,
  type YouTubePlaylistQuery,
  type YouTubePlaylistRecord,
  type YouTubeSearchFeature,
  type YouTubeSearchFilters,
  type YouTubeSearchPage,
  type YouTubeSearchResult,
  type YouTubeSearchQuery,
  type YouTubeTranscriptRecord,
  type YouTubeTranscriptSegment,
  type YouTubeTranscriptLanguage,
  type YouTubeVideoChapter,
  type YouTubeVideoRecord,
  type YouTubeService
} from "../youtube/contracts.js";
import { createYouTubeService } from "../youtube/service.js";
import { SERVER_INFO } from "./create-server.js";

export type RegisterToolDependencies = {
  youtubeService?: Partial<
    Pick<YouTubeService, "getVideo" | "getPlaylist" | "getChannel" | "searchVideos" | "getTranscript" | "getComments">
  >;
};

const MAX_VIDEO_DESCRIPTION_LENGTH = 600;
const MAX_PLAYLIST_DESCRIPTION_LENGTH = 400;
const MAX_CHANNEL_DESCRIPTION_LENGTH = 400;
const searchFeatureSchema = z.enum([
  "hd",
  "subtitles",
  "creative_commons",
  "live",
  "4k",
  "hdr"
]);
const searchFiltersSchema = z
  .object({
    uploadDate: z
      .enum(["all", "hour", "today", "week", "month", "year"])
      .optional(),
    duration: z.enum(["all", "short", "medium", "long"]).optional(),
    sortBy: z.enum(["relevance", "rating", "upload_date", "view_count"]).optional(),
    features: z.array(searchFeatureSchema).max(6).optional()
  })
  .strict();
const searchVideosInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    pageToken: z.string().trim().min(1).max(200).optional(),
    maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
    filters: searchFiltersSchema.optional()
  })
  .strict();
const getVideoDetailsInputSchema = z
  .object({
    video: z.string().trim().min(1).max(500)
  })
  .strict();
const getPlaylistInputSchema = z
  .object({
    playlist: z.string().trim().min(1).max(500).optional(),
    pageToken: z.string().trim().min(1).max(200).optional(),
    maxResults: z.number().int().min(1).max(MAX_PLAYLIST_RESULTS).optional()
  })
  .strict();
const getTranscriptInputSchema = z
  .object({
    video: z.string().trim().min(1).max(500),
    language: z.string().trim().min(1).max(100).optional(),
    includeTimestamps: z.boolean().optional()
  })
  .strict();
const getChannelInputSchema = z
  .object({
    channel: z.string().trim().min(1).max(500)
  })
  .strict();
const getCommentsInputSchema = z
  .object({
    video: z.string().trim().min(1).max(500).optional(),
    pageToken: z.string().trim().min(1).max(200).optional(),
    sortBy: z.enum(["top_comments", "new_comments"]).optional(),
    maxResults: z.number().int().min(1).max(MAX_COMMENT_RESULTS).optional()
  })
  .strict();

export function registerTools(
  _server: McpServer,
  dependencies: RegisterToolDependencies = {}
): void {
  const defaultYouTubeService =
    dependencies.youtubeService?.getVideo &&
    dependencies.youtubeService?.getPlaylist &&
    dependencies.youtubeService?.getChannel &&
    dependencies.youtubeService?.searchVideos &&
    dependencies.youtubeService?.getTranscript &&
    dependencies.youtubeService?.getComments
      ? undefined
      : createYouTubeService();
  const searchVideos =
    dependencies.youtubeService?.searchVideos ?? defaultYouTubeService?.searchVideos;
  const getVideo = dependencies.youtubeService?.getVideo ?? defaultYouTubeService?.getVideo;
  const getPlaylist =
    dependencies.youtubeService?.getPlaylist ?? defaultYouTubeService?.getPlaylist;
  const getChannel =
    dependencies.youtubeService?.getChannel ?? defaultYouTubeService?.getChannel;
  const getTranscript =
    dependencies.youtubeService?.getTranscript ?? defaultYouTubeService?.getTranscript;
  const getComments =
    dependencies.youtubeService?.getComments ?? defaultYouTubeService?.getComments;

  _server.registerTool(
    "server_status",
    {
      description:
        "Report the current ytcp foundation status and the transport surface available in this build.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true
      }
    },
    async () => {
      const transports = ["stdio", "http"];

      if (transports.length === 0) {
        return createResultFromError(
          new NotAvailableError("No MCP transports are configured for this build.", {
            cause: "runtime_unconfigured",
            details: { server: SERVER_INFO.name }
          })
        );
      }

      return createSuccessResult({
        summary: "ytcp is online with the shared foundation wired for stdio and hosted HTTP.",
        data: {
          server: SERVER_INFO.name,
          version: SERVER_INFO.version,
          transports,
          readiness: "foundation"
        }
      });
    }
  );

  _server.registerTool(
    "get_video_details",
    {
      description:
        "Fetch compact details for a public YouTube video from a canonical URL or bare 11-character ID.",
      inputSchema: getVideoDetailsInputSchema.shape,
      annotations: {
        readOnlyHint: true
      }
    },
    async args => {
      try {
        if (!getVideo) {
          throw new NotAvailableError(
            "Video detail lookups are not configured for this ytcp build.",
            {
              cause: "video_lookup_unconfigured"
            }
          );
        }

        const input = parseGetVideoDetailsInput(args);
        const record = await getVideo(input);

        return createSuccessResult({
          summary: summarizeVideoRecord(record),
          data: shapeVideoRecordData(record)
        });
      } catch (error) {
        return createResultFromError(error);
      }
    }
  );

  _server.registerTool(
    "get_playlist",
    {
      description:
        "Fetch compact details and playlist items for a public YouTube playlist from a canonical playlist URL, a watch URL with `list=...`, or a bare playlist ID.",
      inputSchema: getPlaylistInputSchema.shape,
      annotations: {
        readOnlyHint: true
      }
    },
    async args => {
      try {
        if (!getPlaylist) {
          throw new NotAvailableError(
            "Playlist retrieval is not configured for this ytcp build.",
            {
              cause: "playlist_lookup_unconfigured"
            }
          );
        }

        const input = parseGetPlaylistInput(args);
        const record = await getPlaylist(input);

        return createSuccessResult({
          summary: summarizePlaylistRecord(record),
          data: shapePlaylistRecordData(record)
        });
      } catch (error) {
        return createResultFromError(error);
      }
    }
  );

  _server.registerTool(
    "get_channel",
    {
      description:
        "Fetch compact metadata and recent videos for a public YouTube channel from a handle, bare channel ID, or canonical channel URL.",
      inputSchema: getChannelInputSchema.shape,
      annotations: {
        readOnlyHint: true
      }
    },
    async args => {
      try {
        if (!getChannel) {
          throw new NotAvailableError(
            "Channel lookups are not configured for this ytcp build.",
            {
              cause: "channel_lookup_unconfigured"
            }
          );
        }

        const input = parseGetChannelInput(args);
        const record = await getChannel(input);

        return createSuccessResult({
          summary: summarizeChannelRecord(record),
          data: shapeChannelRecordData(record)
        });
      } catch (error) {
        return createResultFromError(error);
      }
    }
  );

  _server.registerTool(
    "get_transcript",
    {
      description:
        "Fetch a public YouTube transcript from a canonical video URL or bare 11-character ID, with optional language selection.",
      inputSchema: getTranscriptInputSchema.shape,
      annotations: {
        readOnlyHint: true
      }
    },
    async args => {
      try {
        if (!getTranscript) {
          throw new NotAvailableError(
            "Transcript retrieval is not configured for this ytcp build.",
            {
              cause: "transcript_lookup_unconfigured"
            }
          );
        }

        const input = parseGetTranscriptInput(args);
        const record = await getTranscript(input.video, {
          ...(input.language ? { language: input.language } : {}),
          ...(typeof input.includeTimestamps === "boolean"
            ? { includeTimestamps: input.includeTimestamps }
            : {})
        });

        return createSuccessResult({
          summary: summarizeTranscriptRecord(record),
          data: shapeTranscriptRecordData(record)
        });
      } catch (error) {
        return createResultFromError(error);
      }
    }
  );

  _server.registerTool(
    "search_videos",
    {
      description:
        "Search public YouTube videos by free-text query and return compact results for disambiguation.",
      inputSchema: searchVideosInputSchema.shape,
      annotations: {
        readOnlyHint: true
      }
    },
    async args => {
      try {
        if (!searchVideos) {
          throw new NotAvailableError("Public YouTube search is not configured for this ytcp build.", {
            cause: "search_unconfigured"
          });
        }

        const input = parseSearchVideosInput(args);

        const page = await searchVideos(input);

        return createSuccessResult({
          summary: summarizeSearchPage(page),
          data: shapeSearchPageData(page)
        });
      } catch (error) {
        return createResultFromError(error);
      }
    }
  );

  _server.registerTool(
    "get_comments",
    {
      description:
        "Fetch top-level comment threads for a public YouTube video from a canonical URL or bare 11-character ID, with optional sort controls.",
      inputSchema: getCommentsInputSchema.shape,
      annotations: {
        readOnlyHint: true
      }
    },
    async args => {
      try {
        if (!getComments) {
          throw new NotAvailableError(
            "Comment retrieval is not configured for this ytcp build.",
            {
              cause: "comment_lookup_unconfigured"
            }
          );
        }

        const input = parseGetCommentsInput(args);
        const page = await getComments(input);

        return createSuccessResult({
          summary: summarizeCommentPage(page),
          data: shapeCommentPageData(page)
        });
      } catch (error) {
        return createResultFromError(error);
      }
    }
  );
}

function parseGetChannelInput(input: unknown): string {
  const parsed = getChannelInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new InvalidInputError(
      "Provide a YouTube channel handle (e.g. @name), bare channel ID, or canonical channel URL in `channel`."
    );
  }

  return parsed.data.channel.trim();
}

function parseGetVideoDetailsInput(input: unknown): string {
  const parsed = getVideoDetailsInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new InvalidInputError(
      "Provide a YouTube video URL or bare 11-character video ID in `video`."
    );
  }

  return parsed.data.video.trim();
}

function parseGetPlaylistInput(input: unknown): YouTubePlaylistQuery {
  const parsed = getPlaylistInputSchema.safeParse(input);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.join(".") ?? "playlist";

    if (path === "pageToken") {
      throw new InvalidInputError(
        "Provide a non-empty `pageToken` string to request the next playlist page."
      );
    }

    if (path === "maxResults") {
      throw new InvalidInputError(
        `\`maxResults\` must be between 1 and ${MAX_PLAYLIST_RESULTS}.`
      );
    }

    throw new InvalidInputError(
      "Provide a YouTube playlist URL, a watch URL with `list=...`, or a bare playlist ID in `playlist`."
    );
  }

  const hasPlaylist = typeof parsed.data.playlist === "string";
  const hasPageToken = typeof parsed.data.pageToken === "string";

  if (!hasPlaylist && !hasPageToken) {
    throw new InvalidInputError(
      "Provide either a `playlist` string or a `pageToken` string to load a public playlist."
    );
  }

  if (hasPlaylist && hasPageToken) {
    throw new InvalidInputError(
      "Provide either `playlist` or `pageToken`, not both, when using `get_playlist`."
    );
  }

  if (hasPageToken) {
    return {
      pageToken: parsed.data.pageToken!.trim(),
      ...(typeof parsed.data.maxResults === "number"
        ? { maxResults: parsed.data.maxResults }
        : {})
    };
  }

  return {
    playlist: parsed.data.playlist!.trim(),
    ...(typeof parsed.data.maxResults === "number"
      ? { maxResults: parsed.data.maxResults }
      : {})
  };
}

function parseGetTranscriptInput(input: unknown): {
  video: string;
  language?: string;
  includeTimestamps?: boolean;
} {
  const parsed = getTranscriptInputSchema.safeParse(input);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.join(".") ?? "video";

    if (path === "language") {
      throw new InvalidInputError(
        "Provide a non-empty `language` string when requesting a transcript language."
      );
    }

    if (path === "includeTimestamps") {
      throw new InvalidInputError(
        "Provide `includeTimestamps` as `true` or `false` when formatting transcript text."
      );
    }

    throw new InvalidInputError(
      "Provide a YouTube video URL or bare 11-character video ID in `video`."
    );
  }

  return {
    video: parsed.data.video.trim(),
    ...(parsed.data.language ? { language: parsed.data.language.trim() } : {}),
    ...(typeof parsed.data.includeTimestamps === "boolean"
      ? { includeTimestamps: parsed.data.includeTimestamps }
      : {})
  };
}

function parseSearchVideosInput(input: unknown): YouTubeSearchQuery {
  const parsed = searchVideosInputSchema.safeParse(input);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.join(".") ?? "query";

    switch (path) {
      case "query":
        throw new InvalidInputError(
          "Provide a non-empty `query` string to search public YouTube videos."
        );
      case "maxResults":
        throw new InvalidInputError(
          `\`maxResults\` must be between 1 and ${MAX_SEARCH_RESULTS}.`
        );
      case "pageToken":
        throw new InvalidInputError(
          "Provide a non-empty `pageToken` string to request the next search page."
        );
      case "filters.uploadDate":
        throw new InvalidInputError(
          "Unsupported `filters.uploadDate` value. Use all, hour, today, week, month, or year."
        );
      case "filters.duration":
        throw new InvalidInputError(
          "Unsupported `filters.duration` value. Use all, short, medium, or long."
        );
      case "filters.sortBy":
        throw new InvalidInputError(
          "Unsupported `filters.sortBy` value. Use relevance, rating, upload_date, or view_count."
        );
      case "filters.features":
      default:
        throw new InvalidInputError(
          "Search filters are invalid. Check `uploadDate`, `duration`, `sortBy`, and `features` values."
        );
    }
  }

  const hasQuery = typeof parsed.data.query === "string";
  const hasPageToken = typeof parsed.data.pageToken === "string";

  if (!hasQuery && !hasPageToken) {
    throw new InvalidInputError(
      "Provide either a `query` string or a `pageToken` string to search public YouTube videos."
    );
  }

  if (hasQuery && hasPageToken) {
    throw new InvalidInputError(
      "Provide either `query` or `pageToken`, not both, when using `search_videos`."
    );
  }

  if (hasPageToken && parsed.data.filters) {
    throw new InvalidInputError(
      "Follow-up search page requests cannot include `filters`; use the returned `pageToken` by itself."
    );
  }

  if (hasPageToken) {
    return {
      pageToken: parsed.data.pageToken!.trim(),
      ...(typeof parsed.data.maxResults === "number"
        ? { maxResults: parsed.data.maxResults }
        : {})
    };
  }

  return {
    query: parsed.data.query!.trim(),
    ...(typeof parsed.data.maxResults === "number"
      ? { maxResults: parsed.data.maxResults }
      : {}),
    ...(parsed.data.filters
      ? { filters: normalizeToolFilters(parsed.data.filters) }
      : {})
  };
}

function normalizeToolFilters(filters: z.infer<typeof searchFiltersSchema>): YouTubeSearchFilters {
  return {
    ...(filters.uploadDate ? { uploadDate: filters.uploadDate } : {}),
    ...(filters.duration ? { duration: filters.duration } : {}),
    ...(filters.sortBy ? { sortBy: filters.sortBy } : {}),
    ...(filters.features
      ? {
          features: filters.features.filter(
            (feature, index, values) => values.indexOf(feature) === index
          ) as YouTubeSearchFeature[]
        }
      : {})
  };
}

function summarizeSearchPage(page: YouTubeSearchPage): string {
  if (page.results.length === 0) {
    return `No public video matches were found for "${page.query}".`;
  }

  return `Showing ${page.results.length} video match${
    page.results.length === 1 ? "" : "s"
  } for "${page.query}".${page.nextPageToken ? " More are available." : ""}`;
}

function summarizeVideoRecord(record: YouTubeVideoRecord): string {
  if (record.title) {
    return `Loaded public video details for "${record.title}".`;
  }

  return `Loaded public video details for ${record.id}.`;
}

function summarizePlaylistRecord(record: YouTubePlaylistRecord): string {
  const label = record.title ? `"${record.title}"` : record.id;

  if (record.pageSize === 0) {
    return `Loaded public playlist details for ${label}. No playlist items were returned for this page.`;
  }

  if (record.title) {
    return `Loaded public playlist details for "${record.title}" with ${record.pageSize} item${
      record.pageSize === 1 ? "" : "s"
    }.${record.nextPageToken ? " More are available." : ""}`;
  }

  return `Loaded public playlist details for ${record.id} with ${record.pageSize} item${
    record.pageSize === 1 ? "" : "s"
  }.${record.nextPageToken ? " More are available." : ""}`;
}

function summarizeChannelRecord(record: YouTubeChannelRecord): string {
  if (record.title) {
    return `Loaded public channel metadata for "${record.title}".`;
  }

  return `Loaded public channel metadata for ${record.id ?? record.canonicalUrl}.`;
}

function summarizeTranscriptRecord(record: YouTubeTranscriptRecord): string {
  const summary = record.title
    ? `Loaded public transcript for "${record.title}" in ${record.language}.`
    : `Loaded public transcript for ${record.videoId} in ${record.language}.`;

  if (record.retrievalMethod === "fallback") {
    return `${summary} Fallback extractor used.`;
  }

  if (record.includeTimestamps) {
    return `${summary} Timestamps included.`;
  }

  return summary;
}

function shapeSearchPageData(page: YouTubeSearchPage): Record<string, unknown> {
  return {
    query: page.query,
    pageSize: page.pageSize,
    ...(typeof page.estimatedResults === "number"
      ? { estimatedResults: page.estimatedResults }
      : {}),
    ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
    results: page.results.map(shapeSearchResultData)
  };
}

function shapeVideoRecordData(record: YouTubeVideoRecord): Record<string, unknown> {
  return {
    id: record.id,
    canonicalUrl: record.canonicalUrl,
    ...(record.title ? { title: record.title } : {}),
    ...(record.description
      ? { description: truncateText(record.description, MAX_VIDEO_DESCRIPTION_LENGTH) }
      : {}),
    ...(record.channelTitle ? { channelTitle: record.channelTitle } : {}),
    ...(typeof record.durationSeconds === "number"
      ? { durationSeconds: record.durationSeconds }
      : {}),
    ...(typeof record.viewCount === "number" ? { viewCount: record.viewCount } : {}),
    ...(typeof record.likeCount === "number" ? { likeCount: record.likeCount } : {}),
    ...(record.thumbnails.length > 0 ? { thumbnails: record.thumbnails } : {}),
    ...(record.keywords && record.keywords.length > 0 ? { keywords: record.keywords } : {}),
    ...(record.category ? { category: record.category } : {}),
    ...(typeof record.isFamilySafe === "boolean"
      ? { isFamilySafe: record.isFamilySafe }
      : {}),
    ...(typeof record.isUnlisted === "boolean" ? { isUnlisted: record.isUnlisted } : {}),
    ...(typeof record.isLive === "boolean" ? { isLive: record.isLive } : {}),
    ...(typeof record.isUpcoming === "boolean" ? { isUpcoming: record.isUpcoming } : {}),
    chapters: (record.chapters ?? []).map(shapeVideoChapterData),
    ...(record.playlistId ? { playlistId: record.playlistId } : {}),
    ...(typeof record.startTimeSeconds === "number"
      ? { startTimeSeconds: record.startTimeSeconds }
      : {})
  };
}

function shapePlaylistRecordData(record: YouTubePlaylistRecord): Record<string, unknown> {
  return {
    id: record.id,
    canonicalUrl: record.canonicalUrl,
    ...(record.title ? { title: record.title } : {}),
    ...(record.description
      ? {
          description: truncateText(
            record.description,
            MAX_PLAYLIST_DESCRIPTION_LENGTH
          )
        }
      : {}),
    ...(record.channelTitle ? { channelTitle: record.channelTitle } : {}),
    ...(record.itemCountText ? { itemCountText: record.itemCountText } : {}),
    ...(record.privacy ? { privacy: record.privacy } : {}),
    ...(record.viewCountText ? { viewCountText: record.viewCountText } : {}),
    ...(record.lastUpdatedText ? { lastUpdatedText: record.lastUpdatedText } : {}),
    ...(record.thumbnails.length > 0 ? { thumbnails: record.thumbnails } : {}),
    pageSize: record.pageSize,
    ...(record.nextPageToken ? { nextPageToken: record.nextPageToken } : {}),
    items: record.items.map(shapePlaylistItemData)
  };
}

function shapeChannelRecordData(record: YouTubeChannelRecord): Record<string, unknown> {
  return {
    ...(record.id ? { id: record.id } : {}),
    canonicalUrl: record.canonicalUrl,
    ...(record.handle ? { handle: record.handle } : {}),
    ...(record.title ? { title: record.title } : {}),
    ...(record.description
      ? { description: truncateText(record.description, MAX_CHANNEL_DESCRIPTION_LENGTH) }
      : {}),
    ...(record.subscriberCountText ? { subscriberCountText: record.subscriberCountText } : {}),
    ...(record.videoCountText ? { videoCountText: record.videoCountText } : {}),
    ...(record.viewCountText ? { viewCountText: record.viewCountText } : {}),
    ...(record.thumbnails.length > 0 ? { thumbnails: record.thumbnails } : {}),
    recentVideos: (record.recentVideos ?? []).map(shapeChannelVideoItemData)
  };
}

function shapeChannelVideoItemData(item: YouTubeChannelVideoItem): Record<string, unknown> {
  return {
    id: item.id,
    canonicalUrl: item.canonicalUrl,
    title: item.title,
    ...(item.thumbnails.length > 0 ? { thumbnails: item.thumbnails } : {}),
    ...(item.publishedText ? { publishedText: item.publishedText } : {}),
    ...(item.durationText ? { durationText: item.durationText } : {}),
    ...(item.viewCountText ? { viewCountText: item.viewCountText } : {})
  };
}

function shapeTranscriptRecordData(record: YouTubeTranscriptRecord): Record<string, unknown> {
  return {
    id: record.videoId,
    canonicalUrl: record.canonicalUrl,
    ...(record.title ? { title: record.title } : {}),
    ...(record.channelTitle ? { channelTitle: record.channelTitle } : {}),
    language: record.language,
    languages: record.languages.map(shapeTranscriptLanguageData),
    includeTimestamps: record.includeTimestamps,
    retrievalMethod: record.retrievalMethod,
    segmentCount: record.segmentCount,
    text: record.text,
    segments: record.segments.map(shapeTranscriptSegmentData)
  };
}

function shapeVideoChapterData(chapter: YouTubeVideoChapter): Record<string, unknown> {
  return {
    title: chapter.title,
    startTimeSeconds: chapter.startTimeSeconds,
    ...(chapter.thumbnailUrl ? { thumbnailUrl: chapter.thumbnailUrl } : {})
  };
}

function shapeTranscriptLanguageData(
  language: YouTubeTranscriptLanguage
): Record<string, unknown> {
  return {
    label: language.label,
    ...(language.languageCode ? { languageCode: language.languageCode } : {}),
    isSelected: language.isSelected,
    ...(language.isAutoGenerated ? { isAutoGenerated: true } : {}),
    ...(language.isTranslatable ? { isTranslatable: true } : {})
  };
}

function shapeTranscriptSegmentData(
  segment: YouTubeTranscriptSegment
): Record<string, unknown> {
  return {
    startTimeText: segment.startTimeText,
    startTimeSeconds: segment.startTimeSeconds,
    endTimeSeconds: segment.endTimeSeconds,
    text: segment.text
  };
}

function shapePlaylistItemData(item: YouTubePlaylistItem): Record<string, unknown> {
  return {
    kind: item.kind,
    id: item.id,
    canonicalUrl: item.canonicalUrl,
    title: item.title,
    ...(item.channelTitle ? { channelTitle: item.channelTitle } : {}),
    ...(item.durationText ? { durationText: item.durationText } : {}),
    ...(typeof item.position === "number" ? { position: item.position } : {}),
    ...(item.thumbnails.length > 0 ? { thumbnails: item.thumbnails } : {}),
    isPlayable: item.isPlayable,
    isLive: item.isLive,
    isUpcoming: item.isUpcoming
  };
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function shapeSearchResultData(result: YouTubeSearchResult): Record<string, unknown> {
  return {
    kind: result.kind,
    id: result.id,
    canonicalUrl: result.canonicalUrl,
    title: result.title,
    ...(result.channelTitle ? { channelTitle: result.channelTitle } : {}),
    ...(result.publishedText ? { publishedText: result.publishedText } : {}),
    ...(result.viewCountText ? { viewCountText: result.viewCountText } : {}),
    ...(result.durationText ? { durationText: result.durationText } : {}),
    ...(result.snippet ? { snippet: result.snippet } : {}),
    ...(result.thumbnails.length > 0 ? { thumbnails: result.thumbnails } : {}),
    isLive: result.isLive,
    isUpcoming: result.isUpcoming
  };
}

function parseGetCommentsInput(input: unknown): YouTubeCommentQuery {
  const parsed = getCommentsInputSchema.safeParse(input);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.join(".") ?? "video";

    if (path === "maxResults") {
      throw new InvalidInputError(
        `\`maxResults\` must be between 1 and ${MAX_COMMENT_RESULTS}.`
      );
    }

    if (path === "pageToken") {
      throw new InvalidInputError(
        "Provide a non-empty `pageToken` string to request the next comment page."
      );
    }

    if (path === "sortBy") {
      throw new InvalidInputError(
        "Unsupported `sortBy` value. Use `top_comments` or `new_comments`."
      );
    }

    throw new InvalidInputError(
      "Provide a YouTube video URL or bare 11-character video ID in `video`."
    );
  }

  const hasVideo = typeof parsed.data.video === "string";
  const hasPageToken = typeof parsed.data.pageToken === "string";

  if (!hasVideo && !hasPageToken) {
    throw new InvalidInputError(
      "Either `video` or `pageToken` must be provided."
    );
  }

  if (hasVideo && hasPageToken) {
    throw new InvalidInputError(
      "Provide either `video` or `pageToken`, not both."
    );
  }

  if (hasPageToken && parsed.data.sortBy) {
    throw new InvalidInputError(
      "Follow-up comment page requests cannot include `sortBy`; use the returned `pageToken` by itself."
    );
  }

  if (hasPageToken) {
    return {
      pageToken: parsed.data.pageToken!.trim(),
      ...(typeof parsed.data.maxResults === "number"
        ? { maxResults: parsed.data.maxResults }
        : {})
    };
  }

  return {
    video: parsed.data.video!.trim(),
    ...(parsed.data.sortBy ? { sortBy: parsed.data.sortBy } : {}),
    ...(typeof parsed.data.maxResults === "number"
      ? { maxResults: parsed.data.maxResults }
      : {})
  };
}

function summarizeCommentPage(page: YouTubeCommentPage): string {
  const sortLabel = page.sortBy === "top_comments" ? "top" : "newest";
  const summary = `Loaded ${page.pageSize} ${sortLabel} comments for video ${page.videoId}.`;

  return page.nextPageToken ? `${summary} More are available.` : summary;
}

function shapeCommentThreadData(thread: YouTubeCommentThread): Record<string, unknown> {
  return {
    threadId: thread.threadId,
    text: thread.text,
    ...(thread.authorName ? { authorName: thread.authorName } : {}),
    ...(thread.likeCount ? { likeCount: thread.likeCount } : {}),
    ...(thread.replyCount ? { replyCount: thread.replyCount } : {}),
    ...(thread.isPinned ? { isPinned: thread.isPinned } : {}),
    ...(thread.publishedText ? { publishedText: thread.publishedText } : {})
  };
}

function shapeCommentPageData(page: YouTubeCommentPage): Record<string, unknown> {
  return {
    videoId: page.videoId,
    canonicalUrl: page.canonicalUrl,
    sortBy: page.sortBy,
    pageSize: page.pageSize,
    ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
    threads: page.threads.map(shapeCommentThreadData)
  };
}
