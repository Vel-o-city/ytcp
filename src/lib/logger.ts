type LogLevel = "debug" | "info" | "warn" | "error";

type LoggerSink = (message: string) => void;

export type Logger = {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

type CreateLoggerOptions = {
  name?: string;
  sink?: LoggerSink;
  clock?: () => Date;
};

const defaultSink: LoggerSink = message => {
  console.error(message);
};

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const name = options.name ?? "ytcp";
  const sink = options.sink ?? defaultSink;
  const clock = options.clock ?? (() => new Date());

  const write = (
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void => {
    const suffix =
      context && Object.keys(context).length > 0
        ? ` ${JSON.stringify(context)}`
        : "";

    sink(
      `[${clock().toISOString()}] ${name} ${level.toUpperCase()} ${message}${suffix}`
    );
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context)
  };
}
