# Task 2 — entitlement overage lines

A feature-removal task cut from a real NestJS TypeScript backend
(`meteringco-src/extracted/top-up-billing-lifecycle`, 534 `.ts` files, 87 runtime
dependencies). The agent works in the actual repository, not a purpose-built
skeleton, and there is no specification document anywhere in the box.

## What was taken out

`Billing.usageToTotal` and `Billing.determineIfLineItemShown` — upstream lines
92–204 of `src/billing/entities/billing.entity.ts`, 113 lines — together with the
nine imports and the class logger they were the only users of. The file goes from
205 lines to 82.

Between them those two methods hold the whole of meteringco's entitlement model: how
much of a period's metered usage a customer actually owes for once the allowance
their plan includes is taken off, and whether a dimension has earned a line on
the invoice at all. What remains in the workspace charges for every unit the
meters recorded and puts a line on the invoice for every dimension a plan
carries. That is a coherent implementation of a world where plans include
nothing and every dimension is worth telling the customer about — which is what
the code reads like, not like something with a hole in it.

| file | change vs upstream |
| --- | --- |
| `src/billing/entities/billing.entity.ts` | both methods gone (+0 / −123) |
| `src/offering/entities/offeringPackage.entity.ts` | the two call sites in `getLineItemsForUsage` rewritten around a plain `Offering.billableTotal` sum, line items emitted unconditionally (+34 / −55) |
| `src/utils/aws/cloudwatch.ts` | gains `getMetricSeries` (+67) |
| `src/utils/aws/s3.ts` | gains `getDocument` (+6 / −1) |
| `src/microservices/invoiceLineGatherer/` | new, 240 lines: the metered invoice-line collector, its DTOs and its module |
| `src/app.module.ts`, `src/scheduler/entities/scheduler.entity.ts` | register the new collector (+4) |

Nothing else moved. `InvoiceLineItem.prepareLineItem`, the dimension DTOs, the
settings DTOs and the tier path are exactly what upstream had, so the line shape
a solution has to produce is not something the task invented.

There are no stubs, no `TODO`s about the absent behaviour, no commented-out
code, no `not supported` throws, and no `.git` directory. The word entitlement
survives only where upstream puts it: the `usageEntitlement` field on the
dimension DTO, its validators, and the generated API docs. `npm run lint` is
clean and the unit suite is 281/281 green both before and after the reference
solution, so nothing in the visible tests either encodes the answer or punishes
it.

### Removed spec material

Three test files carried the matrix as an oracle and were pruned:

| file | change |
| --- | --- |
| `src/offering/entities/offeringPackage.entity.spec.ts` | six `freeDimensionOnInvoice` cases dropped (−288), 110/110 remaining green |
| `integration/dimension/dimensionEntitlements.integration.spec.ts` | deleted (214 lines): it asserted the entitlement matrix end to end |
| `integration/billing/billing.integration.{input,spec}.ts` | the entitlement fixtures and their assertions dropped (−257) |

### Disjoint from the tiered-proration task

Both tasks edit `getLineItemsForUsage`, so this was checked statement by
statement rather than by line range:

| region of the function | tiered-proration task | this task |
| --- | --- | --- |
| tier / grouped / non-tiered dimension routing | collapsed into one `dimensionsMap` | untouched, all three maps intact |
| `Billing.usageToTotal` calls | kept verbatim | replaced |
| upfront-charge proration of `unitCost` | removed | untouched |
| `Billing.determineIfLineItemShown` gate | kept verbatim | removed |
| the tiered and metadata-grouped blocks (202 lines) | removed | untouched |
| `src/billing/entities/billing.entity.ts` | untouched | both statics removed |

The tiered-proration workspace still contains both methods with their real
bodies, and this workspace still contains every line of the tier and proration
logic. Neither task's solution is any part of the other's.

## Where the rules live

No file states the rule set. To derive it in full an agent has to read across
the repository *and* probe the sandbox:

| source | what it yields |
| --- | --- |
| `src/dimensions/dto/create-dimension.dto.ts` | `usageEntitlement` (a number or the string `inf`) and `overageAllowed` as a two-valued enum of `'true'` / `'false'` that is optional, so a third state exists |
| `src/setting/dto/FreeDimensionOnInvoice.ts` and the settings DTO | that a business chooses whether zero-rated dimensions are shown or hidden |
| the catalogues in the sandbox bucket | dimensions with no allowance, finite allowances, `inf` allowances, allowances whose overage flag is `'true'`, `'false'`, and absent; both invoice settings |
| the metric series in the sandbox | that a dimension nothing was recorded against has no series at all, and that `GetMetricData` pages |
| `InvoiceLineItem.prepareLineItem` and each dimension's `consumptionPrice` | that the quantity on a line is the billable total over the usage increment, how the display name is built, and whether the dimension is priced at zero |

An agent that reads only the collector sees a catalogue, a metric query and a
sum. That is the starting workspace, and it scores 0.0.

## How it is graded

`tests/test.sh` stops the agent-facing endpoint, proves its process has exited
and its port can be rebound, then starts a held-out emulator whose identity is
verified with a run-specific admin token. It drops a root-owned driver into
`/app` and asks the collector for one invoice run per business. It never trusts
an exit code or stdout; the driver only transports observations.
`tests/compute_reward.py` runs as root, loads no submitted code, and re-derives
the correct answer from the held-out catalogues and metric readings with its
own reference model.

Reward is 1.0 only if, for both businesses and all ten customers, the set of
dimensions carrying a line matches exactly and every quantity matches to within
floating-point tolerance. Fifty-two dimension-customer cells are exercised; a
correct run puts a line on twenty of them.

| case | held-out example | correct outcome |
| --- | --- | --- |
| no allowance, usage recorded | api requests, events ingested | whole usage charged, line shown |
| no allowance, nothing recorded | api requests for one customer with no series | nothing charged, no line |
| finite allowance not reached | included seats at 18 of 25 | nothing charged |
| usage exactly at the allowance | included seats at 25 of 25 | nothing charged, and on a plan no line |
| finite allowance exceeded, overage sold | included seats at 31 of 25 | the overrun charged, line shown |
| finite allowance exceeded, overage refused | audit exports at 52 of 40 | nothing charged, no line |
| finite allowance, overage flag absent or null | replay jobs, stream hours | nothing charged, no line because permission was not granted |
| unlimited allowance | storage gigabytes, data scans, model invocations | nothing charged, no line unless the dimension itself is priced at zero and free dimensions are shown |
| finite allowance not reached, overage sold | webhook calls at 380 of 500 | nothing charged, no line unless the dimension itself is priced at zero and free dimensions are shown |
| zero-rated dimension, business hides them | support tickets, sandbox hours | no line |
| zero-rated dimension, business shows them | bandwidth gigabytes, retention days | line shown |

The rule is intentionally independent of plan kind. Positive-priced dimensions
appear only when the customer owes a positive quantity. Zero-priced dimensions
follow the business's `freeDimensionOnInvoice` setting. An absent overage flag
does not grant permission to charge an overrun.

The post-QA anchors were re-executed against this exact rule set:

| candidate | reward |
| --- | --- |
| reference solution | **1.0** |
| starting workspace, unchanged | **0.0** |

The larger mutation table from the earlier verifier is not reused here because
it encoded the superseded plan-kind visibility matrix. Fresh scored attempts
must be interpreted against the rule above rather than those historical
candidate labels.

Every candidate ran with an empty environment (`env -i`, `HOME` set to a path
that does not exist) so no host AWS config can leak in, and with `AWS_REGION`
as the only region source.

## Sandbox vs held-out account

The box serves `/opt/billing-sandbox/public.json`: two businesses, three
enrolments across three plans, twelve priced dimensions, whole numbers
throughout, one business hiding zero-rated dimensions and one showing them.
Every hazard is present in kind — an allowance passed and not passed, an
unlimited allowance on each kind of plan, an overage flag of `'true'`, of
`'false'` and absent, a dimension with no series at all, and both invoice
settings.

The held-out document is two businesses, ten customers, four plans, fifty-two
dimension-customer cells, forty-three metric series and 169 readings, with the
allowance shapes spread so that no single customer exhibits them all. Getting
the sandbox right is not evidence of passing the grade.

`GetMetricData` pages three readings at a time in the sandbox and two in the
held-out document. This is present so that a solution which ignores `NextToken`
cannot accidentally look correct on a quiet estate; it is deliberately not the
source of difficulty, since the collector already pages and the agent does not
write that code.

## Layout

```
environment/Dockerfile          image: node 22, python 3, the repo at /app
environment/task-init.sh        starts the emulated endpoint on :4566
environment/workspace/          the repository, capability removed
environment/mockaws/            task-owned copy of the emulated control plane
environment/sandbox/            world-readable fixture + sandbox notes
environment/verifier-data/      root-only: held-out account, run spec, driver
environment/gen_scenarios.py    regenerates both account documents
instruction.md                  the prompt (1000 characters, one paragraph)
solution/solution.patch         the oracle (2 files, +177 / −34)
tests/test.sh                   verifier entry point
tests/compute_reward.py         trusted scorer with its own reference model
```

`environment/mockaws/` is based on the existing CloudWatch-capable copy and is
extended with the `body_json` object form used by the tenant-attribution task so
a catalogue can live in the account document as structured data rather than as
an escaped string. `shared/` itself is unmodified.

## Regenerating

```
python3 environment/gen_scenarios.py --out-dir /tmp/scenarios
install -m 0644 /tmp/scenarios/public.json environment/sandbox/public.json
install -m 0644 /tmp/scenarios/holdout.json environment/verifier-data/holdout.json
install -m 0644 /tmp/scenarios/run-spec.json environment/verifier-data/run-spec.json
```
