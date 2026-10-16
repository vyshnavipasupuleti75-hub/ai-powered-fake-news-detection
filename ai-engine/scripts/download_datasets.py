"""Download datasets that have a reliable, public, direct download. Others require manual steps.

Records source URL, retrieval time and SHA-256 in datasets/MANIFEST.json. Never fabricates a download.
"""
import hashlib
import json
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone

from _common import RAW, ROOT

LIAR_URL = "https://www.cs.ucsb.edu/~william/data/liar_dataset.zip"
MANUAL = {
    "ISOT": "Download True.csv and Fake.csv from the University of Victoria ISOT page (https://onlineacademiccommunity.uvic.ca/isot/) or its Kaggle mirror, check the license terms, and place them in datasets/raw/isot/. Not automated: access requires a manual step.",
    "FEVER": "Download from https://fever.ai/dataset/fever.html (terms on that page) into datasets/raw/fever/. It is evidence-based claim verification (Supported/Refuted/NotEnoughInfo), not a binary news classifier.",
    "SciFact": "Download from https://github.com/allenai/scifact into datasets/raw/scifact/. Scientific-claim verification; a different task and label space.",
    "FakeNewsNet": "Access via https://github.com/KaiDMML/FakeNewsNet; article text must be re-crawled under each site's terms. Not automated here.",
}


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    manifest_path = ROOT / "datasets" / "MANIFEST.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    target = RAW / "liar_dataset.zip"
    try:
        urllib.request.urlretrieve(LIAR_URL, target)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        with zipfile.ZipFile(target) as z:
            z.extractall(RAW / "liar")
        manifest["LIAR"] = {"url": LIAR_URL, "sha256": digest,
                            "retrievedAt": datetime.now(timezone.utc).isoformat(),
                            "license": "Research use only; original sources retain copyright (see LIAR README)."}
        print(f"LIAR downloaded and extracted. sha256={digest}")
    except Exception as exc:
        print(f"LIAR download FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print("\nNot downloaded automatically (manual steps required):")
    for name, text in MANUAL.items():
        print(f" - {name}: {text}")


if __name__ == "__main__":
    main()
