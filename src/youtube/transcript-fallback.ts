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
  fetch?: typeof globalThis.fetch;
};

/**
 * InnerTube /player-based fallback for transcript retrieval.
 *
 * When the primary youtubei.js getTranscript() call fails (e.g. HTTP 400 from
 * the /youtubei/v1/get_transcript endpoint), this adapter fetches the video
 * player response using the InnerTube Android client context to obtain
 * captionTracks with working auth tokens, then downloads and parses the
 * timedtext XML directly.
 *
 * This approach mirrors python-youtube-transcript-api and works without API
 * keys or external binaries.
 */
export function createTranscriptFallbackAdapter(
  options: CreateTranscriptFallbackAdapterOptions = {}
): TranscriptFallbackAdapter {
  const fetchFn = options.fetch ?? globalThis.fetch;

  return {
    getTranscript: async (
      request: TranscriptFallbackRequest
    ): Promise<TranscriptFallbackResult> => {
      try {
        const captionTracks = await fetchCaptionTracks(request.videoId, fetchFn);

        if (captionTracks.length === 0) {
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

        const track = selectCaptionTrack(captionTracks, request.languageCode);

        if (!track) {
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

        const segments = await fetchTimedTextSegments(track.baseUrl, fetchFn);

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
          ...(track.languageCode ? { languageCode: track.languageCode } : {}),
          ...(track.name ? { languageLabel: track.name } : {}),
          segments
        };
      } catch (error) {
        throw toFallbackError(error, request.videoId);
      }
    }
  };
}

type CaptionTrack = {
  baseUrl: string;
  languageCode?: string;
  name?: string;
};

async function fetchCaptionTracks(
  videoId: string,
  fetchFn: typeof globalThis.fetch
): Promise<CaptionTrack[]> {
  const body = buildPlayerRequestBody(videoId);
  const response = await fetchFn(
    "https://www.youtube.com/youtubei/v1/player",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "19.09.3",
        "User-Agent":
          "com.google.android.youtube/19.09.3 (Linux; U; Android 11) gzip"
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    throw new UpstreamUnavailableError(
      "Secondary transcript extraction is temporarily unavailable.",
      {
        cause: `player_response_${response.status}`,
        details: {
          videoId,
          fallback: true
        }
      }
    );
  }

  const json = await response.json() as Record<string, unknown>;
  return extractCaptionTracksFromPlayerResponse(json);
}

function buildPlayerRequestBody(videoId: string): Record<string, unknown> {
  return {
    videoId,
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: "19.09.3",
        androidSdkVersion: 30,
        hl: "en",
        timeZone: "UTC",
        utcOffsetMinutes: 0
      }
    }
  };
}

function extractCaptionTracksFromPlayerResponse(
  json: Record<string, unknown>
): CaptionTrack[] {
  try {
    const captions = (json as Record<string, unknown>).captions;

    if (!captions || typeof captions !== "object") {
      return [];
    }

    const renderer = (captions as Record<string, unknown>).playerCaptionsTracklistRenderer;

    if (!renderer || typeof renderer !== "object") {
      return [];
    }

    const tracks = (renderer as Record<string, unknown>).captionTracks;

    if (!Array.isArray(tracks)) {
      return [];
    }

    const results: CaptionTrack[] = [];

    for (const track of tracks) {
      if (!track || typeof track !== "object") {
        continue;
      }

      const t = track as Record<string, unknown>;
      const baseUrl = typeof t.baseUrl === "string" ? t.baseUrl : undefined;

      if (!baseUrl) {
        continue;
      }

      const name = extractSimpleText(t.name) ?? undefined;
      const languageCode =
        typeof t.languageCode === "string" ? t.languageCode : undefined;

      results.push({ baseUrl, name, languageCode });
    }

    return results;
  } catch {
    return [];
  }
}

function extractSimpleText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;

    if (typeof v.simpleText === "string") {
      return v.simpleText;
    }
  }

  return null;
}

function selectCaptionTrack(
  tracks: CaptionTrack[],
  languageCode: string | undefined
): CaptionTrack | undefined {
  if (!languageCode) {
    return tracks[0];
  }

  const normalized = languageCode.toLowerCase();
  return (
    tracks.find(t => t.languageCode?.toLowerCase() === normalized) ??
    tracks[0]
  );
}

async function fetchTimedTextSegments(
  baseUrl: string,
  fetchFn: typeof globalThis.fetch
): Promise<YouTubeTranscriptSegment[]> {
  const url = `${baseUrl}&fmt=json3`;
  const response = await fetchFn(url);

  if (!response.ok) {
    return [];
  }

  const json = await response.json() as Record<string, unknown>;
  return parseTimedTextJson(json);
}

function parseTimedTextJson(json: Record<string, unknown>): YouTubeTranscriptSegment[] {
  try {
    const events = json.events;

    if (!Array.isArray(events)) {
      return [];
    }

    return events
      .map(event => parseTimedTextEvent(event))
      .filter((seg): seg is YouTubeTranscriptSegment => seg !== null);
  } catch {
    return [];
  }
}

function parseTimedTextEvent(event: unknown): YouTubeTranscriptSegment | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const e = event as Record<string, unknown>;
  const startMs = typeof e.tStartMs === "number" ? e.tStartMs : Number(e.tStartMs);
  const durationMs = typeof e.dDurationMs === "number" ? e.dDurationMs : Number(e.dDurationMs);

  if (!Number.isFinite(startMs) || !Number.isFinite(durationMs)) {
    return null;
  }

  const segs = e.segs;

  if (!Array.isArray(segs)) {
    return null;
  }

  const text = segs
    .map(seg => {
      if (!seg || typeof seg !== "object") {
        return "";
      }

      const s = seg as Record<string, unknown>;
      return typeof s.utf8 === "string" ? s.utf8 : "";
    })
    .join("")
    .replace(/\n/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  const endMs = Math.max(startMs, startMs + durationMs);
  const startTimeSeconds = Math.floor(startMs / 1000);

  return {
    startMs,
    endMs,
    startTimeSeconds,
    endTimeSeconds: Math.floor(endMs / 1000),
    startTimeText: formatTranscriptTimestamp(startTimeSeconds),
    text
  };
}

function toFallbackError(error: unknown, videoId: string): Error {
  if (isToolFailure(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);

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
