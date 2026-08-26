# Discoverability

Every graded rule, and how a solver who never sees the verifier can arrive at it.
Line numbers are into `environment/workspace/`.

The prompt states four things: that a save carries the fields it names and
leaves the rest at what the business had stored (R1), that a field sent blank is
written rather than ignored (R2), that naming one of the customer-facing pages
leaves the other two alone (R3), and that naming one entry in a page's styling
block leaves the rest of that block alone (R5). It also asks, in business terms,
for the hourly cluster-cost collection to follow a save across the boundary (R8)
and for the business-profile screen to be able to save what it displays (R6).
The remaining two are carried entirely by the tree.

| Rule | Route | Evidence |
| --- | --- | --- |
| **R1** unmentioned fields keep their stored value | stated + derivable + observable | Prompt, sentence 3. Every other document-backed resource in the tree saves by reading the stored record first and folding the submitted fields over it: `src/services/services.service.ts:202`, `src/customer/customer.service.ts:718`, `src/invoice/invoices.service.ts:219`. The stakes are visible in `src/setting/entities/settings.entity.ts:101-131`, where an absent field is filled from a default that is frequently *not* blank (`invoiceApproval` becomes `manual`, `freeDimensionOnInvoice` becomes `show`, `invoiceGeneration` becomes `perTransaction`, `sendInvoiceEmail` becomes `true`, each cost source becomes `none`). Both sandbox businesses are recorded so that the difference shows: `biz_sandbox_orchard` sits away from those defaults on every one of them, `biz_sandbox_kite` was never recorded with them at all. |
| **R2** a submitted blank clears, an omission does not | stated + observable | Prompt, sentence 3. `biz_sandbox_orchard` in `environment/sandbox/public.json` carries `postalCode` and `taxCategory` recorded as empty strings next to fields carrying values, while `biz_sandbox_kite` simply has no entry for most of its document, so the two conditions are distinguishable in data the box can read. |
| **R3** one portal page changes and the others do not | stated + derivable | Prompt, sentence 4. `PortalPages` in `src/setting/dto/update-settings.dto.ts:87-186` treats each of the three pages independently and only touches a page whose submitted block has keys (`Object.keys(pages.invoice).length`), which is the same per-page granularity a save has to honour. |
| **R4** switching a page off is a value, not a silence | derivable | `BasePortalPageSettings` at `src/setting/dto/update-settings.dto.ts:49-57` declares `enabled?: boolean` as optional, and the surviving reader at lines 124, 142 and 160 decides whether a page's switch was supplied with `=== undefined` rather than by truthiness, precisely so that `false` counts as an answer. Reading that constructor is the whole rule; the same file is the one a solver is already in for R3. |
| **R5** the styling block merges key by key | stated | Prompt, sentence 5. The block itself is declared at `src/setting/dto/update-settings.dto.ts:61-75` (`appearance?: AppearanceOfferingPortalDto`) and is carried whole by the reader at line 170, so its shape is visible even though the merge is not. |
| **R6** the business profile can be saved, and merges the same way | observable + stated | `docs/open-api-private-spec.json` documents `PUT /settings/profile` under the operation id `Update Business Profile Settings`. The console-facing controller at `src/setting/settings.controller.ts:36-50` serves the same screen read-only and answers with `ReadProfileResponseData`, whose field set is spelled out at `src/setting/dto/read-setting.dto.ts:57-156`. The prompt asks for the screen to become editable in business terms without naming any of that. |
| **R7** a profile save carries only profile fields | observable | The documented request schema for that route lists exactly `businessName`, `addressLine1`, `addressLine2`, `city`, `state`, `country`, `postalCode`, `supportEmail`; nothing about invoice approval, cost sources or tax belongs to it. The application bootstraps its global pipe with `whitelist: true` at `src/genericExpressEnv.ts:30`, so a route bound to a document of that shape drops anything outside it without any extra work. The graded probe offers the profile route a field that is outside both the documented schema and the wider profile document the read side exposes, so a solver who follows either reading passes. |
| **R8** the hourly cluster-cost collection follows the transition | observable + stated | `src/cost/entities/podCost.entity.ts:119-141` exposes `enroll`, `unenroll` and `createScheduleID` as public helpers with no caller anywhere in the tree — a capability wired up and waiting for the event that drives it. `ComputeCostSource` at `src/setting/dto/update-settings.dto.ts:57-60` has exactly the two values the boundary is drawn between. The prompt says the collection should start when a business moves onto the cluster source, wind down when it moves off, and do neither when a save restates what was already there. |

## What is reasoned and what is looked up

Of the eight, three cost nothing beyond reading a file that a solver is already
in: R4 (the `=== undefined` convention, in the same class as R3), R6 (one
documented route) and R7 (its documented field set). R8 costs a grep for an
uncalled helper plus the judgement that a transition, not a mention, is the
trigger. R1, R2, R3 and R5 are stated but still have to be implemented against a
document whose reader fills absences with non-blank defaults, which is where the
work actually is: the naive save is not merely lossy, it silently rewrites four
preferences and two cost sources to values the business never chose, and one of
those rewrites then trips R8 as well.

## Nothing in the tree contradicts the grader

The surviving `PortalPages` reader ignores a blank page caption rather than
writing it, which is the opposite of R2's convention for the flat fields. No
graded save submits a blank caption, and the prompt's blank-is-a-value sentence
is about the document's own fields, so the two never meet. That is the only
place in the tree where the two conventions differ, and it is deliberately left
outside the graded surface.

## Adjacent capabilities this task does not grade

Task 14 admits the cloud role on save, task 16 uploads the brand image, and task
27 owns the tax terms. None of `taxRate`, `taxCategory`, `taxCalculationType`,
`taxJarApiKey`, `cloudIAM`, `logoUrl`, `stripeAccountId` or `stripeConnected` is
compared by the scorer, no held-out business carries a linked payment account,
and no graded save mentions any of them.
