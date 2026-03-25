import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  startHttpServer,
  type HostedHttpServer,
  type StartHttpServerOptions
} from "../../src/transports/http.js";

export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 3001;
export const DEFAULT_HTTP_PATH = "/mcp";

export type LiveHttpWriter = (message: string) => void;

export type LiveHttpOptions = {
  env?: NodeJS.ProcessEnv;
  startServer?: (options?: StartHttpServerOptions) => Promise<HostedHttpServer>;
  write?: LiveHttpWriter;
};

export type LiveHttpConfig = {
  host: string;
  port: number;
  path: string;
};

export function isDirectExecution(metaUrl: string, argv1: string | undefined): boolean {
  return typeof argv1 === "string" && metaUrl === pathToFileURL(argv1).href;
}

export function normalizeHttpPath(pathValue: string | undefined): string {
  if (!pathValue || pathValue.trim().length === 0) {
    return DEFAULT_HTTP_PATH;
  }

  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}

export function parseHttpPort(value: string | undefined): number {
  if (!value || value.trim().length === 0) {
    return DEFAULT_HTTP_PORT;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid YTCP_HTTP_PORT value: ${value}`);
  }

  return port;
}

export function readLiveHttpConfig(
  env: NodeJS.ProcessEnv = process.env
): LiveHttpConfig {
  return {
    host: env.YTCP_HTTP_HOST?.trim() || DEFAULT_HTTP_HOST,
    port: parseHttpPort(env.YTCP_HTTP_PORT),
    path: normalizeHttpPath(env.YTCP_HTTP_PATH)
  };
}

function writeToStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function runLiveHttpServer(
  options: LiveHttpOptions = {}
): Promise<HostedHttpServer> {
  const config = readLiveHttpConfig(options.env);
  const hostedServer = await (options.startServer ?? startHttpServer)(config);

  (options.write ?? writeToStderr)(
    `[ytcp] HTTP harness ready at ${hostedServer.url}`
  );

  const closeServer = async () => {
    await hostedServer.close();
  };

  process.once("SIGINT", () => {
    void closeServer().finally(() => {
      process.exit(0);
    });
  });

  process.once("SIGTERM", () => {
    void closeServer().finally(() => {
      process.exit(0);
    });
  });

  return hostedServer;
}

export async function main(): Promise<void> {
  await runLiveHttpServer();
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void main().catch(error => {
    writeToStderr(
      error instanceof Error
        ? `[ytcp] HTTP harness failed: ${error.message}`
        : `[ytcp] HTTP harness failed: ${String(error)}`
    );
    process.exit(1);
  });
}
