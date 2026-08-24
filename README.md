# Recap Backend

Backend pipeline for Coco.EXE Recap Studio. Takes an uploaded video,
transcribes it, writes a Burmese recap narration script, generates
voiceover audio via TTS Pro, and merges it back onto the video.

## Pipeline

1. `POST /api/process` — upload video (multipart, field name `video`),
   plus `voice` and `tone` fields. Returns `{ jobId }` immediately.
2. Backend runs in the background:
   - Extract audio (ffmpeg)
   - Transcribe (OpenAI Whisper)
   - Write Burmese script (GPT-4o-mini)
   - Generate narration audio (TTS Pro — Myatko's existing Gemini TTS service)
   - Merge narration onto the video (ffmpeg)
3. `GET /api/process/:id` — poll for status
   (`queued → transcribing → writing_script → narrating → rendering → done`)
4. `GET /api/process/:id/result` — download the finished `recap.mp4`
   once status is `done`

## Link import (TikTok / RedNote)

- `POST /api/link/preview` — `{ url }`, returns title/duration/thumbnail
  only. No credit charged, no download yet — use this to show a preview
  card before the user confirms.
- `POST /api/link` — `{ url, voice, tone }`, same response/polling shape
  as `POST /api/process` (`jobId` → poll `GET /api/link/:id` → download
  from `GET /api/link/:id/result`). Adds one `downloading` step before
  the existing transcribe → script → narrate → render pipeline.

Uses the `yt-dlp-exec` npm package, which downloads the `yt-dlp` binary
itself via its own postinstall step — no separate Python/pip install
needed on Render, `npm install` is enough.

RedNote's extractor breaks more often than TikTok's since RedNote
actively pushes back on scraping — keep `yt-dlp-exec` updated
(`npm update yt-dlp-exec`) if RedNote links start failing.

YouTube reliably blocks unauthenticated server requests with "Sign in to
confirm you're not a bot" — this isn't intermittent like TikTok/RedNote,
so retries won't fix it. To support YouTube links, set `YOUTUBE_COOKIES_B64`
(see `.env.example`) to a base64-encoded `cookies.txt` exported from a
logged-in browser session. Cookies expire periodically and will need
re-exporting when YouTube starts rejecting them again.

## Environment variables

Copy `.env.example` to `.env` and fill in:

- `OPENAI_API_KEY` — used for Whisper + GPT-4o-mini
- `TTS_PRO_URL` — defaults to the deployed TTS Pro `/api/generate-tts` endpoint
- `ALLOWED_ORIGINS` — comma-separated list, include your Vercel frontend URL

## Local dev

```bash
npm install
cp .env.example .env   # then fill in OPENAI_API_KEY
npm run dev
```

## Deploying to Render

1. New Web Service → connect this repo
2. Build command: `npm install`
3. Start command: `npm start`
4. Add the environment variables above in Render's dashboard
5. Note the Render URL and set it as `VITE_RECAP_BACKEND_URL` (or similar)
   in the frontend so it knows where to POST uploads

## Known limitations (MVP)

- Job state is in-memory — fine for a single Render instance, won't
  survive a restart or work across multiple instances.
- No auth on the upload endpoint yet — fine while private/testing,
  add a shared secret header before sharing publicly.
- Whisper + GPT-4o-mini calls use the same `OPENAI_API_KEY` that hit a
  billing/quota error in a previous session — double check billing is
  active on platform.openai.com before testing end-to-end.
