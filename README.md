# Meta Muse Spark 1.2 RL evaluation sample

This public sample contains four deterministic, AWS-backed coding tasks and
repeated verifier-backed rollouts for Meta Muse Spark 1.2 and Claude Opus 5.
Every reported task-model cell contains eight scored attempts with native and
normalized trajectories, verifier reports, and binary rewards.

The narrow result is a reliability gap in carrying multi-part business
contracts through boundary cases. It is not a universal model ranking.

| Task | Muse Spark 1.2 | Opus 5 |
| --- | ---: | ---: |
| [Task 2: entitlement overage lines](tasks/02-entitlement-overage-lines/instruction.md) | 0/8 | 8/8 |
| [Task 4: measurement failure DLQ](tasks/04-measurement-failure-dlq/instruction.md) | 2/8 | 8/8 |
| [Task 5: customer communication dispatch](tasks/05-customer-communication-dispatch/instruction.md) | 5/8 | 8/8 |
| [Task 14: IAM role validation](tasks/14-iam-role-validation/instruction.md) | 4/8 | 8/8 |
| **Overall across reported cells** | **11/32** | **32/32** |

Task 14 extends the original three-task sample. Its Muse solve rate is exactly
the release's inclusion threshold of 50% (`4/8`). The original three tasks
remain unchanged for continuity.

Read the [verifier-backed analysis](sample-run/analysis.md) for the failure
modes, representative traces, fairness controls, and evidence limitations. The
[pass-rate matrix](sample-run/indexes/pass-rate-matrix.md) reports raw solves
separately from pass@1, pass@3, and pass@8. Plot-ready execution-time,
model-call, tool-call, token, and cost data are under
[`sample-run/metrics`](sample-run/metrics/).

## What is included

- Four runnable Harbor task packages with frozen environments and independent
  verifiers.
- Sixty-four admitted model trials across eight Muse and Opus cells. No scored
  cohort includes an incomplete attempt.
- Native mini-SWE-agent and normalized ATIF trajectories, submitted
  code where included, verifier reports, reward files, and run metadata.
- Reproducible per-trial execution, call, token, and cost metrics in CSV and
  JSON, plus machine-readable cohort summaries.
- Oracle and no-op control configuration, post-normalization control results,
  task digests, a frozen cohort manifest, and a local validation script.
- A reproduction harness for Harbor 0.18.0 and mini-SWE-agent 2.4.5.

## Repository map

```text
tasks/                 public task packages and frozen verifiers
harness/               cohort, controls, indexing, and publication validation
shared/                deterministic local AWS-compatible task runtime
sample-run/trajectories/ all 64 trials by task, model, and attempt
sample-run/indexes/    machine-readable trial index and pass-rate tables
sample-run/manifests/  frozen hashes, controls, and redaction records
sample-run/metrics/    generated per-trial effort and execution metrics
sample-run/analysis.md verifier-backed model comparison
```

All 64 advertised trials use the same
`sample-run/trajectories/<task>/<model>/trial-XX` layout. Tasks 2, 4, and 5
include the submitted deliverable under `verifier/deliverable/`. Task 14 keeps
the native and ATIF trajectories, results, verifier reports, rewards, logs, and
run metadata without duplicated submitted-code snapshots.

## Evidence validity

The public task packages apply deterministic identifier-only normalization to
the source environments and artifacts: organization names, domains, example
accounts, task-local fake credentials, and execution-infrastructure identifiers
were replaced. Requirements, model-generated control flow, trial membership,
verifier outputs, and rewards were preserved.

Every normalized task has both controls: each oracle scored `1.0`, each no-op
scored `0.0`, and no recorded control raised an exception. Task 14 reuses a
control record whose executable task files are byte-identical to this package;
only its README changed. Run
`python3 harness/validate_publication.py` to check the complete public file set,
trial cells, generated metrics, hashes, links, controls, and privacy gates.

Task 5 has one additional evidence-boundary note: the eight displayed Opus
trajectories are a documented subset of 24 measured attempts. All eight
displayed trials passed; the full measurement was 23/24. Tasks 2 and 4 include
every Opus attempt measured for their cells. This distinction is carried into
the [analysis](sample-run/analysis.md#evidence-boundary) so the repository does
not present the displayed Task 5 subset as a prospective estimate.

## Reproduction

See [HANDOFF.md](HANDOFF.md) for prerequisites, credential separation, control
execution, cohort launch, index regeneration, and final QC.
