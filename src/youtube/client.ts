import { Innertube, UniversalCache, type SessionOptions } from "youtubei.js";

import { createLogger, type Logger } from "../lib/logger.js";

export type InnertubeClientLike = {
  getBasicInfo: (videoId: string) => Promise<unknown>;
  getPlaylist: (playlistId: string) => Promise<unknown>;
  getChannel: (channelId: string) => Promise<unknown>;
  resolveURL?: (url: string) => Promise<unknown>;
};

export type CreateInnertubeClientOptions = {
  cache?: SessionOptions["cache"];
  fetch?: SessionOptions["fetch"];
  logger?: Logger;
  visitorData?: string;
  poToken?: string;
  userAgent?: string;
  enableSessionCache?: boolean;
  generateSessionLocally?: boolean;
  retrieveInnertubeConfig?: boolean;
  retrievePlayer?: boolean;
  createClient?: (config: SessionOptions) => Promise<InnertubeClientLike>;
};

export type InnertubeClientHandle = {
  getConfig: () => SessionOptions;
  getClient: () => Promise<InnertubeClientLike>;
  reset: () => void;
};

export function createInnertubeClient(
  options: CreateInnertubeClientOptions = {}
): InnertubeClientHandle {
  const logger = options.logger ?? createLogger({ name: "ytcp.youtube.client" });
  const cache = options.cache ?? new UniversalCache(false);
  const createClient = options.createClient ?? Innertube.create;
  const config: SessionOptions = {
    cache,
    retrieve_player: options.retrievePlayer ?? false,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.visitorData ? { visitor_data: options.visitorData } : {}),
    ...(options.poToken ? { po_token: options.poToken } : {}),
    ...(options.userAgent ? { user_agent: options.userAgent } : {}),
    ...(typeof options.enableSessionCache === "boolean"
      ? { enable_session_cache: options.enableSessionCache }
      : {}),
    ...(typeof options.generateSessionLocally === "boolean"
      ? { generate_session_locally: options.generateSessionLocally }
      : {}),
    ...(typeof options.retrieveInnertubeConfig === "boolean"
      ? { retrieve_innertube_config: options.retrieveInnertubeConfig }
      : {})
  };

  let clientPromise: Promise<InnertubeClientLike> | undefined;

  return {
    getConfig: () => config,
    getClient: async () => {
      if (!clientPromise) {
        logger.debug("creating youtubei client", {
          retrievePlayer: config.retrieve_player,
          hasCustomFetch: Boolean(config.fetch),
          hasVisitorData: Boolean(config.visitor_data),
          hasPoToken: Boolean(config.po_token)
        });

        clientPromise = createClient(config).catch(error => {
          clientPromise = undefined;
          logger.error("youtubei client creation failed", {
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        });
      }

      return clientPromise;
    },
    reset: () => {
      clientPromise = undefined;
    }
  };
}
