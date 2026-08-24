# Task 4 — measurement failure DLQ

A feature-removal task cut from a real NestJS TypeScript backend
(`meteringco-src/extracted/top-up-billing-lifecycle`, 534 `.ts` files, 87 runtime
dependencies). The agent works in the actual repository, not a purpose-built
skeleton, and there is no specification document anywhere in the box.

## What was taken out

The private `/usage/db` endpoint is how measurements harvested from a
customer's datastore reach the platform: an object lands in the ingestion
bucket, something posts its bytes and its key, and the endpoint parses the
bytes, validates them against the measurement DTO and stores the record. When
any of that fails the endpoint answers `400`.

What the workspace ships without is everything that happens between the failure
and that `400`: the S3 dead-letter writer, and the wiring that sent this
endpoint's failures to it. The remaining `dbUsage` logs the error and rejects
the request, which is a coherent implementation of a world where a message the
platform cannot read is simply a bad request — which is what the code reads
like, not like something with a hole in it.

| file | change vs upstream |
| --- | --- |
| `src/measurement-config/entities/standardMeasurement.entity.ts` | −29 / +0: the `DlqType.s3` branch of `publishFailureToDLQ` (the client, the key, the envelope, and the swallow-and-audit around the write), the `s3` member of `DlqType`, and the now-unused `@aws-sdk/client-s3` import |
| `src/usage/usage.controller.ts` | −15 / +1: `dbUsage`'s catch loses the `publishFailureToDLQ` call and the `e.stack = undefined` that preceded it; the rejection message drops its reference to a DLQ that no longer exists |

Nothing else moved. The Kafka branch of `publishFailureToDLQ`, the
`MeasurementFailureMetadata` class, the `datastoreUsage` call site that uses
them, and the whole parse-and-validate path in `dbUsage` are exactly what
upstream had. That is deliberate: the Kafka branch is a different capability
that nothing in this task removes, and it is also the one sibling implementation
an agent can read.

There are no stubs, no `TODO`s about the absent behaviour, no commented-out
code, no `not supported` throws, and no `.git` directory. The `TODO`s that
remain in the controller (`check if the passed in BusinessID is an authorized
producer`, `make this a standardized parser`) are upstream's own and predate the
task. The string `meteringco-unknown` appears nowhere the agent can read except in
the sandbox objects themselves.

## Where the rules live

No single file states the rule set. `DISCOVERABILITY.md` maps every graded rule
to its route and evidence; in summary:

| source | what it yields |
| --- | --- |
| `instruction.md` | the bucket, that the record is filed under the source file, that it is held as it arrived, that it says why it failed, that redelivery must not overwrite, that orphans are kept, that the caller still gets a rejection even when the store refuses the write, and that the Kafka intake is not this task's business |
| `src/measurement-config/entities/measurement-config.entity.ts` | `dlq: s3://${DB_MEASUREMENT_DLQ_BUCKET_NAME}/${businessID}` and an IAM statement scoping a business to `${DLQ_BUCKET}/${businessID}/*` — so a record has to sit under its business' prefix to be readable by the business |
| `MeasurementFailureMetadata` in `standardMeasurement.entity.ts` | `orginalProcessedName`, documented as "the processed name from the system where the measurement occured / In S3 its the complete fileName" |
| the Kafka branch of `publishFailureToDLQ` | the `{ failedDocument, metadata }` envelope, and that a dead-letter writer swallows its own failure rather than propagating it |
| `datastoreUsage`'s catch | `e.stack = undefined` immediately before the record is built |
| the sandbox dead-letter bucket | the key shape, the `meteringco-unknown/` prefix for orphans, a source object with two records, and what a validation failure's `errorInfo` looks like |
| `CreateStandardMeasurementDto` | which messages can be loaded at all |

An agent that reads only `dbUsage` sees a `catch` and a `400`, and will write a
`PutObject` keyed by a fresh UUID. That is the second-to-last mutant in the
table below, and it scores 0.0.

## How it is graded

`tests/test.sh` stops the agent-facing endpoint, restarts the emulator on a
held-out world, drops a root-owned driver into `/app`, and hands the submitted
intake eleven requests over two phases. It never trusts an exit code or stdout:
the driver only writes down what the *caller* of the endpoint was told, and the
object store is read afterwards by root, straight off the emulator, once the
submission's process has exited.

`tests/compute_reward.py` runs as root, loads no submitted code, and decides for
itself which of those requests could have been turned into a usage record —
parsing each message and applying the constraints `CreateStandardMeasurementDto`
declares — and therefore which of them had to leave a record behind, under what
key and with what content. Reward is 1.0 only if every one of the thirteen
graded rules holds.

The bucket names the verifier passes are not the ones the sandbox used, so a
submission that hardcodes what it saw scores zero.

| case | held-out example | correct outcome |
| --- | --- | --- |
| message loads | `biz-arclight/…/usage-004411.json` | stored, nothing written to the dead-letter bucket |
| message loads, with metadata | `biz-westmoor/…/usage-000097.json` | stored, nothing written |
| unparseable bytes | truncated JSON for `…/usage-004412.json` | one record under that key |
| the same file redelivered | the same bytes again | a *second* record under that key, the first intact |
| timestamp not RFC 3339 | `04/05/2026 11:15` | one record, holding the message as sent |
| customer missing | no `customerId` | one record |
| value not a number string | `"several"` | one record |
| no source file at all | body carries only `message` | one record under `meteringco-unknown/` |
| blank source file | `s3Key: ""`, non-JSON body | one record under `meteringco-unknown/`, distinct from the above |
| Kafka-fed intake fails | `/usage/datastore` with broken `event.original` | rejected, and **nothing** in this bucket |
| dead-letter store refuses | second phase, world served without the bucket | still `400 BadRequest`, not an S3 error |

Measured locally against the real driver, the real held-out worlds and the real
scorer, each candidate applied to a fresh copy of the workspace:

| candidate | reward |
| --- | --- |
| reference solution (`solution/solve.sh`) | **1.0** |
| starting workspace, unchanged | **0.0** |
| separate dead-letter module, `.`-separated key suffix, hand-built error info | **1.0** |
| one record per source file (later failure overwrites the earlier) | 0.0 |
| stores the parsed document instead of the bytes that arrived | 0.0 |
| records the error whole, stack included | 0.0 |
| drops failures that name no source file | 0.0 |
| writes back to the ingestion bucket | 0.0 |
| lets a refused write escape to the caller | 0.0 |
| sends the Kafka-fed intake's failures to the same bucket | 0.0 |
| keys each record by a fresh UUID | 0.0 |
| keys each record by the source file's base name only | 0.0 |

Every candidate was driven under `env -i` so no host AWS config or `HOME` can
leak in, and every reward came from `tests/compute_reward.py` unmodified.

## Sandbox vs held-out world

The box serves `/opt/dlq-sandbox/public.json`: one platform account, two
buckets, three source objects across two businesses, and five records of past
intake failures. Every case class the grader distinguishes is present in kind —
unparseable bytes, two flavours of validation failure, one source object that
failed twice, and one failure with no source object at all.

The held-out world is a different account, differently named buckets, two
different businesses, and a dead-letter bucket that starts empty; the second
phase serves the same world with no dead-letter bucket at all. Passing locally
is not evidence of passing the grade, and the bucket names arrive through the
environment in both.

## Layout

```
environment/Dockerfile          image: node 22, python 3, the repo at /app
environment/task-init.sh        starts the emulated endpoint on :4566
environment/workspace/          the repository, capability removed
environment/mockaws/            task-owned copy of the emulated control plane
environment/sandbox/            world-readable fixture + sandbox notes
environment/verifier-data/      root-only: held-out worlds, intake spec, driver
environment/gen_scenarios.py    regenerates every scenario document
instruction.md                  the prompt (718 characters, one paragraph)
DISCOVERABILITY.md              one row per graded rule, route and evidence
solution/solution.patch         the oracle (2 files, +44 / −1)
tests/test.sh                   verifier entry point
tests/compute_reward.py         trusted scorer with its own reference model
```

`environment/mockaws/` is the task-owned vendored copy and is byte-identical to
the reference task's for every service this task touches; nothing in it was
changed for this task.

## Regenerating

```
python3 environment/gen_scenarios.py \
    --out-dir environment/sandbox \
    --verifier-dir environment/verifier-data
```

This rewrites `environment/sandbox/public.json` and the three files under
`environment/verifier-data/` other than `drive.ts`. The generator never enters
the image.
