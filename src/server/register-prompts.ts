import { z } from "zod";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "extract_transcript_workflow",
    {
      title: "Extract Transcript Workflow",
      description: "Build a step-by-step workflow or key-point summary from a YouTube video transcript.",
      argsSchema: {
        videoId: z.string().trim().min(1).max(500).describe("YouTube video URL or bare 11-character video ID"),
        outputFormat: z.enum(["steps", "bullets", "summary"]).optional().describe("Output format: steps (numbered workflow), bullets (key points), or summary (paragraph)")
      }
    },
    (args) => {
      const formatInstructions: Record<string, string> = {
        steps: "Format the output as a numbered step-by-step workflow that someone could follow.",
        bullets: "Format the output as a bulleted list of key points and insights.",
        summary: "Format the output as a coherent paragraph summary of the main ideas."
      };
      const formatInstruction = formatInstructions[args.outputFormat ?? "steps"] ?? formatInstructions["steps"];

      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Extract an actionable workflow from the YouTube video at: ${args.videoId}

Use the get_transcript tool to fetch the full transcript, then analyze it to produce:
1. The main topic or goal the video addresses
2. The key steps, methods, or insights presented in order
3. Any tools, resources, or prerequisites mentioned

${formatInstruction}

If the transcript is unavailable, use get_video_details to extract as much structure as possible from the title, description, and chapter markers instead.`
          }
        }]
      };
    }
  );

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
