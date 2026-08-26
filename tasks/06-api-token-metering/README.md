# Task 6 — API token metering

The platform serves API calls for its tenants and does not bill itself for them.
The capability under test turns each served call into a registration in an
aggregate bucket, closes a six-hour period by totalling the registrations inside
it, and bills that total to the platform's own production or sandbox account.

The hard part is idempotency. Delivery is at-least-once and unordered, so the
same call can be handed over twice with a flush and a whole closed period
between the arrivals, and a call can arrive behind one that happened later than
it. The property has to hold per call rather than per batch, and it does: a
call's identity and its own moment are part of the row's series key, the store
overwrites a row that repeats an existing measurement, tag set and timestamp, and
so redelivery is free of charge with no deduplication code anywhere. The two
defensible drafts — a set of what has been seen, kept per flush; or stamping the
row when the platform records it — both look right on a whiteboard and only the
data separates them.

## Shape

Purely subtractive across six files.

| file | removed | before | after |
| --- | --- | --- | --- |
| `src/token-consumer/token-consumer.service.ts` | 87 | 271 | 184 |
| `src/token-consumer/token-consumer-async-processor.ts` | 61 | 144 | 83 |
| `src/token-consumer/entities/token-consumer.entity.ts` | 43 | 69 | 26 |
| `src/interceptors/tokenRegisterInterceptor.ts` | 41 | 98 | 57 |
| `src/usage/usage.service.ts` | 10 | 141 | 131 |
| `src/token-consumer/token-consumer.controller.ts` | 2 | 36 | 34 |
| **total** | **244** | | |

`instruction.md` is 1,952 characters.

Strictly so: `diff -ru` between the upstream tree and the workspace reports 244
removed lines and no added line at all, so the oracle is 244 added lines and
nothing else. `create` destructures two names from the resolved customer and the
workspace uses only one of them, which would ordinarily mean narrowing that line;
it is left as upstream wrote it instead, since neither `noUnusedLocals` nor the
repository's own `@typescript-eslint/no-unused-vars` is on. The unused binding is
also a fair signpost: the platform's business id is in hand at the call site, and
the roll-up needs it.

Proof, run against a pristine copy of the upstream tree:

```
$ cp -a environment/workspace /tmp/oracle-proof
$ ./solution/solve.sh /tmp/oracle-proof
$ diff -rq upstream/src /tmp/oracle-proof/src        # identical
$ diff -rq upstream/test /tmp/oracle-proof/test      # identical
$ diff -rq upstream/integration /tmp/oracle-proof/integration   # identical
```

and in the other direction, `diff -rq` between the upstream tree and
`environment/workspace` reports exactly those six files and nothing else. The
workspace typechecks with zero errors under `tsc -p tsconfig.build.json`, the
same as the upstream tree, and no surviving file, spec or api-spec references a
removed name.

## Deviation from the sanctioned cut, and why

The build was authorised on a 205-line, six-file configuration on the stated
grounds that `TokenConsumer.publish`, `aggregateTokens` and `aggregateMeteringCoToken`
were all inside it, putting the point-form and timestamp decisions inside the
hole. Checking that before building, as instructed, turned up two problems with
the premise.

**The mapping and the stamping do live in surviving code, and cannot leave it.**
`MeasurementFormat.getPointForm` is what turns a metadata key into a
`metadata_<key>` tag and what stamps the row from `measurement.timestamp`. Every
one of the eight surviving publish sites reaches it, so it is not removable. This turns out to be
the right outcome rather than a leak: it hands over the *mechanism* — what a
`MeasurementFormat` becomes — while the *decision*, which moment and which
identity go into one, stays out. It is also the reason the decision cannot be
skipped by accident, because `getPointForm` supplies no default timestamp and a
registration built without one is rejected by the store.

**The decision itself was not inside the sanctioned cut.** That configuration
kept `TokenConsumer.tokenConsumerToStandardMeasurementEntity`, because the
surviving interceptor calls it, and that method passes both the token's own
timestamp and its metadata straight through. Together with the interceptor's own
minting of a per-call identity and its non-flushing write, the whole graded
insight would have been sitting in surviving code in the same file as the hole.
Measured as normalised lines, `publish` and that method share only 31.6% and
35.3% containment, which is a measurement artefact of the two being wrapped
differently; read side by side they make the same decisions.

So the cut was widened by the smallest amount that puts the decision inside it:
that method also goes (17 lines), and the interceptor is reduced to the
observability shell it can coherently be (41 lines) rather than kept whole. The
file count is unchanged at six and the total is 244 rather than 205. Both
numbers are outside the spec's aim, which the current policy treats as an aim
rather than a gate, and the deviation is recorded here.

The interceptor's reduced form is not a hollow shell. It taps the response,
gates on a non-error status, resolves the platform's own customer for the caller
and logs it. `TimingInterceptor` in the same directory is a pure logging
interceptor, so an observability interceptor is an ordinary inhabitant of that
directory rather than a stub.

`InfluxService.aggregateMeteringCoToken` was **kept**, against the sanctioned cut.
Removing it would have left `TokenConsumer._measurement` with no reader anywhere
and the entity orphaned, and it is a read helper rather than a discriminator: it
tells a solver the bucket, the measurement, the customer scoping and the two
platform accounts, all of which make the task fair rather than easier. It is now
the surviving contract the registration has to satisfy.

## Emulator lineage

Task 22's `mockaws` is vendored, not task 21's standalone store, because task
21's appends on write. Last-write-wins was confirmed by probing the vendored
emulator directly rather than by reading it: four writes of one series, three
rows retained.

| write | series | outcome |
| --- | --- | --- |
| identical row, request 1 | `uuid=aaaa-1`, `t` | stored |
| identical row, request 2 | `uuid=aaaa-1`, `t` | replaced the first — one row |
| same identity, later instant | `uuid=aaaa-1`, `t+5s` | kept separately |
| different identity, same instant | `uuid=bbbb-2`, `t` | kept separately |

Which is exactly the discrimination the grading rests on: redelivery collapses,
arrival-time stamping does not, and identity is what holds two simultaneous
calls apart.

## Grading

Behavioural and binary, seven rules, decided by `compute_reward.py` from the
store's contents and nothing else. It runs as root, imports no submitted code,
and never reads an exit code, a log line or anything the driver reported. The
reward file is written before the first check runs, so an unexpected exit leaves
a zero behind.

**The reward is binary.** `1.0` when all seven rules pass, `0.0` otherwise, with
no arithmetic over them and no weights. The rules are seven conditions on one
capability, not seven separable features, so partial credit would measure
something else: a submission that meters every call and bills the right account
but double-counts a redelivery has got wrong the one thing this task exists to
ask about, and it should not collect most of the reward for the parts that were
never in question. Under a weighted scheme the second imitation below scored
`0.95`; it scores `0.0` now, which is the correct answer.

| rule | what it asks |
| --- | --- |
| `registration_shape` | each API call becomes one registration, tagged for the platform's customer, account, dimension and amount |
| `identity_in_series_key` | two calls handed over inside one millisecond survive as two registrations |
| `call_time_placement` | a registration sits at the call's own instant, within a millisecond |
| `redelivery_idempotent` | a redelivered call leaves one registration, whichever batch it arrives in |
| `windowed_rollup` | each window produces one billable roll-up worth exactly that window's traffic |
| `platform_account` | the roll-up is billed to the platform's own account for that customer, and to that account's dimension |
| `request_path_meters` | serving a measurement meters the call that asked for it |

The per-rule detail is kept and is worth keeping — naming which rule a candidate
missed is what makes a run reviewable, and it is what the sibling analysis below
is built on. It is written to `report.txt` and `report.json` beside the reward,
where it informs a reader without being arithmetic on the score. `reward.json`
carries the verdict and nothing else.

Traffic is specified as offsets from a base instant `test.sh` pins once as root
and hands to both the driver and the scorer, so neither has to be trusted with
the clock and the same run spec grades a run today and a run next year.

The graded sequence covers both cases the insight turns on. A call is delivered
in the first period, billed, and delivered again in the second — a redelivery
spanning a flush and a closed period, which a per-flush set misses. Another call
happened before the second period opened and is delivered inside it, which
arrival-time stamping bills in the wrong period. Two more arrive inside the same
millisecond carrying different identities, and one belongs to a different
platform customer entirely. Both of the cases the insight turns on are in the
held-out set; the sandbox holds only a recording, no graded traffic.

The first period also carries a burst of five further ordinary calls. They are
there for volume rather than for the insight: they put the batch that closes that
period over the size at which the client compresses and streams a request, so the
graded run covers that write path instead of depending on a submission choosing
to send small ones. See "The write path" below.

The held-out account (`harborline-freight`, two platform customers) shares
nothing with the recorded world (`northwind-logistics`) except the platform-wide
constants — the two account names and their two dimension identifiers — which
would make the capability ungradeable if they differed.

The two held-out platform customers belong to **different accounts of the
platform's**: one to production, one to sandbox. That is deliberate and it was
put right rather than assumed. Both of them started out on the production
account, and with the graded traffic all on one side, a pipeline that never looks
at which account a customer belongs to and simply answers "production" was
indistinguishable from one that reads it — measured, not supposed: such a
pipeline scored `1.0`. Splitting the two customers across the two accounts, and
closing a window for each, makes the account and the dimension a question about
the customer. The same pipeline now scores `0.0`, and so does one that copies the
sandbox pair the recording happens to show: whichever constant a submission
picks, it is wrong about one of the two customers.

## Verification

Seventeen trees, each in its own output directory, run twice. Both passes agreed
on every reward and every failed rule; the table is either one.

The table below is the **in-container** matrix: every tree is dropped into
`/app/src` of a container built from `environment/Dockerfile`, and scored by
`tests/test.sh` running as root against the image's own held-out material, which
is what a graded rollout does. `.local/incontainer-matrix.sh` drives it. The
workstation rig in `.local/run-case.sh` still exists and still agrees, but it
borrows a neighbouring package's `node_modules` and never exercises the root gate
or the `su agent` drop, so it is a convenience rather than evidence.

Every case runs inside this package's own block of ports, and no case is scored
until the store it read has been shown to be the store it seeded — see "Isolation"
below for why that matters more here than the phrase suggests.

| tree | reward | rules lost |
| --- | --- | --- |
| oracle | **1.0** | — |
| control: per-batch dedupe set, call's own time | **1.0** | — |
| control: flushes on every registration | **1.0** | — |
| workspace as shipped | 0.0 | all seven |
| stamps the row when the platform records it | 0.0 | `call_time_placement`, `redelivery_idempotent`, `windowed_rollup` |
| per-flush dedupe set **and** arrival stamping | 0.0 | same three |
| identity in a field, not the series key | 0.0 | those three plus `registration_shape`, `identity_in_series_key` |
| copies the recording's sandbox constants | 0.0 | `registration_shape`, `platform_account` |
| always answers "production", never reads the account | 0.0 | `registration_shape`, `platform_account` |
| reads the bucket unbounded by time | 0.0 | `windowed_rollup` |
| bills the roll-up to the tenant | 0.0 | `platform_account` |
| ablation: registration under the sandbox dimension | 0.0 | `registration_shape` |
| ablation: call's own instant, skewed by 90s | 0.0 | `call_time_placement` |
| re-dates a call whose period was billed into the open one | 0.0 | `call_time_placement`, `windowed_rollup` |
| marks a call whose period was billed, keeping its instant | 0.0 | `redelivery_idempotent` |
| imitation: follows the four data-gatherer siblings | 0.0 | `call_time_placement`, `redelivery_idempotent`, `windowed_rollup` |
| imitation: follows `standardMeasurementPreProcessor` | 0.0 | `request_path_meters` |

Three trees score `1.0` and fourteen score `0.0`, with nothing in between. The load
is carried by the top four rows: the oracle scores one, the workspace scores zero,
and — the part that matters under binary grading — **both defensible drafts that
differ from the oracle still score `1.0`**. That was checked after the change
rather than assumed, since a task that fails a correct-but-different
implementation is broken, and under weights it was conceivable that the weights
were doing that work. They were not: both controls pass all seven rules outright.

### Is every rule load-bearing?

Under binary grading each rule is a potential sole cause of failure, so each was
checked for being the only failure of some candidate. Six are, one is not.

| rule | sole cause in |
| --- | --- |
| `registration_shape` | registration under the sandbox dimension |
| `call_time_placement` | call's own instant skewed by 90s |
| `redelivery_idempotent` | marks a call whose period was billed, keeping its instant |
| `windowed_rollup` | reads the bucket unbounded by time |
| `platform_account` | bills the roll-up to the tenant |
| `request_path_meters` | imitation: follows `standardMeasurementPreProcessor` |
| `identity_in_series_key` | never — always with `registration_shape` and `windowed_rollup` |

The two ablations exist for this check and are labelled as such. Neither is a
draft anyone would write; each is the oracle with one thing moved so that exactly
one rule has anything to say. The dimension one works because the aggregation
query filters on customer and account but never on dimension, so a registration
filed under the wrong dimension is still summed into the right roll-up. The skew
one works because ninety seconds is far outside the millisecond placement allows
and far inside the six-hour window the roll-up sums, and because the skew is a
function of the call's own instant, both deliveries of a redelivered call carry
it and still collapse onto each other.

`redelivery_idempotent` was listed here as one that never stands alone, on the
argument that a second surviving row for one call requires either a different
identity or a different instant, and that both are noticed first by other rules.
That argument was wrong, and the candidate that shows it is now in the table. A
draft can *add* to the identity rather than replace it: reading "do not move an
invoice" as a reason to mark an arrival for an already-closed period with an extra
piece of metadata leaves the call's own identity and the call's own instant
exactly where the other rules want them, and because metadata is part of the
series key, the marked redelivery becomes a second row instead of an overwrite.
It escapes `windowed_rollup` as well, but only because the one call it duplicates
belongs to a window that was closed before the redelivery arrived; a duplicate
anywhere in the open period would inflate that window and take `windowed_rollup`
with it. That is a narrow escape rather than a comfortable one, which is the
point: this task's central rule turns out to have a defensible draft that gets
everything else right and only that wrong.

`identity_in_series_key` is the one that genuinely never stands alone, and that is
entanglement by construction rather than a gap in the scenarios. The two
same-millisecond calls differ by nothing but their identities, so any way of
losing one of them also removes a registration (`registration_shape`) and a call's
worth of value from its window (`windowed_rollup`). Nothing that keeps the
identity on the row can lose a twin.

It is kept anyway, for a reason that costs nothing now that detail is not
arithmetic on the score: it names the mechanism. A report saying "two calls handed
over inside one millisecond did not survive as two registrations" tells a reviewer
what went wrong in the terms the task is about, where "billed 0.002, the windows
are worth 0.003" only says the money came out wrong. The one thing I would not do
is manufacture a candidate to make it fire alone: it is constructible — writing
one twin a second time, at an instant outside every window, would isolate it — but
that is not a reading of the capability, and a row like that in the table would
suggest discrimination the rule does not have.

### Does every zero cover something?

A binary reward makes a crash and a wrong answer the same number by design, so a
verdict is no longer evidence that a candidate tested anything. Three ways a row
can look clean and be worthless, all checked by comparing each candidate's
observable output against the oracle's rather than comparing verdicts —
`.local/masked_mutant_check.py`, adapted from slot 40's:

- **A zero that covers nothing.** Every candidate is required to have run and
  produced a specific wrong value. Running is established from output no
  candidate's change can suppress: a tenant's own metering, published by code
  outside the hole, appears in every tree that compiled. All eleven wrong
  readings produce a named divergence; the shipped workspace produces that
  tenant row and nothing of the graded pipeline, which is what it is for. This
  is not hypothetical — the first run of the "always production" candidate
  scored `0.0` having never executed, and the check caught it where the verdict
  could not.
- **Two candidates that are one candidate.** Comparing output pairwise found a
  duplicate: "no call-site metering" and the second imitation wrote byte-identical
  rows, both diverging from the oracle in exactly one place. That is one reading
  with one observable consequence, not two, so the synthetic one is retired and
  `request_path_meters` rests on the imitation, which had to be scored anyway.
- **A rule with nothing to discriminate.** Each rule was checked for held-out
  data where the right and the wrong reading actually differ. One did not have
  it: both platform customers sat on the production account, so the account and
  dimension checks were comparing against a constant. That was fixed in the data
  rather than in the rule, as described above.

After the fix: eleven of eleven wrong readings compute a distinguishable wrong
answer, no two candidates agree, both controls are byte-identical to the oracle,
and no rule's discriminating input is invariant.

The wrong readings ruled out, seven of them plus two ablations, plus two controls
that must not be punished:

1. Stamping the registration when the platform records it. Bills 0.014 in one
   period where the correct reading bills 0.003 in the first and 0.008 in the
   second, because everything lands in whichever window is open when it arrives.
2. A dedupe set kept per batch **with** arrival stamping — the draft this task
   exists to rule out. Reported directly: "D: redelivery left 2 registrations,
   not 1" and "billed [0.014], the windows are worth [0.003, 0.008]".
3. Identity as a field rather than a tag. The two simultaneous calls collapse to
   one row.
4. Reading the aggregate bucket with no time bound, which re-bills a stale
   registration from a period that closed in January.
5. Billing the roll-up to the tenant instead of to the platform's own account.
6. Copying the account and dimension the recorded period happened to show, which
   is wrong for the production customer.
7. Never reading the account at all and always answering production, which is
   wrong for the sandbox customer. The mirror image of the one above, and the
   reason the two held-out customers sit on different accounts.

And the two ablations, which are not drafts but exist to show that
`registration_shape` and `call_time_placement` can each be the only thing a
candidate gets wrong:

8. The registration filed under the sandbox dimension while the roll-up keeps
   production.
9. The call's own instant kept but skewed by ninety seconds.

And the two that must **not** be punished, because they are style rather than
behaviour:

10. A per-batch dedupe set that keeps the call's own time. Redundant, since the
    store already does the work, but not wrong: `1.0`.
11. Flushing on every registration instead of buffering. Slower, not incorrect:
    `1.0`.

Both of these were checked against the oracle's output as well as its verdict:
each writes byte-identical rows, which is what makes `1.0` the right answer for
them rather than a weight absorbing a difference the rules can see.

Fail-closed paths, each confirmed to write a zero:

| path | result |
| --- | --- |
| verifier invoked as non-root | `0.0`, `harness_failure`, "verifier must run as root" |
| store snapshot missing or unparseable | `0.0`, `harness_failure` |
| held-out world, run spec or driver absent from the image | `0.0`, `harness_failure` |
| store does not carry this run's marker | `0.0`, `harness_failure` |
| store does not hold the held-out account's customer records | `0.0`, `harness_failure` |
| endpoint did not survive the run, on an authenticated check | `0.0`, `harness_failure` |
| verifier cut short before it could score | `0.0`, `harness_failure` |

Every one of these is a `harness_failure` and none is a bare zero, which is a
distinction this task needs rather than a tidy-up: a submission that meters
nothing earns a real `0.0`, so a run that never happened must not be allowed to
look like one.

What the local harness does not exercise, because a workstation has no root: the
`su agent` drop, the sandbox-endpoint teardown and the port-rebind loop. Those
are inherited unchanged from task 22's verifier apart from the base-instant
pinning and the isolation changes below, and the root gate itself was confirmed
by invoking `tests/test.sh` as an ordinary user.

### Isolation

The shipped verifier serves the held-out account on `${MOCKAWS_PORT:-4566}`.
Inside the task's own container 4566 is right and nothing contends for it. On a
workstation where several of these packages are built side by side it is not:
every package defaulting to the same port means a case can bind a neighbour's
emulator, or read a store seeded with a neighbour's world, and score that as
though it were the submission's work. Three things prevent it.

Local runs happen inside a block of a hundred ports belonging to this package
alone, `21500-21599`, under the cohort scheme `21000 + (slot - 40) * 100`. A block
rather than a single port, because single ports assigned one apart leave a harness
looking for a free one no choice but to walk onto a neighbour's; inside a block
the search has somewhere to go that belongs to nobody else. The search stops at
`21599` — if the whole block were occupied the harness reports rather than
reaching into the next package's range — and `.local/run-case.sh` refuses a port
outside the block outright, so no arithmetic in a driving script can put a case on
someone else's port.

Nothing is ever killed by process name, and nothing this package did not start is
ever signalled at all. A pattern kill on `mockaws` matches every emulator on the
machine; the verifier stops the pidfile the task's init script left, then whatever
holds its own port, and nothing else. In the local harness even that is dropped:
a port that is busy is a reason to wait, or to pick another inside the block,
never a reason to clear it.

Every run invents an admin token and a marker. The token proves the endpoint
answering is the one this run started; the marker, written into the store before
the driver touches it, proves the store read back is the one this run seeded and
was not replaced underneath it. The held-out account's own customer records are
checked as a second anchor. If any of that fails the run reports a harness
failure and no score.

This matters more for this task than for most, because what is graded is a row
count. A store that was killed and restarted part-way through, or one belonging
to another package, produces exactly the kind of wrong count the redelivery rule
exists to detect — a spurious zero on a wrong-answer candidate would make a rule
look discriminating when it was not.

It was not hypothetical. On the first pass after the guards went in, the oracle
row came back unmeasured: a neighbouring package was holding the port that pass
had walked onto. Before the guards that row would have been recorded as `0.00` for
the one tree whose score is supposed to be `1.00`, and the fault would have looked
like a bug in this package. That is the whole argument for the guards in one row —
the failure was caught only because the run refused to score a store it could not
prove was its own.

The table above is two full passes inside `21500-21599`, every row measured, no
row unmeasured in either pass, and the two passes identical in every reward and
every failed-rule set. They also agree with the numbers recorded before the port
work, so nothing that shipped was wrong — but that is a fact established after the
fact rather than something the earlier runs were entitled to claim.

The store's last-write-wins behaviour was re-probed directly, in-block, rather
than trusted from any earlier reading: five writes colliding on identity and
instant, three rows surviving, and the last write the one that lives.
`.local/lww-probe.sh` is the probe.

### The write path, and a defect that was there

The emulator inherited with this package read request bodies from
`Content-Length` alone. The metric store's client compresses anything over about
a kilobyte and streams it with `Transfer-Encoding: chunked`, which carries no
`Content-Length`, so such a request read as an empty body: the emulator stored
nothing and answered `204`, and the client was told the write had succeeded.

That is the worst possible defect for this task specifically. What is graded is a
point count, so writes that vanish above some payload size produce exactly the
kind of wrong count the rules exist to detect, and a submission's batch size is
its decision rather than this task's. `server.py` now reads chunked bodies and
decompresses gzipped ones.

Fixing it is not the same as knowing it is fixed, so `.local/write-path-probe.py`
asks the store what it received rather than trusting the response code — a known
number of points in each framing the client can choose, counted back out of the
store:

| framing | bytes | points written | points stored |
| --- | --- | --- | --- |
| declared length | 3,229 | 40 | 40 |
| declared length, gzipped | 3,429 | 40 | 40 |
| chunked | 2,909 | 40 | 40 |
| chunked and gzipped | 3,109 | 40 | 40 |
| chunked and gzipped, larger | 33,889 | 400 | 400 |

Against a deliberately unfixed copy the same probe loses every point in the last
four rows, three of them behind a `204`, so the probe is known to be capable of
failing rather than merely observed to pass.

**Did this contaminate the earlier numbers?** No, and that was checked rather than
argued. Expected counts are computed from the run spec — the declared traffic —
never from an observed run, so no amount of write loss can move the ground truth;
it can only make a correct submission look wrong. And the traffic as it stood
never crossed the threshold: instrumenting the write path showed the oracle's
largest request was 740 bytes, three registrations, with a declared length and no
compression. The decisive check is differential — the oracle scored `1.0` against
both the fixed and the unfixed emulator, which it could not have done had any
graded write been dropped.

**But it was 284 bytes from mattering.** A registration is about 250 bytes of line
protocol, so a submission that buffered four or more before writing would have
crossed the line and been silently zeroed while being entirely correct. Rather
than leave that to chance, the first period now carries a burst of five more
ordinary calls, so the batch that closes it is over the threshold. Measured on the
instrumented copy, that flush now goes out as `Transfer-Encoding: chunked` with
`Content-Encoding: gzip` and no declared length — and against the unfixed emulator
the oracle drops from `1.0` to `0.0`. The compressed-and-streamed write path is
therefore covered by grading, so a regression in it would show up as the oracle
row failing rather than waiting for someone to run a probe by hand.

The only numbers that moved are the ones that burst was meant to move: window one
is now worth `0.008` rather than `0.003`, because it has eight calls in it rather
than three. Every reward and every failed-rule set in the table above is unchanged
from before the burst.

Splitting the two platform customers across the two accounts added a third
billable roll-up, worth `0.001` on the sandbox account, and changed no verdict
either: the graded run now closes three windows rather than two.

## Imitation

The sibling probe was run for real, and it is the one result that came out worse
than the design-time screen suggested. The screen compared block text and put
containment at 23.5%–41.2% against a population median of 54.5%. Scoring an
actual imitation shows the block-text number missed something: a one-line
convention in a distant sibling decides the graded question.

Two implementations were written from the surviving siblings alone, differing
only in which convention they follow for the registration's timestamp, because
the siblings are split on it:

| imitation | reward | rules missed |
| --- | --- | --- |
| follows the four data-gatherer services, which omit the timestamp | 0.0 | `call_time_placement`, `redelivery_idempotent`, `windowed_rollup` |
| follows `standardMeasurementPreProcessor`, which passes its source's timestamp through | 0.0 | `request_path_meters` |

The first is the majority pattern, four sibling call sites to one, and it lands
squarely on the losing draft: it double-counts both redelivered calls and bills
one period 0.014 where the correct reading bills 0.003 in the first and 0.008
in the second.

The second is the case that made binary grading matter. It reaches the insight by
analogy — it passes the source's moment through because that is what its model
does with a measurement, not because of any reasoning about redelivery — and it
gets six of the seven rules right, including the account branch that a
constant-answering pipeline now fails, missing only the call-site rule, and missing
that only because its own call site omitted a timestamp and the store rejected
that write. Under weights it scored `0.95`, which would have made a solver who
reasoned about nothing look almost perfect. Under binary it scores `0.0`, which is
right: it did not deliver the capability.

So the honest reading is that imitation misses, and that where it appears to
arrive it arrives by luck and still does not finish. What keeps the task worth
having is that the *reasoning* is nowhere in the tree: no surviving code
deduplicates anything, no surviving code explains why a call's identity belongs in
the series key, and the two drafts are separated only by running them against
traffic that redelivers.

## What a late arrival is, and the false negative that made it say so

Eight frontier rollouts were graded on this task and one scored `0.0` on a
pipeline that was otherwise complete. It failed `call_time_placement` and
`windowed_rollup`, and both came from one deliberate decision: it kept a
billed-through watermark per platform customer and re-dated any arrival stamped
before that watermark onto the present instant, so that the call would still
reach an invoice. `.local/trees/remap-late-to-open` is that reading rebuilt, and
it reproduces the trial exactly — reward `0.0`, P sitting ~23,404s from its call
time, production windows billed `[0.004, 0.008]` against `[0.003, 0.008]`, and
the other five rules passing.

The rollout was reading the instruction, not ignoring it. The old text said a
late arrival may not "move an invoice" and may not "lose a call that has not been
billed yet", and under the graded convention the held-out late call P is recorded
and then never appears on any invoice at all, because the window it belongs to
was closed before it arrived. Whether that counts as losing it is precisely what
the sentence failed to say. Two readings were left standing and the scorer only
ever accepted one of them.

The scorer's reading is the right one — re-dating an event into a period it did
not happen in falsifies the meter, and it is the reading the rest of the
instruction assumes when it speaks of "the period it belongs to" — so the fix is
in `instruction.md` rather than in `tests/`. It now says that a call is recorded
at its own moment however late it turns up, that when a call reached you is not
part of the record, and that "not dropped on the floor" means the row is written
where the call happened, with the closed period not re-opened to bill it.
Relaxing `call_time_placement` instead was the alternative and was rejected: four
candidates fail on that rule and one fails on it alone, so accepting a
recording-time placement for P would have cost real discrimination to accommodate
a reading the task exists to rule out.

Two smaller things in the scorer were tightened at the same time, neither of them
the cause. Roll-up totals are now compared to a nanounit rather than by exact
float equality, since the smallest difference any rule needs to see is a
thousandth and no rule should turn on `0.007999999999999999`. And an unexpected
exception while applying the rules — a `recordValue` written as a quoted string,
say — is now reported as a harness failure instead of leaving behind a bare zero
that reads like the genuine zero this verifier hands to a pipeline that metered
nothing.

## Difficulty

Hard. Not because the code is long — the oracle is 244 lines — but because the
central decision is invisible until it is tested. Both drafts pass a hand-written
happy path. Getting it right needs the solver to notice that the store's
overwrite rule is doing the deduplication, and the cheapest way to notice is to
probe the sandbox store with two identical writes, which is two commands but only
occurs to someone who has framed the question that way. The surrounding work —
the bucket, the tag set, the window, the account branch — is ordinary and well
signposted, which is what leaves the difficulty concentrated where it belongs.

Binary grading makes it harder than it was, and in the right place. A solver who
writes a plausible pipeline without probing used to land at 0.40 and now lands at
`0.0`, and a solver who imitates the nearest sibling closely enough to get six
rules right also lands at `0.0`. There is no longer a way to be substantially
rewarded for a pipeline that meters everything correctly except the one thing the
task asks about.

## Layout

```
instruction.md            what the box is asked for
DISCOVERABILITY.md        every graded rule and its route
task.toml                 harness manifest
environment/
  Dockerfile              image
  task-init.sh            starts the store the box talks to
  gen_scenarios.py        builds both worlds and the run spec; never in the image
  workspace/              the deliverable
  mockaws/                emulated control plane and time-series store
  sandbox/metering.json   the recorded world served to the box
  verifier-data/          held-out world, run spec, trusted driver (root only)
  hardening/              terminal hardening
solution/
  solution.patch          the oracle
  solve.sh                applies it
tests/
  test.sh                 verifier entry point
  compute_reward.py       the verdict, root, loads no submitted code
```

`.local/` holds the verification harnesses, the trees and their run output. It is
not part of the package and is git-ignored. `incontainer-matrix.sh` is the one
that counts: it scores every tree inside a container built from
`environment/Dockerfile`, which is the shape the task actually ships as.
`matrix.sh` is the older workstation rig, kept because it is faster to iterate
against and because it still agrees.
