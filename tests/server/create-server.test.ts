import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { createServer, SERVER_INFO } from "../../src/server/create-server.js";

describe("createServer", () => {
  it("creates the shared MCP server without transport branching", () => {
    const server = createServer();

    expect(server).toBeInstanceOf(McpServer);
    expect(server).toBeTruthy();
    expect(server).toBeTypeOf("object");
    expect(server.isConnected()).toBe(false);
    expect((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).toEqual({});
    expect((server as unknown as { _registeredResources: Record<string, unknown> })._registeredResources).toEqual({});
    expect((server as unknown as { _registeredPrompts: Record<string, unknown> })._registeredPrompts).toEqual({});
    expect(SERVER_INFO).toEqual({
      name: "ytcp",
      version: "0.1.0"
    });
  });
});
