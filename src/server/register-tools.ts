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
  type YouTubeSearchQuery,
  type YouTubeService
} from "../youtube/contracts.js";
import { SERVER_INFO } from "./create-server.js";

export type RegisterToolDependencies = {
  youtubeService?: Pick<YouTubeService, "searchVideos">;
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
    query: z.string().trim().min(1).max(200),
    maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
    filters: searchFiltersSchema.optional()
  })
  .strict();

export function registerTools(
  _server: McpServer,
  dependencies: RegisterToolDependencies = {}
): void {
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
        const input = parseSearchVideosInput(args);
        const youtubeService = dependencies.youtubeService;

        if (!youtubeService) {
          throw new NotAvailableError(
            "YouTube search is not configured in this build yet.",
            {
              cause: "search_service_unconfigured",
              details: {
                server: SERVER_INFO.name
              }
            }
          );
        }

        const page = await youtubeService.searchVideos(input);

        return createSuccessResult({
          summary: summarizeSearchPage(page),
          data: page as Record<string, unknown>
        });
      } catch (error) {
        return createResultFromError(error);
      }
    }
  );
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

  return {
    query: parsed.data.query.trim(),
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

  return `Found ${page.results.length} matching video result${
    page.results.length === 1 ? "" : "s"
  } for "${page.query}".`;
}
