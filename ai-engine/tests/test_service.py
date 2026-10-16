"""Service tests. OCR/video tests use real generated media (no mocks); model tests use the trained model."""
import io
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # runs lifespan -> loads model once
        yield c


def text_image(text="BREAKING NEWS 2024", size=(900, 200)):
    img = Image.new("RGB", size, "white")
    ImageDraw.Draw(img).text((20, 60), text, fill="black", font=ImageFont.load_default(size=64))
    return img


def png_bytes(img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def test_health_reports_model(client):
    body = client.get("/health").json()
    assert body["status"] in {"ok", "model_unavailable"}
    if body["status"] == "ok":
        assert body["modelVersion"] and body["heldOutAccuracy"] is not None


@pytest.mark.skipif(not (Path(__file__).resolve().parent.parent / "models" / "classifier.joblib").exists(), reason="model not trained")
def test_predict_returns_known_label_and_confidence(client):
    r = client.post("/predict", json={"text": "The senator said unemployment fell by half during the last four years."})
    assert r.status_code == 200
    body = r.json()
    assert body["prediction"] in {"LIKELY_REAL", "POTENTIALLY_FAKE", "INCONCLUSIVE"}
    assert 0 <= body["confidence"] <= 1
    assert body["supportingEvidence"] == []  # classifier never invents evidence


def test_predict_rejects_short_text(client):
    assert client.post("/predict", json={"text": "short"}).status_code == 422


def test_image_ocr_reads_text(client):
    r = client.post("/extract/image", files={"file": ("a.png", png_bytes(text_image()), "image/png")})
    assert r.status_code == 200
    assert "BREAKING" in r.json()["text"].upper()


def test_image_without_text_returns_empty_text(client):
    blank = Image.new("RGB", (400, 300), "white")
    r = client.post("/extract/image", files={"file": ("b.png", png_bytes(blank), "image/png")})
    assert r.status_code == 200 and r.json()["text"] == ""


def test_corrupt_image_rejected(client):
    r = client.post("/extract/image", files={"file": ("x.png", b"not an image at all", "image/png")})
    assert r.status_code == 422


def test_video_frames_are_sampled_and_ocrd(client, tmp_path):
    path = tmp_path / "v.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (900, 200))
    frame = cv2.cvtColor(np.array(text_image("BREAKING NEWS 2024")), cv2.COLOR_RGB2BGR)
    for _ in range(30):
        writer.write(frame)
    writer.release()
    r = client.post("/extract/video", files={"file": ("v.mp4", path.read_bytes(), "video/mp4")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["framesAnalyzed"] >= 1 and body["audioTranscribed"] is False
    assert "BREAKING" in body["text"].upper()


def test_corrupt_video_rejected(client):
    r = client.post("/extract/video", files={"file": ("v.mp4", b"\x00" * 2048, "video/mp4")})
    assert r.status_code == 422
