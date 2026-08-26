# Discoverability

Every graded rule and the route by which a solver can find it without guessing.
Three kinds of route appear below: **surviving code** in the tree, the
**recorded world** the box's store serves on port 4566, and a **probe** the
solver can run against that store. `instruction.md` states the product contract
and nothing about how idempotency is achieved.

## The recorded world

`/opt/metering-sandbox/metering.json` is served to the box at start-up. It holds
a stretch of the platform metering its own traffic for one tenant, across a
production platform account and a sandbox one:

- `dogfood-aggregate-bucket` — thirteen `tokenConsumer` registrations spread over
  two six-hour periods, tagged `customerId`, `dimensionId`, `businessID`,
  `metadata_tokenType`, and on the per-request ones `metadata_uuid`; field
  `recordValue` of `0.001` for a served request and `0.1` for an accepted
  measurement.
- `dev-usage-data` — three `usageMeasurement` roll-ups, each equal to the sum of
  its own period's registrations for its own account (`0.002` at 12:00, `0.206`
  and `0.003` at 18:00), plus two rows of the tenant's own measurement traffic
  under the tenant's own `businessID`, so the platform's rows are visibly a
  separate account rather than a relabelling.
- `prod-config` — the two platform customer documents, each carrying the tenant
  `businessID` it belongs to in its metadata.

## Rule by rule

### `registration_shape`

One `tokenConsumer` row per API call in the aggregate bucket, tagged with the
platform's own customer for that tenant, the platform account, that account's
dimension, and valued at the call's amount.

- `TokenConsumerAsyncProcessor.tokenAggregateBucket` is `'dogfood-aggregate-bucket'`.
- `TokenConsumer._measurement` is `'tokenConsumer'`.
- `InfluxService.aggregateMeteringCoToken` survives and reads exactly that bucket and
  measurement, requires `exists r.customerId`, filters on one `customerId`, and
  accepts only `businessID == "meteringco-production" or "meteringco-sandbox"`. It is the
  contract the registration has to satisfy to be readable at all.
- `MeasurementFormat.getPointForm` survives, and every one of the eight surviving
  publish sites reaches it through `StandardMeasurementEntity.subscribe`: it tags
  `customerId`, `dimensionId` and `businessID`, writes `recordValue` as a float
  field, and turns every metadata key into a `metadata_<key>` tag.
- `TokenConsumerService.getMeteringCoCustomerId` survives: how the platform's own
  customer for a tenant is resolved, and it returns that customer's
  `saasCustomerAssociatedBusinessID` alongside the id.
- The recorded world supplies the two dimension identifiers and the two amounts.

### `identity_in_series_key`

Two calls handed over inside one millisecond both survive, held apart only by
the identity each carries.

- `MeteringCoTokenMetadata` is `{ [key: string]: string; tokenType: TokenType }`: an
  open map, so identifying keys beyond the type are expected.
- `getPointForm` puts metadata into **tags**, not fields, which is what makes a
  metadata key part of the series key.
- Every per-request registration in the recorded world carries `metadata_uuid`.
- Probe: write two rows to the sandbox store that differ only in a metadata tag
  and read the bucket back. Both are there. Drop the tag and one replaces the
  other.

### `call_time_placement`

A registration sits at the moment of the call, not the moment the platform got
round to recording it.

- `MeteringCoToken`'s constructor keeps `meteringcoToken.timestamp` when there is one and
  falls back to `new Date().toISOString()` only when there is not, so a token is
  a thing that carries its own moment.
- `getPointForm` does `point.timestamp(new Date(measurement.timestamp))` with no
  default of its own. A registration path that builds a bare `MeasurementFormat`
  and calls it must therefore choose a timestamp explicitly; leaving it out
  produces an invalid instant and the store rejects the write outright. The
  decision cannot be skipped by accident.
- In the recorded world the sandbox account's 13:22 call sits before its 14:05
  call even though the recording shows it was delivered second, so registrations
  visibly sit at call time rather than delivery time.
- `instruction.md` states that delivery is unordered and that a call can arrive
  after the period it belongs to has been billed. It also settles what happens
  then, which it did not used to: a call is recorded at its own moment however
  late it turns up, when a call reached you is not part of the record, and a late
  arrival is never re-dated forward into a period it did not happen in. A graded
  rollout previously read the earlier wording as licence to re-date such a call
  into the open period so that it would still reach an invoice, and lost an
  otherwise complete pipeline to it; see the false-negative section of
  `README.md`.

### `redelivery_idempotent`

A call handed over twice, with a flush and a closed period between the
arrivals, leaves one registration.

- Probe, and the intended route: write the same measurement, tag set and
  timestamp to the sandbox store twice, in two separate requests, and read the
  bucket back. There is one row. Change only the timestamp and there are two.
  The store's own semantics are what settle this, and they are two commands
  away.
- `instruction.md` states delivery is at-least-once and that redelivery must not
  move an invoice.
- Nothing in the surviving tree does deduplication of any kind, in this pipeline
  or in any of the eight neighbouring measurement publish sites across seven
  files, which is itself evidence about where the property is expected to come
  from.

### `windowed_rollup`

Each window produces one billable roll-up worth exactly that window's traffic.

- `TokenConsumerAsyncProcessor.aggregationProcessor` is `'aggregation-processor'`
  and `TokenAsyncAggregatorDto` names it, along with optional `startDate` and
  `endDate`. Deliberate route: the DTO is the specification of the job's window
  and nothing in the workspace reads it.
- `SupportedMeasurementFrequencies.everySixHours` is `'0 */6 * * *'`.
- `DatetimeUtils.sixHoursAgo` survives with no caller. Deliberate route.
- `scheduleTokenProcessor` survives and shows exactly how a job for this
  processor is registered, including the `scheduleParameters` a handler reads its
  window out of, and `loadTokens` shows the handler signature.
- `aggregateMeteringCoToken` survives: `range(start, stop)`, then
  `group(columns: ["_measurement"])`, then `sum()`.
- The recorded world has two roll-ups six hours apart and the earlier period's
  calls are in the earlier roll-up only.

### `platform_account`

The roll-up is billed to the platform's own account **for that customer**, and to
that account's dimension: not to the tenant, and not to whichever account a
recording happened to show.

- `aggregateMeteringCoToken` names both platform accounts as Flux literals.
- `getMeteringCoCustomerId` returns `saasCustomerAssociatedBusinessID`, which is the
  input the branch turns on.
- `UsageEntity._measurement` is `'usageMeasurement'`.
- The recorded world contains **both** accounts, each with its own dimension, so
  the pairing is readable.
- The held-out run contains both as well: its two platform customers sit on
  different accounts of the platform's, and a window is closed for each. So no
  constant is right for both, and the value has to come from the customer. A
  pipeline that answers "production" unconditionally is wrong about one of them,
  which is the same mistake as copying the recording's sandbox pair, in the other
  direction.

### `request_path_meters`

Serving a measurement meters the call that asked for it.

- `instruction.md` states it.
- `TokenRegisterInterceptor` survives, is applied to twenty-nine routes, and its
  own audit messages say its job is to load tokens. Deliberate route.
- `UsageController` passes `request?.user?.sub` into `UsageService.create`, whose
  `subject` parameter the current body has no use for. Deliberate route.
- The recorded world shows the two amounts side by side, so accepted
  measurements are visibly metered at a different rate from served requests.

## Leftovers that are deliberate routes

Spec section 4 asks that anything left behind naming the capability be a
documented route rather than an accident. These are those:
`TokenAsyncAggregatorDto`'s `startDate`/`endDate`, read by nothing;
`TokenConsumerAsyncProcessor.aggregationProcessor`, named by that DTO but with
no handler; `DatetimeUtils.sixHoursAgo`, uncalled; `TokenRegisterInterceptor`'s
"Failed to load tokens" audit messages; and `UsageService.create`'s unused
`subject`.

One leftover is **not** a route: `FIVE_MINUTES_IN_MS` in
`tokenRegisterInterceptor.ts` is unused in the upstream tree as well, so its
presence is not evidence of anything and it was left where it was found.
