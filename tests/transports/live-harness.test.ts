import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { HostedHttpServer } from "../../src/transports/http.js";
import type { StdioRuntime } from "../../src/transports/stdio.js";
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PATH,
  DEFAULT_HTTP_PORT,
  readLiveHttpConfig,
  runLiveHttpServer
} from "../../scripts/live/http.js";
import { runLiveStdioServer } from "../../scripts/live/stdio.js";

describe("live harness runners", () => {
  it("keeps both runner modules side-effect free on import", () => {
    expect(DEFAULT_HTTP_HOST).toBe("127.0.0.1");
    expect(DEFAULT_HTTP_PORT).toBe(3001);
    expect(DEFAULT_HTTP_PATH).toBe("/mcp");
  });

  it("runLiveStdioServer delegates to the shared stdio bootstrap and writes a stderr-safe banner", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const fakeRuntime = {
      server: { isConnected: () => true },
      transport: {},
      close
    } as unknown as StdioRuntime;
    const startServer = vi.fn().mockResolvedValue(fakeRuntime);
    const write = vi.fn();

    const runtime = await runLiveStdioServer({
      startServer,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      write
    });

    expect(runtime).toBe(fakeRuntime);
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(
      "[ytcp] stdio harness ready for Claude MCP connection"
    );

    await runtime.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("readLiveHttpConfig applies stable defaults and environment overrides", () => {
    expect(readLiveHttpConfig({})).toEqual({
      host: "127.0.0.1",
      port: 3001,
      path: "/mcp"
    });
    expect(
      readLiveHttpConfig({
        YTCP_HTTP_HOST: "0.0.0.0",
        YTCP_HTTP_PORT: "4010",
        YTCP_HTTP_PATH: "custom"
      })
    ).toEqual({
      host: "0.0.0.0",
      port: 4010,
      path: "/custom"
    });
  });

  it("runLiveHttpServer delegates to the shared HTTP bootstrap and reports the resolved URL", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const fakeHostedServer = {
      runtime: {} as HostedHttpServer["runtime"],
      server: {} as HostedHttpServer["server"],
      url: "http://127.0.0.1:3001/mcp",
      close
    } satisfies HostedHttpServer;
    const startServer = vi.fn().mockResolvedValue(fakeHostedServer);
    const write = vi.fn();

    const hostedServer = await runLiveHttpServer({
      startServer,
      write
    });

    expect(hostedServer).toBe(fakeHostedServer);
    expect(startServer).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 3001,
      path: "/mcp"
    });
    expect(write).toHaveBeenCalledWith(
      "[ytcp] HTTP harness ready at http://127.0.0.1:3001/mcp"
    );

    await hostedServer.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
