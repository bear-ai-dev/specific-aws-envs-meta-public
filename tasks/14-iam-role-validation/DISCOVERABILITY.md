# Discoverability

Every rule the verifier grades, and how a competent engineer could have known it
from `instruction.md` plus what the agent can read in `/app` and query in the
sandbox. Nothing below depends on material the agent cannot see.

| # | Graded rule | Route | Evidence |
|---|---|---|---|
| 1 | A cloud access block naming a role the platform can assume, whose session can read the account's instances, is saved and reads back exactly as submitted. | Stated + observable | Prompt: "we must be able to assume it under whatever external id the customer gave, and the credentials that come back must read the instance inventory a collection uses". `meteringco-usage-scraper` and `meteringco-staging-scraper` in the sandbox are exactly this shape. |
| 2 | A role the platform cannot assume is turned away. This covers a role that does not exist, an account the emulator does not know, a string that is not an ARN, an ARN that names something other than a role, a trust policy that names the customer's own account or an AWS service instead of us, and a trust policy carrying an `sts:ExternalId` condition the submitted external id does not satisfy. | Stated + observable | Prompt: "we must be able to assume it under whatever external id the customer gave". Every one of these shapes exists in `/opt/metering-sandbox/public.json`: `deployment-pipeline` (self-trust), `ec2-instance-profile` (service trust), `meteringco-usage-scraper` (external id condition), and any name not in the file. The emulator answers `AccessDenied` or `ValidationError` for each, so the agent can drive the whole set locally. |
| 3 | A role that assumes cleanly but whose policies do not allow the collection call is turned away. | Stated + derivable + observable | Prompt: "the credentials that come back must read the instance inventory a collection uses". `src/microservices/ec2InstanceDataGatherer/ec2InstanceDataGatherer.service.ts` assumes the customer role and immediately calls `getInstanceWithFilters`, which is `DescribeInstancesCommand` in `src/utils/aws/awsEc2.ts`. `meteringco-reports-reader` (storage only) and `meteringco-bare-role` (no policies at all) are both assumable and both refuse that call in the sandbox. |
| 4 | When the customer supplied no external id, no external id may be sent on the assume call. Sending a blank one is a validation error, not "no condition". | Derivable + observable | Six surviving call sites in `/app` spell the convention out: `ExternalId: externalId ? externalId : undefined` in `analytics.service.ts`, `ec2InstanceDataGatherer`, `ec2EgressDataGatherer`, `ebsVolumeDataGatherer`, `ebsSnapshotDataGatherer` and `instanceUptime.service.ts`. Nothing in the tree does the opposite. `meteringco-open-scraper` in the sandbox has no condition, so the mistake is reproducible in one call. |
| 5 | A rejected save is answered as a client-side bad request, not a server error and not a silent success. | Stated + derivable | Prompt: "a bad request the caller is told about". `integration/settings/settingsCrud.integration.spec.ts` records the shape this endpoint has always had for a role we cannot use: status 400, with the message naming IAM. |
| 6 | Nothing else carried in a rejected save is written; the record still reads back the way it did before. | Stated | Prompt: "nothing else in that save is written". Each rejected payload in the graded run carries an ordinary field such as a city or a VAT id, and the record must still hold what the previous accepted save left there. |
| 7 | A blank role is accepted, disconnects the account, and leaves no external id behind in the record. | Stated + derivable | Prompt: "a blank role still means disconnect and must leave no external id behind". The sibling validator in the same directory, `ValidTaxJarApiKeyRule` in `src/setting/dto/taxJarAuthorizer.ts`, already treats the empty string as "clear this" rather than "reject this". |
| 8 | A cloud access block that carries an external id but names no role is turned away. | Stated + derivable | Prompt: "a block naming no role is a mistake, not a disconnect". `IAMAccessCredentials` in `src/measurement-config/entities/measurement-config.entity.ts` marks `iamRoleArn` required and `externalId` optional, so the pair without a role has never been a legal record. |
| 9 | An external id supplied for a role whose trust policy carries no condition is harmless, and the save is accepted. | Observable | `meteringco-open-scraper` in the sandbox has no `sts:ExternalId` condition; assuming it with a well-formed external id succeeds, exactly as the real service behaves. |
| 10 | An accepted save persists the submitted role and external id, and otherwise leaves the existing save semantics of this endpoint alone. | Derivable | `SettingsService.update` and `SettingsEntity.transformer` in the untouched tree already decide how a save is written; the task adds admission control in front of them and changes nothing about them. |

## Rules deliberately not graded

- The wording of the rejection message. Only the status and the untouched record
  are compared, so any honest phrasing scores the same.
- Which AWS call proves permission, as long as the answer matches. Reading the
  role's policies through IAM lands on the same verdict as making the inventory
  call, and the emulator allows both.
- Whether the check lives in a validation decorator, an injectable validator, the
  controller, or the service. All four are driven and all four are accepted.
