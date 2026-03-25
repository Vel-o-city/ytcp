import { describe, expect, it } from "vitest";

import {
  DEFAULT_RESULTS_FILE,
  EXPECTED_PROMPTS,
  EXPECTED_RESOURCE_TEMPLATES,
  EXPECTED_TOOLS,
  parseCliOptions,
  readVerificationFixtures,
  renderVerificationMarkdown,
  verifyConnectedClientSurface,
  type VerificationFixtures
} from "../../scripts/live/verify-mcp.js";

type FakeClient = {
  listTools: () => Promise<{ tools: { name: string }[] }>;
  listPrompts: () => Promise<{ prompts: { name: string }[] }>;
  listResourceTemplates: () => Promise<{
    resourceTemplates: { name: string; uriTemplate: string }[];
  }>;
  callTool: (params: {
    name: string;
    arguments?: Record<string, unknown>;
  }) => Promise<{
    content?: unknown[];
    structuredContent?: unknown;
    isError?: boolean;
  }>;
  readResource: (params: { uri: string }) => Promise<{ contents: unknown[] }>;
  getPrompt: (params: {
    name: string;
    arguments?: Record<string, string>;
  }) => Promise<{ messages: unknown[] }>;
};

function createFakeClient(): FakeClient {
  return {
    listTools: async () => ({
      tools: EXPECTED_TOOLS.map(name => ({ name }))
    }),
    listPrompts: async () => ({
      prompts: EXPECTED_PROMPTS.map(name => ({ name }))
    }),
    listResourceTemplates: async () => ({
      resourceTemplates: [
        {
          name: EXPECTED_RESOURCE_TEMPLATES[0],
          uriTemplate: "youtube://video/{videoId}"
        },
        {
          name: EXPECTED_RESOURCE_TEMPLATES[1],
          uriTemplate: "youtube://transcript/{videoId}"
        },
        {
          name: EXPECTED_RESOURCE_TEMPLATES[2],
          uriTemplate: "youtube://channel/{channelId}"
        }
      ]
    }),
    callTool: async ({ name, arguments: args }) => {
      if (name === "server_status") {
        return {
          content: [{ type: "text", text: "ytcp is online." }],
          structuredContent: {
            status: "ok",
            data: {
              server: "ytcp",
              version: "0.1.0",
              transports: ["stdio", "http"]
            }
          }
        };
      }

      if (name === "search_videos") {
        return {
          content: [{ type: "text", text: "Search results loaded." }],
          structuredContent: {
            status: "ok",
            data: {
              query: "rick astley never gonna give you up",
              pageSize: 1,
              results: [{ id: "dQw4w9WgXcQ" }]
            }
          }
        };
      }

      if (name === "get_video_details") {
        return {
          content: [{ type: "text", text: "Loaded video details." }],
          structuredContent: {
            status: "ok",
            data: {
              id: "dQw4w9WgXcQ",
              canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              title: "Never Gonna Give You Up"
            }
          }
        };
      }

      if (
        name === "get_transcript" &&
        (args?.video === "missing-transcript" ||
          args?.video === "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
      ) {
        return {
          content: [{ type: "text", text: "Transcript unavailable." }],
          structuredContent: {
            status: "not_available",
            reason: "transcript_unavailable"
          }
        };
      }

      if (name === "get_transcript") {
        return {
          content: [{ type: "text", text: "Loaded transcript." }],
          structuredContent: {
            status: "ok",
            data: {
              id: "dQw4w9WgXcQ",
              text: "Never gonna give you up",
              language: "English"
            }
          }
        };
      }

      if (name === "get_channel") {
        return {
          content: [{ type: "text", text: "Loaded channel details." }],
          structuredContent: {
            status: "ok",
            data: {
              id: "UCBJycsmduvYEL83R_U4JriQ",
              canonicalUrl: "https://www.youtube.com/@mkbhd"
            }
          }
        };
      }

      if (name === "get_comments") {
        return {
          content: [{ type: "text", text: "Loaded comments." }],
          structuredContent: {
            status: "ok",
            data: {
              videoId: "dQw4w9WgXcQ",
              pageSize: 2,
              threads: []
            }
          }
        };
      }

      if (name === "get_playlist") {
        return {
          content: [{ type: "text", text: "Loaded playlist." }],
          structuredContent: {
            status: "ok",
            data: {
              id: "PL123",
              pageSize: 2,
              nextPageToken: "next-token",
              items: []
            }
          }
        };
      }

      return {
        content: [{ type: "text", text: `Unexpected tool ${name}` }],
        isError: true,
        structuredContent: {
          status: "error"
        }
      };
    },
    readResource: async ({ uri }) => {
      if (uri.includes("/video/")) {
        return {
          contents: [
            {
              text: JSON.stringify({
                id: "dQw4w9WgXcQ"
              })
            }
          ]
        };
      }

      if (uri.includes("/transcript/")) {
        return {
          contents: [
            {
              text: JSON.stringify({
                id: "dQw4w9WgXcQ",
                text: "Never gonna give you up"
              })
            }
          ]
        };
      }

      return {
        contents: [
          {
            text: JSON.stringify({
              id: "UCBJycsmduvYEL83R_U4JriQ"
            })
          }
        ]
      };
    },
    getPrompt: async ({ name }) => {
      if (name === "analyze_video") {
        return {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Use the get_video_details tool to analyze this video."
              }
            }
          ]
        };
      }

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Use the get_transcript tool to extract the workflow."
            }
          }
        ]
      };
    }
  };
}

describe("readVerificationFixtures", () => {
  it("uses defaults and comments fallback when env is empty", () => {
    expect(readVerificationFixtures({} as NodeJS.ProcessEnv)).toEqual({
      happyPathVideo: "https://www.youtube.com/watch?v=aircAruvnKk",
      searchQuery: "rick astley never gonna give you up",
      handleChannel: "https://www.youtube.com/@GoogleDevelopers",
      commentsVideo: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      transcriptUnavailable: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });
  });

  it("reads explicit fixture overrides from env", () => {
    expect(
      readVerificationFixtures({
        YTCP_FIXTURE_VIDEO: "abc",
        YTCP_FIXTURE_SEARCH_QUERY: "query",
        YTCP_FIXTURE_CHANNEL: "@chan",
        YTCP_FIXTURE_COMMENTS_VIDEO: "comments",
        YTCP_FIXTURE_TRANSCRIPT_UNAVAILABLE: "missing",
        YTCP_FIXTURE_LONG_PLAYLIST: "playlist"
      } as NodeJS.ProcessEnv)
    ).toEqual({
      happyPathVideo: "abc",
      searchQuery: "query",
      handleChannel: "@chan",
      commentsVideo: "comments",
      transcriptUnavailable: "missing",
      longPlaylist: "playlist"
    });
  });
});

describe("parseCliOptions", () => {
  it("parses default options", () => {
    expect(parseCliOptions([])).toEqual({
      transport: "both",
      writeResults: false,
      resultsFile: DEFAULT_RESULTS_FILE
    });
  });

  it("parses explicit flags in both forms", () => {
    expect(
      parseCliOptions([
        "--transport=stdio",
        "--write-results",
        "--results-file",
        "custom.md"
      ])
    ).toEqual({
      transport: "stdio",
      writeResults: true,
      resultsFile: "custom.md"
    });
  });
});

describe("verifyConnectedClientSurface", () => {
  it("records pass and skip rows for a happy client surface", async () => {
    const fixtures: VerificationFixtures = {
      happyPathVideo: "https://www.youtube.com/watch?v=aircAruvnKk",
      searchQuery: "rick astley never gonna give you up",
      handleChannel: "https://www.youtube.com/@GoogleDevelopers",
      commentsVideo: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      transcriptUnavailable: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    };

    const summary = await verifyConnectedClientSurface(
      createFakeClient(),
      "stdio",
      fixtures
    );

    expect(summary.transport).toBe("stdio");
    expect(summary.counts.fail).toBe(0);
    expect(summary.counts.skip).toBe(1);
    expect(summary.counts.pass).toBeGreaterThan(10);
    expect(summary.rows.some(row => row.target === "server_status")).toBe(true);
    expect(
      summary.rows.some(
        row => row.target === "get_playlist" && row.status === "skip"
      )
    ).toBe(true);
    expect(
      summary.rows.some(
        row =>
          row.target === "extract_transcript_workflow" && row.status === "pass"
      )
    ).toBe(true);
    expect(
      summary.rows.some(
        row =>
          row.target === "get_transcript:not_available" && row.status === "pass"
      )
    ).toBe(true);
  });

  it("skip row for missing long playlist mentions YTCP_FIXTURE_LONG_PLAYLIST env var", async () => {
    const fixtures: VerificationFixtures = {
      happyPathVideo: "https://www.youtube.com/watch?v=aircAruvnKk",
      searchQuery: "rick astley never gonna give you up",
      handleChannel: "https://www.youtube.com/@GoogleDevelopers",
      commentsVideo: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    };

    const summary = await verifyConnectedClientSurface(
      createFakeClient(),
      "stdio",
      fixtures
    );

    const playlistSkip = summary.rows.find(
      row => row.target === "get_playlist" && row.status === "skip"
    );

    expect(playlistSkip).toBeDefined();
    expect(playlistSkip?.actual).toContain("YTCP_FIXTURE_LONG_PLAYLIST");
  });

  it("fail row for playlist with items but no continuation token names the item count", async () => {
    const shortPlaylistClient: FakeClient = {
      ...createFakeClient(),
      callTool: async ({ name, arguments: args }) => {
        if (name === "get_playlist") {
          return {
            content: [{ type: "text", text: "Loaded playlist." }],
            structuredContent: {
              status: "ok",
              data: {
                id: "PLshort",
                pageSize: 1,
                items: [{ id: "v1" }]
                // no nextPageToken
              }
            }
          };
        }

        return createFakeClient().callTool({ name, arguments: args });
      }
    };

    const summary = await verifyConnectedClientSurface(
      shortPlaylistClient,
      "stdio",
      {
        happyPathVideo: "https://www.youtube.com/watch?v=aircAruvnKk",
        searchQuery: "rick astley never gonna give you up",
        handleChannel: "https://www.youtube.com/@GoogleDevelopers",
        commentsVideo: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        longPlaylist: "https://www.youtube.com/playlist?list=PLshort"
      }
    );

    const playlistFail = summary.rows.find(
      row => row.target === "get_playlist" && row.status === "fail"
    );

    expect(playlistFail).toBeDefined();
    expect(playlistFail?.actual).toMatch(/1 item/);
    expect(playlistFail?.actual).toContain("nextPageToken");
  });

  it("fail row for empty playlist response names private/deleted as cause", async () => {
    const emptyPlaylistClient: FakeClient = {
      ...createFakeClient(),
      callTool: async ({ name, arguments: args }) => {
        if (name === "get_playlist") {
          return {
            content: [{ type: "text", text: "Loaded playlist." }],
            structuredContent: {
              status: "ok",
              data: {
                id: "PLempty",
                pageSize: 0,
                items: []
                // no nextPageToken
              }
            }
          };
        }

        return createFakeClient().callTool({ name, arguments: args });
      }
    };

    const summary = await verifyConnectedClientSurface(
      emptyPlaylistClient,
      "stdio",
      {
        happyPathVideo: "https://www.youtube.com/watch?v=aircAruvnKk",
        searchQuery: "rick astley never gonna give you up",
        handleChannel: "https://www.youtube.com/@GoogleDevelopers",
        commentsVideo: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        longPlaylist: "https://www.youtube.com/playlist?list=PLempty"
      }
    );

    const playlistFail = summary.rows.find(
      row => row.target === "get_playlist" && row.status === "fail"
    );

    expect(playlistFail).toBeDefined();
    expect(playlistFail?.actual).toMatch(/private|deleted|wrong/i);
  });
});

describe("renderVerificationMarkdown", () => {
  it("renders summary headers and table rows", async () => {
    const summary = await verifyConnectedClientSurface(
      createFakeClient(),
      "http",
      {
        happyPathVideo: "https://www.youtube.com/watch?v=aircAruvnKk",
        searchQuery: "rick astley never gonna give you up",
        handleChannel: "https://www.youtube.com/@GoogleDevelopers",
        commentsVideo: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        longPlaylist: "PL123",
        transcriptUnavailable: "missing-transcript"
      }
    );

    const markdown = renderVerificationMarkdown([summary]);

    expect(markdown).toContain("## MCP SDK Verification - HTTP");
    expect(markdown).toContain("| Timestamp | Surface | Target | Fixture | Expected | Actual | Status |");
    expect(markdown).toContain("server_status");
    expect(markdown).toContain("PASS");
  });
});
