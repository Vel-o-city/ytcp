import {
  InvalidInputError,
  NotAvailableError,
  UpstreamUnavailableError,
  isToolFailure
} from "../lib/mcp-errors.js";

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT"
]);
const RETRYABLE_MESSAGE_PATTERN =
  /\b(temporar|timeout|timed out|rate limit|too many requests|service unavailable|gateway timeout|fetch failed|socket hang up)\b/i;

type RetryContext = {
  label: string;
  target?: string;
};

export type CreateYouTubeRequestPolicyOptions = {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type YouTubeRequestPolicy = {
  retries: number;
  timeoutMs: number;
  execute: <T>(
    operation: () => Promise<T>,
    context: RetryContext
  ) => Promise<T>;
};

export function shouldRetryYouTubeError(error: unknown): boolean {
  if (error instanceof InvalidInputError || error instanceof NotAvailableError) {
    return false;
  }

  if (error instanceof UpstreamUnavailableError) {
    return error.retryable !== false;
  }

  const details = asErrorDetails(error);

  if (typeof details.status === "number" && RETRYABLE_STATUS_CODES.has(details.status)) {
    return true;
  }

  if (typeof details.code === "string" && RETRYABLE_ERROR_CODES.has(details.code)) {
    return true;
  }

  return RETRYABLE_MESSAGE_PATTERN.test(details.message);
}

export function createYouTubeRequestPolicy(
  options: CreateYouTubeRequestPolicyOptions = {}
): YouTubeRequestPolicy {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 1_000;
  const sleep =
    options.sleep ??
    (async (ms: number) => {
      await new Promise(resolve => setTimeout(resolve, ms));
    });

  return {
    retries,
    timeoutMs,
    execute: async <T>(
      operation: () => Promise<T>,
      context: RetryContext
    ): Promise<T> => {
      let attempt = 0;

      while (attempt <= retries) {
        try {
          return await withTimeout(operation(), timeoutMs, context);
        } catch (error) {
          const retryable = shouldRetryYouTubeError(error);

          if (retryable && attempt < retries) {
            await sleep(Math.min(baseDelayMs * (attempt + 1), maxDelayMs));
            attempt += 1;
            continue;
          }

          throw toServiceError(error, context, attempt + 1, timeoutMs);
        }
      }

      throw new UpstreamUnavailableError(
        `YouTube ${context.label} is temporarily unavailable.`,
        {
          details: {
            label: context.label,
            target: context.target,
            attempts: retries + 1
          }
        }
      );
    }
  };
}

class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  context: RetryContext
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new RequestTimeoutError(
              `YouTube ${context.label} timed out after ${timeoutMs}ms.`
            )
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function toServiceError(
  error: unknown,
  context: RetryContext,
  attempts: number,
  timeoutMs: number
): Error {
  if (isToolFailure(error)) {
    return error;
  }

  const details = asErrorDetails(error);

  if (error instanceof RequestTimeoutError) {
    return new UpstreamUnavailableError(
      `YouTube ${context.label} timed out before a response was available.`,
      {
        cause: details.message,
        details: {
          label: context.label,
          target: context.target,
          attempts,
          timeoutMs
        }
      }
    );
  }

  if (shouldRetryYouTubeError(error)) {
    return new UpstreamUnavailableError(
      `YouTube ${context.label} is temporarily unavailable after retrying.`,
      {
        cause: details.message,
        details: {
          label: context.label,
          target: context.target,
          attempts
        }
      }
    );
  }

  return new NotAvailableError(
    `YouTube ${context.label} is not available for this request.`,
    {
      cause: details.message,
      details: {
        label: context.label,
        target: context.target,
        attempts
      }
    }
  );
}

function asErrorDetails(error: unknown): {
  message: string;
  code?: string;
  status?: number;
} {
  if (error instanceof Error) {
    const candidate = error as Error & {
      code?: string;
      status?: number;
      statusCode?: number;
      cause?: unknown;
    };

    return {
      message: candidate.message,
      code: candidate.code,
      status:
        typeof candidate.status === "number"
          ? candidate.status
          : candidate.statusCode
    };
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };

    return {
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : JSON.stringify(candidate),
      code: typeof candidate.code === "string" ? candidate.code : undefined,
      status:
        typeof candidate.status === "number"
          ? candidate.status
          : typeof candidate.statusCode === "number"
            ? candidate.statusCode
            : undefined
    };
  }

  return {
    message: String(error)
  };
}
