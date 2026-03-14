import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { isToolFailure, type ToolFailure } from "../lib/mcp-errors.js";

type StructuredData = Record<string, unknown>;

type SuccessOptions = {
  summary: string;
  data?: StructuredData;
};

type NotAvailableOptions = {
  summary: string;
  reason: string;
  data?: StructuredData;
};

export function createSuccessResult({
  summary,
  data
}: SuccessOptions): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: {
      status: "ok",
      ...(data ? { data } : {})
    }
  };
}

export function createNotAvailableResult({
  summary,
  reason,
  data
}: NotAvailableOptions): CallToolResult {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: {
      status: "not_available",
      reason,
      ...(data ? { data } : {})
    }
  };
}

export function createFailureResult(error: ToolFailure): CallToolResult {
  return {
    content: [{ type: "text", text: error.message }],
    isError: true,
    structuredContent: {
      status: "error",
      error: {
        code: error.code,
        message: error.message,
        ...(typeof error.retryable === "boolean"
          ? { retryable: error.retryable }
          : {}),
        ...(error.suggestion ? { suggestion: error.suggestion } : {}),
        ...(error.causeDetail ? { cause: error.causeDetail } : {}),
        ...(error.details ? { details: error.details } : {})
      }
    }
  };
}

export function createResultFromError(error: unknown): CallToolResult {
  if (isToolFailure(error)) {
    if (error.code === "not_available") {
      return createNotAvailableResult({
        summary: error.message,
        reason: error.causeDetail ?? "not_available",
        data: error.details
      });
    }

    return createFailureResult(error);
  }

  const message = error instanceof Error ? error.message : String(error);

  return {
    content: [{ type: "text", text: message }],
    isError: true,
    structuredContent: {
      status: "error",
      error: {
        code: "internal_error",
        message
      }
    }
  };
}
