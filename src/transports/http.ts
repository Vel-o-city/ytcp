import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse
} from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createLogger, type Logger } from "../lib/logger.js";
import { createServer } from "../server/create-server.js";
import type { ServerFactory } from "./stdio.js";
import { createRateLimiter, type RateLimiter } from "./rate-limiter.js";

type HttpSession = {
  server: McpServer;
  transport: StreamableHttpTransport;
};

type TransportFactoryOptions = {
  sessionIdGenerator: () => string;
  enableJsonResponse: boolean;
  onsessioninitialized?: (sessionId: string) => void;
  onsessionclosed?: (sessionId?: string) => void;
};

export type StreamableHttpTransport = Transport & {
  handleRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown
  ) => Promise<void>;
};

export type StreamableHttpRuntimeOptions = {
  serverFactory?: ServerFactory;
  logger?: Logger;
  validateOrigin?: (origin: string | undefined) => boolean;
  sessionIdGenerator?: () => string;
  enableJsonResponse?: boolean;
  transportFactory?: (options: TransportFactoryOptions) => StreamableHttpTransport;
};

export type StreamableHttpRuntime = {
  handleRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown
  ) => Promise<void>;
  close: () => Promise<void>;
  listSessionIds: () => string[];
  hasSession: (sessionId: string) => boolean;
};

export type StartHttpServerOptions = StreamableHttpRuntimeOptions & {
  host?: string;
  port?: number;
  path?: string;
  rateLimiter?: RateLimiter;
};

export type HostedHttpServer = {
  runtime: StreamableHttpRuntime;
  server: NodeHttpServer;
  url: string;
  close: () => Promise<void>;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readHeader(
  req: IncomingMessage,
  headerName: string
): string | undefined {
  const value = req.headers[headerName.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function getRequestPath(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function writeJsonRpcError(
  res: ServerResponse,
  statusCode: number,
  code: number,
  message: string
): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code,
        message
      },
      id: null
    })
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");

  if (body.length === 0) {
    throw new Error("Request body was empty.");
  }

  return JSON.parse(body);
}

function isInitializePayload(payload: unknown): boolean {
  if (Array.isArray(payload)) {
    return payload.some(message => isInitializeRequest(message));
  }

  return isInitializeRequest(payload);
}

function createHttpSessionRuntime(
  options: StreamableHttpRuntimeOptions = {}
): StreamableHttpRuntime {
  const serverFactory = options.serverFactory ?? createServer;
  const logger = options.logger ?? createLogger({ name: "ytcp" });
  const sessions = new Map<string, HttpSession>();
  const transportFactory =
    options.transportFactory ??
    ((transportOptions: TransportFactoryOptions): StreamableHttpTransport =>
      new StreamableHTTPServerTransport(transportOptions));

  const createSession = async (): Promise<HttpSession> => {
    const server = serverFactory();
    const transport = transportFactory({
      sessionIdGenerator: options.sessionIdGenerator ?? randomUUID,
      enableJsonResponse: options.enableJsonResponse ?? true,
      onsessioninitialized: sessionId => {
        sessions.set(sessionId, { server, transport });
      },
      onsessionclosed: sessionId => {
        if (sessionId) {
          sessions.delete(sessionId);
        }
      }
    });

    transport.onerror = error => {
      logger.error("hosted HTTP transport error", {
        error: getErrorMessage(error)
      });
    };

    await server.connect(transport);

    return { server, transport };
  };

  return {
    handleRequest: async (req, res, parsedBody) => {
      const origin = readHeader(req, "origin");

      if (options.validateOrigin && !options.validateOrigin(origin)) {
        logger.warn("blocked hosted HTTP request from disallowed origin", {
          origin: origin ?? "unknown"
        });
        writeJsonRpcError(res, 403, -32000, "Origin is not allowed.");
        return;
      }

      const sessionId = readHeader(req, "mcp-session-id");

      if (sessionId) {
        const session = sessions.get(sessionId);

        if (!session) {
          writeJsonRpcError(res, 404, -32001, "Session not found.");
          return;
        }

        await session.transport.handleRequest(req, res, parsedBody);
        return;
      }

      if (req.method !== "POST") {
        writeJsonRpcError(
          res,
          400,
          -32000,
          "Initialize the hosted transport with a POST request first."
        );
        return;
      }

      let payload = parsedBody;

      if (typeof payload === "undefined") {
        try {
          payload = await readJsonBody(req);
        } catch (error) {
          logger.warn("failed to parse hosted HTTP request body", {
            error: getErrorMessage(error)
          });
          writeJsonRpcError(res, 400, -32700, "Parse error: Invalid JSON");
          return;
        }
      }

      if (!isInitializePayload(payload)) {
        writeJsonRpcError(
          res,
          400,
          -32600,
          "Initialize the hosted transport before sending other requests."
        );
        return;
      }

      const session = await createSession();

      await session.transport.handleRequest(req, res, payload);
    },
    close: async () => {
      const activeSessions = [...sessions.values()];
      sessions.clear();

      await Promise.all(
        activeSessions.map(async ({ server }) => {
          await server.close();
        })
      );
    },
    listSessionIds: () => [...sessions.keys()],
    hasSession: sessionId => sessions.has(sessionId)
  };
}

export function createStreamableHttpRuntime(
  options: StreamableHttpRuntimeOptions = {}
): StreamableHttpRuntime {
  return createHttpSessionRuntime(options);
}

function closeNodeServer(server: NodeHttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function startHttpServer(
  options: StartHttpServerOptions = {}
): Promise<HostedHttpServer> {
  const runtime = createStreamableHttpRuntime(options);
  const logger = options.logger ?? createLogger({ name: "ytcp" });
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const path = options.path ?? "/mcp";
  const startTime = Date.now();
  const rateLimiter = options.rateLimiter ?? createRateLimiter();
  const server = createNodeHttpServer((req, res) => {
    // Health check -- responds before MCP processing and is not rate limited
    if (req.method === "GET" && getRequestPath(req) === "/health") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        status: "ok",
        uptime: Math.floor((Date.now() - startTime) / 1000)
      }));
      return;
    }

    // Rate limiting -- HTTP transport only, skip /health
    const clientIp = readHeader(req, "fly-client-ip")
      ?? readHeader(req, "x-forwarded-for")?.split(",")[0]?.trim()
      ?? req.socket.remoteAddress
      ?? "unknown";
    const rateResult = rateLimiter.check(clientIp);
    if (!rateResult.allowed) {
      res.statusCode = 429;
      res.setHeader("retry-after", String(rateResult.retryAfterSeconds));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Rate limit exceeded." },
        id: null
      }));
      return;
    }

    if (getRequestPath(req) !== path) {
      writeJsonRpcError(res, 404, -32004, "Endpoint not found.");
      return;
    }

    runtime.handleRequest(req, res).catch(error => {
      logger.error("hosted HTTP request failed", {
        error: getErrorMessage(error)
      });

      if (!res.headersSent) {
        writeJsonRpcError(res, 500, -32603, "Internal server error.");
        return;
      }

      res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Hosted HTTP server did not expose an address.");
  }

  return {
    runtime,
    server,
    url: `http://${host}:${(address as AddressInfo).port}${path}`,
    close: async () => {
      await runtime.close();
      await closeNodeServer(server);
    }
  };
}
