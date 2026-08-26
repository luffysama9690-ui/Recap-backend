const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const { createJob, updateJob, getJob } = require("../jobStore");
const { getMediaDuration, extractAudio, mergeVideoWithNarration } = require("../services/ffmpegTasks");
const { transcribeAudio } = require("../services/transcribe");
const { writeScript } = require("../services/script");
const { narrateScript } = require("../services/narrate");

const router = express.Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB, matches frontend copy
});

// POST /api/process  (multipart/form-data: video, voice, tone)
router.post("/process", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "video file is required" });
  }

  const voice = req.body.voice || "hsayama";
  const tone = req.body.tone || "suspense";
  const jobId = crypto.randomUUID();
  const job = createJob(jobId);

  // Respond immediately with the job id; frontend polls GET /api/process/:id
  res.status(202).json({ jobId: job.id, status: job.status });

  // Run the pipeline in the background.
  runPipeline(jobId, req.file.path, voice, tone).catch((err) => {
    updateJob(jobId, { status: "error", error: err.message });
  });
});

// GET /api/process/:id  -> job status
router.get("/process/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const { id, status, progress, error } = job;
  res.json({ id, status, progress, error, ready: status === "done" });
});

// GET /api/process/:id/result  -> download the finished video
router.get("/process/:id/result", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  if (job.status !== "done" || !job.resultPath) {
    return res.status(409).json({ error: "video is not ready yet" });
  }
  res.download(job.resultPath, "recap.mp4");
});

async function runPipeline(jobId, videoPath, voiceId, toneId) {
  const workDir = path.join(os.tmpdir(), `recap-${jobId}`);
  fs.mkdirSync(workDir, { recursive: true });

  const audioPath = path.join(workDir, "source-audio.mp3");
  const narrationPath = path.join(workDir, "narration.wav");
  const outputPath = path.join(workDir, "output.mp4");

  try {
    updateJob(jobId, { status: "transcribing", progress: 10 });
    const durationSeconds = await getMediaDuration(videoPath).catch(() => 0);
    await extractAudio(videoPath, audioPath);
    const transcript = await transcribeAudio(audioPath);

    updateJob(jobId, { status: "writing_script", progress: 35 });
    const script = await writeScript(transcript, voiceId, toneId, durationSeconds);

    updateJob(jobId, { status: "narrating", progress: 60 });
    await narrateScript(script, voiceId, narrationPath);

    updateJob(jobId, { status: "rendering", progress: 85 });
    await mergeVideoWithNarration(videoPath, narrationPath, outputPath);

    updateJob(jobId, { status: "done", progress: 100, resultPath: outputPath });
  } finally {
    // Clean up the original upload + intermediate audio; keep the final
    // output around until the job store's TTL sweep removes it.
    fs.rm(videoPath, { force: true }, () => {});
    fs.rm(audioPath, { force: true }, () => {});
    fs.rm(narrationPath, { force: true }, () => {});
  }
}

module.exports = router;
