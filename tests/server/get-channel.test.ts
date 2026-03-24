import { describe, it } from "vitest";

describe("get_channel tool", () => {
  it.todo("registers a read-only channel tool with readOnlyHint: true");

  it.todo("returns compact channel metadata for a handle URL request");

  it.todo("summary string contains 'Loaded public channel'");

  it.todo("shaped data includes id, canonicalUrl, title, subscriberCountText, thumbnails, and recentVideos");

  it.todo("description is truncated to MAX_CHANNEL_DESCRIPTION_LENGTH");

  it.todo("source field is omitted from shaped output");

  it.todo("recentVideos items include durationText but not durationSeconds");

  it.todo("returns actionable invalid-input errors for empty channel input");

  it.todo("surfaces NotAvailableError cleanly for unavailable channels");

  it.todo("get_channel is reachable through the shared server factory (transport parity)");
});
