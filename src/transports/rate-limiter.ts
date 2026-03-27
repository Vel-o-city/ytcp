export type RateLimiterOptions = {
  windowMs?: number;
  maxRequests?: number;
  now?: () => number;
};

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = {
  check: (ip: string) => RateLimitResult;
  reset: () => void;
};

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const windowMs = options.windowMs ?? 60_000;
  const maxRequests = options.maxRequests ?? 30;
  const now = options.now ?? Date.now;
  const requests = new Map<string, number[]>();

  return {
    check(ip: string): RateLimitResult {
      const currentTime = now();
      const windowStart = currentTime - windowMs;
      const timestamps = (requests.get(ip) ?? []).filter(t => t > windowStart);

      if (timestamps.length >= maxRequests) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((timestamps[0]! + windowMs - currentTime) / 1000)
        );
        requests.set(ip, timestamps);
        return { allowed: false, retryAfterSeconds };
      }

      timestamps.push(currentTime);
      requests.set(ip, timestamps);
      return { allowed: true, remaining: maxRequests - timestamps.length };
    },

    reset(): void {
      requests.clear();
    }
  };
}
