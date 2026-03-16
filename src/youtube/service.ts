import { randomUUID } from "node:crypto";

import { createLogger, type Logger } from "../lib/logger.js";
import {
  InvalidInputError,
  NotAvailableError,
  UpstreamUnavailableError
} from "../lib/mcp-errors.js";

import {
  DEFAULT_SEARCH_RESULTS,
  MAX_SEARCH_RESULTS,
  type YouTubeChannelInput,
  type YouTubeChannelLookup,
  type YouTubeChannelRecord,
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
  normalizeChannelRecord,
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

export type CreateYouTubeServiceOptions = CreateInnertubeClientOptions & {
  client?: InnertubeClientHandle;
  createContinuationToken?: () => string;
  logger?: Logger;
  parser?: (input: string) => ParsedYouTubeReference;
  policy?: YouTubeRequestPolicy;
  youtubeCache?: YouTubeCache;
};

type SearchFeedLike = Awaited<ReturnType<NonNullable<InnertubeClientLike["search"]>>>;

type SearchContinuationState = {
  query: string;
  filters?: YouTubeSearchFilters;
  response: SearchFeedLike;
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

const SEARCH_TTL_MS = 2 * 60 * 1000;
const TRANSCRIPT_TTL_MS = 24 * 60 * 60 * 1000;

export function createYouTubeService(
  options: CreateYouTubeServiceOptions = {}
): YouTubeService {
  const createContinuationToken = options.createContinuationToken ?? randomUUID;
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

      const response = await getVideoLookupResponse(upstream, reference, policy, logger);
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
      const cached = youtubeCache.getLookup<YouTubeSearchPage>(cacheKey);

      if (cached) {
        logger.debug("youtube search cache hit", {
          query: searchRequest.query,
          maxResults: searchRequest.maxResults
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
      const page = buildSearchPage(response, searchRequest, {
        createContinuationToken,
        youtubeCache
      });

      return youtubeCache.setLookup(cacheKey, page, SEARCH_TTL_MS);
    },
    getTranscript: async (
      input: YouTubeVideoInput,
      options: YouTubeTranscriptOptions = {}
    ): Promise<YouTubeTranscriptRecord> => {
      const reference = expectReferenceKind(input, parser, "video");
      const requestedLanguage = normalizeTranscriptLanguageOption(options.language);
      const cacheKey = createTranscriptCacheKey(reference, requestedLanguage);
      const cached = youtubeCache.getLookup<YouTubeTranscriptRecord>(cacheKey);

      if (cached) {
        logger.debug("youtube transcript cache hit", {
          id: reference.id,
          language: requestedLanguage ?? cached.language
        });
        return cached;
      }

      const upstream = await client.getClient();

      logger.debug("fetching youtube transcript", {
        id: reference.id,
        source: reference.source,
        language: requestedLanguage
      });

      const response = await getTranscriptLookupResponse(
        upstream,
        reference,
        policy
      );
      const transcript = await getPrimaryTranscript(
        response,
        reference,
        requestedLanguage,
        policy
      );
      const record = normalizeTranscriptRecord(transcript, reference, response);
      const resolvedCacheKey = createTranscriptCacheKey(reference, record.language);
      const cachedRecord = youtubeCache.setLookup(
        resolvedCacheKey,
        record,
        TRANSCRIPT_TTL_MS
      );

      if (resolvedCacheKey !== cacheKey) {
        youtubeCache.setLookup(cacheKey, cachedRecord, TRANSCRIPT_TTL_MS);
      }

      return cachedRecord;
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
      return `video:${reference.id}:source=${reference.source}:playlist=${reference.playlistId ?? ""}:start=${reference.startTimeSeconds ?? ""}`;
    case "playlist":
      return `playlist:${reference.id}:source=${reference.source}:video=${reference.videoId ?? ""}`;
    case "channel":
      return `channel:${reference.source}:${reference.channelId ?? reference.handle ?? reference.customName ?? reference.username ?? reference.canonicalUrl}`;
  }
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

async function getPrimaryTranscript(
  response: unknown,
  reference: YouTubeVideoLookup,
  requestedLanguage: string | undefined,
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
      availableLanguages,
      reference.id
    );

    if (resolvedLanguage !== pickTranscriptSelectedLanguage(transcript)) {
      transcript = await requestTranscriptLanguage(
        transcript,
        resolvedLanguage,
        reference.id,
        policy
      );
    }
  }

  const record = normalizeTranscriptRecord(transcript, reference, response);

  if (record.segmentCount === 0 || !record.text.trim()) {
    throw new NotAvailableError(
      "No public transcript is available for this video.",
      {
        cause: "transcript_unavailable",
        details: {
          videoId: reference.id
        }
      }
    );
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
): string {
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

  return match.label;
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

function dedupeFeatures(
  feature: YouTubeSearchFeature,
  index: number,
  values: YouTubeSearchFeature[]
): boolean {
  return values.indexOf(feature) === index;
}
