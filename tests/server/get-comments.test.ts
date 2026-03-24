import { describe, expect, it, vi } from "vitest";

import {
  createFailureResult,
  createNotAvailableResult,
  createSuccessResult
} from "../../src/contracts/tool-result.js";
import { InvalidInputError, NotAvailableError } from "../../src/lib/mcp-errors.js";
import { createServer } from "../../src/server/create-server.js";

type RegisteredTool = {
  annotations?: Record<string, unknown>;
  description?: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

describe("get_comments tool", () => {
  it("registers get_comments with readOnlyHint: true", () => {
    const server = createServer({
      youtubeService: {
        getComments: vi.fn()
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_comments;

    expect(tool).toBeDefined();
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    expect(tool.description).toContain("comment");
  });

  it("returns comment threads for a video (top_comments sort)", async () => {
    const youtubeService = {
      getComments: vi.fn().mockResolvedValue({
        kind: "comments",
        videoId: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        sortBy: "top_comments",
        pageSize: 3,
        threads: [
          {
            threadId: "thread-1",
            text: "Great video!",
            authorName: "User One",
            likeCount: "42",
            replyCount: "3",
            isPinned: false,
            publishedText: "1 day ago"
          },
          {
            threadId: "thread-2",
            text: "Love this!",
            authorName: "User Two",
            likeCount: "10",
            replyCount: "0",
            isPinned: false,
            publishedText: "2 days ago"
          },
          {
            threadId: "thread-3",
            text: "Pinned comment here.",
            authorName: "Channel Owner",
            likeCount: "100",
            replyCount: "5",
            isPinned: true,
            publishedText: "3 days ago"
          }
        ]
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_comments;

    const result = (await tool.handler({ video: "dQw4w9WgXcQ" })) as {
      structuredContent: {
        status: string;
        data: {
          videoId: string;
          sortBy: string;
          pageSize: number;
          threads: Array<Record<string, unknown>>;
          [key: string]: unknown;
        };
      };
    };

    expect(result.structuredContent.status).toBe("ok");
    expect(result.structuredContent.data.videoId).toBe("dQw4w9WgXcQ");
    expect(result.structuredContent.data.sortBy).toBe("top_comments");
    expect(result.structuredContent.data.threads).toHaveLength(3);
    expect(result.structuredContent.data.threads[0].text).toBe("Great video!");
    expect(result.structuredContent.data).not.toHaveProperty("kind");
    expect(youtubeService.getComments).toHaveBeenCalledWith({
      video: "dQw4w9WgXcQ"
    });
  });

  it("returns comment threads for a video (new_comments sort)", async () => {
    const youtubeService = {
      getComments: vi.fn().mockResolvedValue({
        kind: "comments",
        videoId: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        sortBy: "new_comments",
        pageSize: 2,
        threads: [
          {
            threadId: "thread-new-1",
            text: "Brand new comment",
            isPinned: false
          },
          {
            threadId: "thread-new-2",
            text: "Another new comment",
            isPinned: false
          }
        ]
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_comments;

    const result = (await tool.handler({
      video: "dQw4w9WgXcQ",
      sortBy: "new_comments"
    })) as {
      structuredContent: { status: string; data: { sortBy: string } };
    };

    expect(result.structuredContent.status).toBe("ok");
    expect(result.structuredContent.data.sortBy).toBe("new_comments");
    expect(youtubeService.getComments).toHaveBeenCalledWith({
      video: "dQw4w9WgXcQ",
      sortBy: "new_comments"
    });
  });

  it("passes pageToken to getComments service", async () => {
    const youtubeService = {
      getComments: vi.fn().mockResolvedValue({
        kind: "comments",
        videoId: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        sortBy: "top_comments",
        pageSize: 20,
        nextPageToken: "tok-page-2",
        threads: []
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_comments;

    const result = (await tool.handler({
      pageToken: "tok-abc",
      maxResults: 10
    })) as {
      structuredContent: {
        status: string;
        data: {
          videoId: string;
          threads: Array<unknown>;
          nextPageToken?: string;
          [key: string]: unknown;
        };
      };
    };

    expect(result.structuredContent.status).toBe("ok");
    expect(result.structuredContent.data.videoId).toBe("dQw4w9WgXcQ");
    expect(Array.isArray(result.structuredContent.data.threads)).toBe(true);
    expect(result.structuredContent.data.nextPageToken).toBe("tok-page-2");
    expect(youtubeService.getComments).toHaveBeenCalledWith({
      pageToken: "tok-abc",
      maxResults: 10
    });
  });

  it("rejects input with neither video nor pageToken", async () => {
    const server = createServer({
      youtubeService: {
        getComments: vi.fn()
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_comments;

    await expect(tool.handler({})).resolves.toEqual(
      createFailureResult(
        new InvalidInputError("Either `video` or `pageToken` must be provided.")
      )
    );
  });

  it("rejects input with both video and pageToken", async () => {
    const server = createServer({
      youtubeService: {
        getComments: vi.fn()
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_comments;

    await expect(
      tool.handler({ video: "dQw4w9WgXcQ", pageToken: "tok-abc" })
    ).resolves.toEqual(
      createFailureResult(
        new InvalidInputError("Provide either `video` or `pageToken`, not both.")
      )
    );
  });

  it("rejects pageToken combined with sortBy", async () => {
    const server = createServer({
      youtubeService: {
        getComments: vi.fn()
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_comments;

    const result = (await tool.handler({
      pageToken: "tok-abc",
      sortBy: "top_comments"
    })) as {
      isError?: boolean;
      structuredContent: { status: string; error?: { message: string } };
    };

    expect(result.isError).toBe(true);
    expect(result.structuredContent.status).toBe("error");
    expect(result.structuredContent.error?.message).toContain("`sortBy`");
  });

  it("maps comments_disabled NotAvailableError to failure result", async () => {
    const server = createServer({
      youtubeService: {
        getComments: vi.fn().mockRejectedValue(
          new NotAvailableError("Comments are disabled for this video.", {
            cause: "comments_disabled"
          })
        )
      }
    });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_comments;

    await expect(
      tool.handler({ video: "dQw4w9WgXcQ" })
    ).resolves.toEqual(
      createNotAvailableResult({
        summary: "Comments are disabled for this video.",
        reason: "comments_disabled"
      })
    );
  });

  it("get_comments is reachable through the shared server factory (transport parity)", () => {
    const server = createServer({
      youtubeService: {
        getComments: vi.fn()
      }
    });
    const tools = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools;

    expect(tools.get_comments).toBeDefined();
    expect(typeof tools.get_comments.handler).toBe("function");
  });

  it.each([
    ["bare video ID", "dQw4w9WgXcQ"],
    ["watch URL", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["short URL", "https://youtu.be/dQw4w9WgXcQ"]
  ])("resolves multiple video URL input forms — %s", async (_label, input) => {
    const youtubeService = {
      getComments: vi.fn().mockResolvedValue({
        kind: "comments",
        videoId: "dQw4w9WgXcQ",
        canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        sortBy: "top_comments",
        pageSize: 0,
        threads: []
      })
    };
    const server = createServer({ youtubeService });
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.get_comments;

    const result = (await tool.handler({ video: input })) as {
      structuredContent: { status: string };
    };

    expect(result.structuredContent.status).toBe("ok");
    expect(youtubeService.getComments).toHaveBeenCalledWith(
      expect.objectContaining({ video: input })
    );
  });
});
