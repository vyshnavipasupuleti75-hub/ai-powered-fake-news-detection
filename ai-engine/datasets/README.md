# Datasets

Raw files live in `raw/` (git-ignored); derived files in `processed/`. `MANIFEST.json` records URL, SHA-256 and retrieval time for what was actually downloaded.

## Used: LIAR (downloaded)

- Source: https://www.cs.ucsb.edu/~william/data/liar_dataset.zip (William Yang Wang, "Liar, Liar Pants on Fire", ACL 2017).
- Retrieved 2026-10-16, SHA-256 `611c1addad919743dde15822b87a60bfb760d8f85597f25289e34621800654c7`.
- Terms (from the dataset README): research use only; original sources retain copyright; provided as is. Keep it research/academic.
- Task: statement-level truthfulness of PolitiFact claims, six labels.
- Mapping used (documented in `processed/preprocessing.json`): pants-fire/false/barely-true -> FAKE, mostly-true/true -> REAL, half-true excluded.
- Result after cleaning: train 8,136 rows, validation 1,031, test 1,013; 10 duplicate or repeated training statements, 5 validation rows and 3 test rows were removed (duplicates, or already present in an earlier split).
- Caveat: "FAKE" here means "judged false or mostly false by PolitiFact", not "from a fake-news website".

## Not downloaded (manual steps required)

| Dataset | Task | Why not automated | Where to get it |
|---|---|---|---|
| ISOT Fake News | Binary article classification | Download requires a manual request / Kaggle sign-in; its page URL returned 404 when probed | University of Victoria ISOT group (https://onlineacademiccommunity.uvic.ca/isot/), place `True.csv`, `Fake.csv` in `raw/isot/`; read its license first |
| FEVER | Evidence-based claim verification (Supported/Refuted/NotEnoughInfo) | Different task and label space; needs Wikipedia evidence retrieval | https://fever.ai/dataset/fever.html |
| SciFact | Scientific claim verification | Different task | https://github.com/allenai/scifact |
| FakeNewsNet | Article classification with social context | Article text must be re-crawled under each site's terms | https://github.com/KaiDMML/FakeNewsNet |

Labels from these datasets must **not** be merged with LIAR without a documented mapping: ISOT labels the publisher type (news site vs. flagged site), LIAR labels individual statements, FEVER/SciFact label claim-vs-evidence relations.
To add ISOT after downloading, write a new `preprocess_isot.py` that outputs the same `text,label` CSV schema and train it as a separate model; compare on its own held-out split rather than mixing.
