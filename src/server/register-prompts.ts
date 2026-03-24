import { z } from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "analyze_video",
    {
      title: "Analyze YouTube Video",
      description: "Generate a structured analysis of a YouTube video using its metadata and chapter markers.",
      argsSchema: {
        videoId: z.string().trim().min(1).max(500).describe("YouTube video URL or bare 11-character video ID"),
        focus: z.enum(["general", "technical", "sentiment", "summary"]).optional().describe("Analysis focus")
      }
    },
    (args) => {
      const focusLines: Record<string, string> = {
        technical: "4. Technical depth and complexity assessment",
        sentiment: "4. Tone, sentiment, and audience reception signals",
        summary: "Focus on producing a single comprehensive summary paragraph"
      };
      const extraInstruction = args.focus && args.focus !== "general"
        ? `\n${focusLines[args.focus] ?? ""}`
        : "";

      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Analyze the YouTube video with ID or URL: ${args.videoId}

Use the get_video_details tool to fetch the video metadata, then provide:
1. A 2-3 sentence summary of the video content based on the title, description, and chapter markers
2. Key topics covered (from keywords, chapters, and description)
3. Estimated target audience and content type (tutorial, review, entertainment, news, etc.)${extraInstruction}

Format your response as structured markdown with clear headings.`
          }
        }]
      };
    }
  );
}
