const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const express = require("express");

const { createJob, updateJob, getJob } = require("../jobStore");
const { probeVideo, downloadVideo } = require("../services/ytdlp");
const { extractAudio, mergeVideoWithNarration } = require("../services/ffmpegTasks");
const { transcribeAudio } = require("../services/transcribe");
const { writeScript } = require("../services/script");
const { narrateScript } = require("../services/narrate");

const router = express.Router();

// POST /api/link/preview  { url }
// Free metadata check — no credit charged, no download yet. Frontend uses
// this to show the title/thumbnail/duration before the user confirms.
router.post("/link/preview", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url ပါဝင်ရမယ်" });

  try {
    const info = await probeVideo(url);
    res.json({ ok: true, info });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

// POST /api/link  { url, voice, tone }
// Same shape as POST /api/process, but the source video comes from a
// TikTok/RedNote link instead of a direct upload.
router.post("/link", async (req, res) => {
  const { url, voice, tone } = req.body;
  if (!url) return res.status(400).json({ error: "url ပါဝင်ရမယ်" });

  const jobId = crypto.randomUUID();
  const job = createJob(jobId);

  res.status(202).json({ jobId: job.id, status: job.status });

  runLinkPipeline(jobId, url, voice || "hsayama", tone || "suspense").catch((err) => {
    updateJob(jobId, { status: "error", error: err.message });
  });
});

// GET /api/link/:id and /api/link/:id/result reuse the same shape as
// /api/process/:id — kept here too so the frontend can poll either job
// type through one consistent path if it wants to.
router.get("/link/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job မတွေ့ပါ" });
  const { id, status, progress, error } = job;
  res.json({ id, status, progress, error, ready: status === "done" });
});

router.get("/link/:id/result", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job မတွေ့ပါ" });
  if (job.status !== "done" || !job.resultPath) {
    return res.status(409).json({ error: "video မပြီးသေးပါ" });
  }
  res.download(job.resultPath, "recap.mp4");
});

async function runLinkPipeline(jobId, url, voiceId, toneId) {
  const workDir = path.join(os.tmpdir(), `recap-link-${jobId}`);
  fs.mkdirSync(workDir, { recursive: true });

  const videoPath = path.join(workDir, "source-video.mp4");
  const audioPath = path.join(workDir, "source-audio.mp3");
  const narrationPath = path.join(workDir, "narration.wav");
  const outputPath = path.join(workDir, "output.mp4");

  try {
    updateJob(jobId, { status: "downloading", progress: 5 });
    await downloadVideo(url, videoPath);

    updateJob(jobId, { status: "transcribing", progress: 20 });
    await extractAudio(videoPath, audioPath);
    const transcript = await transcribeAudio(audioPath);

    updateJob(jobId, { status: "writing_script", progress: 45 });
    const script = await writeScript(transcript, voiceId, toneId);

    updateJob(jobId, { status: "narrating", progress: 65 });
    await narrateScript(script, voiceId, narrationPath);

    updateJob(jobId, { status: "rendering", progress: 85 });
    await mergeVideoWithNarration(videoPath, narrationPath, outputPath);

    updateJob(jobId, { status: "done", progress: 100, resultPath: outputPath });
  } finally {
    fs.rm(videoPath, { force: true }, () => {});
    fs.rm(audioPath, { force: true }, () => {});
    fs.rm(narrationPath, { force: true }, () => {});
  }
}

module.exports = router;
