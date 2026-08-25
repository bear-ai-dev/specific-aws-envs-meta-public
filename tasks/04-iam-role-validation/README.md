# Task 4 — IAM role validation

## Headline result

| Model | Solves `c/n` | pass@1 | pass@3 | pass@8 |
| --- | ---: | ---: | ---: | ---: |
| Muse Spark 1.2 | 4/8 | 0.5000 | 0.9286 | 1.0000 |
| Opus 5 | 8/8 | 1.0000 | 1.0000 | 1.0000 |

A feature-removal task cut from a real NestJS TypeScript backend
(`meteringco-src/extracted/top-up-billing-lifecycle`, 534 `.ts` files, 87 runtime
dependencies). The agent works in the actual repository, not a purpose-built
skeleton, and there is no specification document anywhere in the box.

## What was taken out

A customer connects their AWS account to the platform by saving a cross-account
role for the usage scraper into their settings. Upstream, that save was
admission-controlled: the settings endpoint proved the role before storing it,
so a role the platform could never step into was refused at the point of entry
rather than discovered a month later by a collection that returned nothing.

The workspace ships with that proof gone. `CloudIAM.iamRoleArn` now carries a
plain `@IsString()`, which is a coherent implementation of a world where the
console is trusted to send a working role — it reads like a field nobody thought
to check, not like something with a hole in it.

| file | change vs upstream |
| --- | --- |
| `src/setting/dto/customIAMAuthorizer.ts` | deleted (−40): the whole `ValidIAMRole` decorator, including the `AssumeRole` probe and its `ExternalId` handling |
| `src/setting/dto/update-settings.dto.ts` | `CloudIAM.iamRoleArn` loses the decorator and its message, gains `@IsString()` (+1 / −4) |
| `src/measurement-config/entities/measurement-config.entity.ts` | `IAMAccessCredentials.iamRoleArn` loses the same decorator, keeps `@IsNotEmpty()`, gains `@IsString()` (+1 / −4) |

Total: 3 files, +2 / −48. The second call site is not in the assignment's
description but had to go with it — the entity imported the same symbol, so
leaving it would have left the tree referencing a function that no longer
exists. Grading only exercises the settings endpoint.

Nothing else moved. `SettingsService.update`, `SettingsEntity` and the influx
row are exactly what upstream had, so the persistence a solution has to work
through is not something the task invented. There are no stubs, no `TODO`s
about the absent behaviour, no commented-out code, no `not supported` throws,
and no `.git` directory.

## Where the rules live

No single file states the rule set. To derive it in full an agent has to read
across the repository *and* query the sandbox. `DISCOVERABILITY.md` carries the
full rule-by-rule table; the sources it draws on are:

| source | what it yields |
| --- | --- |
| `src/microservices/ec2InstanceDataGatherer/ec2InstanceDataGatherer.service.ts` | what a collection actually does with the role: assume it, then `getInstanceWithFilters`, which is `DescribeInstancesCommand` in `src/utils/aws/awsEc2.ts` |
| six surviving `fromTemporaryCredentials` call sites | the `ExternalId: externalId ? externalId : undefined` convention — the parameter is omitted, never blanked, when the customer gave none |
| `src/setting/dto/taxJarAuthorizer.ts` | the sibling validator in the same directory, which treats an empty string as "clear this" rather than "reject this" |
| `integration/settings/settingsCrud.integration.spec.ts` | the answer this endpoint has always given for a role the platform cannot use: status 400, message naming IAM |
| `src/measurement-config/entities/measurement-config.entity.ts` | that a role arn is required wherever cloud credentials are recorded, while the external id is optional |
| `/opt/metering-sandbox/public.json` and the emulator | which roles assume and which do not, what a blank `ExternalId` does to an assume call, and which roles come back with credentials that cannot read anything |

An agent that restores only the assume probe writes the `naive` mutant below,
and it scores 0.0.

## How it is graded

`tests/test.sh` stops the agent-facing endpoint, restarts the emulator on a
held-out set of AWS accounts, compiles the submitted tree with the image's own
compiler under root-owned settings, and stands the settings API up on a loopback
port with an in-memory store behind it. It then replays a fixed sequence of
saves through `PUT /settings`, reading the settings back over `GET /settings`
after each one. It never trusts an exit code or stdout.

The API is assembled from the repository's own controller and service, with a
global `ValidationPipe` and `useContainer` wired the way the project's own API
tests wire them, and every provider the settings module declares carried across.
A check written as a validation decorator, as an injectable validator, in the
controller, or in the service is therefore driven the same way.

`tests/compute_reward.py` runs as root, loads no submitted code, and re-derives
from the held-out document which saves should have been accepted: it parses each
role arn, walks the trust policy for a statement that names the platform and
whose `sts:ExternalId` condition the submitted external id satisfies, then walks
the attached and inline policy documents for a grant covering
`ec2:DescribeInstances`. Reward is 1.0 only if every save landed the way the
reference says, with the same status and the same readable record afterwards.

Twenty-one saves are replayed, covering every case class:

| case | held-out example | correct outcome |
| --- | --- | --- |
| assumable under the right external id, can read instances | `meteringco-metering` with `vd-9c41ab27` | saved |
| same role, wrong external id | `vd-9c41ab28` | 400, record untouched |
| same role, external id omitted | no `externalId` key | 400, record untouched |
| trust policy carries no condition, no external id sent | `meteringco-metering-legacy` | saved |
| trust policy carries no condition, external id sent anyway | `meteringco-metering-legacy` with a stray id | saved |
| assumes cleanly, storage permissions only | `meteringco-archive` | 400, record untouched |
| assumes cleanly, cost-explorer permissions only | `meteringco-cost-view` | 400, record untouched |
| assumes cleanly, no policies at all | `meteringco-empty` | 400, record untouched |
| trust policy names the customer's own account | `terraform-apply` | 400, record untouched |
| trust policy names an AWS service | `ci-runner` | 400, record untouched |
| role does not exist in a known account | `meteringco-collector-typo` | 400, record untouched |
| account the emulator has never heard of | `411000000999` | 400, record untouched |
| not an arn at all | `meteringco-collector` | 400, record untouched |
| arn of a user rather than a role | `:user/meteringco-collector` | 400, record untouched |
| external id supplied, no role named | `{ externalId }` alone | 400, record untouched |
| permission granted by an inline policy | `meteringco-collector` | saved |
| blank role | `{ iamRoleArn: '' }` | saved, connection cleared |
| blank role with a stale external id still attached | `{ iamRoleArn: '', externalId }` | saved, both fields cleared |
| save that carries no cloud block at all | city only | saved |

Every rejected save also carries an ordinary field — a city or a VAT id — that
must not move, which is how atomicity is checked without asking the submission
to report anything about itself.

Measured on the built tree, each candidate scored by the reference verifier:

| candidate | reward |
| --- | --- |
| reference solution (`solution/solution.patch`) | **1.0** |
| starting workspace, unchanged | **0.0** |
| upstream's assume-only probe restored verbatim, `ExternalId` blanked when absent | 0.0 |
| assume plus inventory probe, but disconnect leaves the external id behind | 0.0 |
| permission proved by reading the role's IAM policies instead of calling EC2 | **1.0** |
| check in the service rather than the DTO, explicit `STSClient`, `BadRequestException`, different messages | **1.0** |

All candidates were run with an empty environment (`env -i`) so no host AWS
config or `HOME` can leak in.

## Sandbox vs held-out accounts

The box serves `/opt/metering-sandbox/public.json`: one platform account, two
customer accounts, eight roles. Every case class is present in kind — a role
guarded by an external id, one with no condition, one that assumes but grants
only storage, one that grants only cost data, one with no policies at all, one
that trusts the customer's own account, one that trusts an AWS service, and one
whose permission comes from an inline policy. The document is world-readable, so
an agent can work out what any role should do and then check that against what
the emulator answers.

The held-out document is a different platform account, four customer accounts
and ten roles, sharing no identifier with the sandbox. Passing locally is not
evidence of passing the grade.

The emulator's `AssumeRole` genuinely evaluates trust-policy principals and
`sts:ExternalId` conditions, and this task's copy adds two things: EC2 calls are
authorised against the permissions the assumed session actually carries, and an
`ExternalId` outside the service's 2–1224 character bound is a `ValidationError`
before the trust policy is consulted. Both are real AWS behaviour, and both are
reproducible in the sandbox in a single call.

## Layout

```
environment/Dockerfile              image: node 22, python 3, the repo at /app
environment/task-init.sh            starts the emulated endpoint on :4566
environment/workspace/              the repository, capability removed
environment/mockaws/                task-owned copy of the emulated control plane
environment/sandbox/                world-readable fixture + sandbox notes
environment/verifier-data/          root-only: held-out world, run spec, driver,
                                    compiler settings
environment/gen_scenarios.py        regenerates both world documents and the spec
instruction.md                      the prompt (658 characters, one paragraph)
DISCOVERABILITY.md                  one row per graded rule, route and evidence
solution/solution.patch             the oracle (4 files, +73 / −1)
tests/test.sh                       verifier entry point
tests/compute_reward.py             trusted scorer with its own reference model
```

`environment/mockaws/` diverges from the shared copy on purpose, in the two ways
described above. Nothing else in it was touched.

## Regenerating

```
python3 environment/gen_scenarios.py --out-dir /tmp/scenarios
install -m 0644 /tmp/scenarios/public.json   environment/sandbox/public.json
install -m 0644 /tmp/scenarios/holdout.json  environment/verifier-data/holdout.json
install -m 0644 /tmp/scenarios/run-spec.json environment/verifier-data/run-spec.json
```
