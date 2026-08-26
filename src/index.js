require("dotenv").config();
const express = require("express");
const cors = require("cors");

const processRoutes = require("./routes/process");
const previewRoutes = require("./routes/preview");
const linkRoutes = require("./routes/link");
const editRoutes = require("./routes/edit");

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);

// Needed for JSON bodies (used by /api/link and /api/link/preview).
// The multipart /api/process route uses multer separately and doesn't
// need this, but it's harmless to have both.
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "recap-backend" });
});

app.use("/api", processRoutes);
app.use("/api", previewRoutes);
app.use("/api", linkRoutes);
app.use("/api", editRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Recap backend listening on port ${PORT}`);
  // Fire-and-forget: pre-generate preview audio for every voice so the
  // first real visitor doesn't pay the TTS generation delay.
  previewRoutes.warmPreviewCache().catch((err) =>
    console.warn(`[preview] warmPreviewCache failed: ${err.message}`)
  );
});
