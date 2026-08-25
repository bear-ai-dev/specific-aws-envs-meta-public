# Matched eight-run cohort analysis

## Cohort result

This sample evaluates four frozen tasks. Muse Spark 1.2 and Opus 5 each have
eight trials per task. All 64 reported trials have a numeric reward, native and
normalized trajectories, a verifier report, and no Harbor exception.

| Task | Model | Solves | Interpretation |
| --- | --- | ---: | --- |
| [Task 2: entitlement overage lines](../tasks/02-entitlement-overage-lines/instruction.md) | Muse Spark 1.2 | 0/8 | Comparator-reachable full failure |
| [Task 2: entitlement overage lines](../tasks/02-entitlement-overage-lines/instruction.md) | Opus 5 | 8/8 | Consistent solving comparator |
| [Task 4: measurement failure DLQ](../tasks/04-measurement-failure-dlq/instruction.md) | Muse Spark 1.2 | 2/8 | Solves, with six preservation failures |
| [Task 4: measurement failure DLQ](../tasks/04-measurement-failure-dlq/instruction.md) | Opus 5 | 8/8 | Consistent solving comparator |
| [Task 5: customer communication dispatch](../tasks/05-customer-communication-dispatch/instruction.md) | Muse Spark 1.2 | 5/8 | Solves, with three repeated draft-selection failures |
| [Task 5: customer communication dispatch](../tasks/05-customer-communication-dispatch/instruction.md) | Opus 5 | 8/8 | Eight solving trials |
| [Task 14: IAM role validation](../tasks/14-iam-role-validation/instruction.md) | Muse Spark 1.2 | 4/8 | Four repeated omitted-field boundary failures |
| [Task 14: IAM role validation](../tasks/14-iam-role-validation/instruction.md) | Opus 5 | 8/8 | Consistent solving comparator |

The [full matrix](indexes/pass-rate-matrix.md) keeps raw solves separate from
pass@1, pass@3, and pass@8. Across the reported cells, the aggregate stored
result is 11/32 for Muse and 32/32 for Opus.

Task 14 extends the original three-task sample and meets this release's
inclusion threshold of Muse at or below 50% (`4/8`). The original three tasks
remain in the sample unchanged.

## Observed model difference

The evidence supports a specific reliability difference: Muse less
consistently preserves every branch of a multi-part business contract when a
task combines normal behavior with zero-value visibility, duplicate delivery,
error sanitization, primary-versus-backup recipient rules, or optional nested
settings fields.

This is not evidence that Muse lacks the underlying coding or AWS capability.
It solved Task 4 twice, Task 5 five times, and Task 14 four times. Those
counterexamples implement the same behaviors that the failing trials miss.
Opus was a consistent solving comparator on the stored task variants.

## Trial evidence

The [machine-readable trial index](indexes/trials.json) resolves every admitted
trial to its native trajectory, normalized trajectory, verifier report,
reward, and submitted deliverable where included. The generated
[per-trial metrics](metrics/) add recorded duration, model-call, tool-call,
token, and cost fields for every one of those 64 trials. They are descriptive
effort measures, not causal evidence for the failure modes below.

| Task | Muse Spark 1.2 | Opus 5 |
| --- | --- | --- |
| Task 2 | [eight trials](trajectories/02-entitlement-overage-lines/muse-spark-1.2/) | [eight trials](trajectories/02-entitlement-overage-lines/opus-5/) |
| Task 4 | [eight trials](trajectories/04-measurement-failure-dlq/muse-spark-1.2/) | [eight trials](trajectories/04-measurement-failure-dlq/opus-5/) |
| Task 5 | [eight trials](trajectories/05-customer-communication-dispatch/muse-spark-1.2/) | [eight trials](trajectories/05-customer-communication-dispatch/opus-5/) |
| Task 14 | [eight trials](trajectories/14-iam-role-validation/muse-spark-1.2/) | [eight trials](trajectories/14-iam-role-validation/opus-5/) |

## Failure-mode analysis

### Task 2: chargeability and invoice visibility were not kept independent

The prompt requires both an owed-quantity calculation and a separate decision
about whether a dimension should appear on an invoice. Zero-priced dimensions
can remain visible even when their owed quantity is zero.

Six Muse trials omitted the same four or five required lines in the held-out
Solstice cases. One additional trial added three lines whose visibility setting
required them to be hidden. The eighth trial regressed an existing usage-service
call and failed before completing the business logic. The dominant seven-trial
pattern is an incomplete decision table, not a missing ability to calculate
allowances.

- [Representative missing-line report](trajectories/02-entitlement-overage-lines/muse-spark-1.2/trial-07/verifier/report.txt)
- [Representative extra-line report](trajectories/02-entitlement-overage-lines/muse-spark-1.2/trial-04/verifier/report.txt)
- [Runtime-regression report](trajectories/02-entitlement-overage-lines/muse-spark-1.2/trial-08/verifier/report.txt)

All eight Opus trials passed the same held-out matrix. This supports a narrow
gap in translating coupled quantity and visibility requirements into a complete
branch table.

### Task 4: persistence was added without all durability and privacy invariants

The task requires every rejected datastore message to be written once per
delivery, including redeliveries, while never overwriting an earlier record. It
also requires useful error metadata without a stack trace and an orphan prefix
when no source key exists.

All six failing Muse trials implemented a DLQ write, but missed at least one
preservation invariant:

- Two trials used the original source key as the object key. Their objects were
  not distinct per delivery, and the verifier could not account for the
  expected source-derived records.
- One trial left only one object after two deliveries of the same source.
- Three trials produced distinct objects but kept stack traces in redelivery
  and orphan records.

The [representative failed implementation](trajectories/04-measurement-failure-dlq/muse-spark-1.2/trial-05/verifier/deliverable/usage/usage.controller.ts)
uses the source key directly. A [solving Muse implementation](trajectories/04-measurement-failure-dlq/muse-spark-1.2/trial-02/verifier/deliverable/usage/usage.controller.ts)
adds a unique suffix and removes the stack. The two Muse passes show the task is
reachable; the six failures show inconsistent completion of durability and
privacy invariants around an otherwise-correct S3 write.

### Task 5: every draft was sent instead of only the primary draft

The event payload can carry primary and backup drafts. The contract requires
only the first draft from each communication to be sent. All three failing Muse
trials iterated over every draft, producing exactly the same three extra
messages: the backup accounts-payable, CFO, and procurement recipients.

The [representative failed implementation](trajectories/05-customer-communication-dispatch/muse-spark-1.2/trial-03/verifier/deliverable/customer/entities/customerCommunication.entity.ts)
loops over `request.data`. A [solving Muse implementation](trajectories/05-customer-communication-dispatch/muse-spark-1.2/trial-05/verifier/deliverable/customer/entities/customerCommunication.processor.ts)
selects `request.data[0]`. Both correctly build SES source, reply-to, UTF-8,
body, and configuration-set fields. The failure is therefore a precise
primary-versus-fallback selection error, not general SES unfamiliarity.

### Task 14: an omitted cloud block was mistaken for an invalid block

The settings endpoint must validate a supplied IAM role before writing, but an
ordinary update that carries no `cloudIAM` block must pass through unchanged.
All four failing Muse trials rejected the same city-only update with status 400
and left the city unwritten. Every other held-out case in those verifier reports
passed.

The repeated implementation error was checking whether `cloudIAM` was present
as a property on the framework-transformed DTO. The validation pipeline can
materialize an omitted optional field as `cloudIAM: undefined`, so a property
presence test enters the validation branch and rejects it. The passing
implementations instead guard on `updatedFields.cloudIAM !== undefined`.

This is a narrow optional-field boundary error, not an IAM capability failure:
the failing trials successfully implemented role assumption, external-ID,
EC2 inventory, disconnect, and atomic rejection behavior. Four Muse
counterexamples handled the omitted field correctly, and all eight Opus trials
passed the full 21-save sequence.

- [Representative omitted-field failure](trajectories/14-iam-role-validation/muse-spark-1.2/trial-01/verifier/report.txt)
- [Representative solving report](trajectories/14-iam-role-validation/opus-5/trial-01/verifier/report.txt)

## Fairness and reachability

Each instruction states that a local AWS-compatible endpoint is already
available through `AWS_ENDPOINT_URL`, with task credentials and region in the
shell. Held-out verifier data is root-only. The public harness checks the exact
agent shell's local AWS reachability before model execution and keeps Bedrock
credentials separate from task credentials.

Every normalized public task has an oracle score of `1.0` and a no-op score of
`0.0`, with no recorded exception. Tasks 2, 4, and 5 were rerun through Harbor
0.18.0 in Docker on 2026-08-24. Task 14 reuses the 2026-08-19 control from a
public task tree whose executable files are byte-identical; the current tree
differs only in README documentation. Trial IDs, reuse basis, and task digests
are in the [control manifest](manifests/public-controls-validation.json).

Within each task, the stored model trials used the same mini-SWE-agent version,
reasoning setting, task package, verifier logic, and eight-attempt cell size.
They used different model providers. Tasks 2, 4, and 5 routed Muse through
OpenRouter, while Task 14 routed Muse through Meta's Responses API. The Task 14
cells used the same high reasoning setting and 32,768-token output allowance.
Provider stacks remain an inference-condition difference and the results should
be read as end-to-end agent configurations, not provider-normalized model
internals.

## Evidence boundary

These conclusions are limited to the stored prompts, frozen task variants,
trajectories, verifier outcomes, and controls. Four tasks and eight eight-run
cells do not establish a universal model ranking, and pass@8 reaching `1.0` for
a cell with any solve should not be read as eight raw solves.

Tasks 2 and 4 include all eight Opus attempts measured for the reported cells.
For Task 5, the repository shows eight solving Opus trials from 24 measured
attempts; the full measurement was 23/24. The table reports the displayed
evidence subset as 8/8 and does not treat it as a prospective eight-trial
estimate. This selection boundary is why the repeated verifier-backed Muse
failure mode, rather than Task 5's Opus percentage, is the defensible result.
