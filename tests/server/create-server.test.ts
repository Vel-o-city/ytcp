import { describe, expect, it } from "vitest";

import { createServer, SERVER_INFO } from "../../src/server/create-server.js";

describe("createServer", () => {
  it("creates the shared MCP server without transport branching", () => {
    const server = createServer();

    expect(server).toBeTruthy();
    expect(server).toBeTypeOf("object");
    expect(SERVER_INFO).toEqual({
      name: "ytcp",
      version: "0.1.0"
    });
  });
});
