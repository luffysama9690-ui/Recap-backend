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
  // Guards against out-of-bounds crop/overlay coordinates — e.g. if the
  // frontend's percentages were computed against a letterboxed <video>
  // element whose rendered box included black bars (portrait video in a
  // wider container), a box could otherwise end up positioned or sized
  // past the actual frame edge, which makes ffmpeg's crop filter fail
  // immediately with no output frames.
  const clampBox = (xPct, yPct, wPct, hPct, dimW, dimH) => {
    let w = even(px(Math.min(wPct, 95), dimW));
    let h = even(px(Math.min(hPct, 95), dimH));
    let x = even(px(xPct, dimW));
    let y = even(px(yPct, dimH));
    x = Math.min(x, dimW - w - 2);
    y = Math.min(y, dimH - h - 2);
    x = Math.max(0, x);
    y = Math.max(0, y);
    return { x, y, w, h };
  };

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath);
    const filters = [];
    let videoLabel = "0:v";
    let stderrTail = "";

    if (blur) {
      const { x: bx, y: by, w: bw, h: bh } = clampBox(blur.xPct, blur.yPct, blur.wPct, blur.hPct, width, height);
      filters.push(`[0:v]crop=${bw}:${bh}:${bx}:${by},boxblur=20:5[blurpatch]`);
      filters.push(`[0:v][blurpatch]overlay=${bx}:${by}[vblur]`);
      videoLabel = "vblur";
    }

    if (logoPath) {
      cmd.input(logoPath);
      const lw = even(px(Math.min(logo?.wPct ?? 15, 90), width));
      const lx = Math.max(0, Math.min(even(px(logo?.xPct ?? 3, width)), width - lw - 2));
      const ly = Math.max(0, even(px(logo?.yPct ?? 3, height)));
      filters.push(`[1:v]scale=${lw}:-2[logoScaled]`);
      filters.push(`[${videoLabel}][logoScaled]overlay=${lx}:${ly}[outv]`);
      videoLabel = "outv";
    } else {
      filters.push(`[${videoLabel}]null[outv]`);
    }

    cmd
      .complexFilter(filters, "outv")
      .outputOptions(["-map 0:a?", "-c:a copy"])
      .on("stderr", (line) => {
        stderrTail = (stderrTail + "\n" + line).slice(-800); // keep last ~800 chars
      })
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(new Error(`Overlay render failed: ${err.message}. Details: ${stderrTail}`)))
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
