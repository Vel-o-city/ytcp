import { describe, expect, it, vi } from "vitest";

import {
  InvalidInputError,
  NotAvailableError,
  UpstreamUnavailableError
} from "../../src/lib/mcp-errors.js";
import { createInnertubeClient } from "../../src/youtube/client.js";
import { createYouTubeCache } from "../../src/youtube/cache.js";
import { createYouTubeService } from "../../src/youtube/service.js";
import {
  createYouTubeRequestPolicy,
  shouldRetryYouTubeError
} from "../../src/youtube/policies.js";

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

describe("shouldRetryYouTubeError", () => {
  it("retries transient upstream and transport failures", () => {
    expect(shouldRetryYouTubeError({ status: 429, message: "Too many requests" })).toBe(
      true
    );
    expect(
      shouldRetryYouTubeError({
        code: "ECONNRESET",
        message: "socket hang up"
      })
    ).toBe(true);
    expect(
      shouldRetryYouTubeError(
        new UpstreamUnavailableError("temporary outage", {
          retryable: true
        })
      )
    ).toBe(true);
  });

  it("does not retry invalid-input or not-available failures", () => {
    expect(shouldRetryYouTubeError(new InvalidInputError("bad input"))).toBe(false);
    expect(shouldRetryYouTubeError(new NotAvailableError("not public"))).toBe(false);
  });
});

describe("createYouTubeRequestPolicy", () => {
  it("retries a bounded number of times before succeeding", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ status: 503, message: "Service Unavailable" })
      .mockResolvedValueOnce("ok");
    const policy = createYouTubeRequestPolicy({
      retries: 2,
      sleep,
      timeoutMs: 100
    });

    await expect(
      policy.execute(operation, { label: "video lookup", target: "dQw4w9WgXcQ" })
    ).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("maps timeout guard failures to typed upstream errors", async () => {
    const policy = createYouTubeRequestPolicy({
      retries: 0,
      timeoutMs: 5
    });

    await expect(
      policy.execute(
        async () =>
          new Promise<string>(resolve => {
            setTimeout(() => resolve("late"), 20);
          }),
        { label: "channel lookup", target: "@GoogleDevelopers" }
      )
    ).rejects.toMatchObject({
      name: "UpstreamUnavailableError",
      code: "upstream_unavailable",
      retryable: true
    });
  });
});

describe("createYouTubeCache", () => {
  it("stores normalized lookup values until their ttl expires", () => {
    let now = 1_000;
    const cache = createYouTubeCache({
      defaultTtlMs: 50,
      now: () => now
    });

    cache.setLookup("video:dQw4w9WgXcQ", { title: "Never Gonna Give You Up" });

    expect(
      cache.getLookup<{ title: string }>("video:dQw4w9WgXcQ")
    ).toMatchObject({
      title: "Never Gonna Give You Up"
    });

    now += 60;

    expect(cache.getLookup("video:dQw4w9WgXcQ")).toBeUndefined();
  });
});

describe("client cache wiring", () => {
  it("reuses the shared session cache hook when one is supplied", async () => {
    const youtubeCache = createYouTubeCache();
    const upstream = {
      getBasicInfo: vi.fn(),
      getPlaylist: vi.fn(),
      getChannel: vi.fn()
    };
    const createClient = vi.fn().mockResolvedValue(upstream);
    const client = createInnertubeClient({
      createClient,
      youtubeCache,
      logger: createSilentLogger()
    });

    await client.getClient();

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        cache: youtubeCache.session
      })
    );
  });
});

describe("service policy and cache integration", () => {
  it("caches normalized lookups so repeated video requests avoid duplicate upstream calls", async () => {
    const youtubeCache = createYouTubeCache();
    const upstream = {
      getBasicInfo: vi.fn().mockResolvedValue({
        basic_info: {
          title: "Never Gonna Give You Up"
        }
      }),
      getPlaylist: vi.fn(),
      getChannel: vi.fn()
    };
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger(),
      youtubeCache,
      policy: createYouTubeRequestPolicy({
        retries: 0,
        timeoutMs: 100,
        sleep: vi.fn().mockResolvedValue(undefined)
      })
    });

    await service.getVideo("dQw4w9WgXcQ");
    await service.getVideo("dQw4w9WgXcQ");

    expect(upstream.getBasicInfo).toHaveBeenCalledTimes(1);
  });

  it("surfaces retry exhaustion as a typed upstream error from the service layer", async () => {
    const upstream = {
      getBasicInfo: vi
        .fn()
        .mockRejectedValue({ status: 503, message: "Service Unavailable" }),
      getPlaylist: vi.fn(),
      getChannel: vi.fn()
    };
    const service = createYouTubeService({
      client: {
        getClient: vi.fn().mockResolvedValue(upstream),
        getConfig: vi.fn().mockReturnValue({}),
        reset: vi.fn()
      },
      logger: createSilentLogger(),
      policy: createYouTubeRequestPolicy({
        retries: 1,
        timeoutMs: 100,
        sleep: vi.fn().mockResolvedValue(undefined)
      })
    });

    await expect(service.getVideo("dQw4w9WgXcQ")).rejects.toMatchObject({
      name: "UpstreamUnavailableError",
      code: "upstream_unavailable",
      retryable: true
    });
    expect(upstream.getBasicInfo).toHaveBeenCalledTimes(2);
  });
});
