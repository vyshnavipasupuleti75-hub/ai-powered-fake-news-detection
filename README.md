# AI-POWERED FAKE NEWS DETECTION & VERIFICATION SYSTEM

A full-stack academic project. Users sign up, then check text claims, article URLs, images and videos. Each check produces a saved report that separates (1) a machine-learning classification, (2) an evidence assessment, and (3) a list of limitations.

> **Read this first.** The classifier looks only at wording; it does not know whether a claim is true. Its score is not the probability that a claim is true. Evidence is marked INCONCLUSIVE unless a published fact-check was actually retrieved.

## Architecture

| Part | Path | Stack |
|---|---|---|
| Frontend | `frontend/` | React 18, Vite, React Router, Recharts |
| Backend API | `backend/` | Node.js, Express, Mongoose, MongoDB Atlas, Multer |
| AI service | `ai-engine/` | Python 3.12, FastAPI, scikit-learn, OpenCV, RapidOCR |

Flow: browser -> Express (auth, validation, rate limits, persistence) -> FastAPI (`/predict`, `/extract/image`, `/extract/video`). MongoDB stores reports and extracted text, never the uploaded files.

## What works (verified)

- Text claim and article-URL verification (URL fetch is SSRF-protected: no private IPs, unsafe redirects, 2 MB cap, 8 s timeout).
- Image upload (JPEG/PNG/WEBP, drag-and-drop, preview, progress) -> local OCR -> classification of the extracted text.
- Video upload (MP4/MOV) -> 8 evenly spaced frames -> OCR per frame, plus local speech-to-text (faster-whisper `tiny.en`) -> classification of both. The report states how many frames were read and whether a transcript exists.
- Image and video analysis run as background jobs with visible stages (Uploading, Extracting, Analyzing Claims, Checking Evidence, Preparing Report); the finished report is saved to MongoDB.
- Each report has a data-driven summary, next steps, a capabilities list (what was and was not done), and a "needs human review" flag when the classifier and retrieved fact-checks disagree.
- Dashboard and analytics charts (donut, bar, trend, model evaluation) are computed from stored analyses and the saved evaluation report.
- Trained TF-IDF + Logistic Regression model on the LIAR dataset (measured metrics in `ai-engine/README.md`).
- Evidence: Wikipedia background pages (never labelled for/against) and, if `EVIDENCE_API_KEY` (Google Fact Check Tools API) is set, published fact-check ratings.
- Registration, login (bcrypt, HttpOnly cookie), per-user reports, history search and filters, analytics, profile, password change, admin stats.

## What does not exist (by design or missing dependency)

- Speech transcription is English-only (`tiny.en`), may contain errors, and downloads its ~75 MB model from Hugging Face on first use.
- Image/video authenticity or deepfake detection: not implemented. Only on-screen text is analyzed.
- Evidence retrieval beyond Wikipedia and the optional Google Fact Check API.
- Password-reset email (no mail provider configured).
- Datasets other than LIAR: ISOT, FEVER, SciFact and FakeNewsNet need manual download (see `ai-engine/datasets/README.md`).

## Prerequisites

- Node.js 18+ (the backend uses built-in `fetch`/`FormData`).
- Python **3.12** (3.15 alpha cannot build scikit-learn). Windows: `winget install Python.Python.3.12`.
- A MongoDB Atlas cluster and database user.
- About 1.5 GB for the Python environment (OCR + OpenCV). If C: is low on space, create the venv on another drive and set `TMP`, `TEMP` and `PIP_CACHE_DIR` there before installing.

## Setup and run (PowerShell)

```powershell
# 1. AI service (terminal 1) - replace D:\verity-ai\venv with any location
python -m venv D:\verity-ai\venv
D:\verity-ai\venv\Scripts\python.exe -m pip install -r ai-engine\requirements.txt
cd ai-engine\scripts
D:\verity-ai\venv\Scripts\python.exe download_datasets.py
D:\verity-ai\venv\Scripts\python.exe validate_datasets.py
D:\verity-ai\venv\Scripts\python.exe preprocess_data.py
D:\verity-ai\venv\Scripts\python.exe train_model.py
D:\verity-ai\venv\Scripts\python.exe evaluate_model.py
cd ..
D:\verity-ai\venv\Scripts\python.exe -m uvicorn predict:app --host 127.0.0.1 --port 8000

# Or start all three services at once (skips any whose port is already in use):
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 -Python D:\verity-ai\venv\Scripts\python.exe

# 2. Backend (terminal 2)
cd backend
copy .env.example .env      # then fill in real values; never commit .env
npm install
npm run dev

# 3. Frontend (terminal 3)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

Expected backend log: `MongoDB connected and ping succeeded`. `GET http://127.0.0.1:5000/health` returns 200 `{"status":"ok",...}` only after a real ping, otherwise 503 `degraded`.

## Environment variables (backend/.env)

See `backend/.env.example` (placeholders only). Real values stay in `backend/.env`, which is git-ignored.

| Variable | Purpose |
|---|---|
| `MONGODB_URI`, `MONGODB_CONNECTION_MODE`, `MONGODB_STANDARD_URI`, `MONGODB_DNS_SERVERS` | Atlas connection (see troubleshooting) |
| `JWT_SECRET` | Required, 32+ random characters |
| `CLIENT_URL` | Exact frontend origin (CORS + CSRF origin check) |
| `MEDIA_SERVICE_URL` | FastAPI service (classifier, OCR, frames, speech), e.g. `http://127.0.0.1:8000`. `AI_SERVICE_URL` is accepted as an alias |
| `EVIDENCE_API_KEY` | Optional Google Fact Check Tools API key |
| `MAX_IMAGE_MB` (8), `MAX_VIDEO_MB` (50), `MEDIA_TIMEOUT_SECONDS` (120) | Upload limits |

AI service variables: `MODEL_MIN_CONFIDENCE` (0.60), `MEDIA_TMP_DIR`, `VIDEO_MAX_DURATION_SECONDS` (300), `VIDEO_FRAME_SAMPLES` (8), `VIDEO_PROCESSING_TIMEOUT_SECONDS` (90), `MAX_IMAGE_PIXELS`.

## API (JSON except uploads; auth via the `verity_session` HttpOnly cookie)

- `GET /health`, `GET /api/health`
- `POST /api/auth/register`, `/login`, `/logout`; `GET /api/auth/me`
- `POST /api/verify/text` `{text, headline?}`
- `POST /api/verify/url` `{url}`
- `POST /api/verify/image` multipart field `file` (JPEG/PNG/WEBP, up to `MAX_IMAGE_MB`) -> `202 {jobId, stages, stage}`
- `POST /api/verify/video` multipart field `file` (MP4/MOV, up to `MAX_VIDEO_MB`, up to 5 minutes) -> `202 {jobId, ...}`
- `GET /api/verify/jobs/:id` -> `{status: running|completed|failed, stage, stageIndex, reportId?, error?}` (owner only; jobs live in memory for 1 hour, reports are permanent)
- `GET /api/model/health` (public; 200 if the media service is reachable, 503 with an actionable message if not) and `GET /api/model/metrics` (login required; saved evaluation)
- `GET /api/verify/history?page&limit&search&prediction&inputType`
- `GET /api/verify/:id`, `DELETE /api/verify/:id` (owner only; other users get 404)
- `GET /api/dashboard/stats`, `GET|PATCH|DELETE /api/profile`, `PATCH /api/profile/password`
- Admin: `GET /api/admin/stats`

These `/api/verify/*` routes are the project's equivalents of the `/api/verification/*` names in the original brief.

Upload protections: MIME allow-list **and** file-signature check, size caps, 20 uploads per 15 minutes per IP, files held in memory (never written under client-chosen names), the AI service writes a random temp name and deletes it in a `finally`, decompression-bomb cap, video duration limit and time budget.

## If image/video analysis says the media service is unreachable

The backend forwards uploads to the FastAPI service at `MEDIA_SERVICE_URL`. If nothing is listening there, the UI shows a banner and the job fails with a message naming the service and port. Start it (see above or `scripts\dev.ps1`) and check `http://127.0.0.1:5000/api/model/health`. After editing `backend/.env`, restart the backend: `node --watch` does not reload `.env`.

## Tests

```powershell
cd backend;   npm test                                    # unit/security tests, no database needed
cd ai-engine; D:\verity-ai\venv\Scripts\python.exe -m pytest tests    # real OCR, real video, real model
cd frontend;  npm run build
# Real end-to-end against your Atlas DB + running AI service (creates and deletes its own test users):
cd backend;   node scripts/e2e.js <image.png> <video.mp4> <blank.png> <spoofed.png> <video-with-speech.mp4>
```

## Deployment

- Frontend: `cd frontend && npm ci && npm run build`; host `dist/` statically; set `VITE_API_URL` at build time.
- Backend: `npm ci && npm start` with secrets from the host's secret manager, `NODE_ENV=production`, HTTPS, exact `CLIENT_URL`.
- AI service: run `uvicorn predict:app` on a private network only; it has no authentication. Ship `ai-engine/models/` (trained artifacts are git-ignored) or retrain on the server.
- Atlas: allow the backend's egress IP; use a least-privilege database user.

## Windows backend troubleshooting

The backend reads `MONGODB_URI` from `backend/.env`. Keep the Atlas URI there and do not paste it into a command or issue report. Startup logs classify DNS/SRV, authentication, timeout/refusal, and Atlas allowlist failures without logging the URI or raw driver error. Initial connection failures retry with backoff; the API remains available for health checks and returns `503` for database-dependent requests until MongoDB connects.

If port 5000 is occupied, identify its owner before stopping anything:

```powershell
$listener = Get-NetTCPConnection -LocalPort 5000 -State Listen | Select-Object -First 1
$listenerPid = $listener.OwningProcess
$listenerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerPid"
$parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($listenerProcess.ParentProcessId)"
[pscustomobject]@{
  PID = $listenerPid
  NodeServerEntryPoint = ($listenerProcess.CommandLine -match 'src[\\/]server\.js')
  ParentPID = $parentProcess.ProcessId
  ParentIsNodeWatch = ($parentProcess.CommandLine -match '--watch')
}
```

Confirm the API health response identifies `verity-desk-api` and confirm the process entry point and watcher before stopping an obsolete backend process. Prefer Ctrl+C in that server's original terminal. If that terminal is unavailable and the watcher is confirmed obsolete, stop only its reported watcher PID with `Stop-Process -Id <watcher-PID>`; do not stop a PID based on the port number alone.

To check the Windows DNS SRV record without displaying the returned targets:

```powershell
(Resolve-DnsName -Type SRV -Name '_mongodb._tcp.<your-atlas-cluster-host>' -DnsOnly).Count
```

If Windows resolves the SRV record but Node still reports a DNS/SRV error, compare the machine's resolver/network policy with the Node process environment. Also ensure the backend's outbound IP is allowed by Atlas Network Access and that Atlas database credentials are valid.

Node uses its configured DNS resolver for MongoDB SRV lookups. If the operating-system resolver works but Node's resolver is blocked or misconfigured, configure a DNS resolver IP supplied by your network administrator in `backend/.env` as `MONGODB_DNS_SERVERS=resolver-ip` (multiple IPs may be comma-separated). The backend applies this through Node's supported `dns.setServers()` API before MongoDB connects; it is opt-in and does not select a public resolver for you. Do not copy an arbitrary DNS IP: use one approved and reachable from this machine. Restart the backend after changing it. Verify in the same Node runtime with `node -e "require('node:dns').promises.resolveSrv('_mongodb._tcp.<your-atlas-cluster-host>').then(r=>console.log('SRV records:',r.length)).catch(e=>console.error(e.code))"`.

For local development authentication, create a random secret once in PowerShell and append it to `backend/.env` without printing it: `$secret = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"; Add-Content -Path .env -Value "JWT_SECRET=$secret"; Remove-Variable secret`. Run those commands from `backend`. Keep `.env` out of version control and use the deployment platform's secret manager in production.

## Known limits

- Classifier accuracy is modest (see `ai-engine/README.md`) and limited to short English political statements.
- Cookie auth assumes a same-site deployment; cross-site topologies need CSRF protection first.
- PDF export is not offered; use browser print.
