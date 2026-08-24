# Meta Muse Spark 1.2 RL evaluation sample

This public sample contains three deterministic, AWS-backed coding tasks and a
matched repeated-rollout comparison between Meta Muse Spark 1.2 and Claude
Opus 5. Each model has eight scored attempts per task, with complete
trajectories, final deliverables, verifier reports, and binary rewards.

The narrow result is a reliability gap in carrying multi-part business
contracts through boundary cases. It is not a universal model ranking.

| Task | Muse Spark 1.2 | Opus 5 |
| --- | ---: | ---: |
| [Task 2 — entitlement overage lines](tasks/02-entitlement-overage-lines/instruction.md) | 0/8 | 8/8 |
| [Task 4 — measurement failure DLQ](tasks/04-measurement-failure-dlq/instruction.md) | 2/8 | 8/8 |
| [Task 5 — customer communication dispatch](tasks/05-customer-communication-dispatch/instruction.md) | 5/8 | 8/8 |
| **Overall** | **7/24** | **24/24** |

Read the [verifier-backed analysis](sample-run/analysis.md) for the failure
modes, representative traces, fairness controls, and evidence limitations. The
[pass-rate matrix](sample-run/indexes/pass-rate-matrix.md) reports raw solves
separately from pass@1, pass@3, and pass@8. Plot-ready execution-time,
model-call, tool-call, token, and cost data are under
[`sample-run/metrics`](sample-run/metrics/).

## What is included

- Three runnable Harbor task packages with frozen environments and independent
  verifiers.
- Forty-eight admitted model trials: eight per model per task, with no unscored
  trial in the reported denominator.
- Native mini-SWE-agent and normalized ATIF trajectories, submitted code,
  verifier reports, reward files, and run metadata.
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
sample-run/indexes/    machine-readable trial index and pass-rate tables
sample-run/manifests/  frozen hashes, controls, and redaction records
sample-run/metrics/    generated per-trial effort and execution metrics
sample-run/analysis.md verifier-backed model comparison
```

Large workdir archives are omitted. Every admitted trial retains the final
deliverable under `verifier/deliverable/`, which is the artifact actually
graded.

## Evidence validity

The public task packages apply deterministic identifier-only normalization to
the source environments and artifacts: organization names, domains, example
accounts, task-local fake credentials, and execution-infrastructure identifiers
were replaced. Requirements, model-generated control flow, trial membership,
verifier outputs, and rewards were preserved.

The normalized tasks were rerun with both controls: each oracle scored `1.0`,
each no-op scored `0.0`, and no control raised an exception. Run
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
