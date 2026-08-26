# Task 7 — API keys and environments

**The capability.** A tenant administrator can see the machine credentials their
account holds in the environment they are working in, rotate one, and retire one
for good — and because the environment the caller is in decides which account
the request resolves to, the same person sees a different set of credentials in
sandbox than in production, a credential from the other environment is out of
reach, and a retired credential stops being accepted immediately rather than
when something expires.

The insight worth grading is that the environment is not an authentication
detail. It selects the account, and the account selects the credentials, the
configuration rows and the data behind them. A submission can get the routes,
the guards and the provider calls right and still leak every tenant's
credentials into one listing — the sibling probe below does exactly that.

## What was taken out

Removal counts are lines the reference solution adds back, measured from
`solution/solution.patch`.

| File | Restored | Also modified |
| --- | ---: | ---: |
| `src/users/entities/key.entity.ts` | 226 | — |
| `src/users/users.controller.ts` | 99 | 1 |
| `src/users/users.service.ts` | 98 | — |
| `src/users/dto/update-environment.dto.ts` | 33 | — |
| `src/users/dto/readTokens.dto.ts` | 28 | — |
| `src/users/users.service.spec.ts` | 14 | — |
| `src/users/entities/onboarding.entity.ts` | 12 | 8 |
| `src/users/entities/environment.entity.ts` | 9 | — |
| `src/users/users.module.ts` | 4 | 4 |
| **Total** | **523** | **13** |

**9 files, 523 lines added.** That is 27 short of the 550 floor and the file
count is at the top of the range. The obvious way to close the gap was to take
the environment branch out of `src/interceptors/businessID.interceptor.ts` as
well, which the slot brief suggested; it was tried and reverted, because that
branch reads the `environment` request header and nothing the driver sends uses
that header, so removing it would have added lines the grader never exercises
and left an orphan seam in the workspace. The number is reported as it is rather
than padded.

`instruction.md` is 2,170 characters.

## The graded rules

Eight rules, all behavioural, all re-derived by the verifier from the world
document and the endpoint's final state. Reward is 1.0 only when every rule
holds. Routes are in `DISCOVERABILITY.md`.

1. The credential listing is the account's own, in the environment the operator is in.
2. Changing environment changes the account the request resolves to.
3. Rotating a credential replaces its secret and leaves every other credential alone.
4. Revoking a credential removes it and retires the configuration behind it.
5. A revoked credential stops being able to reach the API at once.
6. A credential outside the caller's current account can be neither read nor changed.
7. A sign-in that may only read cannot rotate or revoke.
8. Work done in one environment leaves the other environment's credentials as they were.

## Verification

**Every row below was scored inside the image this task ships as**, one
container per candidate, built from `environment/Dockerfile` and driven by
`tests/test.sh` exactly as Harbor will drive it. Each row was also scored
locally, and the two agree on every reward and every failed-rule set.

Two things had to be fixed before the container agreed with anything. The
verifier passes its environment to `su agent -c "... env -i ..."` as a string
that a second shell re-splits, and one assignment — `NODE_OPTIONS`, which
carries the identity shim — contains a space. Unquoted, the word after that
space became the command name, so `env` exited 127 before anything was compiled
or driven, and both the oracle and the untouched tree scored 0.0 with identical
reports. Each assignment is now quoted for that second parse, with `env -i`
untouched, since that isolation is what keeps the verifier's paths and secrets
out of a process that loads submitted code.

The second fix is that this was recorded as a wrong answer rather than as a
broken harness. A build or driver that cannot be executed at all, a driver that
does not complete, and a missing transcript are now all recorded with
`harness_failure: true`; so is an unexpected exit anywhere in the script, which
is what the fail-closed reward written before anything runs now says. A
submission that fails to compile still exits non-zero in the ordinary way and is
still graded as the wrong answer it is.

The harness is confined to this task's own port block, 21600–21699, with a
per-run random admin token proving that the endpoint answering was this run's
and was holding this run's world before any score was believed. Rows collected
before that was true were discarded and re-run.

The endpoint reads bodies framed the way a client actually sends them, not only
the way a small write happens to arrive: `mockaws/server.py` decodes
`Transfer-Encoding: chunked` and `Content-Encoding: gzip`. Reading the body from
`Content-Length` alone loses a streamed write entirely and still answers 204,
which is a silent data loss that reads exactly like a broken submission. This
task's own writes are 92, 95 and 157 bytes and are neither chunked nor
compressed, so no row here was ever exposed; the reader is correct anyway,
because the agent can write to the sandbox endpoint in whatever shape it likes.

| Candidate | Reward | Rules failed |
| --- | ---: | --- |
| Reference solution (oracle) | **1.0** | none |
| Same behaviour, different structure | **1.0** | none |
| Shipped workspace, untouched | 0.0 | 1, 2, 3, 4, 5, 7, 8 |
| Sibling imitation (see below) | 0.0 | 1, 2, 3, 4, 5, 6, 8 |
| Listing returns every credential the provider holds | 0.0 | 1, 2, 3, 6, 8 |
| Environment change acknowledged but not persisted | 0.0 | 2, 3, 4, 5, 6, 8 |
| No check that the account holds the credential | 0.0 | 3, 6, 8 |
| Rotation reports success without asking the provider | 0.0 | **3 only** |
| Revocation withdraws the credential but leaves its row | 0.0 | **4, 5** |
| Every key route guarded by the read permission | 0.0 | 4, 5, **7** |

Every rule is failed by at least one candidate that passes the others, so no
rule is decorative. Rule 1 is isolated by the listing candidate, rule 2 by the
unpersisted environment change, rule 3 alone by the inert rotation, rules 4 and
5 by the half-done revocation, rule 6 by the missing ownership check, rule 7 by
the mis-scoped guard, rule 8 by three of them.

### What each zero is evidence of

A mutation that is real in source but inert in behaviour tests nothing, so each
candidate below is described by what it *did*, read out of the recorded session
and the endpoint's final state rather than out of its diff. Every one of them
diverges from the reference on something the grader can see; none is
indistinguishable.

| Candidate | The observable wrong thing |
| --- | --- |
| Lists every credential the provider holds | The production listing returns **13** credentials instead of 2 — both tenants' keys, both environments, three console sign-ins, the management credential and two applications nobody claimed. The sandbox listing returns 12 rather than the account's 2. |
| Environment change not persisted | The switch answers 200 and the listing that follows it returns **the production pair**, `keyWindermereProdBilling` and `keyWindermereProdEvents`, where the reference returns the sandbox pair. Every subsequent act lands in the wrong environment: it rotates nothing, retires `keyWindermereProdEvents@clients` — a *production* row — and withdraws `keyWindermereProdEvents` at the provider. |
| No ownership check | Rotates another tenant's `keyAshcombeProdEvents`, rotates the retired `keyWindermereProdLegacy`, rotates `keyWindermereProdEvents` from the wrong environment, and destroys the unclaimed `appMeteringCoDocsSite` at the provider. The unclaimed deletion then answers 401, so the status alone would have looked like a refusal — rule 6 catches it because it also requires the credential to have survived, and this one did not. |
| Rotation never asks the provider | Answers 200 and is byte-identical to the reference on **every exchange in the session**. Its only trace is in the endpoint's state: `secret_changed` is empty where the reference changed `keyWindermereSbxDrill`. Detected by the world, not by the response. |
| Revocation leaves the row in force | Two divergences and no others: `keyWindermereSbxEvents@clients` is not among the retired rows, and the credential's own token still answers **200** after its revocation where the reference answers 401. |
| Read permission guards every route | `viewer.rotate` and `viewer.revoke` answer **200** where the reference answers 403. The knock-on is visible too: the viewer's revocation lands first, so the sandbox key's own token is already refused with 401 before the operator's session reaches it. |
| Sibling imitation | The production listing returns 13 credentials; a revoked credential's token still answers 200; three secrets change where one should; `keyWindermereSbxEvents@clients` is never retired; and every out-of-reach act — another tenant's, the other environment's, the retired one, the unclaimed one — answers 200. |
| Shipped workspace | Every graded route answers 404 while `/health` answers normally, and nothing at the provider or in the store changes. |

The structural variant's only divergence from the reference is that it refuses
the five out-of-reach acts with **403 instead of 404**, and it still scores 1.0.
That is the same fact from the other direction: the grader reads behaviour, and
status wording is not part of it.

The structural variant decides membership from an explicit set of the account's
identifiers rather than by reusing the single-credential lookup, refuses with a
forbidden rather than a not-found, and words every response differently. It
scores 1.0, which is the evidence that the grading is behavioural.

## Sibling probe

The probe implements the capability by following the patterns the surviving tree
makes obvious and doing nothing else: the account comes off the request the
interceptor prepared, each verb is guarded by the permission enum member named
after it, writes go through a transformer and `loadPoints`, and provider-side
acts call the provider. Where the tree offers no pattern to copy — reconciling
the provider's credential list against the tenant's own configuration, retiring
the account behind a withdrawn credential, invalidating the cached account after
an environment change — the probe simply does not do it.

**It reaches 1 rule of 8**, rule 7, and only because `keys:read`, `keys:update`
and `keys:delete` are sitting in an enum with self-describing names. It compiles,
it answers 200 on every route, and it is comprehensively wrong: it lists all
thirteen credentials the provider holds to every caller, it withdraws a
credential at the provider and the credential's own token keeps working
afterwards, and its environment switch is written down but never takes effect
because the account it replaces is still cached. Imitation gets the surface and
none of the meaning.

## Difficulty

**Frontier model: hard but tractable.** The surface is fully specified — the
private API document that survives in `docs/` names all four routes, their verbs
and their response envelopes — so nothing is guessed about shape. What has to be
worked out is that a credential belongs to a tenant because the configuration
store holds a row for it, not because the identity provider says so; that is
visible in the sandbox world, where every credential has a `<clientId>@clients`
row carrying a business and an environment, and two provider clients have no row
at all. The two traps are that withdrawing a credential at the provider does not
stop its existing token being accepted (the token is self-contained; what stops
it is retiring the row), and that an environment change does not take effect
until the cached account is dropped. Both are recoverable — the prompt says "from
that moment" and "the very next request" — but both are easy to miss, and the
probe misses both.

**Weaker model: unlikely to score.** Reward is all-or-nothing across eight rules,
and a weaker model plausibly produces something close to the probe: correct
routes, correct guards, plausible provider calls, and no scoping. It would score
0.0 while looking finished, which is the honest expectation rather than a
pessimistic one.

## What could not be verified

- The image builds and every row scores correctly inside it, but it has been
  driven by hand rather than by Harbor itself, so the task-init healthcheck and
  the agent-facing session have not been exercised by the real orchestrator.
- Rule 5 is graded through the driver's own transcript, because whether a token
  is still accepted is only observable at the application. The endpoint snapshot
  corroborates the state behind it but cannot confirm the refusal itself.
