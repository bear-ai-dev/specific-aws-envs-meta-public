# Canonical trajectories

This directory contains all 64 trials advertised in the repository README:
eight each for Muse Spark 1.2 and Opus 5 across four tasks. Attempts are ordered
chronologically by the recorded agent start timestamp within each task-model
cell.

Each `trial-*` directory includes the available native mini-SWE-agent
trajectory, normalized ATIF trajectory, Harbor result, verifier report, reward,
logs, and run metadata. The native `result.json` preserves the recorded trial
identifier and provider route; the public index maps those identifiers to this
canonical layout.

Tasks 2, 4, and 5 also include the submitted deliverable. Task 14 omits its
duplicated full submitted-code snapshots; each reward is independently present
in the Harbor result and verifier reward document, while the verifier report
records the observable held-out outcome.

Use the repository-level commands to regenerate and validate all indexes and
metrics:

```sh
python3 harness/summarize_cohort.py
python3 harness/freeze_manifest.py
python3 harness/export_trial_metrics.py
python3 harness/validate_publication.py
```
