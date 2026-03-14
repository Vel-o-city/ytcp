export type ToolFailureCode =
  | "invalid_input"
  | "upstream_unavailable"
  | "not_available";

type ToolFailureOptions = {
  details?: Record<string, unknown>;
  suggestion?: string;
  cause?: string;
  retryable?: boolean;
};

export abstract class ToolFailure extends Error {
  readonly code: ToolFailureCode;
  readonly details?: Record<string, unknown>;
  readonly suggestion?: string;
  readonly causeDetail?: string;
  readonly retryable?: boolean;

  protected constructor(
    code: ToolFailureCode,
    message: string,
    options: ToolFailureOptions = {}
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = options.details;
    this.suggestion = options.suggestion;
    this.causeDetail = options.cause;
    this.retryable = options.retryable;
  }
}

export class InvalidInputError extends ToolFailure {
  constructor(message: string, options: ToolFailureOptions = {}) {
    super("invalid_input", message, options);
  }
}

export class UpstreamUnavailableError extends ToolFailure {
  constructor(message: string, options: ToolFailureOptions = {}) {
    super("upstream_unavailable", message, {
      retryable: true,
      ...options
    });
  }
}

export class NotAvailableError extends ToolFailure {
  constructor(message: string, options: ToolFailureOptions = {}) {
    super("not_available", message, {
      retryable: false,
      ...options
    });
  }
}

export function isToolFailure(error: unknown): error is ToolFailure {
  return error instanceof ToolFailure;
}
