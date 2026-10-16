"""Train TF-IDF + Logistic Regression on the processed LIAR splits.

C is chosen on the validation split only; the test split is never used for training or tuning.
"""
import hashlib
import json
import sys
from datetime import datetime, timezone

import joblib
import pandas as pd
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.pipeline import Pipeline

from _common import PROCESSED, MODELS


def build(c):
    return Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=100000, strip_accents="unicode", sublinear_tf=True)),
        ("classifier", LogisticRegression(C=c, max_iter=2000, class_weight="balanced", random_state=42)),
    ])


def main():
    for s in ("train", "valid", "test"):
        if not (PROCESSED / f"{s}.csv").exists():
            sys.exit("Processed data missing. Run download_datasets.py, then preprocess_data.py.")
    train, valid = (pd.read_csv(PROCESSED / f"{s}.csv") for s in ("train", "valid"))
    best = None
    for c in (0.1, 0.3, 1, 3, 10):
        m = build(c).fit(train.text, train.label)
        f1 = f1_score(valid.label, m.predict(valid.text), average="macro")
        print(f"C={c}: validation macro-F1={f1:.4f}")
        if best is None or f1 > best[0]:
            best = (f1, c)
    model = build(best[1]).fit(train.text, train.label)
    MODELS.mkdir(exist_ok=True)
    joblib.dump(model, MODELS / "classifier.joblib")
    meta = {
        "modelVersion": "liar-tfidf-lr-" + datetime.now(timezone.utc).strftime("%Y%m%d"),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": "LIAR (binary mapping)",
        "trainCsvSha256": hashlib.sha256((PROCESSED / "train.csv").read_bytes()).hexdigest(),
        "trainRows": len(train), "selectedC": best[1], "validationMacroF1": best[0],
        "classes": list(model.classes_), "sklearnVersion": sklearn.__version__,
    }
    (MODELS / "model_meta.json").write_text(json.dumps(meta, indent=2))
    print("Saved model:", meta["modelVersion"])


if __name__ == "__main__":
    main()
