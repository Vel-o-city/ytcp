import { describe, it } from "vitest";

import { createServer } from "../../src/server/create-server.js";

type RegisteredTool = {
  annotations?: Record<string, unknown>;
  description?: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unusedImports: [typeof createServer, RegisteredTool | undefined] = [createServer, undefined];

describe("get_comments tool", () => {
  it.todo("registers get_comments with readOnlyHint: true");
  it.todo("returns comment threads for a video (top_comments sort)");
  it.todo("returns comment threads for a video (new_comments sort)");
  it.todo("passes pageToken to getComments service");
  it.todo("rejects input with neither video nor pageToken");
  it.todo("rejects input with both video and pageToken");
  it.todo("rejects pageToken combined with sortBy");
  it.todo("maps comments_disabled NotAvailableError to failure result");
  it.todo("get_comments is reachable through the shared server factory (transport parity)");
  it.todo("resolves multiple video URL input forms");
});
