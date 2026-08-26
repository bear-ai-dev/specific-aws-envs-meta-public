# Discoverability

Every rule the verifier grades, and how a solver who has never seen the answer
can arrive at it. A rule is **stated** if the prompt says it, **derivable** if
surviving code in the workspace specifies it, and **observable** if the sandbox
estate or the usage it recorded shows it.

Sandbox material referred to below:

- `/opt/billing-sandbox/public.json` — the estate the emulator serves, readable.
- `/opt/billing-sandbox/recorded-usage.json` — usage the platform stored for
  `biz-northwind` on `dim_sbx_egress` during one earlier five-minute run against
  that same estate. Five entries, one per customer billed.
- the emulator itself, at `AWS_ENDPOINT_URL`, answering `DescribeInstances`,
  `ListMetrics`, `GetMetricStatistics` and `GetMetricData`.

## The graded rules

### 1. A machine is enrolled by its tags

Counted only if its dimension tag's comma-separated list contains the dimension
this run is for, and it also carries a customer tag.

- **Stated.** The prompt describes both tags, the comma-separated list, and that
  a machine failing either test is no part of the run.
- **Derivable.** Both surviving gatherers in `src/microservices/` apply exactly
  this gate, and `ArrayGroupBy` in `src/utils/shared/utils.ts` is the grouping
  those two tags feed.
- **Observable.** The sandbox estate carries all four cases: enrolled on this
  dimension, enrolled on another, enrolled on both, and enrolled with no
  customer tag. Only the first and third appear in the recorded usage.

### 2. Bytes transmitted, not bytes received

- **Stated.** "bytes leaving the machine rather than arriving at it".
- **Observable.** Every machine in the sandbox publishes both directions with
  different figures. `cus_harborlight` is recorded at 6,500,000; the inbound
  series for its two machines total 18,750,000.

### 3. The figure is the total of the interval's observations, not their average

- **Stated.** "charge its customer the total it sent".
- **Observable.** Sandbox machines publish three, four or five observations in
  the interval, deliberately uneven and a different count per machine. Each
  recorded figure is the sum of the observations belonging to that customer's
  machines: `cus_stanchion` is recorded at 250,000 against observations of
  68,182, 68,182, 68,182 and 45,455. No average, and no multiple of any single
  observation, reproduces the recorded figures.

### 4. Power state does not gate the measurement

- **Stated.** "a machine that has since been stopped or torn down still sent
  whatever it sent while it was up".
- **Observable.** `cus_glasswing` is recorded at 1,750,000 and its only enrolled
  machine is `stopped`. `cus_windlass` is recorded at 640,000 and the machine
  that sent those bytes is `terminated`. The surviving running-time sampler
  filters to running machines, so this rule is the one place where copying it is
  actively wrong, and the recording is what says so.

### 5. A machine that reported nothing contributes nothing, and a customer with no reporting machine is not billed at all

This is the rule the task exists for, and it is **observable only**. It is not
stated, and no surviving code specifies it.

- `cus_pellucid` has two enrolled machines in the sandbox estate. One has never
  published the transmitted-bytes series at all. The other publishes it, but its
  only readings are a day old. `cus_pellucid` has no entry in the recorded usage
  — not an entry of zero, no entry.
- The emulator distinguishes the two answers in both request shapes, which is
  what the real API does. A `GetMetricStatistics` call for a machine with
  nothing in the window returns an empty datapoint list. A `GetMetricData`
  `SELECT` returns no result for that series at all, because a Metrics Insights
  query answers about the series it found readings for. Neither shape ever
  reports a zero for a series that said nothing.
- `ListMetrics` shows that the day-old machine's series exists, so the absence
  is visibly an absence of recent readings rather than an absence of a metric.

### 6. A machine that reported zero did report, and its customer is billed at zero

The other half of rule 5, and also **observable only**.

- `cus_marlinspike` appears in the recorded usage with a figure of 0. Its one
  enrolled machine publishes the series and its readings in the interval are
  zero.
- Rules 5 and 6 have to hold together. Defaulting an absent reading to zero
  satisfies 6 by breaking 5; dropping every zero satisfies 5 by breaking 6.

### 7. A customer's machines add up, and a silent one among them suppresses nothing

- **Stated.** "what each of them sent adds into that customer's single figure".
- **Observable.** `cus_windlass` has two enrolled machines, one reporting and
  one that has never published the series, and is recorded at exactly what the
  reporting one sent. `cus_harborlight` has two machines both reporting and is
  recorded at their sum.

### 8. Bytes, unrounded and unconverted

- **Stated.** "in bytes, neither rounded nor converted to any larger unit".
- **Observable.** Recorded figures run from 0 to 6,500,000 and are exact.

### 9. One figure per customer, filed against the dimension the run is for

- **Stated.** "one figure per customer against the dimension the run is for".
- **Derivable.** Both surviving gatherers take the dimension identifier from the
  run's own parameters rather than from a machine's tag, which matters because a
  machine's tag may name several dimensions.
- **Observable.** The recorded usage has one entry per customer, each carrying
  `dim_sbx_egress`, including for the customer whose machine is tagged for two
  dimensions.

## The publication path is observed, not graded

An earlier draft of this document listed "usage is recorded the way the platform
records usage" as a tenth graded rule. It is not graded, and an audit caught the
claim. The driver captures usage by wrapping `StandardMeasurementEntity.publish`,
but when a collector publishes nothing it falls back to whatever the collector
returned. A candidate built to check this — correct arithmetic, rows handed back
to the caller instead of recorded — scores **1.0**.

That fallback is deliberate: a collector that returns its rows for a caller to
record is a legitimate shape, and failing it would punish a correct answer for a
matter of plumbing. So the publication path is how the answer is *observed*, and
the prompt still asks for it, but nothing about it is scored. Nine rules are
graded, and they are the nine above.

## Constraints that are forced rather than graded

These are not scored on their own. A submission that gets them wrong produces no
usable figures and fails the rules above, and each announces itself on the first
local run.

- **Metric query identifiers are validated.** `GetMetricData` requires each
  query id to start with a lowercase letter and hold only letters, digits and
  underscores, so a machine id cannot be used as one. The emulator rejects an
  invalid id with a `ValidationError` naming the rule, exactly as the real API
  does.
- **The interval has to have settled.** A window confined to the last few
  minutes finds nothing at all, in the sandbox as in the held-out estate. Any
  lookback reaching back past roughly six minutes sees the whole interval, so
  the rule is forgiving; a run against the sandbox that returns nothing is the
  signal.
- **Cross-account access.** The estate is a separate account reached by assuming
  the role the run names, with the external id it names. The role's trust policy
  in `public.json` states the requirement, and the surviving gatherers show the
  credential provider the codebase uses.

## What is deliberately not discoverable

The held-out estate. It shares no account, business, dimension, customer,
machine identifier or magnitude with the sandbox, and it is `0600` root-only in
the image. The generator that produced it never enters the image.

## One known divergence kept off the graded surface

The surviving gatherers group by the raw value of the dimension tag paired with
the customer tag, so a customer owning both a machine tagged for one dimension
and a machine tagged for several would receive two entries for one dimension.
That is a defect in the platform, not a rule worth teaching, so no customer in
either estate is arranged that way, and the grader's "one figure per customer"
holds without depending on it.
