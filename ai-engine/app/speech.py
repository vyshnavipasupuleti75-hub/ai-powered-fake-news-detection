"""Optional speech-to-text for video audio (faster-whisper, local). Reports unavailability honestly."""
import os

ENABLED = os.getenv("WHISPER_ENABLED", "1") != "0"
MODEL_NAME = os.getenv("WHISPER_MODEL", "tiny.en")
CACHE_DIR = os.getenv("WHISPER_CACHE_DIR") or None

_model = None
_load_error = None


def _get_model():
    global _model, _load_error
    if _model is not None or _load_error:
        return _model
    try:
        from faster_whisper import WhisperModel
        _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", download_root=CACHE_DIR)
    except Exception as exc:  # missing package, offline model download, ...
        _load_error = f"Speech model could not be loaded ({type(exc).__name__})."
    return _model


def status() -> dict:
    if not ENABLED:
        return {"available": False, "reason": "Disabled by WHISPER_ENABLED=0.", "model": MODEL_NAME}
    try:
        import faster_whisper  # noqa: F401
    except Exception:
        return {"available": False, "reason": "faster-whisper is not installed.", "model": MODEL_NAME}
    return {"available": _load_error is None, "reason": _load_error, "model": MODEL_NAME, "loaded": _model is not None}


def transcribe(path: str) -> dict:
    base = {"model": MODEL_NAME, "status": "unavailable", "text": "", "segments": [], "language": None, "reason": None}
    if not ENABLED:
        return {**base, "reason": "Speech transcription is disabled (WHISPER_ENABLED=0)."}
    try:
        import av
        with av.open(path) as container:
            if not container.streams.audio:
                return {**base, "status": "no_audio", "reason": "This video has no audio track."}
    except Exception:
        pass  # fall through; transcription reports its own error
    model = _get_model()
    if model is None:
        return {**base, "reason": _load_error or "Speech model unavailable."}
    try:
        segments, info = model.transcribe(path, vad_filter=True, beam_size=1)
        items = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments if s.text.strip()]
    except Exception as exc:
        return {**base, "status": "failed", "reason": f"Audio could not be decoded or transcribed ({type(exc).__name__})."}
    text = " ".join(i["text"] for i in items)
    return {**base, "status": "completed" if text else "no_speech", "text": text, "segments": items[:200], "language": info.language,
            "reason": None if text else "No speech was detected in the audio."}
