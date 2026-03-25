import { appendFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { HostedHttpServer, StartHttpServerOptions } from "../../src/transports/http.js";
import { runLiveHttpServer } from "./http.js";

export const EXPECTED_TOOLS = [
  "server_status",
  "search_videos",
  "get_video_details",
  "get_transcript",
  "get_playlist",
  "get_channel",
  "get_comments"
] as const;

export const EXPECTED_PROMPTS = [
  "analyze_video",
  "extract_transcript_workflow"
] as const;

export const EXPECTED_RESOURCE_TEMPLATES = [
  "youtube_video",
  "youtube_transcript",
  "youtube_channel"
] as const;

export const DEFAULT_SEARCH_QUERY = "rick astley never gonna give you up";

export const DEFAULT_FIXTURES = {
  happyPathVideo: "https://www.youtube.com/watch?v=aircAruvnKk",
  searchQuery: DEFAULT_SEARCH_QUERY,
  handleChannel: "https://www.youtube.com/@GoogleDevelopers",
  commentsVideo: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  transcriptUnavailable: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  longPlaylist: undefined
} as const;

export const DEFAULT_RESULTS_FILE =
  ".planning/phases/09.5-live-integration-testing/9.5-LIVE-RESULTS.md";

export type VerificationTransport = "stdio" | "http";
export type VerificationStatus = "pass" | "fail" | "skip";
export type VerificationSurface =
  | "transport"
  | "discovery"
  | "tool"
  | "resource"
  | "prompt";

export type VerificationFixtures = {
  happyPathVideo: string;
  searchQuery: string;
  handleChannel: string;
  commentsVideo: string;
  transcriptUnavailable?: string;
  longPlaylist?: string;
};

export type VerificationRow = {
  timestamp: string;
  transport: VerificationTransport;
  surface: VerificationSurface;
  target: string;
  fixture: string;
  expected: string;
  actual: string;
  status: VerificationStatus;
};

export type VerificationSummary = {
  transport: VerificationTransport;
  rows: VerificationRow[];
  counts: {
    pass: number;
    fail: number;
    skip: number;
  };
};

export type CliOptions = {
  transport: VerificationTransport | "both";
  writeResults: boolean;
  resultsFile: string;
};

type MinimalToolResult = {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  toolResult?: unknown;
};

type MinimalResourceResult = {
  contents?: unknown[];
};

type MinimalPromptResult = {
  messages?: unknown[];
};

type McpVerificationClient = {
  listTools: () => Promise<{ tools: { name: string }[] }>;
  listPrompts: () => Promise<{ prompts: { name: string }[] }>;
  listResourceTemplates: () => Promise<{
    resourceTemplates: { name: string; uriTemplate: string }[];
  }>;
  callTool: (params: {
    name: string;
    arguments?: Record<string, unknown>;
  }) => Promise<MinimalToolResult>;
  readResource: (params: { uri: string }) => Promise<MinimalResourceResult>;
  getPrompt: (params: {
    name: string;
    arguments?: Record<string, string>;
  }) => Promise<MinimalPromptResult>;
};

type VerificationConnection = {
  client: McpVerificationClient;
  close: () => Promise<void>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function pickString(
  value: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function pickArray(
  value: Record<string, unknown> | undefined,
  key: string
): unknown[] | undefined {
  const candidate = value?.[key];
  return Array.isArray(candidate) ? candidate : undefined;
}

function trimEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function now(): string {
  return new Date().toISOString();
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRow(
  transport: VerificationTransport,
  surface: VerificationSurface,
  target: string,
  fixture: string,
  expected: string,
  actual: string,
  status: VerificationStatus
): VerificationRow {
  return {
    timestamp: now(),
    transport,
    surface,
    target,
    fixture,
    expected,
    actual,
    status
  };
}

function extractTextContent(content: unknown[] | undefined): string {
  if (!content) {
    return "";
  }

  return content
    .flatMap(item => {
      const record = asRecord(item);
      return record?.type === "text" && typeof record.text === "string"
        ? [record.text]
        : [];
    })
    .join(" ")
    .trim();
}

function extractSuccessData(
  result: MinimalToolResult,
  target: string
): Record<string, unknown> {
  if (result.isError) {
    throw new Error(`${target} returned an MCP error result.`);
  }

  const structuredContent = asRecord(result.structuredContent);
  const status = pickString(structuredContent, "status");

  if (status !== "ok") {
    throw new Error(
      `${target} returned status ${status ?? "unknown"}: ${
        extractTextContent(result.content) || "no summary"
      }`
    );
  }

  const data = asRecord(structuredContent?.data);

  if (!data) {
    throw new Error(`${target} did not include structured data.`);
  }

  return data;
}

function extractNotAvailableReason(
  result: MinimalToolResult,
  target: string
): string {
  const structuredContent = asRecord(result.structuredContent);
  const status = pickString(structuredContent, "status");

  if (status !== "not_available") {
    throw new Error(
      `${target} expected not_available but got ${status ?? "unknown"}.`
    );
  }

  const reason = pickString(structuredContent, "reason");

  if (!reason) {
    throw new Error(`${target} did not include a not_available reason.`);
  }

  return reason;
}

function extractResourceJson(
  result: MinimalResourceResult,
  target: string
): Record<string, unknown> {
  const contents = Array.isArray(result.contents) ? result.contents : [];
  const first = asRecord(contents[0]);
  const text = pickString(first, "text");

  if (!text) {
    throw new Error(`${target} did not return a text resource payload.`);
  }

  const parsed = JSON.parse(text);
  const parsedRecord = asRecord(parsed);

  if (!parsedRecord) {
    throw new Error(`${target} returned non-object JSON.`);
  }

  return parsedRecord;
}

function extractPromptText(
  result: MinimalPromptResult,
  target: string
): string {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const first = asRecord(messages[0]);
  const content = asRecord(first?.content);
  const text = pickString(content, "text");

  if (!text) {
    throw new Error(`${target} did not return a text prompt message.`);
  }

  return text;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function summarizeCounts(rows: VerificationRow[]): VerificationSummary["counts"] {
  return rows.reduce(
    (counts, row) => {
      counts[row.status] += 1;
      return counts;
    },
    { pass: 0, fail: 0, skip: 0 }
  );
}

function hasAllNames(items: { name: string }[], expected: readonly string[]): string[] {
  const names = new Set(items.map(item => item.name));
  return expected.filter(name => !names.has(name));
}

async function runCheck<T>(
  rows: VerificationRow[],
  transport: VerificationTransport,
  surface: VerificationSurface,
  target: string,
  fixture: string,
  expected: string,
  check: () => Promise<{ actual: string; value?: T }>
): Promise<T | undefined> {
  try {
    const outcome = await check();
    rows.push(
      createRow(
        transport,
        surface,
        target,
        fixture,
        expected,
        outcome.actual,
        "pass"
      )
    );
    return outcome.value;
  } catch (error) {
    rows.push(
      createRow(
        transport,
        surface,
        target,
        fixture,
        expected,
        summarizeError(error),
        "fail"
      )
    );
    return undefined;
  }
}

function addSkip(
  rows: VerificationRow[],
  transport: VerificationTransport,
  surface: VerificationSurface,
  target: string,
  fixture: string,
  expected: string,
  reason: string
): void {
  rows.push(
    createRow(transport, surface, target, fixture, expected, reason, "skip")
  );
}

export function maybeExtractVideoId(input: string): string | undefined {
  const trimmed = input.trim();

  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);

    if (url.hostname === "youtu.be") {
      const candidate = url.pathname.replace(/^\/+/, "").split("/")[0];
      return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : undefined;
    }

    const fromQuery = url.searchParams.get("v");
    if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) {
      return fromQuery;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const candidate = parts.at(-1);
    return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate)
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

export function readVerificationFixtures(
  env: NodeJS.ProcessEnv = process.env
): VerificationFixtures {
  const transcriptUnavailable =
    trimEnvValue(env.YTCP_FIXTURE_TRANSCRIPT_UNAVAILABLE) ??
    DEFAULT_FIXTURES.transcriptUnavailable;
  const longPlaylist =
    trimEnvValue(env.YTCP_FIXTURE_LONG_PLAYLIST) ??
    DEFAULT_FIXTURES.longPlaylist;

  return {
    happyPathVideo:
      trimEnvValue(env.YTCP_FIXTURE_VIDEO) ?? DEFAULT_FIXTURES.happyPathVideo,
    searchQuery:
      trimEnvValue(env.YTCP_FIXTURE_SEARCH_QUERY) ?? DEFAULT_FIXTURES.searchQuery,
    handleChannel:
      trimEnvValue(env.YTCP_FIXTURE_CHANNEL) ?? DEFAULT_FIXTURES.handleChannel,
    commentsVideo:
      trimEnvValue(env.YTCP_FIXTURE_COMMENTS_VIDEO) ??
      DEFAULT_FIXTURES.commentsVideo,
    ...(transcriptUnavailable ? { transcriptUnavailable } : {}),
    ...(longPlaylist ? { longPlaylist } : {})
  };
}

export function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    transport: "both",
    writeResults: false,
    resultsFile: DEFAULT_RESULTS_FILE
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--write-results") {
      options.writeResults = true;
      continue;
    }

    if (argument === "--transport" || argument === "--results-file") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error(`Missing value for ${argument}.`);
      }

      if (argument === "--transport") {
        if (!["stdio", "http", "both"].includes(value)) {
          throw new Error(`Unsupported transport value: ${value}`);
        }
        options.transport = value as CliOptions["transport"];
      } else {
        options.resultsFile = value;
      }

      index += 1;
      continue;
    }

    if (argument.startsWith("--transport=")) {
      const value = argument.slice("--transport=".length);
      if (!["stdio", "http", "both"].includes(value)) {
        throw new Error(`Unsupported transport value: ${value}`);
      }
      options.transport = value as CliOptions["transport"];
      continue;
    }

    if (argument.startsWith("--results-file=")) {
      options.resultsFile = argument.slice("--results-file=".length);
      continue;
    }

    throw new Error(`Unsupported argument: ${argument}`);
  }

  return options;
}

export function renderVerificationMarkdown(
  summaries: VerificationSummary[]
): string {
  return summaries
    .map(summary => {
      const lines = [
        `## MCP SDK Verification - ${summary.transport.toUpperCase()}`,
        "",
        `Summary: ${summary.counts.pass} passed, ${summary.counts.fail} failed, ${summary.counts.skip} skipped`,
        "",
        "| Timestamp | Surface | Target | Fixture | Expected | Actual | Status |",
        "|-----------|---------|--------|---------|----------|--------|--------|"
      ];

      for (const row of summary.rows) {
        lines.push(
          `| ${row.timestamp} | ${row.surface} | ${escapeTableCell(
            row.target
          )} | ${escapeTableCell(row.fixture)} | ${escapeTableCell(
            row.expected
          )} | ${escapeTableCell(row.actual)} | ${row.status.toUpperCase()} |`
        );
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

export async function appendVerificationResults(
  filePath: string,
  summaries: VerificationSummary[]
): Promise<void> {
  const section = renderVerificationMarkdown(summaries);
  await appendFile(filePath, `\n\n${section}\n`);
}

function createClient(): Client {
  return new Client(
    {
      name: "ytcp-live-verifier",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
}

export async function verifyConnectedClientSurface(
  client: McpVerificationClient,
  transport: VerificationTransport,
  fixtures: VerificationFixtures
): Promise<VerificationSummary> {
  const rows: VerificationRow[] = [];
  const ids: {
    videoId?: string;
    channelId?: string;
  } = {
    videoId: maybeExtractVideoId(fixtures.happyPathVideo)
  };

  await runCheck(
    rows,
    transport,
    "discovery",
    "tools/list",
    "-",
    "All expected tools are advertised",
    async () => {
      const result = await client.listTools();
      const missing = hasAllNames(result.tools, EXPECTED_TOOLS);

      if (missing.length > 0) {
        throw new Error(`Missing tools: ${missing.join(", ")}`);
      }

      return {
        actual: `${result.tools.length} tools advertised`
      };
    }
  );

  await runCheck(
    rows,
    transport,
    "discovery",
    "prompts/list",
    "-",
    "All expected prompts are advertised",
    async () => {
      const result = await client.listPrompts();
      const missing = hasAllNames(result.prompts, EXPECTED_PROMPTS);

      if (missing.length > 0) {
        throw new Error(`Missing prompts: ${missing.join(", ")}`);
      }

      return {
        actual: `${result.prompts.length} prompts advertised`
      };
    }
  );

  await runCheck(
    rows,
    transport,
    "discovery",
    "resources/templates/list",
    "-",
    "All expected youtube:// templates are advertised",
    async () => {
      const result = await client.listResourceTemplates();
      const missing = hasAllNames(
        result.resourceTemplates,
        EXPECTED_RESOURCE_TEMPLATES
      );

      if (missing.length > 0) {
        throw new Error(`Missing resource templates: ${missing.join(", ")}`);
      }

      return {
        actual: `${result.resourceTemplates.length} resource templates advertised`
      };
    }
  );

  await runCheck(
    rows,
    transport,
    "tool",
    "server_status",
    "-",
    "Returns server metadata and both transports",
    async () => {
      const result = await client.callTool({ name: "server_status", arguments: {} });
      const data = extractSuccessData(result, "server_status");
      const transports = pickArray(data, "transports")?.filter(
        value => typeof value === "string"
      ) as string[] | undefined;

      if (!transports || !transports.includes("stdio") || !transports.includes("http")) {
        throw new Error("server_status did not report both stdio and http transports.");
      }

      return {
        actual: `${extractTextContent(result.content)} transports=${transports.join(",")}`
      };
    }
  );

  await runCheck(
    rows,
    transport,
    "tool",
    "search_videos",
    fixtures.searchQuery,
    "Returns at least one search result",
    async () => {
      const result = await client.callTool({
        name: "search_videos",
        arguments: { query: fixtures.searchQuery, maxResults: 3 }
      });
      const data = extractSuccessData(result, "search_videos");
      const results = pickArray(data, "results");

      if (!results || results.length === 0) {
        throw new Error("search_videos returned no results.");
      }

      const firstId = pickString(asRecord(results[0]), "id");
      return {
        actual: `${extractTextContent(result.content)} firstId=${firstId ?? "unknown"}`
      };
    }
  );

  await runCheck(
    rows,
    transport,
    "tool",
    "get_video_details",
    fixtures.happyPathVideo,
    "Returns structured video data and canonical video ID",
    async () => {
      const result = await client.callTool({
        name: "get_video_details",
        arguments: { video: fixtures.happyPathVideo }
      });
      const data = extractSuccessData(result, "get_video_details");
      const videoId = pickString(data, "id");

      if (!videoId) {
        throw new Error("get_video_details did not return a video id.");
      }

      ids.videoId = videoId;

      return {
        actual: `${extractTextContent(result.content)} id=${videoId}`
      };
    }
  );

  await runCheck(
    rows,
    transport,
    "tool",
    "get_transcript",
    fixtures.happyPathVideo,
    "Returns transcript text for the happy-path video",
    async () => {
      const result = await client.callTool({
        name: "get_transcript",
        arguments: { video: fixtures.happyPathVideo, includeTimestamps: false }
      });
      const data = extractSuccessData(result, "get_transcript");
      const transcriptText = pickString(data, "text");

      if (!transcriptText) {
        throw new Error("get_transcript did not return transcript text.");
      }

      return {
        actual: `${extractTextContent(result.content)} chars=${transcriptText.length}`
      };
    }
  );

  await runCheck(
    rows,
    transport,
    "tool",
    "get_channel",
    fixtures.handleChannel,
    "Returns channel metadata with a channel id",
    async () => {
      const result = await client.callTool({
        name: "get_channel",
        arguments: { channel: fixtures.handleChannel }
      });
      const data = extractSuccessData(result, "get_channel");
      const channelId = pickString(data, "id");

      if (!channelId) {
        throw new Error("get_channel did not return a channel id.");
      }

      ids.channelId = channelId;

      return {
        actual: `${extractTextContent(result.content)} id=${channelId}`
      };
    }
  );

  await runCheck(
    rows,
    transport,
    "tool",
    "get_comments",
    fixtures.commentsVideo,
    "Returns comment page metadata for a comments-enabled video",
    async () => {
      const result = await client.callTool({
        name: "get_comments",
        arguments: { video: fixtures.commentsVideo, maxResults: 3 }
      });
      const data = extractSuccessData(result, "get_comments");
      const pageSize = data.pageSize;

      if (typeof pageSize !== "number") {
        throw new Error("get_comments did not return pageSize.");
      }

      return {
        actual: `${extractTextContent(result.content)} pageSize=${pageSize}`
      };
    }
  );

  if (fixtures.longPlaylist) {
    await runCheck(
      rows,
      transport,
      "tool",
      "get_playlist",
      fixtures.longPlaylist,
      "Returns playlist data and a continuation token for a long playlist",
      async () => {
        const result = await client.callTool({
          name: "get_playlist",
          arguments: { playlist: fixtures.longPlaylist, maxResults: 2 }
        });
        const data = extractSuccessData(result, "get_playlist");
        const nextPageToken = pickString(data, "nextPageToken");
        const items = pickArray(data, "items");
        const pageSize = typeof data.pageSize === "number" ? data.pageSize : (items?.length ?? 0);

        if (!nextPageToken) {
          if (pageSize === 0) {
            throw new Error(
              "get_playlist returned 0 items; the fixture playlist may be private, deleted, or the playlist ID is wrong."
            );
          }

          throw new Error(
            `get_playlist returned ${pageSize} item(s) but no nextPageToken; the fixture does not have enough items to trigger pagination with maxResults=2.`
          );
        }

        return {
          actual: `${extractTextContent(result.content)} pageSize=${pageSize} nextPageToken=${nextPageToken.slice(0, 12)}...`
        };
      }
    );
  } else {
    addSkip(
      rows,
      transport,
      "tool",
      "get_playlist",
      "(missing)",
      "Long playlist fixture is configured",
      "Set YTCP_FIXTURE_LONG_PLAYLIST to a playlist URL or ID with more than 2 items. See 9.5-FIXTURES.md for the recommended fixture."
    );
  }

  if (fixtures.transcriptUnavailable) {
    await runCheck(
      rows,
      transport,
      "tool",
      "get_transcript:not_available",
      fixtures.transcriptUnavailable,
      "Returns not_available for a transcript-unavailable fixture",
      async () => {
        const result = await client.callTool({
          name: "get_transcript",
          arguments: { video: fixtures.transcriptUnavailable }
        });
        const reason = extractNotAvailableReason(
          result,
          "get_transcript:not_available"
        );

        if (reason !== "transcript_unavailable") {
          throw new Error(`Expected transcript_unavailable, received ${reason}.`);
        }

        return {
          actual: `${extractTextContent(result.content)} reason=${reason}`
        };
      }
    );
  } else {
    addSkip(
      rows,
      transport,
      "tool",
      "get_transcript:not_available",
      "(missing)",
      "Transcript-unavailable fixture is configured",
      "No YTCP_FIXTURE_TRANSCRIPT_UNAVAILABLE value was provided."
    );
  }

  if (ids.videoId) {
    await runCheck(
      rows,
      transport,
      "resource",
      "youtube://video/{id}",
      ids.videoId,
      "Reads the JSON video resource for the verified video id",
      async () => {
        const data = extractResourceJson(
          await client.readResource({ uri: `youtube://video/${ids.videoId}` }),
          "youtube://video/{id}"
        );
        const resourceVideoId = pickString(data, "id");

        if (resourceVideoId !== ids.videoId) {
          throw new Error(
            `Expected video resource id ${ids.videoId}, received ${resourceVideoId ?? "unknown"}.`
          );
        }

        return {
          actual: `id=${resourceVideoId}`
        };
      }
    );

    await runCheck(
      rows,
      transport,
      "resource",
      "youtube://transcript/{id}",
      ids.videoId,
      "Reads the JSON transcript resource for the verified video id",
      async () => {
        const data = extractResourceJson(
          await client.readResource({ uri: `youtube://transcript/${ids.videoId}` }),
          "youtube://transcript/{id}"
        );
        const resourceVideoId = pickString(data, "id");

        if (resourceVideoId !== ids.videoId) {
          throw new Error(
            `Expected transcript resource id ${ids.videoId}, received ${resourceVideoId ?? "unknown"}.`
          );
        }

        return {
          actual: `id=${resourceVideoId}`
        };
      }
    );
  } else {
    addSkip(
      rows,
      transport,
      "resource",
      "youtube://video/{id}",
      fixtures.happyPathVideo,
      "Happy-path video id is known",
      "Video id was unavailable because get_video_details did not complete."
    );
    addSkip(
      rows,
      transport,
      "resource",
      "youtube://transcript/{id}",
      fixtures.happyPathVideo,
      "Happy-path video id is known",
      "Video id was unavailable because get_video_details did not complete."
    );
  }

  if (ids.channelId) {
    await runCheck(
      rows,
      transport,
      "resource",
      "youtube://channel/{id}",
      ids.channelId,
      "Reads the JSON channel resource for the verified channel id",
      async () => {
        const data = extractResourceJson(
          await client.readResource({ uri: `youtube://channel/${ids.channelId}` }),
          "youtube://channel/{id}"
        );
        const resourceChannelId = pickString(data, "id");

        if (resourceChannelId !== ids.channelId) {
          throw new Error(
            `Expected channel resource id ${ids.channelId}, received ${resourceChannelId ?? "unknown"}.`
          );
        }

        return {
          actual: `id=${resourceChannelId}`
        };
      }
    );
  } else {
    addSkip(
      rows,
      transport,
      "resource",
      "youtube://channel/{id}",
      fixtures.handleChannel,
      "Channel id is known",
      "Channel id was unavailable because get_channel did not complete."
    );
  }

  await runCheck(
    rows,
    transport,
    "prompt",
    "analyze_video",
    fixtures.happyPathVideo,
    "Returns prompt text that instructs the client to use get_video_details",
    async () => {
      const text = extractPromptText(
        await client.getPrompt({
          name: "analyze_video",
          arguments: { videoId: fixtures.happyPathVideo, focus: "general" }
        }),
        "analyze_video"
      );

      if (!text.includes("get_video_details")) {
        throw new Error("analyze_video prompt did not mention get_video_details.");
      }

      return {
        actual: `mentions get_video_details, ${text.length} chars`
      };
    }
  );

  await runCheck(
    rows,
    transport,
    "prompt",
    "extract_transcript_workflow",
    fixtures.happyPathVideo,
    "Returns prompt text that instructs the client to use get_transcript",
    async () => {
      const text = extractPromptText(
        await client.getPrompt({
          name: "extract_transcript_workflow",
          arguments: { videoId: fixtures.happyPathVideo, outputFormat: "steps" }
        }),
        "extract_transcript_workflow"
      );

      if (!text.includes("get_transcript")) {
        throw new Error(
          "extract_transcript_workflow prompt did not mention get_transcript."
        );
      }

      return {
        actual: `mentions get_transcript, ${text.length} chars`
      };
    }
  );

  return {
    transport,
    rows,
    counts: summarizeCounts(rows)
  };
}

export async function connectStdioVerificationClient(options: {
  cwd?: string;
} = {}): Promise<VerificationConnection> {
  const client = createClient();
  const transport = new StdioClientTransport({
    command: "npm",
    args: ["run", "live:stdio"],
    cwd: options.cwd ?? process.cwd(),
    stderr: "pipe"
  });

  let stderrOutput = "";
  const stderr = transport.stderr;

  if (stderr) {
    const readable = stderr as unknown as NodeJS.ReadableStream & {
      setEncoding?: (encoding: BufferEncoding) => void;
    };
    readable.setEncoding?.("utf8");
    stderr.on("data", chunk => {
      stderrOutput += chunk.toString();
    });
  }

  try {
    await client.connect(transport);
  } catch (error) {
    const detail = stderrOutput.trim();
    throw new Error(
      detail ? `${summarizeError(error)}\n${detail}` : summarizeError(error)
    );
  }

  return {
    client,
    close: async () => {
      await client.close();
    }
  };
}

export async function connectHttpVerificationClient(options: {
  env?: NodeJS.ProcessEnv;
  startServer?: (
    options?: StartHttpServerOptions
  ) => Promise<HostedHttpServer>;
} = {}): Promise<VerificationConnection> {
  const hostedServer = await runLiveHttpServer({
    env: options.env,
    startServer: options.startServer
  });
  const client = createClient();
  const transport = new StreamableHTTPClientTransport(new URL(hostedServer.url));

  try {
    await client.connect(transport);
  } catch (error) {
    await hostedServer.close();
    throw error;
  }

  return {
    client,
    close: async () => {
      await client.close();
      await hostedServer.close();
    }
  };
}

export async function runStdioVerification(options: {
  fixtures?: VerificationFixtures;
  cwd?: string;
} = {}): Promise<VerificationSummary> {
  const fixtures = options.fixtures ?? readVerificationFixtures();

  try {
    const connection = await connectStdioVerificationClient({
      cwd: options.cwd
    });

    try {
      return await verifyConnectedClientSurface(
        connection.client,
        "stdio",
        fixtures
      );
    } finally {
      await connection.close();
    }
  } catch (error) {
    const row = createRow(
      "stdio",
      "transport",
      "connect",
      "-",
      "A standards-compliant MCP client connects over stdio",
      summarizeError(error),
      "fail"
    );

    return {
      transport: "stdio",
      rows: [row],
      counts: summarizeCounts([row])
    };
  }
}

export async function runHttpVerification(options: {
  fixtures?: VerificationFixtures;
  env?: NodeJS.ProcessEnv;
  startServer?: (
    options?: StartHttpServerOptions
  ) => Promise<HostedHttpServer>;
} = {}): Promise<VerificationSummary> {
  const fixtures = options.fixtures ?? readVerificationFixtures(options.env);

  try {
    const connection = await connectHttpVerificationClient({
      env: options.env,
      startServer: options.startServer
    });

    try {
      return await verifyConnectedClientSurface(
        connection.client,
        "http",
        fixtures
      );
    } finally {
      await connection.close();
    }
  } catch (error) {
    const row = createRow(
      "http",
      "transport",
      "connect",
      "-",
      "A standards-compliant MCP client connects over Streamable HTTP",
      summarizeError(error),
      "fail"
    );

    return {
      transport: "http",
      rows: [row],
      counts: summarizeCounts([row])
    };
  }
}

export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const options = parseCliOptions(argv);
  const fixtures = readVerificationFixtures(env);
  const summaries: VerificationSummary[] = [];

  if (options.transport === "stdio" || options.transport === "both") {
    summaries.push(
      await runStdioVerification({
        fixtures
      })
    );
  }

  if (options.transport === "http" || options.transport === "both") {
    summaries.push(
      await runHttpVerification({
        fixtures,
        env
      })
    );
  }

  const markdown = renderVerificationMarkdown(summaries);
  process.stdout.write(`${markdown}\n`);

  if (options.writeResults) {
    await appendVerificationResults(options.resultsFile, summaries);
    process.stdout.write(
      `[ytcp] wrote verification results to ${options.resultsFile}\n`
    );
  }

  return summaries.some(summary => summary.counts.fail > 0) ? 1 : 0;
}

function isDirectExecution(metaUrl: string, argv1: string | undefined): boolean {
  return typeof argv1 === "string" && metaUrl === pathToFileURL(argv1).href;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void main().then(
    exitCode => {
      process.exit(exitCode);
    },
    error => {
      process.stderr.write(
        error instanceof Error
          ? `[ytcp] MCP verification failed: ${error.message}\n`
          : `[ytcp] MCP verification failed: ${String(error)}\n`
      );
      process.exit(1);
    }
  );
}
