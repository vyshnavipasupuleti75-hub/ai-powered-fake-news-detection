"""Verity AI service: classifier prediction + image OCR + video frame analysis."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

import json

from . import media, model, speech

MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_VIDEO_BYTES = 120 * 1024 * 1024


@asynccontextmanager
async def lifespan(_app):
    model.load()  # once at startup, never per request
    yield


app = FastAPI(title="AI-Powered Fake News Detection & Verification System - AI service", version="2.0.0", lifespan=lifespan)


class PredictionRequest(BaseModel):
    text: str = Field(min_length=20, max_length=10000)


@app.get("/health")
def health():
    info = model.info()
    return {"status": "ok" if info["ready"] else "model_unavailable", "modelVersion": info["meta"].get("modelVersion"),
            "error": info["error"], "heldOutAccuracy": info["heldOutAccuracy"],
            "capabilities": {"classifier": info["ready"], "ocr": True, "videoFrames": True, "speechToText": speech.status(),
                             "imageManipulationDetection": False, "deepfakeDetection": False}}


@app.get("/model/metrics")
def model_metrics():
    path = model.MODEL_DIR / "metrics.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="No evaluation report. Run scripts/evaluate_model.py.")
    return {"meta": model.info()["meta"], "metrics": json.loads(path.read_text())}


@app.post("/predict")
def predict(request: PredictionRequest):
    if not model.is_ready():
        raise HTTPException(status_code=503, detail="No trained model is loaded.")
    try:
        result = model.predict(request.text)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The model could not produce a prediction.") from exc
    return {**result, "supportingEvidence": [], "contradictoryEvidence": []}


async def _read(upload: UploadFile, limit: int) -> bytes:
    data = await upload.read(limit + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > limit:
        raise HTTPException(status_code=413, detail="The uploaded file is too large.")
    return data


@app.post("/extract/image")
async def extract_image(file: UploadFile = File(...)):
    data = await _read(file, MAX_IMAGE_BYTES)
    try:
        return await run_in_threadpool(media.analyze_image, data)
    except media.MediaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/extract/video")
async def extract_video(file: UploadFile = File(...)):
    data = await _read(file, MAX_VIDEO_BYTES)
    try:
        return await run_in_threadpool(media.analyze_video, data)
    except media.MediaError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
