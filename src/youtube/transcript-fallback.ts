import * as captionExtractor from "youtube-caption-extractor";

import {
  NotAvailableError,
  UpstreamUnavailableError,
  isToolFailure
} from "../lib/mcp-errors.js";

import type { YouTubeTranscriptSegment } from "./contracts.js";
import { formatTranscriptTimestamp } from "./normalize.js";

export type TranscriptFallbackRequest = {
  videoId: string;
  languageCode?: string;
  languageLabel?: string;
};

export type TranscriptFallbackResult = {
  languageCode?: string;
  languageLabel?: string;
  segments: YouTubeTranscriptSegment[];
};

export type TranscriptFallbackAdapter = {
  getTranscript: (
    request: TranscriptFallbackRequest
  ) => Promise<TranscriptFallbackResult>;
};

export type CreateTranscriptFallbackAdapterOptions = {
  getSubtitles?: typeof captionExtractor.getSubtitles;
};

export function createTranscriptFallbackAdapter(
  options: CreateTranscriptFallbackAdapterOptions = {}
): TranscriptFallbackAdapter {
  const getSubtitles = options.getSubtitles ?? captionExtractor.getSubtitles;

  return {
    getTranscript: async (
      request: TranscriptFallbackRequest
    ): Promise<TranscriptFallbackResult> => {
      try {
        const subtitles = await getSubtitles({
          videoID: request.videoId,
          ...(request.languageCode ? { lang: request.languageCode } : {})
        });
        const segments = subtitles
          .map(subtitle => normalizeFallbackSubtitle(subtitle))
          .filter((segment): segment is YouTubeTranscriptSegment => Boolean(segment));

        if (segments.length === 0) {
          throw new NotAvailableError(
            "No public transcript is available for this video.",
            {
              cause: "transcript_unavailable",
              details: {
                videoId: request.videoId,
                fallback: true
              }
            }
          );
        }

        return {
          ...(request.languageCode ? { languageCode: request.languageCode } : {}),
          ...(request.languageLabel ? { languageLabel: request.languageLabel } : {}),
          segments
        };
      } catch (error) {
        throw toFallbackError(error, request.videoId);
      }
    }
  };
}

function normalizeFallbackSubtitle(
  subtitle: captionExtractor.Subtitle
): YouTubeTranscriptSegment | null {
  const startSeconds = Number(subtitle.start);
  const durationSeconds = Number(subtitle.dur);
  const text = subtitle.text.trim();

  if (!Number.isFinite(startSeconds) || !Number.isFinite(durationSeconds) || !text) {
    return null;
  }

  const startMs = Math.max(0, Math.floor(startSeconds * 1000));
  const endMs = Math.max(startMs, Math.floor((startSeconds + durationSeconds) * 1000));

  return {
    startMs,
    endMs,
    startTimeSeconds: Math.max(0, Math.floor(startMs / 1000)),
    endTimeSeconds: Math.max(0, Math.floor(endMs / 1000)),
    startTimeText: formatTranscriptTimestamp(startSeconds),
    text
  };
}

function toFallbackError(error: unknown, videoId: string): Error {
  if (isToolFailure(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLocaleLowerCase();

  if (
    normalizedMessage.includes("caption") ||
    normalizedMessage.includes("subtitle") ||
    normalizedMessage.includes("transcript") ||
    normalizedMessage.includes("not found")
  ) {
    return new NotAvailableError(
      "No public transcript is available for this video.",
      {
        cause: "transcript_unavailable",
        details: {
          videoId,
          fallback: true
        }
      }
    );
  }

  return new UpstreamUnavailableError(
    "Secondary transcript extraction is temporarily unavailable.",
    {
      cause: message,
      details: {
        videoId,
        fallback: true
      }
    }
  );
}
