import { describe, it } from "vitest";

import { createServer } from "../../src/server/create-server.js";

describe("MCP prompts", () => {
  it.todo("registers analyze_video and extract_transcript_workflow prompts");
  it.todo("analyze_video callback returns a GetPromptResult with user role message containing the videoId");
  it.todo("analyze_video callback reflects focus argument in returned text");
  it.todo("extract_transcript_workflow callback returns a GetPromptResult with user role message containing the videoId");
});
