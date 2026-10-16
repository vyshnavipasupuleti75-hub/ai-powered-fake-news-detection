"""Validate raw LIAR files: schema, labels, missing values, duplicates, class distribution."""
import sys

import pandas as pd

from _common import RAW, LIAR_COLUMNS, LIAR_LABEL_MAP


def load(split):
    return pd.read_csv(RAW / "liar" / f"{split}.tsv", sep="\t", header=None, names=LIAR_COLUMNS, quoting=3, dtype=str)


def main():
    ok = True
    for split in ("train", "valid", "test"):
        path = RAW / "liar" / f"{split}.tsv"
        if not path.exists():
            print(f"MISSING {path}. Run scripts/download_datasets.py")
            sys.exit(1)
        df = load(split)
        known = set(LIAR_LABEL_MAP) | {"half-true"}
        bad = sorted(set(df.label.dropna()) - known)
        print(f"[{split}] rows={len(df)} missing_statement={df.statement.isna().sum()} "
              f"duplicate_statements={df.statement.duplicated().sum()} unknown_labels={bad}")
        print("   label counts:", df.label.value_counts().to_dict())
        ok &= not bad and df.statement.isna().sum() == 0
    print("VALID" if ok else "PROBLEMS FOUND")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
