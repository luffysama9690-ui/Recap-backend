const ytdlp = require("yt-dlp-exec");

const MAX_DURATION_SECONDS = parseInt(process.env.MAX_VIDEO_DURATION || "240", 10); // matches the 4-min MVP limit

/**
 * Metadata only, no download — lets the frontend show a preview card
 * (title/thumbnail/duration) before a credit gets charged.
 */
async function probeVideo(url) {
  const info = await ytdlp(url, {
    dumpSingleJson: true,
    noWarnings: true,
    skipDownload: true,
    noPlaylist: true,
  });

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

  await ytdlp(url, {
    format: "mp4/best",
    mergeOutputFormat: "mp4",
    output: videoOutPath,
    noPlaylist: true,
    noWarnings: true,
  });

  return info;
}

module.exports = { probeVideo, downloadVideo };
