import { describe, it } from "vitest";

import { createServer } from "../../src/server/create-server.js";

describe("youtube:// resources", () => {
  it.todo("registers youtube_video, youtube_transcript, and youtube_channel resource templates");
  it.todo("youtube_video readCallback invokes getVideo and returns TextResourceContents with application/json");
  it.todo("youtube_transcript readCallback invokes getTranscript and returns TextResourceContents with application/json");
  it.todo("youtube_channel readCallback invokes getChannel and returns TextResourceContents with application/json");
});
