import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { createServer } from "../../src/server/create-server.js";
import { startStdioServer } from "../../src/transports/stdio.js";

describe("startStdioServer", () => {
  it("boots the shared server core over stdio without writing diagnostics to stdout", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const serverFactory = vi.fn(() => createServer());
    const onError = vi.fn();
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runtime = await startStdioServer({
      stdin,
      stdout,
      serverFactory,
      onError
    });

    expect(serverFactory).toHaveBeenCalledTimes(1);
    expect(runtime.server.isConnected()).toBe(true);
    expect(consoleLogSpy).not.toHaveBeenCalled();

    const transportError = new Error("stdin exploded");
    stdin.emit("error", transportError);

    expect(onError).toHaveBeenCalledWith(transportError);

    await runtime.close();

    expect(runtime.server.isConnected()).toBe(false);

    consoleLogSpy.mockRestore();
  });
});
