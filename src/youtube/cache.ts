import { UniversalCache, type SessionOptions } from "youtubei.js";

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

export type YouTubeCache = {
  session: NonNullable<SessionOptions["cache"]>;
  getLookup: <T>(key: string) => T | undefined;
  setLookup: <T>(key: string, value: T, ttlMs?: number) => T;
  deleteLookup: (key: string) => void;
  clearLookup: () => void;
};

export type CreateYouTubeCacheOptions = {
  session?: SessionOptions["cache"];
  persistentSession?: boolean;
  persistentDirectory?: string;
  defaultTtlMs?: number;
  now?: () => number;
};

export function createYouTubeCache(
  options: CreateYouTubeCacheOptions = {}
): YouTubeCache {
  const defaultTtlMs = options.defaultTtlMs ?? 5 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const lookupCache = new Map<string, CacheEntry>();
  const session =
    options.session ??
    new UniversalCache(
      options.persistentSession ?? false,
      options.persistentDirectory
    );

  return {
    session,
    getLookup: <T>(key: string): T | undefined => {
      const entry = lookupCache.get(key);

      if (!entry) {
        return undefined;
      }

      if (entry.expiresAt <= now()) {
        lookupCache.delete(key);
        return undefined;
      }

      return entry.value as T;
    },
    setLookup: <T>(key: string, value: T, ttlMs?: number): T => {
      lookupCache.set(key, {
        value,
        expiresAt: now() + (ttlMs ?? defaultTtlMs)
      });

      return value;
    },
    deleteLookup: (key: string): void => {
      lookupCache.delete(key);
    },
    clearLookup: (): void => {
      lookupCache.clear();
    }
  };
}
