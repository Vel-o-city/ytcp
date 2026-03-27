import type { YouTubeCache } from "./cache.js";

export type CoalescingCache = YouTubeCache & {
  getOrFetch: <T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs?: number
  ) => Promise<T>;
};

export function createCoalescingCache(inner: YouTubeCache): CoalescingCache {
  const inFlight = new Map<
    string,
    { promise: Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();

  return {
    ...inner,
    getOrFetch: async <T>(
      key: string,
      fetcher: () => Promise<T>,
      ttlMs?: number
    ): Promise<T> => {
      const cached = inner.getLookup<T>(key);

      if (cached !== undefined) {
        return cached;
      }

      const existing = inFlight.get(key);

      if (existing) {
        return existing.promise as Promise<T>;
      }

      let resolve!: (value: unknown) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });

      // Suppress unhandled rejection on the shared promise — callers
      // that await getOrFetch will observe the rejection through
      // their own awaited reference, not through this deferred.
      promise.catch(() => {});

      inFlight.set(key, { promise, resolve, reject });

      try {
        const result = await fetcher();
        inner.setLookup(key, result, ttlMs);
        resolve(result);
        return result;
      } catch (error) {
        reject(error);
        throw error;
      } finally {
        inFlight.delete(key);
      }
    }
  };
}
