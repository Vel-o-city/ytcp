import { describe, expect, it } from "vitest";

import {
  createFailureResult,
  createNotAvailableResult,
  createResultFromError,
  createSuccessResult
} from "../../src/contracts/tool-result.js";
import {
  InvalidInputError,
  NotAvailableError,
  UpstreamUnavailableError
} from "../../src/lib/mcp-errors.js";

describe("tool result helpers", () => {
  it("creates balanced success payloads", () => {
    expect(
      createSuccessResult({
        summary: "ytcp is ready.",
        data: {
          server: "ytcp",
          version: "0.1.0"
        }
      })
    ).toEqual({
      content: [{ type: "text", text: "ytcp is ready." }],
      structuredContent: {
        status: "ok",
        data: {
          server: "ytcp",
          version: "0.1.0"
        }
      }
    });
  });

  it("returns actionable invalid-input failures", () => {
    expect(
      createFailureResult(
        new InvalidInputError("`video_id` must be an 11-character YouTube video ID.", {
          details: { field: "video_id" },
          suggestion: "Pass a full YouTube URL or a valid 11-character video ID."
        })
      )
    ).toEqual({
      content: [
        {
          type: "text",
          text: "`video_id` must be an 11-character YouTube video ID."
        }
      ],
      isError: true,
      structuredContent: {
        status: "error",
        error: {
          code: "invalid_input",
          message: "`video_id` must be an 11-character YouTube video ID.",
          details: { field: "video_id" },
          suggestion: "Pass a full YouTube URL or a valid 11-character video ID."
        }
      }
    });
  });

  it("returns cause-aware upstream failures", () => {
    expect(
      createResultFromError(
        new UpstreamUnavailableError("YouTube did not return a usable response right now.", {
          cause: "InnerTube request timed out after 10s.",
          details: { upstream: "youtube" }
        })
      )
    ).toEqual({
      content: [
        {
          type: "text",
          text: "YouTube did not return a usable response right now."
        }
      ],
      isError: true,
      structuredContent: {
        status: "error",
        error: {
          code: "upstream_unavailable",
          message: "YouTube did not return a usable response right now.",
          retryable: true,
          cause: "InnerTube request timed out after 10s.",
          details: { upstream: "youtube" }
        }
      }
    });
  });

  it("returns structured not-available payloads without treating them as fatal", () => {
    expect(
      createResultFromError(
        new NotAvailableError("Comments are turned off for this video.", {
          cause: "feature_disabled",
          details: { surface: "comments" }
        })
      )
    ).toEqual({
      content: [
        {
          type: "text",
          text: "Comments are turned off for this video."
        }
      ],
      structuredContent: {
        status: "not_available",
        reason: "feature_disabled",
        data: { surface: "comments" }
      }
    });
  });

  it("can create not-available payloads directly", () => {
    expect(
      createNotAvailableResult({
        summary: "Transcript is not available for this video.",
        reason: "captions_missing",
        data: { language: "en" }
      })
    ).toEqual({
      content: [
        {
          type: "text",
          text: "Transcript is not available for this video."
        }
      ],
      structuredContent: {
        status: "not_available",
        reason: "captions_missing",
        data: { language: "en" }
      }
    });
  });
});
