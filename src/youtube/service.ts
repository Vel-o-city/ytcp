import { createLogger, type Logger } from "../lib/logger.js";
import { InvalidInputError, NotAvailableError } from "../lib/mcp-errors.js";

import {
  DEFAULT_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS,
  type YouTubeChannelInput,
  type YouTubeChannelLookup,
  type YouTubeChannelRecord,
  type YouTubeSearchFeature,
  type YouTubeSearchPage,
  type YouTubeSearchQuery,
  type YouTubeService,
  type YouTubeVideoInput,
  type YouTubeVideoLookup,
  type YouTubeVideoRecord,
  type YouTubePlaylistInput,
  type YouTubePlaylistLookup,
  type YouTubePlaylistRecord
} from "./contracts.js";
import {
  createInnertubeClient,
  type CreateInnertubeClientOptions,
  type InnertubeClientHandle,
  type InnertubeClientLike
} from "./client.js";
import { createYouTubeCache, type YouTubeCache } from "./cache.js";
import {
  normalizeChannelRecord,
  normalizePlaylistRecord,
  normalizeSearchPage,
  toInnertubeSearchFilters,
  normalizeVideoRecord
} from "./normalize.js";
import {
  createYouTubeRequestPolicy,
  type YouTubeRequestPolicy
} from "./policies.js";
import { parseYouTubeInput } from "./parser.js";
import type { ParsedYouTubeReference } from "./reference.js";

export type CreateYouTubeServiceOptions = CreateInnertubeClientOptions & {
  client?: InnertubeClientHandle;
  logger?: Logger;
  parser?: (input: string) => ParsedYouTubeReference;
  policy?: YouTubeRequestPolicy;
  youtubeCache?: YouTubeCache;
};

export function createYouTubeService(
  options: CreateYouTubeServiceOptions = {}
): YouTubeService {
  const logger = options.logger ?? createLogger({ name: "ytcp.youtube.service" });
  const parser = options.parser ?? parseYouTubeInput;
  const youtubeCache = options.youtubeCache ?? createYouTubeCache();
  const policy = options.policy ?? createYouTubeRequestPolicy();
  const client =
    options.client ??
    createInnertubeClient({
      ...options,
      youtubeCache
    });

  return {
    parseInput: parser,
    getVideo: async (input: YouTubeVideoInput): Promise<YouTubeVideoRecord> => {
      const reference = expectReferenceKind(input, parser, "video");
      const cacheKey = createCacheKey(reference);
      const cached = youtubeCache.getLookup<YouTubeVideoRecord>(cacheKey);

      if (cached) {
        logger.debug("youtube video cache hit", { id: reference.id });
        return cached;
      }

      const upstream = await client.getClient();

      logger.debug("fetching youtube video", { id: reference.id, source: reference.source });

      const response = await policy.execute(
        () => upstream.getBasicInfo(reference.id),
        {
          label: "video lookup",
          target: reference.id
        }
      );
      const record = normalizeVideoRecord(response, reference);

      return youtubeCache.setLookup(cacheKey, record);
    },
    getPlaylist: async (
      input: YouTubePlaylistInput
    ): Promise<YouTubePlaylistRecord> => {
      const reference = expectReferenceKind(input, parser, "playlist");
      const cacheKey = createCacheKey(reference);
      const cached = youtubeCache.getLookup<YouTubePlaylistRecord>(cacheKey);

      if (cached) {
        logger.debug("youtube playlist cache hit", { id: reference.id });
        return cached;
      }

      const upstream = await client.getClient();

      logger.debug("fetching youtube playlist", {
        id: reference.id,
        source: reference.source
      });

      const response = await policy.execute(
        () => upstream.getPlaylist(reference.id),
        {
          label: "playlist lookup",
          target: reference.id
        }
      );
      const record = normalizePlaylistRecord(response, reference);

      return youtubeCache.setLookup(cacheKey, record);
    },
    getChannel: async (
      input: YouTubeChannelInput
    ): Promise<YouTubeChannelRecord> => {
      const reference = expectReferenceKind(input, parser, "channel");
      const cacheKey = createCacheKey(reference);
      const cached = youtubeCache.getLookup<YouTubeChannelRecord>(cacheKey);

      if (cached) {
        logger.debug("youtube channel cache hit", {
          target: reference.channelId ?? reference.handle ?? reference.canonicalUrl
        });
        return cached;
      }

      const upstream = await client.getClient();
      const target = await resolveChannelTarget(upstream, reference, policy, logger);

      logger.debug("fetching youtube channel", {
        target,
        source: reference.source
      });

      const response = await policy.execute(() => upstream.getChannel(target), {
        label: "channel lookup",
        target
      });
      const record = normalizeChannelRecord(response, reference);

      return youtubeCache.setLookup(cacheKey, record);
    },
    searchVideos: async (input: YouTubeSearchQuery): Promise<YouTubeSearchPage> => {
      const searchQuery = normalizeSearchQuery(input);
      const cacheKey = createSearchCacheKey(searchQuery);
      const cached = youtubeCache.getLookup<YouTubeSearchPage>(cacheKey);

      if (cached) {
        logger.debug("youtube search cache hit", {
          query: searchQuery.query,
          maxResults: searchQuery.maxResults
        });
        return cached;
      }

      const upstream = await client.getClient();

      if (!upstream.search) {
        throw new NotAvailableError(
          "This YouTube client does not support public search requests.",
          {
            cause: "search_unsupported"
          }
        );
      }

      logger.debug("fetching youtube search", {
        query: searchQuery.query,
        hasFilters: Boolean(searchQuery.filters),
        maxResults: searchQuery.maxResults
      });

      const response = await policy.execute(
        () => upstream.search!(searchQuery.query, toInnertubeSearchFilters(searchQuery.filters)),
        {
          label: "search lookup",
          target: searchQuery.query
        }
      );
      const page = normalizeSearchPage(response, searchQuery);

      return youtubeCache.setLookup(cacheKey, page);
    }
  };
}

function expectReferenceKind<TKind extends ParsedYouTubeReference["kind"]>(
  input: string | ParsedYouTubeReference,
  parser: (input: string) => ParsedYouTubeReference,
  kind: TKind
): Extract<ParsedYouTubeReference, { kind: TKind }> {
  const reference = typeof input === "string" ? parser(input) : input;

  if (reference.kind !== kind) {
    throw new InvalidInputError(
      `Expected a YouTube ${kind} reference, but received a ${reference.kind} reference instead.`
    );
  }

  return reference as Extract<ParsedYouTubeReference, { kind: TKind }>;
}

async function resolveChannelTarget(
  client: InnertubeClientLike,
  reference: YouTubeChannelLookup,
  policy: YouTubeRequestPolicy,
  logger: Logger
): Promise<string> {
  if (reference.channelId) {
    return reference.channelId;
  }

  if (client.resolveURL) {
    try {
      const endpoint = await policy.execute(
        () => client.resolveURL!(reference.canonicalUrl),
        {
          label: "channel resolution",
          target: reference.canonicalUrl
        }
      );
      const browseId = extractBrowseId(endpoint);

      if (browseId) {
        return browseId;
      }
    } catch (error) {
      logger.warn("youtube channel resolution fell back to direct target", {
        error: error instanceof Error ? error.message : String(error),
        target: reference.canonicalUrl
      });
    }
  }

  return (
    reference.handle ??
    reference.customName ??
    reference.username ??
    reference.canonicalUrl
  );
}

function extractBrowseId(value: unknown): string | undefined {
  const payload = asRecord(asRecord(value)?.payload);

  if (!payload) {
    return undefined;
  }

  if (typeof payload.browseId === "string" && payload.browseId) {
    return payload.browseId;
  }

  if (typeof payload.browse_id === "string" && payload.browse_id) {
    return payload.browse_id;
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function createCacheKey(reference: ParsedYouTubeReference): string {
  switch (reference.kind) {
    case "video":
      return `video:${reference.id}:playlist=${reference.playlistId ?? ""}:start=${reference.startTimeSeconds ?? ""}`;
    case "playlist":
      return `playlist:${reference.id}`;
    case "channel":
      return `channel:${reference.channelId ?? reference.handle ?? reference.customName ?? reference.username ?? reference.canonicalUrl}`;
  }
}

function normalizeSearchQuery(input: YouTubeSearchQuery): YouTubeSearchQuery {
  const query = input.query.trim();

  if (!query) {
    throw new InvalidInputError(
      "Provide a non-empty search query before requesting YouTube search results."
    );
  }

  const maxResults = input.maxResults ?? DEFAULT_SEARCH_RESULTS;

  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_SEARCH_RESULTS) {
    throw new InvalidInputError(
      `\`maxResults\` must be between 1 and ${MAX_SEARCH_RESULTS}.`
    );
  }

  return {
    query,
    maxResults,
    ...(input.filters
      ? {
          filters: {
            ...(input.filters.uploadDate ? { uploadDate: input.filters.uploadDate } : {}),
            ...(input.filters.duration ? { duration: input.filters.duration } : {}),
            ...(input.filters.sortBy ? { sortBy: input.filters.sortBy } : {}),
            ...(input.filters.features
              ? {
                  features: input.filters.features.filter(
                    dedupeFeatures
                  ) as YouTubeSearchFeature[]
                }
              : {})
          }
        }
      : {})
  };
}

function createSearchCacheKey(query: YouTubeSearchQuery): string {
  return `search:${query.query}:max=${query.maxResults ?? DEFAULT_SEARCH_RESULTS}:filters=${JSON.stringify(query.filters ?? {})}`;
}

function dedupeFeatures(
  feature: YouTubeSearchFeature,
  index: number,
  values: YouTubeSearchFeature[]
): boolean {
  return values.indexOf(feature) === index;
}
