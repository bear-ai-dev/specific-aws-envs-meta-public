# Meta Muse Spark 1.2 RL evaluation sample

This public sample contains four deterministic, AWS-backed coding tasks and
repeated verifier-backed rollouts for Meta Muse Spark 1.2, Claude Opus 5, and,
on the newly added task, GPT-5.6 Sol. Every reported task-model cell contains
eight scored attempts with native and normalized trajectories, verifier
reports, and binary rewards.

The narrow result is a reliability gap in carrying multi-part business
contracts through boundary cases. It is not a universal model ranking.

| Task | Muse Spark 1.2 | GPT-5.6 Sol | Opus 5 |
| --- | ---: | ---: | ---: |
| [Task 2 — entitlement overage lines](tasks/02-entitlement-overage-lines/instruction.md) | 0/8 | — | 8/8 |
| [Task 4 — measurement failure DLQ](tasks/04-measurement-failure-dlq/instruction.md) | 2/8 | — | 8/8 |
| [Task 5 — customer communication dispatch](tasks/05-customer-communication-dispatch/instruction.md) | 5/8 | — | 8/8 |
| [Task 14 — IAM role validation](tasks/14-iam-role-validation/instruction.md) | 4/8 | 3/8 | 8/8 |
| **Overall across reported cells** | **11/32** | **3/8** | **32/32** |

Task 14 is the only addition from the latest six-task screening cohort that met
the publication rule of a Muse solve rate at or below 50% (`4/8`). The three
earlier public tasks predate that gate and remain unchanged for continuity.

Read the [verifier-backed analysis](sample-run/analysis.md) for the failure
modes, representative traces, fairness controls, and evidence limitations. The
[pass-rate matrix](sample-run/indexes/pass-rate-matrix.md) reports raw solves
separately from pass@1, pass@3, and pass@8. Plot-ready execution-time,
model-call, tool-call, token, and cost data are under
[`sample-run/metrics`](sample-run/metrics/).

## What is included

- Four runnable Harbor task packages with frozen environments and independent
  verifiers.
- Seventy-two admitted model trials across nine task-model cells, with no
  unscored trial in the reported denominator.
- Native mini-SWE-agent and normalized ATIF trajectories, retained submitted
  code where included, verifier reports, reward files, and run metadata.
- Reproducible per-trial execution, call, token, and cost metrics in CSV and
  JSON, plus machine-readable cohort summaries.
- Oracle and no-op control configuration, post-normalization control results,
  task digests, a frozen cohort manifest, and an automated publication check.
- A reproduction harness for Harbor 0.18.0 and mini-SWE-agent 2.4.5.

## Repository map

```text
tasks/                 public task packages and frozen verifiers
harness/               cohort, controls, indexing, and publication validation
shared/                deterministic local AWS-compatible task runtime
sample-run/raw/        complete admitted model-trial evidence
sample-run/trajectories/ canonical Task 14 evidence by model and attempt
sample-run/indexes/    machine-readable trial index and pass-rate tables
sample-run/manifests/  frozen hashes, controls, and redaction records
sample-run/metrics/    generated per-trial effort and execution metrics
sample-run/analysis.md verifier-backed model comparison
```

Large workdir archives are omitted. The original 48-trial cohort retains the
submitted deliverable under `verifier/deliverable/`. The 24 Task 14 trials use
a compact canonical layout that retains native and ATIF trajectories, results,
verifier reports, rewards, logs, and run metadata; duplicated submitted-code
snapshots remain in the private source archive.

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

Task 5 has one additional evidence-boundary note: the eight stored Opus trials
are a documented retained slice of 24 measured attempts. All eight retained
trials passed; the full measurement was 23/24. Tasks 2 and 4 retain every Opus
attempt measured for their cells. This distinction is carried into the
[analysis](sample-run/analysis.md#evidence-boundary) so the repository does not
present the retained Task 5 slice as a prospective estimate.

## Reproduction

See [HANDOFF.md](HANDOFF.md) for prerequisites, credential separation, control
execution, cohort launch, index regeneration, and final QC.
