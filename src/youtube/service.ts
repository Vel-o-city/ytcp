import { randomUUID } from "node:crypto";

import { createLogger, type Logger } from "../lib/logger.js";
import {
  InvalidInputError,
  NotAvailableError,
  UpstreamUnavailableError
} from "../lib/mcp-errors.js";

import {
  DEFAULT_COMMENT_RESULTS,
  DEFAULT_PLAYLIST_RESULTS,
  DEFAULT_SEARCH_RESULTS,
  MAX_PLAYLIST_RESULTS,
  MAX_SEARCH_RESULTS,
  type YouTubeChannelInput,
  type YouTubeChannelLookup,
  type YouTubeChannelRecord,
  type YouTubeCommentPage,
  type YouTubeCommentQuery,
  type YouTubeCommentSortBy,
  type YouTubePlaylistQuery,
  type YouTubeSearchFeature,
  type YouTubeSearchFilters,
  type YouTubeSearchPage,
  type YouTubeSearchQuery,
  type YouTubeService,
  type YouTubeTranscriptOptions,
  type YouTubeTranscriptRecord,
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
  createCoalescingCache,
  type CoalescingCache
} from "./coalescing-cache.js";
import {
  createTranscriptRecord,
  extractChannelVideos,
  formatTranscriptText,
  normalizeChannelRecord,
  normalizeCommentPage,
  normalizePlaylistRecord,
  normalizeSearchPage,
  normalizeTranscriptRecord,
  toInnertubeSearchFilters,
  normalizeVideoRecord
} from "./normalize.js";
import {
  createYouTubeRequestPolicy,
  type YouTubeRequestPolicy
} from "./policies.js";
import { parseYouTubeInput } from "./parser.js";
import type { ParsedYouTubeReference } from "./reference.js";
import {
  createTranscriptFallbackAdapter,
  type TranscriptFallbackAdapter
} from "./transcript-fallback.js";
import { createCanonicalPlaylistUrl } from "./reference.js";

export type CreateYouTubeServiceOptions = CreateInnertubeClientOptions & {
  client?: InnertubeClientHandle;
  createContinuationToken?: () => string;
  logger?: Logger;
  parser?: (input: string) => ParsedYouTubeReference;
  policy?: YouTubeRequestPolicy;
  transcriptFallback?: TranscriptFallbackAdapter;
  youtubeCache?: YouTubeCache | CoalescingCache;
};

type SearchFeedLike = Awaited<ReturnType<NonNullable<InnertubeClientLike["search"]>>>;
type PlaylistFeedLike = Awaited<
  ReturnType<NonNullable<InnertubeClientLike["getPlaylist"]>>
>;
type CommentsLike = Awaited<ReturnType<NonNullable<InnertubeClientLike["getComments"]>>>;

type CommentContinuationState = {
  videoId: string;
  sortBy: YouTubeCommentSortBy;
  response: CommentsLike;
};

type SearchContinuationState = {
  query: string;
  filters?: YouTubeSearchFilters;
  response: SearchFeedLike;
};

type PlaylistContinuationState = {
  reference: YouTubePlaylistLookup;
  response: PlaylistFeedLike;
};

type InitialSearchRequest = {
  kind: "initial";
  query: string;
  maxResults: number;
  filters?: YouTubeSearchFilters;
};

type ContinuationSearchRequest = {
  kind: "continuation";
  pageToken: string;
  maxResults: number;
};

type NormalizedSearchRequest = InitialSearchRequest | ContinuationSearchRequest;

type InitialPlaylistRequest = {
  kind: "initial";
  reference: YouTubePlaylistLookup;
  maxResults: number;
};

type ContinuationPlaylistRequest = {
  kind: "continuation";
  pageToken: string;
  maxResults: number;
};

type NormalizedPlaylistRequest =
  | InitialPlaylistRequest
  | ContinuationPlaylistRequest;

const SEARCH_TTL_MS = 2 * 60 * 1000;
const PLAYLIST_TTL_MS = 2 * 60 * 1000;
const TRANSCRIPT_TTL_MS = 24 * 60 * 60 * 1000;
const COMMENT_TTL_MS = 2 * 60 * 1000;

const SORT_MAP: Record<YouTubeCommentSortBy, "TOP_COMMENTS" | "NEWEST_FIRST"> = {
  top_comments: "TOP_COMMENTS",
  new_comments: "NEWEST_FIRST"
};

function isCommentsDisabledError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "InnertubeError" &&
    error.message.includes("Comments page did not have any content")
  );
}

export function createYouTubeService(
  options: CreateYouTubeServiceOptions = {}
): YouTubeService {
  const createContinuationToken = options.createContinuationToken ?? randomUUID;
  const logger = options.logger ?? createLogger({ name: "ytcp.youtube.service" });
  const parser = options.parser ?? parseYouTubeInput;
  const rawCache = options.youtubeCache ?? createYouTubeCache();
  const youtubeCache: CoalescingCache =
    "getOrFetch" in rawCache
      ? (rawCache as CoalescingCache)
      : createCoalescingCache(rawCache);
  const policy = options.policy ?? createYouTubeRequestPolicy();
  const transcriptFallback =
    options.transcriptFallback ?? createTranscriptFallbackAdapter();
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

      return youtubeCache.getOrFetch<YouTubeVideoRecord>(cacheKey, async () => {
        const upstream = await client.getClient();

        logger.debug("fetching youtube video", { id: reference.id, source: reference.source });

        const response = await getVideoLookupResponse(upstream, reference, policy, logger);
        return normalizeVideoRecord(response, reference);
      });
    },
    getPlaylist: async (
      input: YouTubePlaylistInput | YouTubePlaylistQuery
    ): Promise<YouTubePlaylistRecord> => {
      const playlistRequest = normalizePlaylistQuery(input, parser);

      if (playlistRequest.kind === "continuation") {
        return getPlaylistContinuationPage(
          playlistRequest,
          {
            createContinuationToken,
            logger,
            policy,
            youtubeCache
          }
        );
      }

      const cacheKey = createPlaylistCacheKey(
        playlistRequest.reference,
        playlistRequest.maxResults
      );

      return youtubeCache.getOrFetch<YouTubePlaylistRecord>(cacheKey, async () => {
        const upstream = await client.getClient();

        logger.debug("fetching youtube playlist", {
          id: playlistRequest.reference.id,
          source: playlistRequest.reference.source,
          maxResults: playlistRequest.maxResults
        });

        const response = await policy.execute(
          () => upstream.getPlaylist(playlistRequest.reference.id),
          {
            label: "playlist lookup",
            target: playlistRequest.reference.id
          }
        );
        return buildPlaylistRecord(
          response,
          playlistRequest.reference,
          playlistRequest.maxResults,
          {
            createContinuationToken,
            youtubeCache
          }
        );
      }, PLAYLIST_TTL_MS);
    },
    getChannel: async (
      input: YouTubeChannelInput
    ): Promise<YouTubeChannelRecord> => {
      const reference = expectReferenceKind(input, parser, "channel");
      const cacheKey = createCacheKey(reference);

      return youtubeCache.getOrFetch<YouTubeChannelRecord>(cacheKey, async () => {
        const upstream = await client.getClient();
        const target = await resolveChannelTarget(upstream, reference, policy, logger);

        logger.debug("fetching youtube channel", {
          target,
          source: reference.source
        });

        const response = await policy.execute(
          async () => {
            try {
              return await upstream.getChannel(target);
            } catch (error) {
              if (isChannelUnavailableError(error)) {
                throw new NotAvailableError(
                  "This YouTube channel is not available or does not exist.",
                  { cause: "channel_unavailable" }
                );
              }

              throw error;
            }
          },
          {
            label: "channel lookup",
            target
          }
        );

        const channelResponse = asRecord(response);
        const record = normalizeChannelRecord(response, reference);
        let recentVideos: import("./contracts.js").YouTubeChannelVideoItem[] = [];

        if (channelResponse?.has_videos === true && typeof channelResponse.getVideos === "function") {
          logger.debug("fetching youtube channel videos", { target });

          try {
            const getVideos = channelResponse.getVideos as () => Promise<unknown>;
            const videosResponse = await policy.execute(
              () => getVideos(),
              { label: "channel videos lookup", target }
            );
            recentVideos = extractChannelVideos(videosResponse);
          } catch (videosError) {
            logger.warn("channel recent-videos lookup failed, trying search fallback", {
              target,
              error: videosError instanceof Error ? videosError.message : String(videosError)
            });
          }
        }

        if (recentVideos.length === 0 && record.title) {
          logger.debug("using search fallback for channel recent videos", { target, channelTitle: record.title });
          try {
            const searchResponse = await policy.execute(
              () => upstream.search(record.title!, toInnertubeSearchFilters({ sortBy: "upload_date" })),
              { label: "channel videos search fallback", target }
            );
            const searchPage = normalizeSearchPage(searchResponse, {
              query: record.title!,
              maxResults: 10,
              filters: { sortBy: "upload_date" }
            });
            recentVideos = searchPage.results
              .filter(r => !record.id || r.channelId === record.id)
              .map(r => ({
                id: r.id,
                canonicalUrl: r.canonicalUrl,
                title: r.title,
                thumbnails: r.thumbnails,
                ...(r.publishedText ? { publishedText: r.publishedText } : {}),
                ...(r.durationText ? { durationText: r.durationText } : {}),
                ...(r.viewCountText ? { viewCountText: r.viewCountText } : {})
              }));
          } catch (searchError) {
            logger.warn("search fallback for channel recent videos also failed", {
              target,
              error: searchError instanceof Error ? searchError.message : String(searchError)
            });
          }
        }

        return { ...record, recentVideos };
      });
    },
    searchVideos: async (input: YouTubeSearchQuery): Promise<YouTubeSearchPage> => {
      const searchRequest = normalizeSearchQuery(input);

      if (searchRequest.kind === "continuation") {
        return getSearchContinuationPage(
          searchRequest,
          {
            createContinuationToken,
            logger,
            policy,
            youtubeCache
          }
        );
      }

      const cacheKey = createSearchCacheKey(searchRequest);

      return youtubeCache.getOrFetch<YouTubeSearchPage>(cacheKey, async () => {
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
          query: searchRequest.query,
          hasFilters: Boolean(searchRequest.filters),
          maxResults: searchRequest.maxResults
        });

        const response = await policy.execute(
          () => upstream.search(searchRequest.query, toInnertubeSearchFilters(searchRequest.filters)),
          {
            label: "search lookup",
            target: searchRequest.query
          }
        );
        return buildSearchPage(response, searchRequest, {
          createContinuationToken,
          youtubeCache
        });
      }, SEARCH_TTL_MS);
    },
    getTranscript: async (
      input: YouTubeVideoInput,
      options: YouTubeTranscriptOptions = {}
    ): Promise<YouTubeTranscriptRecord> => {
      const reference = expectReferenceKind(input, parser, "video");
      const requestedLanguage = normalizeTranscriptLanguageOption(options.language);
      const includeTimestamps = options.includeTimestamps === true;
      const cacheKey = createTranscriptCacheKey(reference, requestedLanguage);
      const baseRecord = await youtubeCache.getOrFetch<YouTubeTranscriptRecord>(
        cacheKey,
        async () => {
          const upstream = await client.getClient();

          logger.debug("fetching youtube transcript", {
            id: reference.id,
            source: reference.source,
            language: requestedLanguage,
            includeTimestamps
          });

          const response = await getTranscriptLookupResponse(
            upstream,
            reference,
            policy
          );
          const transcriptLanguageCatalog = getTranscriptLanguageCatalog(
            response,
            reference,
            requestedLanguage
          );
          const record = await getTranscriptRecord(
            response,
            reference,
            {
              requestedLanguage,
              includeTimestamps,
              languageCatalog: transcriptLanguageCatalog,
              logger,
              policy,
              transcriptFallback
            }
          );
          const formatted = applyTranscriptFormat(record, false);

          // Also cache under the resolved language key if it differs
          const resolvedCacheKey = createTranscriptCacheKey(reference, record.language);

          if (resolvedCacheKey !== cacheKey) {
            youtubeCache.setLookup(resolvedCacheKey, formatted, TRANSCRIPT_TTL_MS);
          }

          return formatted;
        },
        TRANSCRIPT_TTL_MS
      );

      return applyTranscriptFormat(baseRecord, includeTimestamps);
    },
    getComments: async (query: YouTubeCommentQuery): Promise<YouTubeCommentPage> => {
      if (query.pageToken) {
        const state = youtubeCache.getContinuation<CommentContinuationState>(query.pageToken);

        if (!state) {
          throw new NotAvailableError(
            "This comment page token is missing or expired. Run the comments lookup again to continue.",
            { cause: "comment_page_token_expired" }
          );
        }

        const maxResults = query.maxResults ?? DEFAULT_COMMENT_RESULTS;

        logger.debug("fetching youtube comment continuation", {
          videoId: state.videoId,
          pageToken: query.pageToken,
          maxResults
        });

        const nextResponse = await policy.execute(
          () => state.response.getContinuation(),
          { label: "comment continuation", target: state.videoId }
        );

        const continuationReference: YouTubeVideoLookup = {
          kind: "video",
          id: state.videoId,
          input: state.videoId,
          source: "id",
          canonicalUrl: `https://www.youtube.com/watch?v=${state.videoId}`
        };
        const page = normalizeCommentPage(nextResponse, continuationReference, {
          sortBy: state.sortBy,
          maxResults
        });

        if (asRecord(nextResponse)?.has_continuation) {
          const newToken = createContinuationToken();
          youtubeCache.setContinuation(newToken, {
            videoId: state.videoId,
            sortBy: state.sortBy,
            response: nextResponse as CommentsLike
          });
          page.nextPageToken = newToken;
        }

        return page;
      }

      const sortBy: YouTubeCommentSortBy = query.sortBy ?? "top_comments";
      const maxResults = query.maxResults ?? DEFAULT_COMMENT_RESULTS;
      const reference = expectReferenceKind(query.video!, parser, "video");
      const cacheKey = `comment:${reference.id}:sort=${sortBy}:max=${maxResults}`;

      return youtubeCache.getOrFetch<YouTubeCommentPage>(cacheKey, async () => {
        const upstream = await client.getClient();

        logger.debug("fetching youtube comments", {
          id: reference.id,
          sortBy,
          maxResults
        });

        const response = await policy.execute(
          async () => {
            try {
              return await upstream.getComments(reference.id, SORT_MAP[sortBy]);
            } catch (err) {
              if (isCommentsDisabledError(err)) {
                throw new NotAvailableError(
                  "Comments are disabled for this video.",
                  { cause: "comments_disabled" }
                );
              }
              throw err;
            }
          },
          {
            label: "comment lookup",
            target: reference.id
          }
        );

        const record = normalizeCommentPage(response, reference, { sortBy, maxResults });

        if (asRecord(response)?.has_continuation) {
          const token = createContinuationToken();
          youtubeCache.setContinuation(token, {
            videoId: reference.id,
            sortBy,
            response: response as CommentsLike
          });
          record.nextPageToken = token;
        }

        return record;
      }, COMMENT_TTL_MS);
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

function expectPlaylistReference(
  input: YouTubePlaylistInput,
  parser: (input: string) => ParsedYouTubeReference
): YouTubePlaylistLookup {
  const reference = typeof input === "string" ? parser(input) : input;

  if (reference.kind === "playlist") {
    return reference;
  }

  if (reference.kind === "video" && reference.playlistId) {
    return {
      kind: "playlist",
      id: reference.playlistId,
      input: reference.input,
      source: "watch",
      canonicalUrl: createCanonicalPlaylistUrl(reference.playlistId),
      videoId: reference.id
    };
  }

  throw new InvalidInputError(
    `Expected a YouTube playlist reference, but received a ${reference.kind} reference instead.`
  );
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

async function getPlaylistContinuationPage(
  playlistRequest: ContinuationPlaylistRequest,
  dependencies: {
    createContinuationToken: () => string;
    logger: Logger;
    policy: YouTubeRequestPolicy;
    youtubeCache: YouTubeCache;
  }
): Promise<YouTubePlaylistRecord> {
  const continuation = dependencies.youtubeCache.getContinuation<PlaylistContinuationState>(
    playlistRequest.pageToken
  );

  if (!continuation) {
    throw new NotAvailableError(
      "This YouTube playlist page token is missing or expired. Run the playlist lookup again to continue.",
      {
        cause: "playlist_page_token_expired"
      }
    );
  }

  dependencies.logger.debug("fetching youtube playlist continuation", {
    id: continuation.reference.id,
    pageToken: playlistRequest.pageToken,
    maxResults: playlistRequest.maxResults
  });

  const response = await dependencies.policy.execute(
    () => continuation.response.getContinuation(),
    {
      label: "playlist continuation",
      target: continuation.reference.id
    }
  );

  return buildPlaylistRecord(
    response,
    continuation.reference,
    playlistRequest.maxResults,
    {
      createContinuationToken: dependencies.createContinuationToken,
      youtubeCache: dependencies.youtubeCache
    }
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

function isChannelUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === "ChannelError") {
    return true;
  }

  if (error.name === "InnertubeError" && error.message.includes("Invalid channel")) {
    return true;
  }

  return false;
}

function createCacheKey(reference: ParsedYouTubeReference): string {
  switch (reference.kind) {
    case "video":
      return `video:${reference.id}:source=${reference.source}:playlist=${reference.playlistId ?? ""}:start=${reference.startTimeSeconds ?? ""}`;
    case "playlist":
      return `playlist:${reference.id}:source=${reference.source}:video=${reference.videoId ?? ""}`;
    case "channel":
      return `channel:${reference.source}:${reference.channelId ?? reference.handle ?? reference.customName ?? reference.username ?? reference.canonicalUrl}`;
  }
}

function createPlaylistCacheKey(
  reference: YouTubePlaylistLookup,
  maxResults: number
): string {
  return `${createCacheKey(reference)}:max=${maxResults}`;
}

async function getVideoLookupResponse(
  client: InnertubeClientLike,
  reference: YouTubeVideoLookup,
  policy: YouTubeRequestPolicy,
  logger: Logger
): Promise<unknown> {
  if (client.getInfo) {
    try {
      return await policy.execute(
        () => client.getInfo!(reference.id),
        {
          label: "video detail lookup",
          target: reference.id
        }
      );
    } catch (error) {
      logger.warn("youtube rich video lookup fell back to basic info", {
        error: error instanceof Error ? error.message : String(error),
        id: reference.id,
        source: reference.source
      });
    }
  }

  return policy.execute(
    () => client.getBasicInfo(reference.id),
    {
      label: "video lookup",
      target: reference.id
    }
  );
}

async function getTranscriptLookupResponse(
  client: InnertubeClientLike,
  reference: YouTubeVideoLookup,
  policy: YouTubeRequestPolicy
): Promise<unknown> {
  if (!client.getInfo) {
    throw new NotAvailableError(
      "This YouTube client does not support public transcript lookups.",
      {
        cause: "transcript_unsupported"
      }
    );
  }

  return policy.execute(
    () => client.getInfo!(reference.id),
    {
      label: "transcript video lookup",
      target: reference.id
    }
  );
}

async function getTranscriptRecord(
  response: unknown,
  reference: YouTubeVideoLookup,
  dependencies: {
    requestedLanguage: string | undefined;
    includeTimestamps: boolean;
    languageCatalog: YouTubeTranscriptRecord["languages"];
    logger: Logger;
    policy: YouTubeRequestPolicy;
    transcriptFallback: TranscriptFallbackAdapter;
  }
): Promise<YouTubeTranscriptRecord> {
  try {
    const transcript = await getPrimaryTranscript(
      response,
      reference,
      dependencies.requestedLanguage,
      dependencies.languageCatalog,
      dependencies.policy
    );

    return ensureTranscriptRecord(
      normalizeTranscriptRecord(transcript, reference, response, {
        includeTimestamps: dependencies.includeTimestamps,
        retrievalMethod: "primary"
      }),
      reference.id
    );
  } catch (error) {
    if (!shouldTryTranscriptFallback(error)) {
      throw error;
    }

    const primaryError = error;

    dependencies.logger.warn(
      "youtube primary transcript lookup fell back to secondary extractor",
      {
        id: reference.id,
        error: error instanceof Error ? error.message : String(error),
        requestedLanguage: dependencies.requestedLanguage
      }
    );

    try {
      return await getFallbackTranscriptRecord(
        response,
        reference,
        dependencies
      );
    } catch (fallbackError) {
      // When the primary error was transcript_unavailable and the fallback failed
      // with an infrastructure error (e.g. InnerTube /player returned 400 or an
      // empty body), throw the original primary error rather than the fallback's
      // UpstreamUnavailableError. This preserves the accurate transcript_unavailable
      // classification so callers do not receive a misleading "temporarily unavailable"
      // status for a video that genuinely has no transcript.
      //
      // If the fallback itself returns a NotAvailableError, propagate that instead
      // because it may carry additional details (e.g. fallback: true) that are useful
      // for callers to distinguish the fallback path.
      if (
        fallbackError instanceof UpstreamUnavailableError &&
        primaryError instanceof NotAvailableError &&
        primaryError.causeDetail === "transcript_unavailable"
      ) {
        throw primaryError;
      }

      throw fallbackError;
    }
  }
}

async function getPrimaryTranscript(
  response: unknown,
  reference: YouTubeVideoLookup,
  requestedLanguage: string | undefined,
  languageCatalog: YouTubeTranscriptRecord["languages"],
  policy: YouTubeRequestPolicy
): Promise<unknown> {
  const transcriptSource = asTranscriptSource(response, reference);
  let transcript = await requestPrimaryTranscript(transcriptSource, reference, policy);

  if (requestedLanguage) {
    const availableLanguages = normalizeTranscriptRecord(
      transcript,
      reference,
      response
    ).languages;
    const resolvedLanguage = resolveRequestedTranscriptLanguage(
      requestedLanguage,
      availableLanguages.length > 0 ? availableLanguages : languageCatalog,
      reference.id
    );

    if (resolvedLanguage.label !== pickTranscriptSelectedLanguage(transcript)) {
      transcript = await requestTranscriptLanguage(
        transcript,
        resolvedLanguage.label,
        reference.id,
        policy
      );
    }
  }

  return transcript;
}

function asTranscriptSource(
  value: unknown,
  reference: YouTubeVideoLookup
): {
  getTranscript: () => Promise<unknown>;
} {
  const candidate = value as {
    getTranscript?: unknown;
  };

  if (typeof candidate?.getTranscript !== "function") {
    throw new UpstreamUnavailableError(
      "Primary transcript lookup is temporarily unavailable for this video.",
      {
        cause: "transcript_primary_unavailable",
        details: {
          videoId: reference.id
        }
      }
    );
  }

  const getTranscript = candidate.getTranscript as () => Promise<unknown>;

  return {
    getTranscript: () => getTranscript()
  };
}

async function requestPrimaryTranscript(
  source: {
    getTranscript: () => Promise<unknown>;
  },
  reference: YouTubeVideoLookup,
  policy: YouTubeRequestPolicy
): Promise<unknown> {
  try {
    return await policy.execute(
      () => source.getTranscript(),
      {
        label: "transcript lookup",
        target: reference.id
      }
    );
  } catch (error) {
    throw remapTranscriptLookupError(error, reference.id);
  }
}

async function requestTranscriptLanguage(
  transcript: unknown,
  language: string,
  videoId: string,
  policy: YouTubeRequestPolicy
): Promise<unknown> {
  const selectable = transcript as {
    selectLanguage?: unknown;
  };

  if (typeof selectable?.selectLanguage !== "function") {
    throw new UpstreamUnavailableError(
      "Primary transcript language selection is temporarily unavailable.",
      {
        cause: "transcript_language_selection_unavailable",
        details: {
          videoId,
          language
        }
      }
    );
  }

  const selectLanguage = selectable.selectLanguage as (
    language: string
  ) => Promise<unknown>;

  return policy.execute(
    () => selectLanguage(language),
    {
      label: "transcript language lookup",
      target: `${videoId}:${language}`
    }
  );
}

function resolveRequestedTranscriptLanguage(
  requestedLanguage: string,
  languages: YouTubeTranscriptRecord["languages"],
  videoId: string
): YouTubeTranscriptRecord["languages"][number] {
  const normalizedRequestedLanguage = normalizeLanguageToken(requestedLanguage);
  const match = languages.find(language => {
    const labelMatches =
      normalizeLanguageToken(language.label) === normalizedRequestedLanguage;
    const codeMatches =
      typeof language.languageCode === "string" &&
      normalizeLanguageToken(language.languageCode) === normalizedRequestedLanguage;

    return labelMatches || codeMatches;
  });

  if (!match) {
    throw new NotAvailableError(
      `Transcript language "${requestedLanguage}" is not available for this video.`,
      {
        cause: "transcript_language_unavailable",
        details: {
          videoId,
          language: requestedLanguage,
          availableLanguages: languages.map(language => language.label)
        }
      }
    );
  }

  return match;
}

function pickTranscriptSelectedLanguage(value: unknown): string | undefined {
  const transcript = asRecord(value);

  return typeof transcript?.selectedLanguage === "string"
    ? transcript.selectedLanguage
    : undefined;
}

function remapTranscriptLookupError(error: unknown, videoId: string): Error {
  if (!(error instanceof NotAvailableError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const message = `${error.message} ${error.causeDetail ?? ""}`.toLocaleLowerCase();

  if (
    message.includes("transcript") ||
    message.includes("engagement panel") ||
    message.includes("transcript panel") ||
    message.includes("basic video info")
  ) {
    return new NotAvailableError(
      "No public transcript is available for this video.",
      {
        cause: "transcript_unavailable",
        details: {
          videoId
        }
      }
    );
  }

  return error;
}

function shouldTryTranscriptFallback(error: unknown): boolean {
  if (error instanceof InvalidInputError) {
    return false;
  }

  if (error instanceof UpstreamUnavailableError) {
    return true;
  }

  return (
    error instanceof NotAvailableError &&
    error.causeDetail === "transcript_unavailable"
  );
}

async function getFallbackTranscriptRecord(
  response: unknown,
  reference: YouTubeVideoLookup,
  dependencies: {
    requestedLanguage: string | undefined;
    includeTimestamps: boolean;
    languageCatalog: YouTubeTranscriptRecord["languages"];
    transcriptFallback: TranscriptFallbackAdapter;
  }
): Promise<YouTubeTranscriptRecord> {
  const requestedLanguage = toFallbackRequestedLanguage(
    dependencies.requestedLanguage,
    dependencies.languageCatalog,
    reference.id
  );
  const fallbackTranscript = await dependencies.transcriptFallback.getTranscript({
    videoId: reference.id,
    ...(requestedLanguage?.languageCode
      ? { languageCode: requestedLanguage.languageCode }
      : {}),
    ...(requestedLanguage?.label ? { languageLabel: requestedLanguage.label } : {})
  });
  const selectedLanguage = fallbackTranscript.languageLabel ??
    requestedLanguage?.label ??
    dependencies.requestedLanguage ??
    "Fallback";
  const selectedLanguageCode =
    fallbackTranscript.languageCode ?? requestedLanguage?.languageCode;
  const languages = buildFallbackLanguageCatalog(
    dependencies.languageCatalog,
    selectedLanguage,
    selectedLanguageCode
  );

  return ensureTranscriptRecord(
    createTranscriptRecord({
      reference,
      videoResponse: response,
      language: selectedLanguage,
      languages,
      segments: fallbackTranscript.segments,
      includeTimestamps: dependencies.includeTimestamps,
      retrievalMethod: "fallback"
    }),
    reference.id
  );
}

function getTranscriptLanguageCatalog(
  response: unknown,
  reference: YouTubeVideoLookup,
  selectedLanguage: string | undefined
): YouTubeTranscriptRecord["languages"] {
  return normalizeTranscriptRecord(
    {
      languages: [],
      ...(selectedLanguage ? { selectedLanguage } : {})
    },
    reference,
    response
  ).languages;
}

function toFallbackRequestedLanguage(
  requestedLanguage: string | undefined,
  languageCatalog: YouTubeTranscriptRecord["languages"],
  videoId: string
): YouTubeTranscriptRecord["languages"][number] | undefined {
  if (!requestedLanguage) {
    return languageCatalog.find(language => language.isSelected) ?? languageCatalog[0];
  }

  if (languageCatalog.length > 0) {
    return resolveRequestedTranscriptLanguage(
      requestedLanguage,
      languageCatalog,
      videoId
    );
  }

  return {
    label: requestedLanguage,
    isSelected: true,
    ...(looksLikeLanguageCode(requestedLanguage)
      ? { languageCode: requestedLanguage }
      : {})
  };
}

function buildFallbackLanguageCatalog(
  languageCatalog: YouTubeTranscriptRecord["languages"],
  selectedLanguage: string,
  selectedLanguageCode?: string
): YouTubeTranscriptRecord["languages"] {
  if (languageCatalog.length === 0) {
    return [
      {
        label: selectedLanguage,
        isSelected: true,
        ...(selectedLanguageCode ? { languageCode: selectedLanguageCode } : {})
      }
    ];
  }

  const languages = languageCatalog.map(language => ({
    ...language,
    isSelected:
      normalizeLanguageToken(language.label) ===
        normalizeLanguageToken(selectedLanguage) ||
      (selectedLanguageCode
        ? normalizeLanguageToken(language.languageCode ?? "") ===
          normalizeLanguageToken(selectedLanguageCode)
        : false)
  }));

  if (languages.some(language => language.isSelected)) {
    return languages;
  }

  return [
    {
      label: selectedLanguage,
      isSelected: true,
      ...(selectedLanguageCode ? { languageCode: selectedLanguageCode } : {})
    },
    ...languages
  ];
}

function ensureTranscriptRecord(
  record: YouTubeTranscriptRecord,
  videoId: string
): YouTubeTranscriptRecord {
  if (record.segmentCount === 0 || !record.text.trim()) {
    throw new NotAvailableError(
      "No public transcript is available for this video.",
      {
        cause: "transcript_unavailable",
        details: {
          videoId
        }
      }
    );
  }

  return record;
}

function applyTranscriptFormat(
  record: YouTubeTranscriptRecord,
  includeTimestamps: boolean
): YouTubeTranscriptRecord {
  if (record.includeTimestamps === includeTimestamps) {
    return record;
  }

  return {
    ...record,
    includeTimestamps,
    text: formatTranscriptText(record.segments, {
      includeTimestamps
    })
  };
}

async function getSearchContinuationPage(
  searchRequest: ContinuationSearchRequest,
  dependencies: {
    createContinuationToken: () => string;
    logger: Logger;
    policy: YouTubeRequestPolicy;
    youtubeCache: YouTubeCache;
  }
): Promise<YouTubeSearchPage> {
  const continuation = dependencies.youtubeCache.getContinuation<SearchContinuationState>(
    searchRequest.pageToken
  );

  if (!continuation) {
    throw new NotAvailableError(
      "This YouTube search page token is missing or expired. Run the search again to continue.",
      {
        cause: "search_page_token_expired"
      }
    );
  }

  dependencies.logger.debug("fetching youtube search continuation", {
    query: continuation.query,
    pageToken: searchRequest.pageToken,
    maxResults: searchRequest.maxResults
  });

  const response = await dependencies.policy.execute(
    () => continuation.response.getContinuation(),
    {
      label: "search continuation",
      target: continuation.query
    }
  );

  return buildSearchPage(
    response,
    {
      kind: "initial",
      query: continuation.query,
      maxResults: searchRequest.maxResults,
      ...(continuation.filters ? { filters: continuation.filters } : {})
    },
    {
      createContinuationToken: dependencies.createContinuationToken,
      youtubeCache: dependencies.youtubeCache
    }
  );
}

function buildSearchPage(
  response: SearchFeedLike,
  request: InitialSearchRequest,
  dependencies: {
    createContinuationToken: () => string;
    youtubeCache: YouTubeCache;
  }
): YouTubeSearchPage {
  const nextPageToken = cacheSearchContinuation(response, request, dependencies);
  const page = normalizeSearchPage(response, request);

  return nextPageToken ? { ...page, nextPageToken } : page;
}

function buildPlaylistRecord(
  response: PlaylistFeedLike,
  reference: YouTubePlaylistLookup,
  maxResults: number,
  dependencies: {
    createContinuationToken: () => string;
    youtubeCache: YouTubeCache;
  }
): YouTubePlaylistRecord {
  const nextPageToken = cachePlaylistContinuation(response, reference, dependencies);
  const record = normalizePlaylistRecord(response, reference, {
    maxResults
  });

  return nextPageToken ? { ...record, nextPageToken } : record;
}

function cacheSearchContinuation(
  response: SearchFeedLike,
  request: InitialSearchRequest,
  dependencies: {
    createContinuationToken: () => string;
    youtubeCache: YouTubeCache;
  }
): string | undefined {
  if (!response.has_continuation) {
    return undefined;
  }

  const token = dependencies.createContinuationToken();

  dependencies.youtubeCache.setContinuation<SearchContinuationState>(
    token,
    {
      query: request.query,
      ...(request.filters ? { filters: request.filters } : {}),
      response
    },
    SEARCH_TTL_MS
  );

  return token;
}

function cachePlaylistContinuation(
  response: PlaylistFeedLike,
  reference: YouTubePlaylistLookup,
  dependencies: {
    createContinuationToken: () => string;
    youtubeCache: YouTubeCache;
  }
): string | undefined {
  if (!response.has_continuation) {
    return undefined;
  }

  const token = dependencies.createContinuationToken();

  dependencies.youtubeCache.setContinuation<PlaylistContinuationState>(
    token,
    {
      reference,
      response
    },
    PLAYLIST_TTL_MS
  );

  return token;
}

function normalizePlaylistQuery(
  input: YouTubePlaylistInput | YouTubePlaylistQuery,
  parser: (input: string) => ParsedYouTubeReference
): NormalizedPlaylistRequest {
  if (typeof input === "string" || isParsedReference(input)) {
    return {
      kind: "initial",
      reference: expectPlaylistReference(input, parser),
      maxResults: normalizePlaylistMaxResults(undefined)
    };
  }

  const maxResults = normalizePlaylistMaxResults(input.maxResults);

  if (typeof input.pageToken === "string") {
    const pageToken = input.pageToken.trim();

    if (!pageToken) {
      throw new InvalidInputError(
        "Provide a non-empty `pageToken` string to request the next playlist page."
      );
    }

    return {
      kind: "continuation",
      pageToken,
      maxResults
    };
  }

  return {
    kind: "initial",
    reference: expectPlaylistReference(input.playlist, parser),
    maxResults
  };
}

function normalizeSearchQuery(input: YouTubeSearchQuery): NormalizedSearchRequest {
  const maxResults = normalizeMaxResults(input.maxResults);

  if (typeof input.pageToken === "string") {
    const pageToken = input.pageToken.trim();

    if (!pageToken) {
      throw new InvalidInputError(
        "Provide a non-empty `pageToken` string to request the next search page."
      );
    }

    return {
      kind: "continuation",
      pageToken,
      maxResults
    };
  }

  const query = input.query.trim();

  if (!query) {
    throw new InvalidInputError(
      "Provide a non-empty search query before requesting YouTube search results."
    );
  }

  return {
    kind: "initial",
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

function normalizePlaylistMaxResults(maxResults: number | undefined): number {
  const resolvedMaxResults = maxResults ?? DEFAULT_PLAYLIST_RESULTS;

  if (
    !Number.isInteger(resolvedMaxResults) ||
    resolvedMaxResults < 1 ||
    resolvedMaxResults > MAX_PLAYLIST_RESULTS
  ) {
    throw new InvalidInputError(
      `\`maxResults\` must be between 1 and ${MAX_PLAYLIST_RESULTS}.`
    );
  }

  return resolvedMaxResults;
}

function normalizeMaxResults(maxResults: number | undefined): number {
  const resolvedMaxResults = maxResults ?? DEFAULT_SEARCH_RESULTS;

  if (
    !Number.isInteger(resolvedMaxResults) ||
    resolvedMaxResults < 1 ||
    resolvedMaxResults > MAX_SEARCH_RESULTS
  ) {
    throw new InvalidInputError(
      `\`maxResults\` must be between 1 and ${MAX_SEARCH_RESULTS}.`
    );
  }

  return resolvedMaxResults;
}

function createSearchCacheKey(query: InitialSearchRequest): string {
  return `search:${query.query}:max=${query.maxResults}:filters=${JSON.stringify(query.filters ?? {})}`;
}

function isParsedReference(value: unknown): value is ParsedYouTubeReference {
  const record = asRecord(value);

  return (
    record?.kind === "video" ||
    record?.kind === "playlist" ||
    record?.kind === "channel"
  );
}

function createTranscriptCacheKey(
  reference: YouTubeVideoLookup,
  language: string | undefined
): string {
  return `transcript:${reference.id}:source=${reference.source}:language=${normalizeLanguageToken(language ?? "default")}`;
}

function normalizeTranscriptLanguageOption(language: string | undefined): string | undefined {
  if (typeof language !== "string") {
    return undefined;
  }

  const trimmed = language.trim();

  if (!trimmed) {
    throw new InvalidInputError(
      "Provide a non-empty `language` string when requesting a transcript language."
    );
  }

  return trimmed;
}

function normalizeLanguageToken(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function looksLikeLanguageCode(value: string): boolean {
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(value.trim());
}

function dedupeFeatures(
  feature: YouTubeSearchFeature,
  index: number,
  values: YouTubeSearchFeature[]
): boolean {
  return values.indexOf(feature) === index;
}
