from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "datasets" / "raw"
PROCESSED = ROOT / "datasets" / "processed"
MODELS = ROOT / "models"
LIAR_COLUMNS = ["id", "label", "statement", "subject", "speaker", "job_title", "state", "party",
                "barely_true", "false", "half_true", "mostly_true", "pants_fire", "context"]
# Documented label mapping (see datasets/README.md). half-true is excluded as ambiguous.
LIAR_LABEL_MAP = {"pants-fire": "FAKE", "false": "FAKE", "barely-true": "FAKE",
                  "mostly-true": "REAL", "true": "REAL"}
