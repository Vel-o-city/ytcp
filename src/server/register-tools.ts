import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  createResultFromError,
  createSuccessResult
} from "../contracts/tool-result.js";
import { NotAvailableError } from "../lib/mcp-errors.js";
import { SERVER_INFO } from "./create-server.js";

export function registerTools(_server: McpServer): void {
  _server.registerTool(
    "server_status",
    {
      description:
        "Report the current ytcp foundation status and the transport surface available in this build.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true
      }
    },
    async () => {
      const transports = ["stdio", "http"];

      if (transports.length === 0) {
        return createResultFromError(
          new NotAvailableError("No MCP transports are configured for this build.", {
            cause: "runtime_unconfigured",
            details: { server: SERVER_INFO.name }
          })
        );
      }

      return createSuccessResult({
        summary: "ytcp is online with the shared foundation wired for stdio and hosted HTTP.",
        data: {
          server: SERVER_INFO.name,
          version: SERVER_INFO.version,
          transports,
          readiness: "foundation"
        }
      });
    }
  );
}
