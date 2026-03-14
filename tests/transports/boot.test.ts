import { PassThrough } from "node:stream";

import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import * as rootExports from "../../src/index.js";
import { createSuccessResult } from "../../src/contracts/tool-result.js";
import { createServer, SERVER_INFO } from "../../src/server/create-server.js";
import {
  createStreamableHttpRuntime,
  type StreamableHttpTransport
} from "../../src/transports/http.js";
import { startStdioServer } from "../../src/transports/stdio.js";

type RegisteredTool = {
  handler: (args: Record<string, never>) => Promise<unknown>;
};

class FakeStreamableHttpTransport implements StreamableHttpTransport {
  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;

  constructor(
    private readonly options: {
      sessionIdGenerator: () => string;
      onsessioninitialized?: (sessionId: string) => void;
      onsessionclosed?: (sessionId?: string) => void;
    }
  ) {}

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.options.onsessionclosed?.(this.sessionId);
    this.onclose?.();
  }

  async send(): Promise<void> {}

  async handleRequest(
    _req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown
  ): Promise<void> {
    if (!this.sessionId && parsedBody === initializePayload) {
      this.sessionId = this.options.sessionIdGenerator();
      this.options.onsessioninitialized?.(this.sessionId);
      res.setHeader("mcp-session-id", this.sessionId);
    }

    res.end(JSON.stringify({ ok: true }));
  }
}

function createInitializeRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: {
        name: "vitest",
        version: "1.0.0"
      }
    }
  };
}

const initializePayload = createInitializeRequest();

function createMockRequest(): IncomingMessage {
  return {
    method: "POST",
    url: "/mcp",
    headers: {}
  } as IncomingMessage;
}

function createMockResponse(): ServerResponse {
  const headers: Record<string, string> = {};
  const response = {
    statusCode: 200,
    headersSent: false,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return response;
    },
    end() {
      response.headersSent = true;
      return response;
    }
  };

  return response as unknown as ServerResponse;
}

describe("root transport boot surface", () => {
  it("re-exports the explicit transport bootstraps", () => {
    expect(rootExports.startStdioServer).toBe(startStdioServer);
    expect(rootExports.startHttpServer).toBeDefined();
    expect(rootExports.createStreamableHttpRuntime).toBe(
      createStreamableHttpRuntime
    );
  });

  it("boots stdio and hosted HTTP from the same shared server factory contract", async () => {
    const createdServers: ReturnType<typeof createServer>[] = [];
    const serverFactory = vi.fn(() => {
      const server = createServer();
      createdServers.push(server);
      return server;
    });
    const stdioRuntime = await startStdioServer({
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      serverFactory
    });
    const httpRuntime = createStreamableHttpRuntime({
      serverFactory,
      sessionIdGenerator: () => "boot-session",
      transportFactory: options => new FakeStreamableHttpTransport(options)
    });

    const tool = (
      stdioRuntime.server as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.server_status;
    const stdioResult = await tool.handler({});

    await httpRuntime.handleRequest(
      createMockRequest(),
      createMockResponse(),
      initializePayload
    );
    const httpTool = (
      createdServers[1] as unknown as {
        _registeredTools: Record<string, RegisteredTool>;
      }
    )._registeredTools.server_status;
    const httpResult = await httpTool.handler({});

    expect(serverFactory).toHaveBeenCalledTimes(2);
    expect(stdioResult).toEqual(httpResult);
    expect(httpResult).toEqual(
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

    await httpRuntime.close();
    await stdioRuntime.close();
  });
});
