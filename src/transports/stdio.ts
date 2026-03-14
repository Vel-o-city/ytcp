import process from "node:process";
import type { Readable, Writable } from "node:stream";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createLogger, type Logger } from "../lib/logger.js";
import { createServer } from "../server/create-server.js";

export type ServerFactory = () => McpServer;

export type StdioRuntimeOptions = {
  serverFactory?: ServerFactory;
  stdin?: Readable;
  stdout?: Writable;
  logger?: Logger;
  onError?: (error: Error) => void;
};

export type StdioRuntime = {
  server: McpServer;
  transport: StdioServerTransport;
  close: () => Promise<void>;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startStdioServer(
  options: StdioRuntimeOptions = {}
): Promise<StdioRuntime> {
  const server = (options.serverFactory ?? createServer)();
  const logger = options.logger ?? createLogger({ name: "ytcp" });
  const transport = new StdioServerTransport(
    options.stdin ?? (process.stdin as Readable),
    options.stdout ?? (process.stdout as Writable)
  );

  transport.onerror =
    options.onError ??
    (error => {
      logger.error("stdio transport error", {
        error: getErrorMessage(error)
      });
    });

  await server.connect(transport);

  return {
    server,
    transport,
    close: async () => {
      await server.close();
    }
  };
}
