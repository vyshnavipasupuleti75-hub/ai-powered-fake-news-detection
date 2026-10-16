# AI service: classifier, OCR and video frame analysis

FastAPI service used by the Express backend. It loads the trained model **once at startup**.

| Endpoint | Purpose |
|---|---|
| `GET /health` | `ok` only if a trained model is loaded; reports model version and held-out accuracy |
| `POST /predict` | `{text}` -> `LIKELY_REAL` / `POTENTIALLY_FAKE` / `INCONCLUSIVE` + model score |
| `POST /extract/image` | multipart `file` -> OCR text lines (RapidOCR, local ONNX models) |
| `POST /extract/video` | multipart `file` -> up to 8 sampled frames (OpenCV) with OCR per frame + speech transcript |
| `GET /model/metrics` | saved evaluation report from the last real training run |

If no model file exists, `/health` reports `model_unavailable` and `/predict` returns 503; nothing is invented.

## Pipeline (reproducible)

Run from `ai-engine/scripts` with a Python 3.12 environment (`pip install -r ../requirements.txt`):

```powershell
python download_datasets.py    # downloads LIAR, records sha256 + URL in datasets/MANIFEST.json
python validate_datasets.py    # schema, labels, missing values, duplicates, class counts
python preprocess_data.py      # label mapping, de-duplication, cross-split leakage removal
python train_model.py          # TF-IDF + Logistic Regression; C chosen on validation only
python evaluate_model.py       # held-out test metrics -> models/metrics.json
```

Serve: `python -m uvicorn predict:app --host 127.0.0.1 --port 8000` (from `ai-engine/`).
Tests: `python -m pytest tests` (real OCR on a generated image, real video frame sampling, the trained model).

## Dataset and label mapping

Trained on **LIAR** (Wang, ACL 2017; PolitiFact statements). Its six labels are mapped to a binary task:
`pants-fire`, `false`, `barely-true` -> **FAKE**; `mostly-true`, `true` -> **REAL**; `half-true` is **excluded** as ambiguous.
Only the statement text is used. The speaker "credit history" columns are deliberately excluded because they encode label information.
Details, license and the other candidate datasets are in `datasets/README.md`.

## Measured results (held-out LIAR test split, produced by `evaluate_model.py`)

Run on 2026-10-16; model `liar-tfidf-lr-20261016`, C = 1 (selected by validation macro-F1 = 0.650).

| | Value |
|---|---|
| Training rows | 8,136 (FAKE 4,489 / REAL 3,647) |
| Test rows | 1,013 (FAKE 554 / REAL 459) |
| **Accuracy** | **0.647** |
| Majority-class baseline accuracy | 0.547 |
| FAKE precision / recall / F1 | 0.684 / 0.659 / 0.671 |
| REAL precision / recall / F1 | 0.605 / 0.632 / 0.618 |
| Confusion matrix (rows = true FAKE, REAL; cols = predicted FAKE, REAL) | [[365, 189], [169, 290]] |

Interpretation: the model beats a trivial baseline by about 10 points but is wrong roughly one time in three. It learns wording patterns of short political statements. It is not a fact checker and should not be used to decide whether a claim is true. Predictions with a top-class probability below `MODEL_MIN_CONFIDENCE` (default 0.60) are reported as INCONCLUSIVE. Probabilities are not calibrated.

## Media processing

- OCR: RapidOCR (`rapidocr-onnxruntime`), bundled models, fully local. Tesseract could not be installed in the development environment (installer download failed), so it is not used.
- Video: OpenCV samples evenly spaced frames (default 8) and reads them with OCR. Audio is transcribed locally with faster-whisper (`WHISPER_MODEL`, default `tiny.en`; `WHISPER_ENABLED=0` disables it; `WHISPER_CACHE_DIR` sets the model cache). PyAV (bundled FFmpeg libraries) decodes the audio, so no system FFmpeg is needed; keep `av<17` for faster-whisper 1.2.1. A silent video reports `no_audio`; nothing is invented.
- Heavy work runs in a thread pool so `/health` stays responsive during processing.
- Limits (env): `MAX_IMAGE_PIXELS`, `VIDEO_MAX_DURATION_SECONDS` (300), `VIDEO_FRAME_SAMPLES` (8), `VIDEO_PROCESSING_TIMEOUT_SECONDS` (90), `MEDIA_TMP_DIR`.
- Uploaded video is written to a randomly named temp file and removed in a `finally` block.

## Known limitations

- English political statements only; accuracy on news articles, other domains or languages is unmeasured.
- No evidence retrieval happens here; the backend handles evidence separately.
- No image forensics or deepfake detection.
