# Meta Muse Spark 1.2 RL evaluation sample

This public sample contains eight deterministic, AWS-backed coding tasks and
repeated verifier-backed rollouts for Meta Muse Spark 1.2 and Claude Opus 5.
Every reported task-model cell contains eight scored attempts with native and
normalized trajectories, verifier reports, and binary rewards.

The narrow result is a reliability gap in carrying multi-part business
contracts through boundary cases. It is not a universal model ranking.

| Task | Muse Spark 1.2 | Opus 5 |
| --- | ---: | ---: |
| [Task 1: entitlement overage lines](tasks/01-entitlement-overage-lines/instruction.md) | 0/8 | 8/8 |
| [Task 2: measurement failure DLQ](tasks/02-measurement-failure-dlq/instruction.md) | 2/8 | 8/8 |
| [Task 3: customer communication dispatch](tasks/03-customer-communication-dispatch/instruction.md) | 5/8 | 8/8 |
| [Task 4: IAM role validation](tasks/04-iam-role-validation/instruction.md) | 4/8 | 8/8 |
| [Task 5: network egress metering](tasks/05-network-egress-metering/instruction.md) | 6/8 | 8/8 |
| [Task 6: API token metering](tasks/06-api-token-metering/instruction.md) | 1/8 | 7/8 |
| [Task 7: API keys and environments](tasks/07-api-keys-and-environments/instruction.md) | 2/8 | 8/8 |
| [Task 8: business settings persistence](tasks/08-business-settings-persistence/instruction.md) | 4/8 | 8/8 |
| **Overall across reported cells** | **24/64** | **63/64** |

Tasks 1 to 4 are tightly scoped changes. Tasks 5 to 8, added on August 26, 2026,
are larger feature builds: their mean prompt is 2,179 characters against 750,
and their reference change adds 451 lines against 85. Task 6 holds the only
Opus 5 failure in the sample; that trial satisfied six of the task's seven
graded rules.

Two run-configuration details differ across the sample and are recorded rather
than smoothed over. Muse reached the model through three routes:
`openrouter/meta/muse-spark-1.2` on Tasks 1 to 3, `meta/responses/muse-spark-1.2`
on Task 4, and `openai/muse-spark-1.2` on Tasks 5 to 8. Opus 5 ran on
`bedrock/us.anthropic.claude-opus-5` throughout. On Tasks 5 to 8 the two cohorts
also record different Harbor task checksums, because the packages were
repackaged between the two rollouts; see `task_checksum_note` in
[the transformation manifest](sample-run/manifests/public-transformation.json)
for the equivalence check that accompanies them.

Read the [verifier-backed analysis](sample-run/analysis.md) for the failure
modes, representative traces, fairness controls, and evidence limitations. The
[pass-rate matrix](sample-run/indexes/pass-rate-matrix.md) reports raw solves
separately from pass@1, pass@3, and pass@8. Plot-ready execution-time,
model-call, tool-call, token, and cost data are under
[`sample-run/metrics`](sample-run/metrics/).

## What is included

- Eight runnable Harbor task packages with frozen environments and independent
  verifiers.
- One hundred twenty-eight admitted model trials across sixteen Muse and Opus
  cells. No scored cohort includes an incomplete attempt.
- Native mini-SWE-agent, normalized ATIF, and text trajectories, submitted code
  where included, verifier reports, reward files, and run metadata.
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
sample-run/trajectories/ all 128 trials by task, model, and attempt
sample-run/indexes/    machine-readable trial index and pass-rate tables
sample-run/manifests/  frozen hashes, controls, and redaction records
sample-run/metrics/    generated per-trial effort and execution metrics
sample-run/analysis.md verifier-backed model comparison
```

All 128 advertised trials use the same
`sample-run/trajectories/<task>/<model>/trial-XX` layout and include native,
ATIF, and text trajectories. Every task except Task 4 includes the submitted
deliverable under `verifier/deliverable/`. Task 4 keeps the remaining evidence
without duplicated submitted-code snapshots; its text views are deterministic
renders of the native public JSON trajectories. Tasks 5 and 7 record their
per-rule verifier outcome in `verifier/reward-detail.json` rather than
`verifier/report.txt`.

## Evidence validity

The public task packages apply deterministic identifier-only normalization to
the source environments and artifacts: organization names, domains, example
accounts, task-local fake credentials, and execution-infrastructure identifiers
were replaced. Requirements, model-generated control flow, trial membership,
verifier outputs, and rewards were preserved.

Tasks 1 to 4 have both controls recorded against their published packages: each
oracle scored `1.0`, each no-op scored `0.0`, and no recorded control raised an
exception.

Tasks 5 to 8 are published without control records. Their reference solutions are
included under `tasks/<task>/solution/`, and every one of those tasks was solved
by at least one scored trial, but the oracle and no-op runs have not yet been
executed against the published packages. That is the outstanding publication step
for those four tasks, and it is marked pending in
[the execution summary](sample-run/indexes/execution-summary.json) and the
transformation manifest so the gap is not mistaken for a completed control. The sequential
folder names do not change the byte-identical executable files covered by those
controls. Task 4's controlled source additionally differs only in README
documentation. Run
`python3 harness/validate_publication.py` to check the complete public file set,
trial cells, generated metrics, hashes, links, controls, and privacy gates.

Task 3 has one additional evidence-boundary note: the eight displayed Opus
trajectories are a documented subset of 24 measured attempts. All eight
displayed trials passed; the full measurement was 23/24. Tasks 1 and 2 include
every Opus attempt measured for their cells. This distinction is carried into
the [analysis](sample-run/analysis.md#evidence-boundary) so the repository does
not present the displayed Task 3 subset as a prospective estimate.

## Reproduction

See [HANDOFF.md](HANDOFF.md) for prerequisites, credential separation, control
execution, cohort launch, index regeneration, and final QC.
