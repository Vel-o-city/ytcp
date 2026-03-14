import { describe, expect, it, vi } from "vitest";

import {
  InvalidInputError,
  NotAvailableError,
  UpstreamUnavailableError
} from "../../src/lib/mcp-errors.js";
import {
  createYouTubeRequestPolicy,
  shouldRetryYouTubeError
} from "../../src/youtube/policies.js";

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
