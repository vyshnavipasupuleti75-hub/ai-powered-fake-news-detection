"""Map LIAR 6-way labels to binary FAKE/REAL (documented), de-duplicate, prevent split leakage.

Only the statement text is used. Speaker credit-history columns are excluded (they leak label information).
"""
import json
import re

from _common import PROCESSED, LIAR_LABEL_MAP
from validate_datasets import load


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).strip()


def main():
    PROCESSED.mkdir(parents=True, exist_ok=True)
    seen, stats = set(), {}
    for split in ("train", "valid", "test"):
        df = load(split).dropna(subset=["statement", "label"])
        raw_rows = len(df)
        df = df[df.label.isin(LIAR_LABEL_MAP)].copy()
        after_map = len(df)
        df["text"] = df.statement.map(clean)
        df["key"] = df.text.str.lower()
        df = df.drop_duplicates("key")
        df = df[~df.key.isin(seen)]  # drop anything already in an earlier split (leakage)
        seen |= set(df.key)
        df["label"] = df.label.map(LIAR_LABEL_MAP)
        df[["text", "label"]].to_csv(PROCESSED / f"{split}.csv", index=False)
        stats[split] = {"raw_rows": raw_rows, "after_label_mapping": after_map, "final_rows": len(df),
                        "class_counts": df.label.value_counts().to_dict()}
        print(split, stats[split])
    (PROCESSED / "preprocessing.json").write_text(json.dumps({
        "dataset": "LIAR (Wang, ACL 2017)", "task": "binary statement-level classification",
        "label_mapping": LIAR_LABEL_MAP, "excluded_labels": ["half-true"],
        "features": "statement text only", "splits": stats}, indent=2))


if __name__ == "__main__":
    main()
