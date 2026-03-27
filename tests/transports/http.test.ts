import type { IncomingMessage, ServerResponse } from "node:http";

import http from "node:http";
import { describe, expect, it, vi, afterEach } from "vitest";

import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";
import {
  createStreamableHttpRuntime,
  startHttpServer,
  type StreamableHttpTransport
} from "../../src/transports/http.js";
import { createSuccessResult } from "../../src/contracts/tool-result.js";
import { SERVER_INFO } from "../../src/server/create-server.js";
import { createRateLimiter } from "../../src/transports/rate-limiter.js";

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

function httpGet(url: string): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers
        });
      });
    }).on("error", reject);
  });
}

function httpPost(url: string): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST" }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: res.headers
        });
      });
    });
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
  });
}

describe("HTTP server health check and rate limiting", () => {
  let serverHandle: Awaited<ReturnType<typeof startHttpServer>> | undefined;

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close();
      serverHandle = undefined;
    }
  });

  it("GET /health returns 200 with status ok and uptime number", async () => {
    serverHandle = await startHttpServer({
      host: "127.0.0.1",
      port: 0,
      logger: createLogger({ sink: () => {} })
    });
    const baseUrl = serverHandle.url.replace(/\/mcp$/, "");
    const res = await httpGet(`${baseUrl}/health`);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe("ok");
    expect(typeof parsed.uptime).toBe("number");
  });

  it("GET /health is not affected by rate limiting", async () => {
    const limiter = createRateLimiter({ maxRequests: 1 });
    serverHandle = await startHttpServer({
      host: "127.0.0.1",
      port: 0,
      rateLimiter: limiter,
      logger: createLogger({ sink: () => {} })
    });
    const baseUrl = serverHandle.url.replace(/\/mcp$/, "");

    // Exhaust rate limit with a request to /mcp
    await httpPost(serverHandle.url);

    // Health check should still work
    const healthRes = await httpGet(`${baseUrl}/health`);
    expect(healthRes.statusCode).toBe(200);
    expect(JSON.parse(healthRes.body).status).toBe("ok");
  });

  it("requests to /mcp after rate limit breach return 429 with retry-after header", async () => {
    const limiter = createRateLimiter({ maxRequests: 1 });
    serverHandle = await startHttpServer({
      host: "127.0.0.1",
      port: 0,
      rateLimiter: limiter,
      logger: createLogger({ sink: () => {} })
    });

    // First request consumes the limit
    await httpPost(serverHandle.url);

    // Second request should be rate limited
    const res = await httpPost(serverHandle.url);
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    const parsed = JSON.parse(res.body);
    expect(parsed.error.message).toBe("Rate limit exceeded.");
  });
});
