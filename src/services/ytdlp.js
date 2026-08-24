const fs = require("fs");
const os = require("os");
const path = require("path");
const ytdlp = require("yt-dlp-exec");

const MAX_DURATION_SECONDS = parseInt(process.env.MAX_VIDEO_DURATION || "7200", 10); // 2 hours default
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Optional: YouTube (and some other sites) block server-side requests with
// "Sign in to confirm you're not a bot" unless yt-dlp presents cookies from
// a real logged-in browser session. If YOUTUBE_COOKIES_B64 is set (base64 of
// a cookies.txt exported via a browser extension like "Get cookies.txt"),
// write it out once at startup and pass it to every yt-dlp call. If unset,
// yt-dlp just runs without cookies — TikTok/RedNote don't need this, only
// YouTube reliably does.
let cookiesFilePath = null;
if (process.env.YOUTUBE_COOKIES_B64) {
  try {
    cookiesFilePath = path.join(os.tmpdir(), "yt-cookies.txt");
    fs.writeFileSync(cookiesFilePath, Buffer.from(process.env.YOUTUBE_COOKIES_B64, "base64"));
    console.log("[ytdlp] Loaded cookies from YOUTUBE_COOKIES_B64");
  } catch (err) {
    console.warn(`[ytdlp] Failed to write cookies file: ${err.message}`);
    cookiesFilePath = null;
  }
}

function withCookies(opts) {
  return cookiesFilePath ? { ...opts, cookies: cookiesFilePath } : opts;
}

// TikTok/RedNote extraction fails intermittently (anti-bot measures kick in
// on a fraction of requests) even when the link and yt-dlp version are both
// fine. Retrying the same request a couple of times resolves most of these
// without needing any code change on our side. YouTube's bot-check is a
// different, persistent kind of failure that retries won't fix — only
// cookies (above) resolve that one.
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`[ytdlp] ${label} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message.slice(0, 200)}`);
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

/**
 * Metadata only, no download — lets the frontend show a preview card
 * (title/thumbnail/duration) before a credit gets charged.
 */
async function probeVideo(url) {
  const info = await withRetry(
    () =>
      ytdlp(
        url,
        withCookies({
          dumpSingleJson: true,
          noWarnings: true,
          skipDownload: true,
          noPlaylist: true,
        })
      ),
    "probe"
  );

  return {
    title: info.title,
    duration: info.duration, // seconds
    thumbnail: info.thumbnail,
    uploader: info.uploader,
    platform: info.extractor_key, // "TikTok", "Xiaohongshu", "Youtube", etc.
  };
}

/**
 * Downloads the source video from a TikTok/RedNote/YouTube/etc link to
 * videoOutPath. Enforces the same duration cap as direct uploads. Pass a
 * previously fetched `knownInfo` (e.g. from the /preview step) to skip the
 * extra probe call and its own chance of hitting the intermittent extractor
 * error.
 */
async function downloadVideo(url, videoOutPath, knownInfo = null) {
  const info = knownInfo || (await probeVideo(url));

  if (info.duration && info.duration > MAX_DURATION_SECONDS) {
    throw new Error(`Video ရှည်လွန်းပါတယ် (${info.duration}s). ${MAX_DURATION_SECONDS}s ထက်မကျော်ရပါ။`);
  }

  await withRetry(
    () =>
      ytdlp(
        url,
        withCookies({
          format: "mp4/best",
          mergeOutputFormat: "mp4",
          output: videoOutPath,
          noPlaylist: true,
          noWarnings: true,
        })
      ),
    "download"
  );

  return info;
}

module.exports = { probeVideo, downloadVideo };
