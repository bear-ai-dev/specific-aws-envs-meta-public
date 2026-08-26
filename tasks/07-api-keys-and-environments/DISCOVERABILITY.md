# Discoverability

One row per rule the grader can fail a submission on, the route by which a
competent engineer could have known it, and the exact evidence for that route.
Anything that could not be placed against surviving code or against data the box
can read is stated in the prompt.

Paths under `src/` and `docs/` are relative to `/app` inside the box, i.e. to
`environment/workspace/`. `/opt/meteringco-sandbox/public.json` is the world the
agent-facing endpoint serves, i.e. `environment/sandbox/public.json`.
`/opt/mockaws/` is the emulator, readable but not writable.

**There is no reference output in the image.** The sandbox serves a live world
that can be read and changed all day, but nothing in the image says what a
correct listing, rotation or revocation should produce. Every rule below is
recoverable from the prompt, the surviving code, or that world.

## The surface

| # | Graded rule | Route | Evidence |
| ---: | --- | --- | --- |
| — | The capability is four routes: `GET /keys`, `PUT /keys/{keyId}`, `DELETE /keys/{keyId}`, and `PUT /users/environment`. | Derivable | `docs/open-api-private-spec.json` survives whole and documents all four, with their verbs, their `keyId` path parameter, their `bearer` security and their response envelopes, under the `Keys` and `Environment` tags. `GET /users/environment` and `PUT /users/environment/admin` are documented alongside them. The same document defines `UpdateEnvironmentDto` with `environment` enumerated as exactly `production` and `sandbox`. Rendered again in `docs/private_api.html`. |

## What an environment scopes

| # | Graded rule | Route | Evidence |
| ---: | --- | --- | --- |
| 1 | A listing returns the credentials **this account** holds in the environment the operator is in — not every credential the identity provider knows about. **The decisive rule.** | Derivable + observable | Code: `src/users/users.service.ts:114-119`, `getCurrentUserConfigFromDb`, survives untouched and is the whole argument — it reads the caller's *current environment* first and only then reads the user row, `readUserData(subject, environment)`. `src/influx/influx.service.ts:885-902` is that read, filtering on `subject` **and** `environment`. The reconciliation tool also survives: `findAllUsersForBusinessID` at `src/users/users.service.ts:128-133` over `readAllUsersForBusiness` at `src/influx/influx.service.ts:935-951`, which returns the subjects configured for one business. Data: in the sandbox world every credential has a configuration row whose subject is `<clientId>@clients` carrying a `businessID` and an `environment` — `keyHarborlineProdIngest@clients` is `harborline`/`production`, `keyHarborlineSbxIngest@clients` is `harborline-sandbox`/`sandbox` — while `appHarborlineStatusBoard` and `appMeteringCoMarketingSite` exist at the provider with **no row at all**. A listing built from the provider alone therefore visibly returns two tenants' credentials plus two nobody claimed. |
| 2 | Changing environment changes the account the next request resolves to, and it takes effect on the very next request. | Stated + derivable + observable | Prompt: *"moving between environments must likewise take effect on the very next request."* Code: the environment is read per request through `getCurrentEnvironment` → `readCurrentUserEnv` at `src/influx/influx.service.ts:952-967`, newest row wins (`sort desc` then `top(n: 1)`); the resolved account is then cached against the subject for a week at `src/users/users.service.ts:101`, `cacheManager.set(subject, ..., 604800)`, which is what makes "the very next request" a real requirement rather than a restatement. `src/interceptors/businessID.interceptor.ts:63-93` survives whole and is where the resolved account is hung on the request as `user.businessID`. Data: the operator `auth0|opharborline77` has two rows, `harborline`/`production` and `harborline-sandbox`/`sandbox`, so the two environments resolve to two different accounts for one person. |
| 8 | Work done in one environment leaves the other environment's credentials as they were. | Derivable + observable | The same two mechanisms as rules 1 and 2: an account is per environment, so a change made while standing in one is written against that account's credentials only. Data: the sandbox world gives both tenants a credential in each environment, so a change that crosses the boundary is visible on the other side. |

## Rotating and revoking

| # | Graded rule | Route | Evidence |
| ---: | --- | --- | --- |
| 3 | Rotating replaces the secret on that credential and leaves every other credential alone. | Stated + derivable | Prompt: *"Rotating replaces the secret on that credential alone and leaves every other credential untouched."* Code: `src/users/entities/organization.entity.ts:143-175` survives and is the pattern for every provider-side act in this tree — fetch a management token from `https://auth.meteringco.example/oauth/token/` with a client-credentials grant and a scope string, cache it, then call `https://auth.meteringco.example/api/v2/...` with it as a bearer. The console's own management credentials are in the shell as `METERINGCO_DASHBOARD_CLIENT_ID` and `METERINGCO_DASHBOARD_CLIENT_SECRET`. Observable: the provider is reachable in the box, and the emulator that answers it implements the management surface a rotation needs — `POST /api/v2/clients/{id}/rotate-secret` at `/opt/mockaws/mockaws/services/auth0.py:289`, alongside client read and delete — so the operation can be found by exploring the endpoint rather than by guessing at an absent API. |
| 4 | Revoking withdraws the credential at the provider **and** retires the configuration row behind it. | Stated + derivable + observable | Prompt: *"Retiring withdraws the credential at the identity provider and takes the account it signs in as out of the tenant's configuration."* Code: retirement in this tree is a tombstone, not a deletion — `src/customer/entities/customer.entity.ts:235-236`, `src/offering/entities/offeringPackage.entity.ts:1955-1956` and `src/measurement-config/entities/measurement-config.entity.ts:203-204` each tag a point `softDelete: 'deleted'`, and `src/measurement-config/measurement-config.service.ts:249` and `src/offering/offering.service.ts:276` set the flag rather than removing anything. `src/users/entities/user.entity.ts:19` declares `softDelete` on the user row itself. Data: `keyHarborlineProdRetired@clients` is in the sandbox world carrying exactly that tag, so the shape of a retired credential can be read directly. |
| 5 | A revoked credential stops being able to reach the API at once. | Stated + derivable + observable | Prompt: *"a caller still presenting it is refused from that moment rather than at the next hour or the next deployment."* Code: this is the rule that punishes withdrawing at the provider alone. Tokens are validated against a signing key, not against the provider's client list — `src/authz/jwt.strategy.ts:15,24` verifies through JWKS and issuer — so an already-issued token survives its client's deletion. What stops it is the reader at `src/influx/influx.service.ts:899`, `filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`, which makes the retired row invisible, after which `src/users/users.service.ts:97-99` answers an empty result with `UnauthorizedException`. Data: the already-retired credential in the sandbox world can be used to try exactly this. |

## Who may do it

| # | Graded rule | Route | Evidence |
| ---: | --- | --- | --- |
| 6 | A credential the current account does not hold can be neither read nor changed, and the attempt leaves it exactly as it was — whether it belongs to another tenant, to this tenant's other environment, to something already retired, or to a client the tenant never claimed. | Stated + derivable + observable | Prompt: names all four cases explicitly. Code: the account on the request is the only account in scope, `src/interceptors/businessID.interceptor.ts:92-93`; every surviving sibling service takes `businessID` and scopes by it, e.g. `findAllUsersForBusinessID` at `src/users/users.service.ts:128`. Data: the sandbox world supplies one of each — Crestfall's credentials for another tenant, `keyHarborlineSbxIngest` for the other environment, `keyHarborlineProdRetired` for the retired case, and `appMeteringCoMarketingSite` for the unclaimed case. |
| 7 | A sign-in carrying only the right to read may list credentials and do nothing else. | Stated + derivable | Prompt: *"a sign-in carrying only the right to read credentials may list them and do nothing else."* Code: `src/users/user.permissions.ts` survives with `KEYSREAD = 'keys:read'`, `KEYSUPDATE = 'keys:update'` and `KEYSDELETE = 'keys:delete'` — three members for three verbs, unused anywhere else in the tree. `PermissionsGuard` at `src/authz/PermissionsGaurd.js` is applied this way on every surviving controller, e.g. the organisation routes in `src/users/users.controller.ts`. Data: the sandbox world holds two console sign-ins for the same operator — `sessHarborlineConsole01`, granted `keys:read`, `keys:update` and `keys:delete`, and `sessHarborlineViewer01`, granted `keys:read` alone — so the distinction can be exercised end to end, and the tokens the endpoint mints for them carry those permissions. |

## Rules deliberately not graded

- **Status codes and wording.** Rules 6 and 7 record only that an attempt was
  refused with a 4xx, never which exception class or message carried it. The
  structural variant refuses with a forbidden where the reference refuses with a
  not-found and scores the same.
- **Response envelope.** The listing is searched for credential identifiers
  anywhere in the returned JSON, so the shape around them — `{ data: [...] }`,
  a bare array, whatever the field is called — is the submission's business.
- **How the secret is delivered.** Rotation is graded on the secret having
  changed at the provider and on no other credential having changed. Whether the
  new secret is returned, emailed or withheld is not graded.
- **Class names, file layout, DTO validation, module wiring.** Grading is at the
  HTTP surface, and that surface is documented; nothing below it is inspected.
- **The `environment` request header.** The interceptor's header branch survives
  untouched and is never exercised by the grader. Rule 2 is about the stored
  environment, not the header.
