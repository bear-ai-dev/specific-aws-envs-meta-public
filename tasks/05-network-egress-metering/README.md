# Task 5 — network egress metering

Turn per-machine outbound network traffic into billable usage: total the bytes
each enrolled machine transmitted over the interval, whatever its power state,
charge one figure per customer, and bill nothing at all for a machine that
reported no traffic rather than billing it as a zero.

## The capability

A scheduled collector runs every five minutes for one business and one
dimension. It assumes a role inside the customer's own AWS account, finds the
machines tagged for that dimension and for a customer, reads how many bytes each
of them sent out over the interval that has finished settling, and records one
usage figure per customer.

The hard part is the metric series. It is sparse, and the statistic matters. A
machine that published nothing in the interval has said nothing about its
traffic, which is not the same as saying it sent none — so it contributes
nothing and cannot put its customer on the invoice by itself. A machine that
published zeros has said something, and its customer is billed at zero. And the
figure is the total of the interval's observations, not their average: a draft
that averages produces numbers that look entirely plausible and are quietly a
quarter of the truth.

## Size

**372 lines across 17 files.**

| lines | file |
| ----: | ---- |
| 113 | `src/microservices/ec2EgressDataGatherer/ec2EgressDataGatherer.service.ts` |
| 86 | `integration/measurement/ec2EgressMeasurement.integration.spec.ts` |
| 44 | `src/utils/aws/cloudwatch.ts` |
| 40 | `integration/utils/cloudwatch.ts` |
| 21 | `integration/client/publicClient/measurement.ts` |
| 20 | `src/microservices/ec2EgressDataGatherer/Dto/ec2EgressDataGatherer.dto.ts` |
| 19 | `src/measurement-config/measurement-config.service.ts` |
| 14 | `src/microservices/ec2EgressDataGatherer/ec2EgressDataGatherer.module.ts` |
| 3 | `src/dimensions/dimensions.service.ts` |
| 2 | `src/scheduler/entities/scheduler.entity.ts` |
| 2 | `src/app.module.ts` |
| 2 | `docs/open-api-public-spec.json` |
| 2 | `docs/open-api-private-spec.json` |
| 1 | `src/measurement-config/entities/measurement-config.entity.ts` |
| 1 | `src/dimensions/dto/create-dimension.dto.ts` |
| 1 | `docs/public_api.html` |
| 1 | `docs/private_api.html` |
| **372** | **17 files** |

This is under the cohort's line aim and over its file ceiling, and both numbers
are honest rather than negotiable.

The line count is what the capability actually costs in this codebase. The slot
estimated roughly 600 from whole-file counts, but two of the files it named are
shared with other capabilities: `src/utils/shared/utils.ts` holds a grouping
helper two surviving gatherers still call, and
`src/measurement-config/entities/standardMeasurement.entity.ts` is the
publication path every gatherer uses. Neither can leave, and neither should:
they are the specification a solver reads.

The file count is over the ceiling for a structural reason. Declaring a new
measurable resource kind in this platform costs six edits of one to three lines
each, spread across the dimension enum, the dimension service's resource
mapping, the measurement-config enum, its validation, the scheduler's parameter
union and the application module. Four more single-line edits fall in the
generated API documents, which publish the resource-kind enum and would
otherwise name the resource kind outright. Ten of the seventeen files are
therefore one to three lines apiece. Padding the set out to reach the line aim
would have meant bundling work that is not part of this capability, and
narrowing it to reach the file ceiling would have meant leaving a declared
resource kind that nothing handles — which is exactly the shape a workspace must
not have. So: 372 across 17, and the shape is the reason.

`solution/solution.patch` applied to `environment/workspace/` reproduces upstream
byte for byte under `diff -rq` across the whole tree, `src/`, `test/`,
`integration/` and `docs/` included.

## Grading

Behavioural and binary. `tests/test.sh` runs as root, stops the agent-facing
emulator, starts its own against a held-out estate the box has never seen with a
freshly minted admin token on its own port, drives the submission under `env -i`
as the agent, and hands the raw usage rows to `tests/compute_reward.py`.

The scorer runs as root, imports nothing from the deliverable, executes none of
it, and re-derives the correct rows from the held-out estate document. Reward is
1.0 or 0.0 and is written fail-closed: the zero lands on disk before anything
can go wrong, and is overwritten only when both graded runs match exactly. Every
early exit — not root, held-out estate unreadable, `/app/src` gone, the driver
producing nothing — leaves the zero in place.

One class of failure is deliberately kept out of the reward. If the port cannot
be cleared, or the endpoint never answers as this run's own, or it stops being
this run's own partway through, then nothing was measured and a zero would be a
statement the run is not entitled to make. Those cases write a `harness_failure`
key instead and say so on stdout, so a run that could not be graded can never
later be read as a submission that answered wrongly.

The driver cannot know what the submission called anything, so it does not look
for a name. It hashes the tree the box started with, takes every source file the
submission wrote or changed, and looks in those for a class with a queue handler
on it; failing that, a handler-shaped method. Ranking is only a guess, so the
first run settles it: whichever candidate actually publishes usage is the
collector. Usage is captured at the platform's own publication entry point,
which is the one part of the path the submission did not write, and a collector
that returns its rows instead of publishing them is taken at its word.

Two runs are graded, on two dimensions in the same estate, so a submission that
ignores which dimension it was asked about cannot pass by billing everything.

The nine graded rules and the route to each are in `DISCOVERABILITY.md`. A tenth
was listed there until an audit showed it was not in fact graded; see "Rules
nothing exercises" below.

## The sibling probe

Two surviving gatherers in `src/microservices/` share this one's scaffolding,
and the running-time sampler shares nearly all of it. Screening said so loudly:

| pair | containment | share of longer | hunks |
| ---- | ----------: | --------------: | ----: |
| removed collector vs surviving running-time sampler | **78.7%** | 61.5% | 7 |
| removed collector vs imitation variant | 66.7% | 61.5% | 6 |
| removed collector vs structurally different implementation | 34.3% | 15.4% | 7 |

House baseline for this population (28 pairs of collector methods across
`src/microservices/*/*.service.ts`): median containment 26.1%, upper quartile
36.5%, max 80.8%. At 78.7% the survivor is a near-copy of the removed block by
any measure, so screening alone could not clear it.

So the imitation was built and scored. `.local/variants/imitation.sh` copies the
surviving sampler and adapts it only as far as the prompt and the surviving code
force, without reading the recorded usage: it keeps the role assumption, the tag
gate, the grouping, the metadata reduction, the row shape and the publish path,
and because the sampler never reads a metric it has no template for the one part
that matters. What it reaches for instead is what a writer with no template
reaches for — `GetMetricStatistics` with the console's default statistic, and a
zero where no datapoint came back.

**It scores 0.0, and reaches 4 of the 9 graded rules.**

Reached: enrolment by tag, bytes out rather than in, bytes unrounded and
unconverted, and one figure per customer against the run's dimension. All four
are rules the copy hands over for free, and none carries graded weight on its
own. It also uses the platform's publication path, which the copy hands over as
well, but that turned out not to be graded.

Failed, and these are where the weight sits:

- **the statistic.** Every figure it produces is the average of the interval's
  observations. `cus_ferrule` comes out at 98,304 against 393,216.
- **power state.** It inherits the sampler's filter to running machines, so
  `cus_bastion` and `cus_calliper` are never billed at all, and `cus_wharfage`
  is billed 0 instead of 2,097,152 because the machine that sent the bytes has
  since been torn down.
- **a gap is not a zero.** `cus_kestrelmoor` is billed 0 although both its
  machines reported nothing.
- **a silent machine among several suppresses nothing.** The same zero-fill that
  bills `cus_kestrelmoor` is what reduces `cus_wharfage` to 0.
- **a zero is a reading** it satisfies only by accident: `cus_solenoid` is
  correctly billed 0, but by the same defaulting that breaks the rule above it.
  The two rules have to hold together and the copy cannot hold both.

The screening read was right and it is the favourable one. The survivor never
queries CloudWatch, so the statistic and the gap-versus-zero distinction have no
analogue in it, and it actively contradicts on power state. The graded weight is
on that surface, and off the processor scaffolding the copy hands over.

## Verification

No Docker. Every candidate got its own directory and its own port, was copied
with `cp -a`, and shared nothing but a read-only `node_modules`. Harness in
`.local/verify.sh`, variants in `.local/variants/`.

Every row below was collected after the isolation fix described in
"Isolation on a shared machine", and no row was reported until an authenticated
admin call had proved, both before and after the run, that the endpoint
answering was the one that run had started against the held-out estate.
Eleven of the thirteen zeros and ones below are supported by rows the candidate
actually published; the two that published nothing did so for their own reason,
and their logs show the collector running to completion against a confirmed
endpoint.

| row | candidate | reward | why |
| --- | --------- | -----: | --- |
| oracle | `solution/solve.sh` on a pristine workspace | **1.0** | both runs match exactly |
| untouched | the shipped workspace | **0.0** | no collector found in the submission |
| structurally different | one batched Metrics Insights query grouped by machine, group key read off the result label, every bucket totalled, a `Map` instead of the shared grouping helper, a 30-minute window, different file, class and resource kind | **1.0** | both runs match exactly |
| structurally different, no queue decorators | the same implementation as a plain service class with one collection method | **1.0** | driver finds it by novelty rather than by framework metadata |
| imitation | the surviving sampler, copied and minimally adapted | **0.0** | see above |
| wrong: averages the interval | `AVG` in place of `SUM` | **0.0** | `cus_ravelin` 1,730,150.4 against 8,388,608 |
| wrong: a gap is a zero | absent readings defaulted to 0 | **0.0** | bills `cus_kestrelmoor`, who owes nothing |
| wrong: a zero is not a reading | drops rows whose figure is 0 | **0.0** | `cus_solenoid` never billed |
| wrong: running machines only | inherits the sampler's state filter | **0.0** | `cus_bastion`, `cus_calliper`, `cus_wharfage` never billed |
| wrong: bytes in | `NetworkIn` in place of `NetworkOut` | **0.0** | bills `cus_kestrelmoor`; `cus_ferrule` 786,432 against 393,216 |
| wrong: converts to gibibytes | divides by 1024³ | **0.0** | `cus_ravelin` 0.0078125 against 8,388,608 |
| wrong: reads the freshest five minutes | window `[now-5m, now]` | **0.0** | nothing settled in that window; no customer billed |
| wrong: a silent machine drops its customer | suppresses a customer with any silent machine | **0.0** | `cus_wharfage` never billed |
| wrong: any dimension | drops the dimension test, keeps the customer test | **0.0** | bills `cus_bastion` on the replica run, where nobody is owed |
| wrong: no customer gate | enrols on the dimension tag alone | **0.0** | publishes a row with no customer, valued 5,242,880 |
| wrong: dimension read off the machine | files under the machine's tag, not the run's | **0.0** | `cus_tallow`, tagged for two dimensions, never billed on either |
| probe: rows returned, not recorded | correct arithmetic, rows handed back instead of published | **1.0** | the publication path is not graded; see below |

Eleven wrong readings, each failing for the reason it was built to fail for, and
each failing on the held-out estate rather than on the sandbox.

### No masked mutants

A verdict is not evidence. A wrong reading can score 0.0 while testing nothing:
something downstream may undo the mutation and leave the output arithmetically
identical to the correct answer, or the candidate may never parse and so never
evaluate its rule at all. `.local/masked_mutant_check.py` reads the rows each
candidate actually published and compares them to the oracle's, so the evidence
is the specific wrong value rather than the reward.

All twelve wrong readings produce a distinct wrong value, none is output-identical
to the oracle, every one parsed, had its collector discovered and driven, and
exited cleanly. Two collapses showed up and both are explained rather than
excused:

- `untouched` and `wrong-fresh-window` produce identical output, because both
  publish nothing. As matrix rows they do not discriminate from each other and
  only their logs separate them. `wrong-fresh-window` exercises the settling
  window, which `DISCOVERABILITY.md` lists as forced rather than graded, so no
  graded rule depends on that row.
- `returns-rows` is output-identical to the oracle by construction. That is the
  finding it was built to produce, not a defect in it.

### Each zero is its own zero

Comparing rewards is the weaker check, because a spurious zero and an earned one
look identical in the reward. So every failing row was read back to the rows the
candidate actually published, and each had to fail in its own characteristic
way. Eleven of the thirteen rows are backed by published usage: `wrong-average`
gives `cus_bastion` 1,048,576 against 3,145,728; `wrong-gap-as-zero` bills
`cus_kestrelmoor`, who owes nothing; `wrong-running-only` never bills
`cus_bastion`, `cus_calliper` or `cus_wharfage`; `wrong-gigabytes` reports
0.002929688 where 3,145,728 was due; `wrong-skip-zero` drops `cus_solenoid`
alone. A candidate cannot produce that signature by dying.

Two rows published nothing, which is the one shape a dead endpoint can imitate,
so they are distinguished by their logs rather than by their rewards.
`untouched` publishes nothing because there is nothing in it to find, and the
driver says so. `wrong-fresh-window` is the interesting one: its log shows the
driver selecting the collector, the collector logging its own start and finish,
and a clean driver exit against an endpoint confirmed ours immediately
afterwards — it published nothing because the window it asked about had not
settled, which is exactly the behaviour it was built to exhibit. A candidate that
publishes nothing because its emulator died leaves none of that behind, and only
the log separates the two.

### Rules nothing exercises

A rule can be listed, documented and believed while nothing depends on it. Then
the grader could hold it backwards and no row would move.
`.local/rule_coverage.py` negates each rule inside the scorer's own reference
model and re-derives the expected rows from the held-out estate, so every rule
has to name the observation that would change if it were wrong.

All nine graded rules are pinned, and twelve negations each move at least one
row. Named: ignoring the customer tag adds an unowned row of 5,242,880; ignoring
which dimension adds five customers to the replica run; reading the dimension tag
whole rather than as a list drops `cus_tallow` from both runs; billing bytes
received moves seven of nine figures; averaging moves five; filtering to running
machines drops `cus_bastion`, `cus_calliper` and `cus_wharfage`; defaulting a gap
to zero adds `cus_kestrelmoor` at 0; dropping zero rows removes `cus_solenoid`;
letting a silent machine suppress its customer removes `cus_wharfage`; converting
to gibibytes moves every figure; and either way of grouping by the tag's own
value misfiles `cus_tallow`, who is tagged for two dimensions.

Rules 5, 6 and 7 are each pinned by exactly one customer in the held-out estate —
`cus_kestrelmoor`, `cus_solenoid` and `cus_wharfage` respectively. That is
sufficient but thin, and worth knowing: those three customers are the whole
margin on the rules the task exists for.

Two gaps were real and are now closed. Enrolment by tag and "one figure per
customer against the run's dimension" were pinned by the data but exercised by no
candidate, so the grader could have had either wrong with nothing moving. The
three candidates added above cover them, and each is a mistake a solver would
plausibly make rather than a row added to satisfy a count — grouping by the tag's
literal value is what the platform's own helper does.

The tenth rule was not a gap but an error. "Usage is recorded the way the
platform records usage" was documented as graded and is not: the driver falls
back to a collector's returned rows when it publishes none, so a correct
implementation that hands its rows back scores 1.0. The fallback is the right
behaviour — it keeps a legitimate shape from failing on plumbing — so the rule was
withdrawn rather than enforced, and the count is nine.

### Isolation on a shared machine

Eleven of these packages were built side by side on one host, and a verifier
that takes a fixed port or signals a process by name reaches into its
neighbours. Both mistakes produce the same artefact — a zero — and a zero caused
by a dead emulator is indistinguishable afterwards from a zero earned by a wrong
answer. On a wrong-answer candidate that is the dangerous direction, because it
makes a rule look like it discriminates when it does not.

Three properties close it, in `tests/test.sh` and in the local harness alike.
The port is `${MOCKAWS_PORT:-4566}`, so the shipped container keeps the default
it should have and nothing outside a container ever takes it. Every signal goes
to a process this run owns, found by pidfile and otherwise by holding this
specific port — by `lsof` where it exists and by reading the process table for
this port where it does not — so no path can name a process that merely looks
like ours. And each run mints a random admin token, which makes an authenticated
admin call proof of two things at once: only this run knows the token, and only
the held-out estate grants the role the same call reads back out of the world.
That check has to pass before the driver starts and again after it finishes; if
either fails, the run reports a harness failure carrying a `harness_failure` key
and no reward is written at all, rather than a zero that would later read as a
verdict. That path was tested rather than assumed, by standing a foreign
listener on this slot's own port and running the oracle against it: the run
reported `HARNESS FAILURE  port 41100 already held` and wrote no `reward.json`
whatsoever, so there was nothing for a later reader to mistake for a score.

The local sweep needs one port per candidate, so it cannot simply count upward
from a single assigned port without walking into the ports assigned to the slots
after this one — which is exactly what happened on the first re-run, where port
14651 was held by a neighbour. The sweep now works inside a hundred-port block
keyed on this slot's own number, `41100-41199`, which is collision-free by
construction and sits clear of the range the rest of the cohort was given. It
moves within the block when a port is busy, treats the block edge as a stop
rather than a hurdle, and never evicts an occupant: a busy port belongs to
whoever holds it. If the block ever filled, the sweep would stop and say which
candidates it did not run rather than reach past it.

Scenario documents reproduce byte for byte: `python3 environment/gen_scenarios.py
--check` passes on all six shipped documents. The recorded usage shipped in the
sandbox is derived by importing `tests/compute_reward.py`'s own reference model,
so the worked example a solver reads cannot drift from the answer that is graded.

A re-run is only as good as the estate it re-runs against, so `holdout.json` and
`run-spec.json` were hashed before and after the generator was last touched and
confirmed identical. Every row above was therefore collected against the same
held-out estate, and the verdicts are comparable to each other and to the rows
they replaced.

**The answer does not depend on when the run happens.** Observations hang off the
most recent five-minute boundary, so a run's own position in that cycle could in
principle change which buckets its window clips. It was checked exhaustively:
for all 300 phases of the cycle, over both estates, and over seven window shapes
a collector might plausibly ask for, every reporting series resolves to exactly
one bucket holding all of its observations, and the set of series answered is
identical at every phase. There is therefore no index choice to get right, no
`ScanBy` dependency, and no flakiness in the grade. The same sweep shows the two
edges of the window rule: a window confined to `[t-5m, t]` answers no series at
all at any phase, and a window of `[t-1h, t]` with no lag at all answers every
one of them — which is why the settling requirement is a speed bump rather than a
graded discriminator.

## The estates

Sandbox and holdout share no account, business, dimension, customer, machine
identifier or magnitude.

|  | sandbox | holdout |
| --- | --- | --- |
| metering account | 900000000001 | 900000000009 |
| metered account | 100000000031 | 200000000077 |
| business | `biz-northwind` | `biz-tessellate` |
| dimensions | `dim_sbx_egress`, `dim_sbx_archive` | `dim_hld_transfer`, `dim_hld_replica` |
| machines | 12 | 13 |
| customers billed | 4 | 5 on one dimension, 2 on the other |

Both hold an instance of every case class the grader distinguishes: reporting,
reporting zero, never having published the series, having published it but
nothing recently, running, stopped, torn down, shutting down, enrolled on
several dimensions, enrolled on another dimension, enrolled with no customer
tag, and untagged.

## Emulator

`environment/mockaws/` is task 02's control plane with three changes, all in
service of the metric semantics this task turns on:

- `state.py` takes a `metric_anchor_seconds` from the scenario, so relative
  observations can hang off the most recent five-minute boundary rather than the
  previous whole clock hour. A metric published every few minutes needs a
  boundary of its own period or the observations drift up to an hour away from
  the caller's window.
- `services/cloudwatch.py` answers a Metrics Insights `SELECT` with one result
  per series it found readings for, so a silent series is absent from the reply
  rather than present and empty. A `MetricStat` query still always answers, with
  an empty value list. Both are the real API's behaviour and both distinguish
  absence from zero, which is the point.
- `services/cloudwatch.py` validates `Id` on a metric data query the way the
  real API does: lowercase first letter, then letters, digits and underscores
  only. A machine identifier is therefore not usable as one.
- `server.py` reads a request body framed chunked as well as one with a declared
  length, and decompresses a gzipped body. The inherited copy read
  `Content-Length` only, so a client that streamed a body without declaring its
  size would have had it silently read as empty and still been answered
  successfully.

Whether that last one could ever have bitten here was measured rather than
argued. `MOCKAWS_FRAMING_LOG` records how every request arrived, and across all
seventeen candidates of a full battery — 341 requests — **none was chunked, none
was compressed, and the largest body was 688 bytes.** The exposure was nil, for
two structural reasons: this emulator exposes only AWS services and no
time-series write endpoint, and usage never crosses the wire at all because the
driver wraps the publication entity in-process. The fix is therefore inert on the
graded path, which the re-run confirms — every verdict unchanged. It was taken
anyway because a body silently read as empty and answered successfully is the
kind of defect that surfaces later as an unexplained zero. Proof it works: a
2,033-byte body, gzipped to 66 bytes and sent chunked with no `Content-Length`,
is now read and decoded to exactly 2,033 bytes; before, it read as empty.

`environment/gen_scenarios.py` never enters the image.

## Difficulty

**Frontier model: moderate-to-hard. I would expect roughly half to pass on a
first attempt, and most to pass given a second look at the sandbox.**

Everything except one rule is either stated in the prompt or written into the
surviving gatherers, and the shape of the work is unmistakable: there are two
collectors to copy the scaffolding from and the prompt asks for a third. A
frontier model will assume the role, apply the tag gate, group by customer and
publish correctly almost by reflex. What decides the run is whether it reads
`recorded-usage.json` and asks why one tagged customer with two enrolled
machines has no entry while another has an entry of zero. That question has one
answer and the answer is the task. A model that runs its own collector against
the sandbox and diffs the output against the recording will find it. A model
that reasons from first principles and never looks will very likely default the
absent reading to zero, because that is the natural thing to do with an
accumulator, and it will fail with numbers that look right.

The statistic is a second, softer trap. The prompt says "the total it sent",
which is enough for a careful reader, but `NetworkOut` is already a per-period
sum in real CloudWatch and it is easy to conclude that any statistic over a
single datapoint is equivalent. The estate publishes three to five observations
per interval per machine, so it is not.

**Weaker model: hard, and I would expect most attempts to fail.**

Four things stack up. The metric read has to be written from nothing, since no
CloudWatch helper survives and the two siblings never touch the service. The
query identifier rule rejects a machine identifier outright, which costs a
debugging cycle. The collection window has to reach back past the settling
minutes, which costs another if it does not — though the sandbox says so
immediately, so this one is a speed bump rather than a wall. And the sibling is
a 78.7% match that is wrong in exactly the two places the grading cares about,
so the path of least resistance leads to a confident zero. The measured
imitation is the evidence: a copy that is two thirds of the answer by line and
none of it by reward.

## What I could not verify

- **The image never got built.** Verification ran without Docker, per the brief,
  against `environment/workspace/` copies rather than a built `/app`. The
  Dockerfile's layering, permissions and the `pristine_app` copy the driver
  hashes are therefore reviewed rather than exercised.
- **Node version.** Local verification ran on node 25; the image pins node 22.
  Nothing in the driver or the deliverable is version-sensitive as far as I can
  see, but I did not run the battery on 22.
- **`tests/test.sh` end to end.** The pieces it adds over task 02's shape — the
  baseline manifest, the `appRoot` it passes the driver, and the ownership
  checks — were all exercised by the local harness, which does the same things
  the same way. The script itself was not run as root against a container.
- **The `lsof`-less path.** Finding the holder of this port by reading
  `/proc/*/cmdline` is the fallback for an image without `lsof`; `lsof` is now
  installed in the image and exists on the build host, so the fallback is
  reviewed rather than exercised. The `lsof` path was exercised.
- **Two interference events, both caught by the new checks.** An early battery
  had one candidate score zero because its emulator never came up, and the first
  post-fix re-run found port 14651 held by a neighbouring builder. Neither
  produced a reported reward once the ownership check was in place — both
  surfaced as harness failures. No verdict in the table above changed as a
  result, but the second one is direct evidence that a fixed-port harness on
  this host would have recorded a zero it had not earned.
