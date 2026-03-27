import { describe, expect, it, vi } from "vitest";

import { createYouTubeCache } from "../../src/youtube/cache.js";
import {
  createCoalescingCache,
  type CoalescingCache
} from "../../src/youtube/coalescing-cache.js";

function createTestCache(): CoalescingCache {
  let fakeNow = 1000;
  const inner = createYouTubeCache({ now: () => fakeNow });
  return createCoalescingCache(inner);
}

describe("CoalescingCache", () => {
  it("returns cached value from inner cache without calling fetcher (cache hit)", () => {
    let fakeNow = 1000;
    const inner = createYouTubeCache({ now: () => fakeNow });
    inner.setLookup("video:abc", { title: "Hello" });

    const cache = createCoalescingCache(inner);
    const fetcher = vi.fn();

    return cache.getOrFetch("video:abc", fetcher).then((result) => {
      expect(result).toEqual({ title: "Hello" });
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  it("calls fetcher on cache miss and stores result in inner cache (cache miss)", async () => {
    let fakeNow = 1000;
    const inner = createYouTubeCache({ now: () => fakeNow });
    const cache = createCoalescingCache(inner);

    const result = await cache.getOrFetch("video:xyz", async () => ({
      title: "Fetched"
    }));

    expect(result).toEqual({ title: "Fetched" });
    expect(inner.getLookup("video:xyz")).toEqual({ title: "Fetched" });
  });

  it("triggers fetcher exactly once for two concurrent calls with same key (concurrent coalescing)", async () => {
    let fakeNow = 1000;
    const inner = createYouTubeCache({ now: () => fakeNow });
    const cache = createCoalescingCache(inner);

    let resolveExternal!: (value: { title: string }) => void;
    const fetcherPromise = new Promise<{ title: string }>((resolve) => {
      resolveExternal = resolve;
    });

    const fetcher = vi.fn(() => fetcherPromise);

    const call1 = cache.getOrFetch("video:same", fetcher);
    const call2 = cache.getOrFetch("video:same", fetcher);

    resolveExternal({ title: "Shared" });

    const [result1, result2] = await Promise.all([call1, call2]);

    expect(result1).toEqual({ title: "Shared" });
    expect(result2).toEqual({ title: "Shared" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("propagates rejection to all concurrent waiters when fetcher throws (error propagation)", async () => {
    let fakeNow = 1000;
    const inner = createYouTubeCache({ now: () => fakeNow });
    const cache = createCoalescingCache(inner);

    let rejectExternal!: (error: Error) => void;
    const fetcherPromise = new Promise<never>((_resolve, reject) => {
      rejectExternal = reject;
    });

    const fetcher = vi.fn(() => fetcherPromise);

    const call1 = cache.getOrFetch("video:fail", fetcher);
    const call2 = cache.getOrFetch("video:fail", fetcher);

    rejectExternal(new Error("upstream failed"));

    await expect(call1).rejects.toThrow("upstream failed");
    await expect(call2).rejects.toThrow("upstream failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows new fetch after a failed one (cleanup after error)", async () => {
    let fakeNow = 1000;
    const inner = createYouTubeCache({ now: () => fakeNow });
    const cache = createCoalescingCache(inner);

    const fetcher1 = vi.fn(async () => {
      throw new Error("first fail");
    });

    await expect(cache.getOrFetch("video:retry", fetcher1)).rejects.toThrow(
      "first fail"
    );

    const fetcher2 = vi.fn(async () => ({ title: "Recovered" }));
    const result = await cache.getOrFetch("video:retry", fetcher2);

    expect(result).toEqual({ title: "Recovered" });
    expect(fetcher2).toHaveBeenCalledTimes(1);
  });

  it("passes custom ttlMs to inner setLookup when provided (ttl passthrough)", async () => {
    let fakeNow = 1000;
    const inner = createYouTubeCache({ now: () => fakeNow });
    const cache = createCoalescingCache(inner);

    await cache.getOrFetch(
      "video:ttl",
      async () => ({ title: "TTL test" }),
      60_000
    );

    // Value should be in cache now
    expect(inner.getLookup("video:ttl")).toEqual({ title: "TTL test" });

    // Advance past the custom TTL
    fakeNow = 1000 + 60_001;
    expect(inner.getLookup("video:ttl")).toBeUndefined();
  });

  it("passes through all original YouTubeCache methods unchanged (passthrough)", () => {
    let fakeNow = 1000;
    const inner = createYouTubeCache({ now: () => fakeNow });
    const cache = createCoalescingCache(inner);

    // session should be passed through
    expect(cache.session).toBe(inner.session);

    // setLookup/getLookup passthrough
    cache.setLookup("key1", "value1");
    expect(cache.getLookup("key1")).toBe("value1");

    // deleteLookup passthrough
    cache.deleteLookup("key1");
    expect(cache.getLookup("key1")).toBeUndefined();

    // clearLookup passthrough
    cache.setLookup("key2", "value2");
    cache.clearLookup();
    expect(cache.getLookup("key2")).toBeUndefined();

    // continuation methods passthrough
    cache.setContinuation("token1", { data: true });
    expect(cache.getContinuation("token1")).toEqual({ data: true });
    cache.deleteContinuation("token1");
    expect(cache.getContinuation("token1")).toBeUndefined();

    cache.setContinuation("token2", { data: true });
    cache.clearContinuations();
    expect(cache.getContinuation("token2")).toBeUndefined();
  });
});
