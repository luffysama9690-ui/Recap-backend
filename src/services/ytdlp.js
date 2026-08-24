const ytdlp = require("yt-dlp-exec");

const MAX_DURATION_SECONDS = parseInt(process.env.MAX_VIDEO_DURATION || "240", 10); // matches the 4-min MVP limit
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// TikTok/RedNote extraction fails intermittently (anti-bot measures kick in
// on a fraction of requests) even when the link and yt-dlp version are both
// fine. Retrying the same request a couple of times resolves most of these
// without needing any code change on our side.
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
      ytdlp(url, {
        dumpSingleJson: true,
        noWarnings: true,
        skipDownload: true,
        noPlaylist: true,
      }),
    "probe"
  );

  return {
    title: info.title,
    duration: info.duration, // seconds
    thumbnail: info.thumbnail,
    uploader: info.uploader,
    platform: info.extractor_key, // "TikTok", "Xiaohongshu", etc.
  };
}

/**
 * Downloads the source video from a TikTok/RedNote/etc link to videoOutPath.
 * Enforces the same duration cap as direct uploads. Pass a previously
 * fetched `knownInfo` (e.g. from the /preview step) to skip the extra
 * probe call and its own chance of hitting the intermittent extractor error.
 */
async function downloadVideo(url, videoOutPath, knownInfo = null) {
  const info = knownInfo || (await probeVideo(url));

  if (info.duration && info.duration > MAX_DURATION_SECONDS) {
    throw new Error(`Video ရှည်လွန်းပါတယ် (${info.duration}s). ${MAX_DURATION_SECONDS}s ထက်မကျော်ရပါ။`);
  }

  await withRetry(
    () =>
      ytdlp(url, {
        format: "mp4/best",
        mergeOutputFormat: "mp4",
        output: videoOutPath,
        noPlaylist: true,
        noWarnings: true,
      }),
    "download"
  );

  return info;
}

module.exports = { probeVideo, downloadVideo };
