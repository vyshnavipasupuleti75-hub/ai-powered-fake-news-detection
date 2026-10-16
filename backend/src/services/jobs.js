// In-memory background jobs for analysis progress. The finished report is stored in MongoDB; jobs only track progress.
const crypto = require('crypto');

const TTL_MS = 60 * 60 * 1000;
const MAX_ACTIVE_PER_USER = 2;
const MAX_ACTIVE_TOTAL = 4;
const jobs = new Map();

const STAGES = {
  image: ['Uploaded', 'Extracting Text (OCR)', 'Analyzing Claims', 'Checking Evidence', 'Preparing Report'],
  video: ['Uploaded', 'Extracting Frames, Text and Speech', 'Analyzing Claims', 'Checking Evidence', 'Preparing Report']
};

function sweep() { const now = Date.now(); for (const [id, j] of jobs) if (now - j.updatedAt > TTL_MS) jobs.delete(id); }
function active(userId) {
  let mine = 0, all = 0;
  for (const j of jobs.values()) if (j.status === 'running') { all++; if (String(j.userId) === String(userId)) mine++; }
  return { mine, all };
}

function create(userId, kind) {
  sweep();
  const { mine, all } = active(userId);
  if (mine >= MAX_ACTIVE_PER_USER || all >= MAX_ACTIVE_TOTAL) {
    throw Object.assign(new Error('Too many analyses are running. Wait for one to finish and try again.'), { status: 429, expose: true });
  }
  const job = { id: crypto.randomUUID(), userId, kind, stages: STAGES[kind], stageIndex: 0, status: 'running', reportId: null, error: null, updatedAt: Date.now() };
  jobs.set(job.id, job);
  return job;
}
function setStage(job, index) { job.stageIndex = index; job.updatedAt = Date.now(); }
function complete(job, reportId) { job.status = 'completed'; job.reportId = String(reportId); job.stageIndex = job.stages.length - 1; job.updatedAt = Date.now(); }
function fail(job, message) { job.status = 'failed'; job.error = message; job.updatedAt = Date.now(); }
function get(id, userId) { const j = jobs.get(id); return j && String(j.userId) === String(userId) ? j : null; }
function view(j) { return { jobId: j.id, kind: j.kind, status: j.status, stages: j.stages, stageIndex: j.stageIndex, stage: j.stages[j.stageIndex], reportId: j.reportId, error: j.error }; }

module.exports = { create, setStage, complete, fail, get, view };
