import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  createResultFromError,
  createSuccessResult
} from "../contracts/tool-result.js";
import { InvalidInputError, NotAvailableError } from "../lib/mcp-errors.js";
import {
  MAX_SEARCH_RESULTS,
  type YouTubeSearchFeature,
  type YouTubeSearchFilters,
  type YouTubeSearchPage,
  type YouTubeSearchResult,
  type YouTubeSearchQuery,
  type YouTubeVideoRecord,
  type YouTubeService
} from "../youtube/contracts.js";
import { createYouTubeService } from "../youtube/service.js";
import { SERVER_INFO } from "./create-server.js";

export type RegisterToolDependencies = {
  youtubeService?: Partial<Pick<YouTubeService, "getVideo" | "searchVideos">>;
};

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

export function registerTools(
  _server: McpServer,
  dependencies: RegisterToolDependencies = {}
): void {
  const defaultYouTubeService =
    dependencies.youtubeService?.getVideo && dependencies.youtubeService?.searchVideos
      ? undefined
      : createYouTubeService();
  const searchVideos =
    dependencies.youtubeService?.searchVideos ?? defaultYouTubeService?.searchVideos;
  const getVideo = dependencies.youtubeService?.getVideo ?? defaultYouTubeService?.getVideo;

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
    ...(record.description ? { description: record.description } : {}),
    ...(record.channelTitle ? { channelTitle: record.channelTitle } : {}),
    ...(typeof record.durationSeconds === "number"
      ? { durationSeconds: record.durationSeconds }
      : {}),
    ...(typeof record.viewCount === "number" ? { viewCount: record.viewCount } : {}),
    ...(typeof record.likeCount === "number" ? { likeCount: record.likeCount } : {}),
    ...(record.thumbnails.length > 0 ? { thumbnails: record.thumbnails } : {}),
    ...(record.keywords && record.keywords.length > 0 ? { keywords: record.keywords } : {}),
    ...(typeof record.isLive === "boolean" ? { isLive: record.isLive } : {}),
    ...(typeof record.isUpcoming === "boolean" ? { isUpcoming: record.isUpcoming } : {}),
    ...(record.playlistId ? { playlistId: record.playlistId } : {}),
    ...(typeof record.startTimeSeconds === "number"
      ? { startTimeSeconds: record.startTimeSeconds }
      : {})
  };
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
