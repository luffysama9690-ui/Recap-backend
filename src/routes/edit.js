const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");

const { getJob, updateJob } = require("../jobStore");
const { applyOverlays } = require("../services/ffmpegTasks");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB is plenty for a logo image
});

const router = express.Router();

function parsePct(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback;
}

// POST /api/jobs/:id/edit
// multipart/form-data:
//   logo          (file, optional) - PNG/JPG to overlay
//   blurX/blurY/blurW/blurH   (%, optional) - box to blur out original on-screen text
//   logoX/logoY/logoW         (%, optional) - logo position/width, height auto-scales
// Works for jobs created by either /api/process (upload) or /api/link
// (import) — both write into the same shared jobStore.
router.post("/jobs/:id/edit", upload.single("logo"), async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  if (job.status !== "done" || !job.resultPath) {
    return res.status(409).json({ error: "video is not ready yet" });
  }

  const hasBlur = ["blurX", "blurY", "blurW", "blurH"].every((k) => req.body[k] !== undefined);
  const hasLogo = !!req.file;
  if (!hasBlur && !hasLogo) {
    return res.status(400).json({ error: "provide a blur box, a logo file, or both" });
  }

  const workDir = path.dirname(job.resultPath);
  const outputPath = path.join(workDir, `edited-${crypto.randomUUID()}.mp4`);
  let logoTmpPath = null;

  try {
    const opts = {};
    if (hasBlur) {
      opts.blur = {
        xPct: parsePct(req.body.blurX, 10),
        yPct: parsePct(req.body.blurY, 10),
        wPct: parsePct(req.body.blurW, 25),
        hPct: parsePct(req.body.blurH, 10),
      };
    }
    if (hasLogo) {
      logoTmpPath = path.join(os.tmpdir(), `logo-${crypto.randomUUID()}${path.extname(req.file.originalname) || ".png"}`);
      fs.writeFileSync(logoTmpPath, req.file.buffer);
      opts.logoPath = logoTmpPath;
      opts.logo = {
        xPct: parsePct(req.body.logoX, 3),
        yPct: parsePct(req.body.logoY, 3),
        wPct: parsePct(req.body.logoW, 15),
      };
    }

    await applyOverlays(job.resultPath, outputPath, opts);
    updateJob(job.id, { editedResultPath: outputPath });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (logoTmpPath) fs.rm(logoTmpPath, { force: true }, () => {});
  }
});

// GET /api/jobs/:id/edit-result — downloads the edited video
router.get("/jobs/:id/edit-result", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  if (!job.editedResultPath) return res.status(409).json({ error: "no edited version yet" });
  res.download(job.editedResultPath, "recap-edited.mp4");
});

module.exports = router;
