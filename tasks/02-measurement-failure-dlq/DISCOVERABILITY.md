# Discoverability

One row per rule the grader decides on. Every rule reaches the agent by at
least one of the three routes: **stated** in `instruction.md`, **derivable**
from code in `/app`, or **observable** in the sandbox the emulator serves.

Nothing below is graded that cannot be reached by one of them. Where a rule has
more than one route, all of them are listed, because a route that only just
carries a rule is a route that can fail.

| # | Graded rule | Route | Exact evidence |
| --: | --- | --- | --- |
| 1 | A message the intake cannot load leaves a record in the bucket named by `DB_MEASUREMENT_DLQ_BUCKET_NAME`, not in the ingestion bucket and not under a fixed name | stated · derivable · observable | Prompt: "every message it cannot load belongs in the dead-letter bucket the platform was given". `src/measurement-config/entities/measurement-config.entity.ts` returns `dlq: \`s3://${process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME}/${businessID}\`` from `setupAccess` and `updateAccess`, and grants the customer role `arn:aws:s3:::${process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME}/*`. The project `README.md` lists both bucket variables in its `.env` sample. The sandbox serves both buckets and only the dead-letter one holds failure records. |
| 2 | A message that does load leaves nothing behind and is not rejected | stated · observable | Prompt scopes the behaviour to "every message it **cannot** load". Driving `/usage/db` in the sandbox with a well-formed message writes nothing. |
| 3 | The record is filed under the source object's complete key: the object key begins with the incoming `s3Key`, is longer than it, and ends `.json` | derivable · observable · stated | `MeasurementFailureMetadata.orginalProcessedName` in `standardMeasurement.entity.ts` carries the doc comment "This is the processed name from the system where the measurement occured / In S3 its the complete fileName". `setupAccess` scopes a business to `arn:aws:s3:::${DLQ_BUCKET}/${businessID}/*`, and `dbUsage` takes `businessID` from the first segment of `s3Key`, so a record outside that prefix is unreadable by its owner. Every sandbox record is keyed `<source key>-<suffix>.json`. Prompt: "filed under the source file it came from so the owning business can reach it". |
| 4 | Two failures of the same source object leave two distinct records; the second does not overwrite the first | stated · observable | Prompt: "never overwriting an earlier failure of the same file". The sandbox holds two records for one source object: `biz-cadence/2026/02/03/usage-000117.json-k3f9a1.json` and `…-9wq2mz.json`, same `originalFileContent`, different keys and times. |
| 5 | A request with no usable `s3Key` (absent or empty) is still kept, filed under the `meteringco-unknown/` prefix | observable · stated | The sandbox holds `meteringco-unknown/1f5c9d2e-8a41-4f2b-9c07-6b3e5a0d1122-h2k8vq.json`, whose `failedDocument` carries no `s3Key`; it is the only record not under a business prefix. Prompt states the keeping ("Messages with no source file must be kept too"); the sandbox is what names the prefix. |
| 6 | `metadata.orginalProcessedName` is the name the record was filed under — the key starts with it, and it equals the source key when there is one | observable · derivable | In all five sandbox records the key is `orginalProcessedName` plus a suffix. The field and its doc comment are in `standardMeasurement.entity.ts`, which the workspace still ships. |
| 7 | `failedDocument.originalFileContent` is the message exactly as it arrived, as a string, not a re-serialised document | stated · observable | Prompt: "held exactly as it arrived". The sandbox record `…usage-000117.json-k3f9a1.json` holds an unterminated JSON fragment, which no parsed document could round-trip to; another holds a document whose spacing and key order differ from what a re-serialise would emit. |
| 8 | `failedDocument.s3Key` names the source object, and is absent when there was none | observable · derivable | Four sandbox records carry it, the `meteringco-unknown/` one does not. The surviving `datastoreUsage` call site builds the same `{ failedDocument, metadata }` envelope, and the Kafka branch serialises it with `JSON.stringify({ failedDocument: failedDocument, metadata })`. |
| 9 | The record says why the message failed: `metadata.errorInfo` non-empty, plus `metadata.results` and an ISO `metadata.timestamp` | stated · observable | Prompt: "saying why it failed". Every sandbox record carries all three. Two of them show what a *validation* failure records: `validateOrReject` rejects with a **list** of `ValidationError`s rather than an `Error`, and those two records hold that list verbatim — `target`, `value`, `property`, `constraints`. An implementation that reads only `error.name` and `error.message` can see from them that it would be storing `{}` for exactly those failures. |
| 10 | The record carries no stack trace | derivable · observable | `datastoreUsage` in the workspace still runs `e.stack = undefined;` immediately before handing the failure to `publishFailureToDLQ`. No sandbox record contains a `stack` field. |
| 11 | After the record is written the caller is still told the message was rejected (HTTP 400 / `BadRequestException`) | stated · derivable | Prompt: "Callers are still told the message was rejected". The `throw new BadRequestException(...)` at the end of the `dbUsage` catch is untouched in the workspace. |
| 12 | A dead-letter store that refuses the write does not change what the caller is told | stated · derivable | Prompt: "a store refusing the write must not change that". The Kafka branch of `publishFailureToDLQ` wraps its own write in `try/catch`, publishes an audit event and `return`s rather than propagating — the dead-letter writer is a best-effort sink, not part of the request's success path. |
| 13 | Failures of the Kafka-fed `/usage/datastore` intake leave nothing in this bucket | stated · derivable | Prompt: "The Kafka-fed intake keeps its own arrangement". That call site in `usage.controller.ts` passes `DlqType.kafka` and the Kafka branch of `publishFailureToDLQ` is intact; nothing about it needs changing. |

## Cases the grader distinguishes, and where each is present in the sandbox

| Case | Present in the sandbox as |
| --- | --- |
| message loads cleanly | source objects in the ingestion bucket, and no dead-letter record for them |
| message is not parseable JSON | `…usage-000117.json-k3f9a1.json` (truncated content, `SyntaxError`) |
| message parses but fails the measurement constraints | `…usage-000204.json-b7t4xd.json` (timestamp) and `…usage-000031.json-m4p1cs.json` (record value) |
| same source object fails twice | the `usage-000117.json` pair |
| message with no source object | `meteringco-unknown/1f5c9d2e-…-h2k8vq.json` |
| a second business | `biz-lumen/2026/02/12/usage-000031.json-m4p1cs.json` |
| dead-letter store refuses the write | **not** present as data. Stated in the prompt, derivable from the Kafka branch, and reproducible on the box: the sandbox README explains how to restart the emulator on a world of your own, which is how to serve one without the bucket. |

## Nothing in the workspace points the other way

Checked before declaring done:

- No surviving helper writes to the ingestion bucket on failure, or keys a
  failure record by anything other than the source object's name.
- `MeasurementFailureMetadata` is intact, so the only in-repo description of
  `orginalProcessedName` agrees with what is graded.
- The Kafka branch of `publishFailureToDLQ` is upstream's, unmodified; it is the
  one sibling implementation an agent will read, and it agrees with the graded
  envelope rather than contradicting it.
- `grep -ri "meteringco-unknown"` over the workspace returns nothing, so the prefix
  is reached from the sandbox rather than from a stale string in the tree.
