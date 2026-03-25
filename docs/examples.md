# Example Workflows

Real things you can do with ytcp once it's connected to Claude.

---

## Research a topic

**Prompt:**
> Find me the top videos on "systems design interview" from the last year, sorted by view count. Give me a ranked list with view counts.

Claude will call `search_videos` with `uploadDate: year`, `sortBy: view_count`, and return a structured list you can browse and act on immediately.

---

## Extract a tutorial as a checklist

**Prompt:**
> Take this video and extract every step as a numbered checklist I can follow:
> https://youtube.com/watch?v=...

Claude fetches the transcript with `get_transcript`, reads through the spoken content, and produces a clean step-by-step guide — no manual watching required.

---

## Understand what a long video covers before watching

**Prompt:**
> This is a 3-hour conference talk. Give me a summary of each section with timestamps so I know which parts to watch:
> https://youtube.com/watch?v=...

Claude pulls the transcript and chapter data from `get_video_details` and `get_transcript` and builds a navigable outline.

---

## Gauge audience reaction to a video

**Prompt:**
> What are the top comments on this video? What are people praising and what are they criticizing?
> https://youtube.com/watch?v=...

Claude calls `get_comments` sorted by `top_comments`, then synthesizes sentiment and themes across the threads.

---

## Compare multiple videos on the same topic

**Prompt:**
> I found three videos on Rust lifetimes. For each one, fetch the transcript and tell me which one explains borrowing most clearly:
> - https://youtube.com/watch?v=...
> - https://youtube.com/watch?v=...
> - https://youtube.com/watch?v=...

Claude calls `get_transcript` for each, reads through the explanations, and gives you a comparative recommendation.

---

## Build study notes from a lecture series

**Prompt:**
> This playlist is a full university course on compilers. Fetch the details for all videos, then for each one pull the transcript and generate bullet-point notes:
> https://youtube.com/playlist?list=...

Claude pages through the playlist with `get_playlist`, then calls `get_transcript` per video and structures the notes by lecture.

---

## Research a creator before an interview or collaboration

**Prompt:**
> I'm meeting with this creator next week. Summarize their channel and last 10 videos so I know what they focus on:
> @channelhandle

Claude calls `get_channel` for the overview, then fetches details on their recent uploads.

---

## Pull quotes from an interview

**Prompt:**
> Find any moments in this podcast transcript where the guest talks about pricing strategy. Quote the exact lines with timestamps:
> https://youtube.com/watch?v=...

Claude fetches the full timestamped transcript and searches it for relevant sections.

---

## Find videos that actually cover a specific subtopic

**Prompt:**
> Search for videos on "PostgreSQL performance" but I only care about ones that specifically cover indexing strategies — filter out the generic ones.

Claude searches with `search_videos`, then fetches transcripts or descriptions to verify which results actually match before presenting them.

---

## Translate a workflow from a foreign-language video

**Prompt:**
> This tutorial is in Spanish. Fetch the transcript in Spanish and translate the key steps to English:
> https://youtube.com/watch?v=...

`get_transcript` supports language selection. Claude fetches the Spanish transcript and translates inline.

---

## Tips

- **Just paste a URL** — Claude will figure out what to do with it.
- **Ask naturally** — you don't need to know tool names.
- **Chain requests** — "now get the comments on the first result" works after a search.
- **Transcripts are the superpower** — the most useful workflows start with a full transcript.
