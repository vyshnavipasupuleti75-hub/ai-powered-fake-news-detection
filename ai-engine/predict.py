"""Backward-compatible entry point: `uvicorn predict:app --host 127.0.0.1 --port 8000`."""
from app.main import app  # noqa: F401
