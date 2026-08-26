# Task 8 — business settings persistence

## The capability

Persist and serve a business's configuration document: a save carries the fields
it names and leaves everything else at whatever that business had stored, a
field sent blank is written rather than treated as unsaid, the nested
customer-facing page settings merge page by page and entry by entry, the
business-profile screen saves its own field set over the same document, and a
save that moves a business onto or off the cluster cost source starts or stops
the hourly collection behind it.

The hard part is that the platform's reader fills an absent field with a
starting value, and several of those starting values are not blank. A save built
from the submitted document alone does not merely lose what the caller omitted:
it rewrites approval preference, free-dimension visibility, invoice generation
mode, email delivery and all three cost sources to values the business never
chose, and the last of those silently unenrols the business from its hourly cost
collection as a side effect.

## What was removed

Purely subtractive. Applying `solution/solution.patch` to `environment/workspace`
reproduces upstream byte-for-byte under `diff -rq` across `src/`, `test/` and
`integration/` (verified).

| File | Lines restored |
| --- | --- |
| `test/api/settings.api-spec.ts` | 235 |
| `src/setting/dto/update-profile.dto.ts` | 136 |
| `src/setting/dto/update-settings.dto.ts` | 92 |
| `src/setting/settings.service.ts` | 89 |
| `integration/settings/settingsCrud.integration.spec.ts` | 47 |
| `src/setting/entities/settings.entity.ts` | 23 |
| `src/setting/settings.service.spec.ts` | 22 |
| `src/setting/settings.controller.ts` | 20 |
| **Total** | **664 across 8 files** |

The save that survives in the workspace writes the submitted document straight
through, which reads as a narrower product rather than a hole: the reader, the
entity, the influx row, the free-trial surface, the brand-image upload and the
read-only profile view are all intact and coherent. The profile save endpoint,
the deep merge helpers, the per-page update handler and the schedule transition
handler are the parts that are absent.

## Grading

Behavioural and binary. `tests/test.sh` stops the box's own emulator, refuses to
proceed unless it can take port 4566 itself, starts a fresh emulator over the
held-out ledger with an admin token minted in that process, replays eleven saves
under `env -i` against eleven businesses the box has never seen, then reads the
resulting ledger back over the admin channel. `tests/compute_reward.py` runs as
root, loads nothing from `/app`, and re-derives what each business should look
like from the recorded document plus the save itself. The reward file is written
zero first and only overwritten on success.

Two independent observations are compared per save: the row that landed in the
ledger, which the submission cannot narrate, and what the service answered when
the same business was read back afterwards. Schedule activity is captured by a
recorder standing in for the queue-backed scheduler, which is infrastructure
outside the deliverable.

Eight rules, each with a held-out case on its boundary:

| Rule | |
| --- | --- |
| R1 | unmentioned fields keep their stored value |
| R2 | a submitted blank clears, an omission does not |
| R3 | one customer-facing page changes and the others do not |
| R4 | switching a page off is a value, not a silence |
| R5 | the styling block merges key by key |
| R6 | the business profile saves over the same document, merging the same way |
| R7 | a profile save carries only profile fields |
| R8 | the hourly cluster-cost collection follows the transition, not the mention |

`DISCOVERABILITY.md` records the route for each.

## Sibling probe

The tree's parallel implementations of this shape are the document-backed
`update` methods on the service, customer and invoice resources, all of which
read the stored record and fold the submitted fields over it. The generous
transplant (`imitate-sibling`) puts that idiom into the settings save verbatim
and changes nothing else.

**Imitation reached 2 of 8 rules: R1 and R2.** It scored 0.0. Against the
untouched workspace, which reaches 0 of 8, the sibling is worth exactly the two
rules the prompt already states, and nothing that is not stated. It misses the
nested merge entirely (R3, R4, R5), has no profile surface at all (R6, R7), and
knows nothing about the schedule transition (R8). The sibling here is a
specification for the flat half of the capability and silent on everything that
distinguishes it.

## Two harness defects, and what they were

An early set of eight Opus 5 rollouts scored two of its trials 0.0 for solutions
that were correct, and the same mechanism was behind both. A third defect
surfaced while reproducing them. All are in the harness; none touches what the
eight rules check.

### The runner compiled the submission at a target the project never builds

`tsconfig.json` declares no `target`. Every path this tree actually uses supplies
one anyway: `tsc` infers ESNext from `module: NodeNext`, so `nest build` and
`nest start` emit native classes, and the repo's own API suite compiles at es2017
through `testTSConfig.json`. `ts-node` is the only loader that lands on its own
es5 default, confirmed inside the shipped image:

```
$ ./node_modules/.bin/ts-node --show-config
  "module": "nodenext", ... "target": "es5"
```

At es5 a `class` extending a call expression is emitted as
`_super.apply(this, arguments)`. Nest's `PickType`, `PartialType` and `OmitType`
return native ES2015 classes, which cannot be called that way. So a request DTO
written in this tree's dominant idiom throws inside `ValidationPipe` and answers
500 — and the idiom is genuinely dominant: `UpdateCustomerDto`,
`UpdateServiceDto`, `UpdateOfferingDto`, `UpdateDimensionDto`, `UpdateUsageDto`,
`UpdateWebhookDto` and about twenty more are all `extends PartialType(...)` or
`extends OmitType(...)`, and the sibling probe this task documents points a
solver straight at that family. Both false negatives wrote
`class UpdateProfileDto extends PickType(UpdateSettingsDto, [...])`. The oracle
happens to write a standalone class, so the defect was invisible from the
oracle's side.

Reproduced from the oracle by changing nothing but the DTO's construction style
(`fn-picktype-profile`): **0.0 before, with the two profile saves at 500 and
`Class constructor PickTypeClass cannot be invoked without 'new'` in the driver
log; 1.0 after.** es5 also mis-lowers `for...of` and spread over non-arrays, so
the same defect had more shapes than the one it was caught in.

`tests/test.sh` now hands the runner `TS_NODE_COMPILER_OPTIONS
'{"target":"es2017"}'` — the repo's own declared test target, which emits native
classes and keeps assignment semantics for class fields where ES2022 and above
would quietly change them. The override is read back out of the runner before the
replay, and a run that cannot confirm it is a harness failure rather than a zero,
because an override that silently stopped applying would look exactly like a
wrong answer.

### The read-back could be issued too early to see the save it followed

`getLatestSettings` bounds its query at `stop: new Date().toISOString()`, which
is truncated to milliseconds, and a Flux range excludes its stop. A row written
inside that same millisecond is therefore invisible and the reader falls through
to the business's previous row. The write timestamp comes from the Influx client,
which derives nanoseconds from a monotonic clock against a millisecond-granular
origin sampled once per process, so it can lead the wall clock by around a
millisecond — a fixed bias per run, which is why this surfaces as a whole run
going bad rather than as the odd step.

The emulator is faithful here, not broken. Proved directly, with a row at a known
timestamp and two queries differing only in `stop`:

| read-back's `stop` | rows returned |
| --- | --- |
| the millisecond the row was written in | 0 |
| one millisecond later | 1 |

It bit for real. The structurally different correct implementation scored 0.0 on
one run of the matrix and 1.0 on the six either side of it. The emulator records
every query it is asked, so the margin each read-back had is measurable rather
than inferred (`.local/read_back_margin.py`), and on the failing run **the six
businesses with a negative margin are exactly the six steps that failed**, six
for six. The margin on healthy runs was `+0.7 ms` at worst, so the whole matrix
had been running a millisecond from the cliff.

Nothing a submission can do avoids it: the reader, the entity and the client are
all outside the deliverable, and the faster a correct save answers, the likelier
it is to be scored wrong. The driver now leaves 25 ms between the save and the
read-back, which moved the worst margin across the whole matrix from `+0.7 ms` to
`+26.4 ms`. `compute_reward.py` also refuses to give a verdict at all if any
read-back still turns out to have been unable to see its save, so the residual
can only ever cost a re-run and never a zero. That check is bounded to a hundred
milliseconds, so a submission stamping rows into the future is still graded as
the wrong answer it is rather than escaping into a harness failure.

## Verification

Superseded by the in-container matrix below. Kept because it is what the
pre-round-9 rows were collected on.

Run without Docker. Every candidate had its own directory (`cp -a`, no cloning),
its own emulator instance, its own run directory for logs and observations, and
its own freshly minted admin token; `node_modules` is a symlink to one read-only
install shared across candidates, which is dependency state rather than scratch
state and is never written to. The emulator holds the whole world, buckets
included, in memory, so no two runs can reach the same object state on disk; the
only file it opens is the scenario it is handed, read-only, at startup.

Every row below was collected after the run isolation was tightened, and none
was carried over from before it. The verifier never signals a process by name,
only whatever holds its own port, so it cannot reach another task's emulator on
the same machine. It proves the endpoint that answered is the one it started by
making an admin call with a token minted for that run, both before the replay
and again afterwards, and a run that fails either check is recorded as a harness
failure that yields no verdict rather than as a zero. That distinction earned
its place during this re-run: one candidate's emulator was killed underneath it
mid-replay and the harness refused to score it. Under the previous arrangement
that run would have been written down as a legitimate 0.0 for that candidate,
and since 0.0 was also the expected verdict, nothing would have looked wrong.

| Candidate | Required | Actual | Rules reached |
| --- | --- | --- | --- |
| Oracle patch | 1.0 | **1.0** | 8 of 8 |
| `solve.sh` on a pristine workspace copy | 1.0 | **1.0** | 8 of 8 |
| Untouched workspace | 0.0, wrong answer not a crash | **0.0** (nine of eleven saves answered 200 with the wrong document, every read answered 200, no fatal; the two profile saves report no route because the workspace has none) | 0 of 8 |
| Structurally different correct implementation | 1.0 | **1.0** | 8 of 8 |
| `imitate-sibling` (sibling probe) | - | **0.0** | 2 of 8 |
| `wrong-merge-forgets-a-field` | 0.0 | **0.0** | 7 of 8, misses R1 |
| `wrong-blank-is-silence` | 0.0 | **0.0** | 7 of 8, misses R2 |
| `wrong-pages-wholesale` | 0.0 | **0.0** | 5 of 8, misses R3, R4, R5 |
| `wrong-page-enabled-truthy` | 0.0 | **0.0** | 7 of 8, misses R4 |
| `wrong-appearance-replace` | 0.0 | **0.0** | 7 of 8, misses R5 |
| `wrong-profile-form-is-complete` | 0.0 | **0.0** | 6 of 8, misses R6, R7 |
| `wrong-profile-accepts-everything` | 0.0 | **0.0** | 7 of 8, misses R7 |
| `wrong-schedule-on-mention` | 0.0 | **0.0** | 7 of 8, misses R8 |
| `wrong-serve-only` | 0.0 | **0.0** | 0 of 8, ledger holds only the submitted fields |

### The matrix, re-collected inside the container the task ships as

Local rigs disagreed with containers for several slots this round, so every row
below was taken by running `tests/test.sh` unmodified inside `cohort9-47:probe`,
built from `environment/`. A fresh container per candidate, `/app` overlaid with
that candidate's tree and the image's own `node_modules` left in place, nothing
published to the host network — the emulator answers on `127.0.0.1:4566` inside
the container's own namespace, so no two candidates and no two tasks can reach
the same one. `.local/run_container_case.sh` is the runner.

| Candidate | Required | Actual | Rules reached |
| --- | --- | --- | --- |
| Oracle patch | 1.0 | **1.0** | 8 of 8 |
| `solve.sh` on a pristine workspace copy | 1.0 | **1.0** | 8 of 8 |
| Structurally different correct implementation | 1.0 | **1.0** | 8 of 8 |
| `fn-picktype-profile` (the false negative, reproduced) | 1.0 | **1.0** | 8 of 8 |
| Untouched workspace | 0.0, wrong answer not a crash | **0.0** (nine saves answered 200 with the wrong document, every read answered 200, no fatal; the two profile saves report no route because the workspace has none) | 0 of 8 |
| `imitate-sibling` (sibling probe) | - | **0.0** | 2 of 8 |
| `wrong-merge-forgets-a-field` | 0.0 | **0.0** | 7 of 8, misses R1 |
| `wrong-blank-is-silence` | 0.0 | **0.0** | 7 of 8, misses R2 |
| `wrong-pages-wholesale` | 0.0 | **0.0** | 5 of 8, misses R3, R4, R5 |
| `wrong-page-enabled-truthy` | 0.0 | **0.0** | 7 of 8, misses R4 |
| `wrong-appearance-replace` | 0.0 | **0.0** | 7 of 8, misses R5 |
| `wrong-profile-form-is-complete` | 0.0 | **0.0** | 6 of 8, misses R6, R7 |
| `wrong-profile-accepts-everything` | 0.0 | **0.0** | 7 of 8, misses R7 |
| `fn-picktype-profile-too-wide` | 0.0 | **0.0** | 7 of 8, misses R7 |
| `wrong-schedule-on-mention` | 0.0 | **0.0** | 7 of 8, misses R8 |
| `wrong-serve-only` | 0.0 | **0.0** | 0 of 8, ledger holds only the submitted fields |

Every rule attribution is identical to the pre-round-9 rows, which is the point:
the target the submission is compiled at decides whether a mapped-type DTO can be
instantiated, and nothing else about what the eight rules see.

`fn-picktype-profile-too-wide` is the pair that keeps the target fix from being a
loosening. It is the same idiom as the false negative — `UpdateProfileDto extends
PickType(UpdateSettingsDto, ...)` — with non-profile fields in the pick. It now
loads, gets as far as writing `invoiceApproval` over a business that had chosen
`automatic`, and scores 0.0 on R7 alone. The fix accepts the idiom, not a wrong
field set.

Both guards were exercised rather than assumed. Pointing the runner at a target
other than es2017 produces `HARNESS FAILURE ... reports target 'es3' rather than
the project's es2017` and no verdict. Replaying the scorer over the failing run's
own recorded observations produces `HARNESS FAILURE: the read-back was issued too
early to see the save it followed, for: biz_hold_ardley (row 1.377 ms past the
read-back's bound), ...` where it used to produce a 0.0, while the healthy run of
the same candidate still scores 1.0 and `wrong-appearance-replace` still scores
0.0 on its own failure.

### Every wrong reading is wrong on the wire, not only in its diff

A mutation that is real in the source but undone before anything leaves the
process tests nothing, however convincing its diff looks, and it reproduces its
wrong verdict perfectly on every re-run. So each candidate's served responses,
its recorded documents and its scheduling calls were compared against the
oracle's directly, without consulting anything the scorer produced. The
structurally different correct implementation is the control: its output is
identical to the oracle's at every step, which is exactly the signature a
masked mutant would show.

| Candidate | The value it actually got wrong |
| --- | --- |
| `wrong-merge-forgets-a-field` | Thornbury's stored `vatId` comes back `""` where `GB 771 4432 21` is owed, and the recorded document drops the tag entirely; same for Selby's `GB 615 3320 88` |
| `wrong-blank-is-silence` | Marlowe's `vatId` comes back `GB 220 9981 47` after a save that submitted it blank, and the ledger keeps the old value where the oracle records none |
| `wrong-pages-wholesale` | Calder's untouched pages come back at their constructor defaults, `payment.text` `"Payment"` where `"Pay the studio"` is owed, and the recorded pages collapse to `{"invoice":{"text":"Statements"},"payment":{},"offering":{}}` |
| `wrong-page-enabled-truthy` | Teviot's `pages.invoice.enabled` comes back `true` after a save that switched it off, and the ledger records `"enabled":true` |
| `wrong-appearance-replace` | Amberley's `pages.offering.appearance` loses `border` and `radius`, recording `{"accent":"#0969da"}` where all three keys are owed |
| `wrong-profile-form-is-complete` | Fenwick's `businessName`, `addressLine1`, `addressLine2`, `state`, `country`, `postalCode` and `sendInvoiceEmail` all come back blank after a profile save that named none of them |
| `wrong-profile-accepts-everything` | Ravensworth's `invoiceApproval` comes back `manual` where the stored `automatic` is owed, because the profile save honoured a field that is not part of a profile |
| `wrong-schedule-on-mention` | Wenlock is enrolled at `biz_hold_wenlock-getAndCommitPODCost` on a save that restated the cluster source it was already on, where the oracle schedules nothing |
| `wrong-serve-only` | Every stored value on every business, 43 of them on Thornbury's step alone, comes back at its default |

### Which rules stand alone

Six of the eight are the sole failure of some candidate, which is what makes
them load-bearing. Two are not, and rather than manufacture a candidate to
paper over it, here is what happened when I tried.

**R3 rides along with R4 and R5, and cannot be separated from them.** The
intended isolating candidate was one that keeps the page the caller named and
drops the pages they did not. It scored as a masked mutant: the sibling pages
survived it untouched, because the incoming document always materialises all
three pages whether the caller mentioned them or not, with the fields of the
unmentioned ones left undefined. So there is no such thing as a page the
request omits, and the only way to get a sibling page wrong is to mishandle an
undefined field, which is the same mechanism R4 and R5 test. That candidate was
discarded rather than recorded, since its name described something it did not
do. `wrong-pages-wholesale` breaks R3 for real, and breaks R4 and R5 with it.

**R6 rides along with R7.** Both profile rules are exercised through the same
save, so a broken profile merge shows up in both steps;
`wrong-profile-form-is-complete` breaks exactly those two and nothing else. The
converse is not true, which is the part that matters: `wrong-profile-accepts-everything`
breaks R7 alone, so the whitelist rule is load-bearing on its own even though
the merge rule is not separable from it.

R1 does stand alone, but only narrowly. A broken top-level merge normally
disturbs every step at once, because each step compares the whole served and
recorded document. `wrong-merge-forgets-a-field` is the narrowest available
version: a hand-rolled carry-forward list missing one field, chosen so that the
field is stored on the two businesses R1's steps use and named in the payload
of the one step that would otherwise have caught it. It is a realistic bug for
anyone who writes the merge as an explicit field list.

Nine wrong readings plus the untouched tree, each failing for its own reason.
`wrong-serve-only` legitimately trips everything because the ledger side of
every check fails at once.

### The emulator's write path, and how close it came to mattering

The configuration store's client compresses any payload over a kilobyte, and
when it compresses it sends no declared length, so the body arrives framed as
chunks. The emulator this task started from took the body from the declared
length alone, which reads as empty in that case: the document is dropped, the
client is told the write succeeded, and nothing anywhere reports an error. Both
halves are fixed here, and the fix is worth stating because the failure it
prevents is not a flaky one. It is a threshold, so a run either sits entirely
below it and looks perfect or crosses it and loses writes consistently.

**These recorded rows were never exposed, by size rather than by luck of
timing.** The largest document any graded step writes is Thornbury's at 881
bytes of line protocol, 88 percent of the 1000-byte threshold, and the smallest
is 279. Nothing crossed. The whole matrix was nonetheless re-collected on the
fixed emulator and every row is identical, so the point is settled by
measurement rather than by argument.

The margin is thin enough to be worth removing anyway, and the reason is about
fairness rather than tidiness: a submission that records the same document in a
slightly bulkier form, say by serialising the nested pages with whitespace or
by carrying a field this reference does not, would cross the threshold, lose
its writes, and be scored as having answered wrongly. The fix removes a way for
the harness to blame a submission for its own defect.

Probed directly rather than reasoned about. Writing a 1423-byte document
through the real client against the unfixed emulator: the client reports
success, and the read that follows fails outright, because the body nobody
consumed is still in the socket and the next request on that connection is
parsed as garbage. Against the fixed emulator the same write reads back with
all eight fields matching. The probe is `.local/probe_write.ts`.

The structurally different implementation differs in mechanism rather than
layout: a single generic recursive fold over the whole document instead of a
per-page handler, a service-side field allow-list instead of a narrow request
document, the schedule transition compared inline rather than in a static helper
on the entity, and the profile route registered on the private controller rather
than inherited from the public one.

Also confirmed: the generator reproduces the shipped documents byte-for-byte;
sandbox and held-out businesses share no identifiers; the sandbox carries an
instance of every case class the grader distinguishes (a document recorded away
from the defaults on every field, a document that was never recorded with most
of them, fields recorded blank next to fields carrying values, a full nested page
block with a styling block, and both sides of the cluster cost boundary).

## Difficulty

**Measured with the harness defects above corrected: Opus 5 scored 8 of 8 and
Muse Spark 1.2 scored 4 of 8.** Those are the numbers to argue from, not the
estimates below. Before the correction Opus recorded 6 of 8, and both of the
missing trials failed only on the DTO construction style.

**Frontier model: usually solves it, perhaps 6-8 in 10.** The four stated rules
carry the flat merge and the nested merge, and the surviving tree hands over the
rest to anyone who reads it: the per-page reader shows the `undefined` versus
`false` convention in the same file a solver is already in for the nested merge,
and the uncalled enrol/unenrol pair is a strong signal. The two places it can
still lose are the transition condition, where the defensible-but-wrong reading
is "the save mentioned the cost source" rather than "the value crossed the
boundary", and the interaction that makes this task more than the sum of its
rules: a save built from the submitted document alone drops the business off the
cluster source as a side effect, which then produces a schedule call nobody
asked for. Get the merge wrong and R8 fails too, from code that looks correct.

**Weaker model: usually produces something plausible and wrong, perhaps 1-2 in
10.** It will very likely reach the flat merge, because the prompt states it and
three surviving siblings demonstrate it, and that is exactly where the sibling
probe lands. Past that it has to notice that the nested block is not a value, that
a page's switch is not a truthiness test, that a documented route exists with a
field set narrower than the document it writes into, and that a schedule follows
a transition. Under one binary reward, four independent chances to be
plausibly wrong is a wide gap.

## Things worth knowing

- The verifier drives the submission with the project's own TypeScript runner
  rather than a transpiler, because the framework this service is built on
  resolves its wiring from compiler-emitted type metadata, which a transpiler
  does not produce. A small resolution hook lets the tree's compiled-form
  imports load straight from source. The target is pinned to the repo's own
  es2017, because the runner's default is es5 and no path in this project
  compiles at es5; see the defect notes above.
- The driver leaves 25 ms between a save and the read-back that observes it. The
  reader's query bound is millisecond-truncated and exclusive, so a read-back in
  the same millisecond as the write cannot see it; see the defect notes above.
- The settings module sits inside an import cycle with the tax module, so the
  driver pulls the application root in first to fix the evaluation order the way
  the running service does. Task 27's notes flag the same cycle.
- The scheduler is queue-backed and would otherwise want a broker. The driver
  substitutes a recorder at that boundary, which is infrastructure outside the
  deliverable, and reads what the submission asked for rather than running it.
- The offering entries inside the styling page are not graded and no held-out
  business carries any, because validating them belongs to the offering
  capability rather than to this one.
