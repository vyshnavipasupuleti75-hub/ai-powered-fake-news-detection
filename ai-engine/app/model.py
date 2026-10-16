"""Loads the trained classifier once and produces a cautious prediction."""
import json
import os
from pathlib import Path
from typing import Any

import joblib

MODEL_DIR = Path(os.getenv("VERITY_MODEL_DIR", Path(__file__).resolve().parent.parent / "models"))
# Predictions whose top-class probability is below this are reported as INCONCLUSIVE.
MIN_CONFIDENCE = float(os.getenv("MODEL_MIN_CONFIDENCE", "0.60"))

LABELS = {"REAL": "LIKELY_REAL", "FAKE": "POTENTIALLY_FAKE"}

_model: Any = None
_meta: dict = {}
_error: str | None = None


def load() -> None:
    global _model, _meta, _error
    path = MODEL_DIR / "classifier.joblib"
    try:
        if not path.exists():
            _error = "No trained model found. Run the scripts in ai-engine/scripts (see ai-engine/README.md)."
            return
        _model = joblib.load(path)
        meta_path = MODEL_DIR / "model_meta.json"
        _meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        _error = None
    except Exception as exc:  # corrupt file, incompatible sklearn version, ...
        _model, _error = None, f"Model failed to load: {type(exc).__name__}"


def is_ready() -> bool:
    return _model is not None


def info() -> dict:
    metrics_path = MODEL_DIR / "metrics.json"
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else None
    return {"ready": is_ready(), "error": _error, "meta": _meta,
            "heldOutAccuracy": metrics["accuracy"] if metrics else None}


def predict(text: str) -> dict:
    if _model is None:
        raise RuntimeError(_error or "model unavailable")
    probs = _model.predict_proba([text])[0]
    classes = list(_model.classes_)
    top = max(range(len(classes)), key=lambda i: probs[i])
    confidence = float(probs[top])
    prediction = LABELS.get(str(classes[top]).upper(), "INCONCLUSIVE") if confidence >= MIN_CONFIDENCE else "INCONCLUSIVE"
    return {
        "prediction": prediction,
        "confidence": confidence,
        "modelVersion": _meta.get("modelVersion", "unknown"),
        "explanation": (
            "A statistical text classifier trained on labeled political statements (LIAR) compared this text with patterns "
            "in its training data. It looks at wording only; it did not check any facts."
            + ("" if prediction != "INCONCLUSIVE" else f" Its score was below the {MIN_CONFIDENCE:.0%} threshold, so no label is given.")
        ),
        "limitations": [
            "The score is the model's confidence in a wording pattern, not the probability that the claim is true.",
            "The model was trained on short English political statements; accuracy on other kinds of text is unknown.",
            f"Held-out accuracy on its own test set was {info()['heldOutAccuracy']:.0%}; many individual predictions are wrong."
            if info()["heldOutAccuracy"] is not None else "Held-out accuracy is unavailable.",
        ],
    }
