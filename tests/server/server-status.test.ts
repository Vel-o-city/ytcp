import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../../src/lib/logger.js";
import { createSuccessResult } from "../../src/contracts/tool-result.js";
import { createServer, SERVER_INFO } from "../../src/server/create-server.js";

type RegisteredTool = {
  annotations?: Record<string, unknown>;
  description?: string;
  handler: (args: Record<string, never>) => Promise<unknown>;
};

describe("server_status tool", () => {
  it("registers a small read-only foundation tool with the shared contract", async () => {
    const server = createServer();
    const tool = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools.server_status;

    expect(tool).toBeDefined();
    expect(tool.description).toContain("ytcp foundation status");
    expect(tool.annotations).toEqual({ readOnlyHint: true });
    await expect(tool.handler({})).resolves.toEqual(
      createSuccessResult({
        summary:
          "ytcp is online with the shared foundation wired for stdio and hosted HTTP.",
        data: {
          server: SERVER_INFO.name,
          version: SERVER_INFO.version,
          transports: ["stdio", "http"],
          readiness: "foundation"
        }
      })
    );
  });
});

describe("createLogger", () => {
  it("writes diagnostics through a stderr-safe sink", () => {
    const sink = vi.fn();
    const logger = createLogger({
      sink,
      clock: () => new Date("2026-03-14T10:30:00.000Z")
    });

    logger.warn("transport fallback is active", { transport: "stdio" });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(
      "[2026-03-14T10:30:00.000Z] ytcp WARN transport fallback is active {\"transport\":\"stdio\"}"
    );
  });
});
