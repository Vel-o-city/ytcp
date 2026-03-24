import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { NotAvailableError } from "../lib/mcp-errors.js";
import type { YouTubeService } from "../youtube/contracts.js";
import { createYouTubeService } from "../youtube/service.js";
import {
  shapeChannelRecordData,
  shapeTranscriptRecordData,
  shapeVideoRecordData
} from "./register-tools.js";

export type RegisterResourceDependencies = {
  youtubeService?: Partial<
    Pick<YouTubeService, "getVideo" | "getTranscript" | "getChannel">
  >;
};

export function registerResources(
  server: McpServer,
  dependencies: RegisterResourceDependencies = {}
): void {
  const defaultYouTubeService =
    dependencies.youtubeService?.getVideo &&
    dependencies.youtubeService?.getTranscript &&
    dependencies.youtubeService?.getChannel
      ? undefined
      : createYouTubeService();
  const getVideo = dependencies.youtubeService?.getVideo ?? defaultYouTubeService?.getVideo;
  const getTranscript =
    dependencies.youtubeService?.getTranscript ?? defaultYouTubeService?.getTranscript;
  const getChannel =
    dependencies.youtubeService?.getChannel ?? defaultYouTubeService?.getChannel;

  server.registerResource(
    "youtube_video",
    new ResourceTemplate("youtube://video/{videoId}", { list: undefined }),
    {
      title: "YouTube Video",
      description: "Public YouTube video metadata",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      try {
        if (!getVideo) {
          throw new NotAvailableError(
            "Video detail lookups are not configured for this ytcp build.",
            { cause: "video_lookup_unconfigured" }
          );
        }

        const videoId = variables.videoId as string;
        const record = await getVideo(videoId);

        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(shapeVideoRecordData(record))
            }
          ]
        };
      } catch (error) {
        throw error;
      }
    }
  );

  server.registerResource(
    "youtube_transcript",
    new ResourceTemplate("youtube://transcript/{videoId}", { list: undefined }),
    {
      title: "YouTube Transcript",
      description: "Public YouTube video transcript",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      try {
        if (!getTranscript) {
          throw new NotAvailableError(
            "Transcript retrieval is not configured for this ytcp build.",
            { cause: "transcript_lookup_unconfigured" }
          );
        }

        const videoId = variables.videoId as string;
        const record = await getTranscript(videoId);

        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(shapeTranscriptRecordData(record))
            }
          ]
        };
      } catch (error) {
        throw error;
      }
    }
  );

  server.registerResource(
    "youtube_channel",
    new ResourceTemplate("youtube://channel/{channelId}", { list: undefined }),
    {
      title: "YouTube Channel",
      description: "Public YouTube channel metadata",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      try {
        if (!getChannel) {
          throw new NotAvailableError(
            "Channel lookups are not configured for this ytcp build.",
            { cause: "channel_lookup_unconfigured" }
          );
        }

        const channelId = variables.channelId as string;
        const record = await getChannel(channelId);

        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify(shapeChannelRecordData(record))
            }
          ]
        };
      } catch (error) {
        throw error;
      }
    }
  );
}
