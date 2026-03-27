import { describe, expect, it } from "vitest";

import { createRateLimiter } from "../../src/transports/rate-limiter.js";

describe("rate limiter", () => {
  it("allows the first request and reports remaining slots", () => {
    const limiter = createRateLimiter({ now: () => 1000 });
    const result = limiter.check("1.2.3.4");

    expect(result).toEqual({ allowed: true, remaining: 29 });
  });

  it("allows the 30th request with zero remaining", () => {
    let time = 0;
    const limiter = createRateLimiter({ now: () => time });

    for (let i = 0; i < 29; i++) {
      time += 1;
      limiter.check("1.2.3.4");
    }

    time += 1;
    const result = limiter.check("1.2.3.4");
    expect(result).toEqual({ allowed: true, remaining: 0 });
  });

  it("rejects the 31st request with a positive retryAfterSeconds", () => {
    let time = 0;
    const limiter = createRateLimiter({ now: () => time });

    for (let i = 0; i < 30; i++) {
      time += 100;
      limiter.check("1.2.3.4");
    }

    time += 100;
    const result = limiter.check("1.2.3.4");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("allows requests again after the window slides", () => {
    let time = 0;
    const limiter = createRateLimiter({ windowMs: 60_000, now: () => time });

    for (let i = 0; i < 30; i++) {
      time += 100;
      limiter.check("1.2.3.4");
    }

    // Advance past the window
    time += 60_001;
    const result = limiter.check("1.2.3.4");
    expect(result.allowed).toBe(true);
  });

  it("tracks different IPs independently", () => {
    const limiter = createRateLimiter({ maxRequests: 1, now: () => 1000 });

    const first = limiter.check("10.0.0.1");
    const second = limiter.check("10.0.0.2");

    expect(first).toEqual({ allowed: true, remaining: 0 });
    expect(second).toEqual({ allowed: true, remaining: 0 });
  });

  it("clears all state on reset", () => {
    let time = 0;
    const limiter = createRateLimiter({ maxRequests: 1, now: () => time });

    limiter.check("1.2.3.4");
    time += 1;
    const blocked = limiter.check("1.2.3.4");
    expect(blocked.allowed).toBe(false);

    limiter.reset();
    time += 1;
    const afterReset = limiter.check("1.2.3.4");
    expect(afterReset).toEqual({ allowed: true, remaining: 0 });
  });
});
