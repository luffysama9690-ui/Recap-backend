// Simple in-memory job store.
// NOTE: Render's filesystem + memory are ephemeral and per-instance.
// This is fine for a single-instance MVP. If you scale to multiple
// instances later, swap this for Redis or a database table.

const jobs = new Map();

function createJob(id) {
  const job = {
    id,
    status: "queued", // queued | transcribing | writing_script | narrating | rendering | done | error
    progress: 0,
    error: null,
    resultPath: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

// Clean up jobs older than 1 hour so memory doesn't grow forever.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 15 * 60 * 1000);

module.exports = { createJob, updateJob, getJob };
