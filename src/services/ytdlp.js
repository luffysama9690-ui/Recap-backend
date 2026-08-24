const { spawn } = require("child_process");

const MAX_DURATION_SECONDS = parseInt(process.env.MAX_VIDEO_DURATION || "240", 10); // matches the 4-min MVP limit

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 500)}`));
    });
    proc.on("error", reject); // binary not found on PATH
  });
}

/**
 * Metadata only, no download — lets the frontend show a preview card
 * (title/thumbnail/duration) before a credit gets charged.
 */
async function probeVideo(url) {
  const raw = await runYtDlp(["-J", "--no-warnings", "--skip-download", url]);
  const info = JSON.parse(raw);
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
 * Enforces the same duration cap as direct uploads.
 */
async function downloadVideo(url, videoOutPath) {
  const info = await probeVideo(url);

  if (info.duration && info.duration > MAX_DURATION_SECONDS) {
    throw new Error(`Video ရှည်လွန်းပါတယ် (${info.duration}s). ${MAX_DURATION_SECONDS}s ထက်မကျော်ရပါ။`);
  }

  await runYtDlp([
    url,
    "-f", "mp4/best",
    "--merge-output-format", "mp4",
    "-o", videoOutPath,
    "--no-playlist",
    "--no-warnings",
  ]);

  return info;
}

module.exports = { probeVideo, downloadVideo };
