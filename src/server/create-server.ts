import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { YouTubeService } from "../youtube/contracts.js";
import { registerPrompts } from "./register-prompts.js";
import { registerResources } from "./register-resources.js";
import { registerTools } from "./register-tools.js";

export const SERVER_INFO = {
  name: "ytcp",
  version: "0.1.0"
} as const;

export type CreateServerOptions = {
  youtubeService?: Partial<Pick<YouTubeService, "getVideo" | "searchVideos">>;
};

export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO);

  registerTools(server, {
    youtubeService: options.youtubeService
  });
  registerResources(server);
  registerPrompts(server);

  return server;
}
