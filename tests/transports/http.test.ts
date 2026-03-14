import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";
import {
  createStreamableHttpRuntime,
  type StreamableHttpTransport
} from "../../src/transports/http.js";
import { createSuccessResult } from "../../src/contracts/tool-result.js";
import { SERVER_INFO } from "../../src/server/create-server.js";

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

function createToolCallRequest() {
  return {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "server_status",
      arguments: {}
    }
  };
}

type MockResponse = ServerResponse & {
  body?: string;
  headersSent: boolean;
  headers: Record<string, string>;
};

class FakeStreamableHttpTransport implements StreamableHttpTransport {
  sessionId?: string;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;
  readonly calls: Array<{
    req: IncomingMessage;
    parsedBody: unknown;
  }> = [];

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
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown
  ): Promise<void> {
    this.calls.push({ req, parsedBody });

    if (!this.sessionId && parsedBody === createInitializeRequestPayload) {
      this.sessionId = this.options.sessionIdGenerator();
      this.options.onsessioninitialized?.(this.sessionId);
      res.setHeader("mcp-session-id", this.sessionId);
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            serverInfo: {
              name: "ytcp"
            }
          }
        })
      );
      return;
    }

    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { ok: true }
      })
    );
  }
}

const createInitializeRequestPayload = createInitializeRequest();

function createMockRequest(
  method: string,
  headers: Record<string, string> = {}
): IncomingMessage {
  return {
    method,
    url: "/mcp",
    headers
  } as IncomingMessage;
}

function createMockResponse(): MockResponse {
  const headers: Record<string, string> = {};

  return {
    statusCode: 200,
    headersSent: false,
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    end(chunk?: string) {
      this.body = chunk;
      this.headersSent = true;
      return this;
    }
  } as MockResponse;
}

describe("hosted HTTP runtime", () => {
  it("creates one hosted session and reuses the shared server core for later requests", async () => {
    const createdServers: ReturnType<typeof createServer>[] = [];
    const createdTransports: FakeStreamableHttpTransport[] = [];
    const serverFactory = vi.fn(() => {
      const server = createServer();
      createdServers.push(server);
      return server;
    });
    const runtime = createStreamableHttpRuntime({
      serverFactory,
      sessionIdGenerator: () => "session-1",
      transportFactory: options => {
        const transport = new FakeStreamableHttpTransport(options);
        createdTransports.push(transport);
        return transport;
      }
    });
    const initResponse = createMockResponse();

    await runtime.handleRequest(
      createMockRequest("POST"),
      initResponse,
      createInitializeRequestPayload
    );

    expect(initResponse.statusCode).toBe(200);
    expect(JSON.parse(initResponse.body ?? "{}").result.serverInfo.name).toBe(
      "ytcp"
    );
    expect(initResponse.headers["mcp-session-id"]).toBe("session-1");
    expect(runtime.listSessionIds()).toEqual(["session-1"]);
    expect(serverFactory).toHaveBeenCalledTimes(1);

    const toolResponse = createMockResponse();
    await runtime.handleRequest(
      createMockRequest("POST", {
        "mcp-session-id": "session-1",
        "mcp-protocol-version": "2025-03-26"
      }),
      toolResponse,
      createToolCallRequest()
    );

    expect(toolResponse.statusCode).toBe(200);
    expect(createdTransports).toHaveLength(1);
    expect(createdTransports[0].calls).toHaveLength(2);
    expect(serverFactory).toHaveBeenCalledTimes(1);
    await expect(
      (
        createdServers[0] as unknown as {
          _registeredTools: {
            server_status: { handler: (args: Record<string, never>) => Promise<unknown> };
          };
        }
      )._registeredTools.server_status.handler({})
    ).resolves.toEqual(
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
    await runtime.close();
    expect(runtime.listSessionIds()).toEqual([]);
  });

  it("supports an origin validation hook before a session is created", async () => {
    const serverFactory = vi.fn(() => createServer());
    const runtime = createStreamableHttpRuntime({
      serverFactory,
      logger: createLogger({ sink: () => {} }),
      validateOrigin: origin => origin === "https://allowed.example",
      transportFactory: options => new FakeStreamableHttpTransport(options)
    });
    const response = createMockResponse();

    await runtime.handleRequest(
      createMockRequest("POST", {
        origin: "https://blocked.example"
      }),
      response,
      createInitializeRequestPayload
    );

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body ?? "{}").error.message).toBe(
      "Origin is not allowed."
    );
    expect(serverFactory).not.toHaveBeenCalled();
    expect(runtime.listSessionIds()).toEqual([]);
  });

  it("exposes a stable runtime surface without creating sessions until initialize", () => {
    const runtime = createStreamableHttpRuntime({
      serverFactory: () => createServer()
    });

    expect(runtime.listSessionIds()).toEqual([]);
    expect(runtime.hasSession("missing-session")).toBe(false);
  });
});
