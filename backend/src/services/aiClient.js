const { mediaServiceUrl } = require('../config/env');

const START_HINT = 'Start it with: cd ai-engine; <python-3.12-venv>\\Scripts\\python.exe -m uvicorn predict:app --host 127.0.0.1 --port 8000 (or run scripts\\dev.ps1).';
function where() { try { return new URL(mediaServiceUrl).host; } catch { return 'the configured address'; } }
function unavailable(message) { return Object.assign(new Error(message), { status: 503, expose: true, code: 'MEDIA_SERVICE_UNAVAILABLE' }); }
function notReachable() { return unavailable(`The AI media-processing service (FastAPI at ${where()}) is not reachable. ${START_HINT} Check it with GET /api/model/health.`); }

async function call(path, { method = 'GET', body, timeoutMs = 8000 } = {}) {
  if (!mediaServiceUrl) throw unavailable('The AI media-processing service is not configured. Set MEDIA_SERVICE_URL in backend/.env (for example http://127.0.0.1:8000).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${mediaServiceUrl.replace(/\/$/, '')}${path}`, { method, body, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw Object.assign(new Error(path.startsWith('/extract') ? 'Media processing timed out. Try a shorter or smaller file.' : 'The AI service did not respond in time. It may be busy; try again in a moment.'), { status: 504, expose: true });
    throw notReachable();
  } finally { clearTimeout(timer); }
}

// Forwards an in-memory upload to the AI service's extraction endpoint (OCR / frame sampling / speech).
async function extract(kind, file, timeoutMs) {
  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimetype }), `upload.${kind === 'image' ? 'img' : 'vid'}`);
  const response = await call(`/extract/${kind}`, { method: 'POST', body: form, timeoutMs });
  if ([400, 413, 422].includes(response.status)) {
    const detail = (await response.json().catch(() => ({}))).detail;
    throw Object.assign(new Error(typeof detail === 'string' ? detail : 'The file could not be processed.'), { status: 422, expose: true });
  }
  if (!response.ok) throw unavailable('The media-processing service returned an error. Check its terminal for details.');
  return response.json();
}

// Reports reachability and capabilities without throwing.
async function health() {
  try {
    const response = await call('/health', { timeoutMs: 3000 });
    const body = await response.json();
    return { reachable: true, status: body.status, modelVersion: body.modelVersion, heldOutAccuracy: body.heldOutAccuracy, capabilities: body.capabilities };
  } catch (err) {
    return { reachable: false, status: 'unreachable', message: err.message };
  }
}

async function modelMetrics() {
  const response = await call('/model/metrics', { timeoutMs: 5000 });
  if (response.status === 404) return null;
  if (!response.ok) throw unavailable('Model metrics are unavailable.');
  return response.json();
}

module.exports = { extract, health, modelMetrics };
