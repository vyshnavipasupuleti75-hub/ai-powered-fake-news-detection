"""Evaluate the saved model on the held-out test split and write models/metrics.json (measured values only)."""
import json
import sys

import joblib
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

from _common import PROCESSED, MODELS


def main():
    if not (MODELS / "classifier.joblib").exists():
        sys.exit("No trained model. Run train_model.py first.")
    model = joblib.load(MODELS / "classifier.joblib")
    train, test = pd.read_csv(PROCESSED / "train.csv"), pd.read_csv(PROCESSED / "test.csv")
    pred = model.predict(test.text)
    base = DummyClassifier(strategy="most_frequent").fit(train.text, train.label)
    labels = list(model.classes_)
    out = {
        "testRows": len(test), "testClassCounts": test.label.value_counts().to_dict(),
        "accuracy": accuracy_score(test.label, pred),
        "majorityBaselineAccuracy": accuracy_score(test.label, base.predict(test.text)),
        "labels": labels, "confusionMatrix": confusion_matrix(test.label, pred, labels=labels).tolist(),
        "perClass": classification_report(test.label, pred, output_dict=True, zero_division=0),
    }
    (MODELS / "metrics.json").write_text(json.dumps(out, indent=2))
    print(classification_report(test.label, pred, zero_division=0))
    print(f"accuracy={out['accuracy']:.4f}  majority-baseline={out['majorityBaselineAccuracy']:.4f}  confusion({labels})={out['confusionMatrix']}")


if __name__ == "__main__":
    main()
