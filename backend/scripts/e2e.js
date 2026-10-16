// Real end-to-end check against the configured MongoDB and the running AI/media service.
// Creates and removes its own test users. Nothing is mocked.
// Usage: node scripts/e2e.js <image.png> <video.mp4> <blank.png> <spoofed.png> <speech-video.mp4>
const fs = require('fs');
const crypto = require('crypto');
const app = require('../src/app');
const connectDb = require('../src/config/db');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Verification = require('../src/models/Verification');
const { clientUrl } = require('../src/config/env');

const [imagePath, videoPath, blankPath, spoofPath, speechPath] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await connectDb();
  const server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tag = crypto.randomBytes(4).toString('hex');
  const emails = [`e2e-a-${tag}@example.test`, `e2e-b-${tag}@example.test`];
  const password = 'E2e-Test-Password-' + tag;
  const call = async (path, { method = 'GET', cookie, json, form } = {}) => {
    const headers = { Origin: clientUrl };
    if (cookie) headers.cookie = cookie;
    let body;
    if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    const res = await fetch(base + path, { method, headers, body });
    return { res, body: await res.json().catch(() => ({})) };
  };
  const upload = (path, file, type, cookie) => { const f = new FormData(); f.append('file', new Blob([fs.readFileSync(file)], { type }), 'x'); return call(path, { method: 'POST', cookie, form: f }); };
  // Upload -> 202 job -> poll -> saved report. Returns { start, stages, report }.
  const analyze = async (kind, file, type, cookie) => {
    const start = await upload(`/api/verify/${kind}`, file, type, cookie);
    if (start.res.status !== 202) return { start };
    const seen = new Set();
    for (let i = 0; i < 240; i++) {
      const job = await call(`/api/verify/jobs/${start.body.jobId}`, { cookie });
      seen.add(job.body.stage);
      if (job.body.status === 'failed') return { start, stages: [...seen], error: job.body.error };
      if (job.body.status === 'completed') {
        const report = await call(`/api/verify/${job.body.reportId}`, { cookie });
        return { start, stages: [...seen], report: report.body.verification, jobId: start.body.jobId };
      }
      await sleep(500);
    }
    return { start, error: 'timed out waiting for job' };
  };
  try {
    const modelHealth = await call('/api/model/health');
    check('media service reachable via backend (/api/model/health)', modelHealth.res.status === 200 && modelHealth.body.status === 'ok', `HTTP ${modelHealth.res.status} speech=${modelHealth.body.capabilities?.speechToText?.available}`);
    const health = await call('/health');
    check('health is ok only with a real ping', health.res.status === 200 && health.body.status === 'ok' && health.body.database === 'connected', `HTTP ${health.res.status}`);
    const cookies = [];
    for (const [i, email] of emails.entries()) {
      const reg = await call('/api/auth/register', { method: 'POST', json: { name: `E2E User ${i}`, email, password } });
      check(`register user ${i}`, reg.res.status === 201, `HTTP ${reg.res.status}`);
      const login = await call('/api/auth/login', { method: 'POST', json: { email, password } });
      const setCookie = login.res.headers.get('set-cookie') || '';
      cookies.push(setCookie.split(';')[0]);
      check(`login user ${i} sets HttpOnly cookie`, login.res.status === 200 && /httponly/i.test(setCookie), `HTTP ${login.res.status}`);
    }
    check('duplicate email rejected', (await call('/api/auth/register', { method: 'POST', json: { name: 'Dup', email: emails[0], password } })).res.status === 409);
    const stored = await User.findOne({ email: emails[0] }).select('+passwordHash');
    check('password stored hashed (bcrypt)', /^\$2[aby]\$/.test(stored?.passwordHash || ''));
    check('model metrics endpoint returns saved evaluation', (await call('/api/model/metrics', { cookie: cookies[0] })).body.metrics?.accuracy > 0);
    check('model metrics require login', (await call('/api/model/metrics')).res.status === 401);

    const text = await call('/api/verify/text', { method: 'POST', cookie: cookies[0], json: { text: 'The senator said unemployment fell by half during the last four years in office.' } });
    const tv = text.body.verification;
    check('text verification saved with model result', text.res.status === 201 && !!tv?._id && tv.modelVersion !== 'unavailable', `prediction=${tv?.prediction} model=${tv?.modelVersion}`);
    check('report has data-driven summary + next steps', /classifier/i.test(tv?.summary || '') && tv?.nextSteps?.length > 0 && /Final result/.test(tv?.summary || ''));
    check('evidence assessment is honest', ['INCONCLUSIVE', 'SUPPORTED', 'CONTRADICTED', 'MIXED'].includes(tv?.evidenceAssessment?.status), `status=${tv?.evidenceAssessment?.status} related=${tv?.relatedSources?.length}`);
    check('capabilities list marks unavailable features', tv?.capabilities?.some(c => /fact-check/i.test(c.name)));

    const img = await analyze('image', imagePath, 'image/png', cookies[0]);
    check('image upload returns 202 job and progresses through stages', img.start.res.status === 202 && (img.stages || []).length >= 2, `stages=${(img.stages || []).join(' > ')}`);
    check('image OCR + classification saved', /cars/i.test(img.report?.submittedText || '') && img.report?.modelVersion !== 'not-run', `ocr="${(img.report?.submittedText || '').replace(/\s+/g, ' ').slice(0, 55)}"`);
    check('image report states manipulation detection unavailable', img.report?.capabilities?.some(c => /manipulation/i.test(c.name) && c.status === 'unavailable'));
    const blank = await analyze('image', blankPath, 'image/png', cookies[0]);
    check('image with no text -> INCONCLUSIVE, nothing invented', blank.report?.prediction === 'INCONCLUSIVE' && blank.report?.modelVersion === 'not-run' && /No usable text/.test(blank.report?.summary || ''));
    check('spoofed file (wrong signature) rejected', (await upload('/api/verify/image', spoofPath, 'image/png', cookies[0])).res.status === 415);
    check('wrong MIME type rejected', (await upload('/api/verify/image', imagePath, 'application/pdf', cookies[0])).res.status === 415);
    check('unauthenticated upload rejected', (await upload('/api/verify/image', imagePath, 'image/png')).res.status === 401);
    check('job not visible to another user', img.jobId && (await call(`/api/verify/jobs/${img.jobId}`, { cookie: cookies[1] })).res.status === 404);

    const video = await analyze('video', videoPath, 'video/mp4', cookies[0]);
    const m = video.report?.media;
    check('video frames OCR + classification saved', m?.framesAnalyzed >= 1 && /cars/i.test(video.report?.submittedText || ''), `frames=${m?.framesAnalyzed}/${m?.framesRequested} stages=${(video.stages || []).length}`);
    check('silent video: transcript honestly not available', m?.transcript?.status !== 'completed' && m?.audioTranscribed === false, `status=${m?.transcript?.status}`);
    const speech = await analyze('video', speechPath, 'video/mp4', cookies[0]);
    const sm = speech.report?.media;
    check('video with speech: audio transcribed locally', sm?.transcript?.status === 'completed' && /bridge/i.test(sm?.transcript?.text || ''), `transcript="${(sm?.transcript?.text || '').slice(0, 70)}"`);
    check('transcript text is analyzed with the model', /bridge/i.test(speech.report?.submittedText || '') && speech.report?.modelVersion !== 'not-run');

    const history = await call('/api/verify/history?limit=50', { cookie: cookies[0] });
    check('history returns own reports', history.res.status === 200 && history.body.total === 5, `total=${history.body.total}`);
    check('history filter by input type', (await call('/api/verify/history?inputType=video', { cookie: cookies[0] })).body.total === 2);
    const id = tv._id;
    check('owner can read report', (await call(`/api/verify/${id}`, { cookie: cookies[0] })).res.status === 200);
    check('other user cannot read report', (await call(`/api/verify/${id}`, { cookie: cookies[1] })).res.status === 404);
    check('other user cannot delete report', (await call(`/api/verify/${id}`, { method: 'DELETE', cookie: cookies[1] })).res.status === 404);
    check('other user history is isolated', (await call('/api/verify/history', { cookie: cookies[1] })).body.total === 0);
    const stats = await call('/api/dashboard/stats', { cookie: cookies[0] });
    check('dashboard stats derive from stored data', stats.body.total === 5 && stats.body.inputTypes?.text === 1 && stats.body.inputTypes?.image === 2 && stats.body.inputTypes?.video === 2, JSON.stringify(stats.body.inputTypes));
    check('owner can delete report', (await call(`/api/verify/${id}`, { method: 'DELETE', cookie: cookies[0] })).res.status === 200);
    check('logout then session rejected', (await call('/api/auth/logout', { method: 'POST', cookie: cookies[0] })).res.status === 200 && (await call('/api/auth/me')).res.status === 401);
  } finally {
    const users = await User.find({ email: { $in: emails } }).select('_id');
    await Verification.deleteMany({ userId: { $in: users.map(u => u._id) } });
    await User.deleteMany({ email: { $in: emails } });
    console.log(`cleanup: removed ${users.length} test users and their reports`);
    server.close();
    await mongoose.disconnect();
  }
  const failed = results.filter(x => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
main().catch(err => { console.error('E2E aborted:', err.message); process.exit(2); });
