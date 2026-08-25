# Canonical Task 14 trajectories

This directory contains the 24 admitted Task 14 trials: eight each for Muse
Spark 1.2, GPT-5.6 Sol, and Opus 5. Attempts are ordered chronologically by the
recorded agent start timestamp within each model cell.

Each `trial-*` directory retains the available native mini-SWE-agent
trajectory, normalized ATIF trajectory, Harbor result, verifier report, reward,
logs, and run metadata. The native `result.json` preserves the recorded trial
identifier and provider route; the public index maps those identifiers to this
canonical layout.

Duplicated full submitted-code snapshots are omitted from this compact public
copy. They are not needed to recompute the published scores: each reward is
independently present in the Harbor result and verifier reward document, while
the verifier report records the observable held-out outcome.

Use the repository-level commands to regenerate and validate all indexes and
metrics:

```sh
python3 harness/summarize_cohort.py
python3 harness/freeze_manifest.py
python3 harness/export_trial_metrics.py
python3 harness/validate_publication.py
```
