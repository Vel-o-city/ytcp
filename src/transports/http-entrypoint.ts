import process from "node:process";
import { startHttpServer } from "./http.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger({ name: "ytcp.http" });

const port = Number(process.env.PORT || process.env.YTCP_HTTP_PORT || "3001");
const host = process.env.YTCP_HTTP_HOST?.trim() || "0.0.0.0";
const path = process.env.YTCP_HTTP_PATH?.trim() || "/mcp";

const server = await startHttpServer({
  host,
  port,
  path: path.startsWith("/") ? path : `/${path}`,
  logger
});

logger.info(`YTCP HTTP server listening at ${server.url}`);

process.once("SIGINT", () => {
  void server.close().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void server.close().finally(() => process.exit(0));
});
