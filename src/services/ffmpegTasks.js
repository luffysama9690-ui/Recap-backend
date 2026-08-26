const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Returns the duration (seconds) of a local media file via ffprobe.
 */
function getMediaDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      const duration = metadata?.format?.duration;
      if (!duration) return reject(new Error("ffprobe returned no duration"));
      resolve(duration);
    });
  });
}

/**
 * Pulls the audio track out of a video file so it can be sent to Gemini for
 * transcription. Mono + 64kbps is plenty for speech recognition and keeps
 * the file (and the base64-encoded request sent to Gemini) meaningfully
 * smaller than the default ~128kbps stereo — important for longer videos,
 * since Gemini's inline audio data has a request-size limit.
 */
function extractAudio(videoPath, audioOutPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioChannels(1)
      .audioBitrate("64k")
      .format("mp3")
      .on("end", () => resolve(audioOutPath))
      .on("error", (err) => reject(new Error(`Audio extraction failed: ${err.message}`)))
      .save(audioOutPath);
  });
}

/**
 * Replaces the video's original audio track with the generated narration.
 * If the narration is shorter than the video, the video is trimmed to
 * match (typical for a "recap" cut). If longer, the narration is trimmed
 * to the video length instead — whichever is shorter wins via -shortest.
 */
function mergeVideoWithNarration(videoPath, narrationPath, outPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(narrationPath)
      .outputOptions([
        "-map 0:v:0",
        "-map 1:a:0",
        "-c:v copy",
        "-c:a aac",
        "-shortest",
      ])
      .on("end", () => resolve(outPath))
      .on("error", (err) => reject(new Error(`Video merge failed: ${err.message}`)))
      .save(outPath);
  });
}

/**
 * Returns the pixel width/height of a local video file via ffprobe.
 */
function getVideoDimensions(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      const stream = metadata?.streams?.find((s) => s.codec_type === "video");
      if (!stream?.width || !stream?.height) return reject(new Error("ffprobe returned no video dimensions"));
      resolve({ width: stream.width, height: stream.height });
    });
  });
}

/**
 * Burns a blur box (to cover original on-screen text/watermarks) and/or a
 * logo image onto a video. Coordinates are all percentages (0-100) of the
 * video's own width/height, so the frontend doesn't need to know the
 * video's actual pixel dimensions — it just reports where the user
 * dragged the box on whatever size the <video> preview happened to render.
 * Percentages are converted to literal pixel values (via ffprobe) before
 * building the filter graph — ffmpeg's plain `scale` filter can't use
 * expressions like main_w/main_h (those only work inside scale2ref).
 *
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {object} opts
 * @param {{xPct:number,yPct:number,wPct:number,hPct:number}} [opts.blur] - box to blur
 * @param {string} [opts.logoPath] - local path to a logo image file
 * @param {{xPct:number,yPct:number,wPct:number}} [opts.logo] - logo position/width (height auto-scales)
 */
async function applyOverlays(inputPath, outputPath, { blur, logoPath, logo } = {}) {
  if (!blur && !logoPath) {
    throw new Error("applyOverlays called with neither blur nor logo");
  }

  const { width, height } = await getVideoDimensions(inputPath);
  const px = (pct, dim) => Math.max(2, Math.round((pct / 100) * dim));
  // Even dimensions/offsets — some codecs/filters (crop, libx264 yuv420p)
  // require even width/height/x/y.
  const even = (n) => n - (n % 2);

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath);
    const filters = [];
    let videoLabel = "0:v";

    if (blur) {
      const bx = even(px(blur.xPct, width));
      const by = even(px(blur.yPct, height));
      const bw = even(px(blur.wPct, width));
      const bh = even(px(blur.hPct, height));
      filters.push(`[0:v]crop=${bw}:${bh}:${bx}:${by},boxblur=20:5[blurpatch]`);
      filters.push(`[0:v][blurpatch]overlay=${bx}:${by}[vblur]`);
      videoLabel = "vblur";
    }

    if (logoPath) {
      cmd.input(logoPath);
      const lx = even(px(logo?.xPct ?? 3, width));
      const ly = even(px(logo?.yPct ?? 3, height));
      const lw = even(px(logo?.wPct ?? 15, width));
      filters.push(`[1:v]scale=${lw}:-2[logoScaled]`);
      filters.push(`[${videoLabel}][logoScaled]overlay=${lx}:${ly}[outv]`);
      videoLabel = "outv";
    } else {
      filters.push(`[${videoLabel}]null[outv]`);
    }

    cmd
      .complexFilter(filters, "outv")
      .outputOptions(["-map 0:a?", "-c:a copy"])
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(new Error(`Overlay render failed: ${err.message}`)))
      .save(outputPath);
  });
}

module.exports = {
  getMediaDuration,
  getVideoDimensions,
  extractAudio,
  mergeVideoWithNarration,
  applyOverlays,
};
