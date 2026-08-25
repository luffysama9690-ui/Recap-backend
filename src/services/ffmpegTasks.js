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

module.exports = { getMediaDuration, extractAudio, mergeVideoWithNarration };
