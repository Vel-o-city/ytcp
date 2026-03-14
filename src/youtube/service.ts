import { createLogger, type Logger } from "../lib/logger.js";
import { InvalidInputError } from "../lib/mcp-errors.js";

import {
  type YouTubeChannelInput,
  type YouTubeChannelLookup,
  type YouTubeChannelRecord,
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
import {
  normalizeChannelRecord,
  normalizePlaylistRecord,
  normalizeVideoRecord
} from "./normalize.js";
import { parseYouTubeInput } from "./parser.js";
import type { ParsedYouTubeReference } from "./reference.js";

export type CreateYouTubeServiceOptions = CreateInnertubeClientOptions & {
  client?: InnertubeClientHandle;
  logger?: Logger;
  parser?: (input: string) => ParsedYouTubeReference;
};

export function createYouTubeService(
  options: CreateYouTubeServiceOptions = {}
): YouTubeService {
  const logger = options.logger ?? createLogger({ name: "ytcp.youtube.service" });
  const parser = options.parser ?? parseYouTubeInput;
  const client = options.client ?? createInnertubeClient(options);

  return {
    parseInput: parser,
    getVideo: async (input: YouTubeVideoInput): Promise<YouTubeVideoRecord> => {
      const reference = expectReferenceKind(input, parser, "video");
      const upstream = await client.getClient();

      logger.debug("fetching youtube video", { id: reference.id, source: reference.source });

      const response = await upstream.getBasicInfo(reference.id);

      return normalizeVideoRecord(response, reference);
    },
    getPlaylist: async (
      input: YouTubePlaylistInput
    ): Promise<YouTubePlaylistRecord> => {
      const reference = expectReferenceKind(input, parser, "playlist");
      const upstream = await client.getClient();

      logger.debug("fetching youtube playlist", {
        id: reference.id,
        source: reference.source
      });

      const response = await upstream.getPlaylist(reference.id);

      return normalizePlaylistRecord(response, reference);
    },
    getChannel: async (
      input: YouTubeChannelInput
    ): Promise<YouTubeChannelRecord> => {
      const reference = expectReferenceKind(input, parser, "channel");
      const upstream = await client.getClient();
      const target = await resolveChannelTarget(upstream, reference);

      logger.debug("fetching youtube channel", {
        target,
        source: reference.source
      });

      const response = await upstream.getChannel(target);

      return normalizeChannelRecord(response, reference);
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
  reference: YouTubeChannelLookup
): Promise<string> {
  if (reference.channelId) {
    return reference.channelId;
  }

  if (client.resolveURL) {
    const endpoint = await client.resolveURL(reference.canonicalUrl);
    const browseId = extractBrowseId(endpoint);

    if (browseId) {
      return browseId;
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
