"""Image OCR and video frame extraction. Local processing only (RapidOCR + OpenCV)."""
import io
import os
import tempfile
import time
import uuid
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from . import speech

MAX_IMAGE_PIXELS = int(os.getenv("MAX_IMAGE_PIXELS", str(40_000_000)))
VIDEO_MAX_SECONDS = float(os.getenv("VIDEO_MAX_DURATION_SECONDS", "300"))
VIDEO_FRAME_SAMPLES = int(os.getenv("VIDEO_FRAME_SAMPLES", "8"))
VIDEO_TIME_BUDGET = float(os.getenv("VIDEO_PROCESSING_TIMEOUT_SECONDS", "90"))
MIN_OCR_SCORE = 0.5

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS  # decompression-bomb guard

_ocr = None


class MediaError(ValueError):
    """User-facing media problem (bad file, too long, unreadable)."""


def _engine():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


def ocr_array(bgr: np.ndarray) -> list[dict]:
    result, _ = _engine()(bgr)
    lines = []
    for box, text, score in result or []:
        if float(score) >= MIN_OCR_SCORE and text.strip():
            lines.append({"text": text.strip(), "confidence": round(float(score), 3)})
    return lines


def analyze_image(data: bytes) -> dict:
    try:
        probe = Image.open(io.BytesIO(data))
        probe.verify()
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:
        raise MediaError("The file could not be read as a valid image.") from exc
    if min(img.size) < 16:
        raise MediaError("The image is too small to analyze.")
    bgr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    lines = ocr_array(bgr)
    return {"width": img.size[0], "height": img.size[1], "engine": "RapidOCR (ONNX, local)",
            "lines": lines, "text": "\n".join(item["text"] for item in lines)}


def analyze_video(data: bytes) -> dict:
    directory = Path(os.getenv("MEDIA_TMP_DIR") or tempfile.gettempdir())
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{uuid.uuid4().hex}.bin"
    path.write_bytes(data)
    started = time.monotonic()
    try:
        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            raise MediaError("The video could not be opened. Supported containers depend on the installed OpenCV build.")
        fps = cap.get(cv2.CAP_PROP_FPS) or 0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if fps <= 0 or total <= 0:
            raise MediaError("The video has no readable frames or duration.")
        duration = total / fps
        if duration > VIDEO_MAX_SECONDS:
            raise MediaError(f"The video is {duration:.0f}s long; the limit is {VIDEO_MAX_SECONDS:.0f}s.")
        count = min(VIDEO_FRAME_SAMPLES, total)
        indices = sorted({int(total * (i + 0.5) / count) for i in range(count)})
        frames, timed_out = [], False
        for index in indices:
            if time.monotonic() - started > VIDEO_TIME_BUDGET:
                timed_out = True
                break
            cap.set(cv2.CAP_PROP_POS_FRAMES, index)
            ok, frame = cap.read()
            if not ok:
                continue
            h, w = frame.shape[:2]
            if max(h, w) > 1280:  # bound OCR cost
                scale = 1280 / max(h, w)
                frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
            lines = ocr_array(frame)
            frames.append({"index": index, "timestampSeconds": round(index / fps, 2), "lines": lines})
        cap.release()
        seen_lines, unique_lines = set(), []
        for f in frames:  # identical on-screen text in several frames is analyzed once
            for l in f["lines"]:
                key = l["text"].strip().lower()
                if key not in seen_lines:
                    seen_lines.add(key)
                    unique_lines.append(l["text"])
        frame_text = "\n".join(unique_lines)
        transcript = speech.transcribe(str(path)) if time.monotonic() - started < VIDEO_TIME_BUDGET else {"status": "unavailable", "text": "", "segments": [], "reason": "Skipped: processing time budget used up by frame analysis.", "model": speech.MODEL_NAME, "language": None}
        return {"durationSeconds": round(duration, 2), "fps": round(fps, 2), "totalFrames": total,
                "framesAnalyzed": len(frames), "framesRequested": len(indices), "timedOut": timed_out,
                "frames": frames, "transcript": transcript, "audioTranscribed": transcript["status"] == "completed",
                "frameText": frame_text,
                "text": "\n".join(part for part in (frame_text, transcript["text"]) if part)}
    finally:
        path.unlink(missing_ok=True)
