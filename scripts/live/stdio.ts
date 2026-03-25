import process from "node:process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

import {
  startStdioServer,
  type StdioRuntime,
  type StdioRuntimeOptions
} from "../../src/transports/stdio.js";

export type LiveStdioWriter = (message: string) => void;

export type LiveStdioOptions = Pick<
  StdioRuntimeOptions,
  "serverFactory" | "stdin" | "stdout" | "logger" | "onError"
> & {
  startServer?: (options?: StdioRuntimeOptions) => Promise<StdioRuntime>;
  write?: LiveStdioWriter;
};

export function isDirectExecution(metaUrl: string, argv1: string | undefined): boolean {
  return typeof argv1 === "string" && metaUrl === pathToFileURL(argv1).href;
}

export function createLiveStdioBanner(): string {
  return "[ytcp] stdio harness ready for Claude MCP connection";
}

function writeToStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function runLiveStdioServer(
  options: LiveStdioOptions = {}
): Promise<StdioRuntime> {
  const runtime = await (options.startServer ?? startStdioServer)({
    serverFactory: options.serverFactory,
    stdin: options.stdin,
    stdout: options.stdout,
    logger: options.logger,
    onError: options.onError
  });

  (options.write ?? writeToStderr)(createLiveStdioBanner());

  const closeRuntime = async () => {
    await runtime.close();
  };

  process.once("SIGINT", () => {
    void closeRuntime().finally(() => {
      process.exit(0);
    });
  });

  process.once("SIGTERM", () => {
    void closeRuntime().finally(() => {
      process.exit(0);
    });
  });

  return runtime;
}

export async function main(): Promise<void> {
  const runtime = await runLiveStdioServer();

  try {
    await Promise.race([
      once(process.stdin, "end"),
      once(process.stdin, "close")
    ]);
  } finally {
    await runtime.close();
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  void main().catch(error => {
    writeToStderr(
      error instanceof Error
        ? `[ytcp] stdio harness failed: ${error.message}`
        : `[ytcp] stdio harness failed: ${String(error)}`
    );
    process.exit(1);
  });
}
