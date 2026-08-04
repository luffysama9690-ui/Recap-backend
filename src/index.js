require("dotenv").config();
const express = require("express");
const cors = require("cors");

const processRoutes = require("./routes/process");

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

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "recap-backend" });
});

app.use("/api", processRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Recap backend listening on port ${PORT}`);
});
