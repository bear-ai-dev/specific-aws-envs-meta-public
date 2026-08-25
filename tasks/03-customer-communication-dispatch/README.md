# Task 3 — customer communication dispatch

A feature-removal task over the real MeteringCo NestJS backend
(`meteringco-backend/top-up-billing-lifecycle`). The capability taken out is the
delivery half of the customer communication bus: the SES send wrapper the whole
service funnels transactional mail through, the processor that turns a
published communication into a message, and the module hook that puts that
processor on the mail channel. The publishers are untouched, so the bus still
carries traffic and nothing listens to it.

The graded artefact is the provider's own record of what left the process — not
a return value, not a log line, not a decision the code made and then failed to
act on.

## What was taken out

| File | Change | +/- |
|------|--------|-----|
| `src/utils/aws/ses.ts` | deleted outright: the `sendEmail` wrapper, its encoded-word framing of the sender, its charset handling and its configuration set | −40 |
| `src/customer/entities/customerCommunication.entity.ts` | `CustomerEmailProcessor` and the five imports only it used; `CustomerCommunicationEntity` stays | −35 |
| `src/customer/customer.module.ts` | the `OnModuleInit` hook on `PrivateAPICustomerModule` that subscribed the processor to the mail channel, and its two imports | +2 / −11 |
| `src/users/entities/organization.entity.ts` | the welcome-mail call that went through the deleted wrapper, and the password-change ticket it read for its body | −13 |
| `src/users/users.controller.ts` | an unused `sendEmail` import | −1 |
| | **total** | **+2 / −100** |

No stub, no `TODO`, no empty method, no comment marking the spot. Everything
that referenced the wrapper was rewired or removed, so the tree compiles and
runs exactly the way it would if the mail path had never been written.

One deliberate deviation from upstream: `@aws-sdk/client-ses` is pinned to
`3.437.0` (upstream floats at `^3.245.0`). Versions before ~3.36 ignore
`AWS_ENDPOINT_URL`, and a client built the way this project builds one would
then dial real AWS from inside the container. `package-lock.json` is pinned to
match.

## Where the rules live

Full table with exact evidence in `DISCOVERABILITY.md`. In outline:

- **The shape of the wiring** is derivable. `CustomerCommunicationChannel`,
  `CustomerCommunicationProcessor` and `CustomerCommunicationEntity.subscribe`
  all survive, two live publishers sit in `src/payment/entities/payment.entity.ts`,
  and `src/audit/audit.service.ts` shows the identical pattern intact on the
  audit bus.
- **The framing convention** is observable. `/opt/meteringco-mail-sandbox/dispatch-capture`
  holds a staging recording: ten communications that went onto the bus and the
  seven messages the provider accepted, recorded off the wire with nothing
  normalised. Every convention the grader checks is legible there.
- **What must not be sent** is stated in the prompt and observable in the
  capture: a suppressed recipient is refused and is not a reason to send
  somewhere else, and a refusal does not stop the traffic behind it.

The subtlety this task turns on is that the sender's display name always goes
out as an RFC 2047 base64 encoded-word — including when it is plain ASCII and
including when it is empty — while the reply-to display name goes out in the
clear. Both readings are defensible; the capture settles it in a single record
that carries an encoded ASCII sender beside an unencoded non-ASCII reply-to.

Nothing left in `/app` implements a competing convention: searching the
workspace for `UTF-8`, `SendEmail`, `SESClient`, `ConfigurationSet` or
`ReplyTo`, with `package-lock.json`, the bundled Redoc HTML under `docs/` and
the vendored `.proto` files excluded, returns nothing at all.

## How it is graded

`tests/test.sh` snapshots the deliverable, stops the sandbox endpoint,
bind-tests the port, starts the emulator against the held-out account with a
random admin token and an outbox in a directory the agent cannot write, and
runs the trusted driver as `agent` under `env -i`. The driver publishes the
held-out communications onto the bus and waits for the wire to go quiet. It can
count the outbox's lines to know when to stop and can do nothing else with it.

`tests/compute_reward.py` runs as root, loads no submitted code, re-derives the
expected messages from `holdout.json` and `run-spec.json`, and compares them to
the outbox as a multiset. Reward is binary. A message that should have gone and
did not fails; so does one that went and should not have; so does the same
message twice.

Wiring is not graded, only delivery. The driver looks for a listener already on
the channel, then tries module lifecycle hooks, then `subscribe`-shaped methods
on `CustomerService`, and if the channel is still empty it subscribes the
dispatcher it finds itself — so a submission that wrote a correct processor and
attached it somewhere unusual is still exercised.

### Held-out cases and the correct outcome

| Held-out communication | Correct outcome |
|---|---|
| ASCII sender name `Bravado Freight`, html | one message, `Source: =?UTF-8?B?QnJhdmFkbyBGcmVpZ2h0?= <no-reply@meteringco.example>` |
| Sender `Bravado Frêt Société Anonyme`, html | one message, encoded-word over the UTF-8 bytes |
| ASCII sender, reply-to `Bravado Kundenbetreuung Groß & Söhne` | sender encoded, reply-to sent verbatim |
| No `html` field at all | text part, `UTF-8`, no html part |
| `"html": false`, sender on its own verified domain | text part, `UTF-8` |
| Three drafts on one communication | one message, to the first draft's recipient only |
| `"data": []` | nothing sent, run continues |
| Recipient on the suppression list | nothing reaches the outbox |
| Suppressed recipient with a deliverable second draft | nothing reaches the outbox; no fallback |
| Subject and body in Japanese | one message, `UTF-8` charsets, encoded-word sender |
| Empty sender display name | one message, `Source: =?UTF-8?B??= <no-reply@meteringco.example>` |
| Deliverable communication published last | one message; a run that stopped at the earlier refusal loses it |

Twelve communications, nine expected messages.

### Gate

| Tree | Outbox | Reward |
|---|---|---|
| `solution/solve.sh` applied to the workspace | 9 messages, exact multiset match | **1.0** |
| Untouched workspace | 0 messages, driver reports "nothing on this tree looks like a dispatcher" | **0.0** |

Both were run without Docker, driving the tree with `tsx` against the vendored
emulator started directly on the held-out account. A structurally different
correct implementation — a plain object literal exported from a new file,
subscribed from a static method on `CustomerService`, building the command
inline with no `sendEmail` wrapper — also scores **1.0**. Nine deliberately
wrong variants score **0.0**: an unencoded sender, a sender encoded only when
non-ASCII, an encoded reply-to, a body always sent as text, a missing
configuration set, a missing subject charset, every draft sent instead of the
first, a duplicate send, and a fallback to the next draft after a refusal.

## Sandbox against held-out

| | Sandbox | Held-out |
|---|---|---|
| Account | `900000000001` `meteringco-notifications` | `900000000009` `bravado-notifications` |
| Verified identities | `meteringco.example`, `no-reply@meteringco.example`, `billing@harbor-analytics.example` | `meteringco.example`, `no-reply@meteringco.example`, `invoices@bravado-freight.example` |
| Suppressed | 1 address | 2 addresses |
| Communications | 10 (in the capture) | 12 |
| Messages expected | 7 | 9 |
| Customers | Harbor Analytics, Lattice Robotics | Meridian Labs, Sable Foods, Kestrel Marine, Nordwind Guss, Aoi Denki, Harrow Optics, Windlass Rail |

Same record kinds and field names, different identifiers and scale. Every case
the grader distinguishes appears in the sandbox at the same or a tamer dose,
including the two that only bite on the held-out run if you get them wrong: an
empty sender display name, and a refused recipient sitting in front of a
deliverable second draft.

## Layout

```
tasks/03-customer-communication-dispatch/
├── instruction.md                       one paragraph, 625 characters
├── README.md
├── DISCOVERABILITY.md
├── task.toml
├── environment/
│   ├── Dockerfile
│   ├── task-init.sh
│   ├── gen_scenarios.py
│   ├── hardening/{shell-hardening.sh,tmux.conf}
│   ├── mockaws/                         vendored emulator, SES added here
│   ├── sandbox/{README,public.json,dispatch-capture/}
│   ├── verifier-data/{drive.ts,holdout.json,run-spec.json}
│   └── workspace/                       the backend with the capability removed
├── solution/{solve.sh,solution.patch}
└── tests/{test.sh,compute_reward.py}
```

The vendored `mockaws` gained `services/ses.py`: `SendEmail`,
`ListIdentities`, `GetIdentityVerificationAttributes` and `GetSendQuota`, with
unverified senders and suppressed recipients refused as `MessageRejected` and
every accepted message appended verbatim to the file named by
`MOCKAWS_SES_OUTBOX`.

## Regenerating the scenarios

```
python3 environment/gen_scenarios.py \
    --out-dir environment/sandbox \
    --verifier-dir environment/verifier-data
```

`gen_scenarios.py` writes the sandbox account, the staging capture, the
held-out account and the held-out communications. The capture is produced by
the same `framing()` function `tests/compute_reward.py` re-implements, so the
evidence the agent reads and the answer the grader derives cannot drift apart.
