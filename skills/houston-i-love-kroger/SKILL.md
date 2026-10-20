---
name: houston-i-love-kroger
description: "Use Houston I Love Kroger's stored-data service to find stores from a ZIP, confirm the person's exact store, discover collected topics, find useful deals, check item prices, estimate requested quantities, or read dated history. Explain freshness, coverage, partial costs and permission gaps; never query Kroger directly."
---

# Houston I Love Kroger

Return a store-specific result from this project's stored-data service, with
collection dates, freshness and coverage, or a precise permission/data gap.
Help a person install the companion and app without choosing an AI provider or
assuming a public host. Agent reads never contact Kroger or start collection.

**Readiness:** API-version-1 operational candidate. Deterministic CLI checks,
documentation integrity, actual installation availability and observed agent
performance are separate evidence. This skill does not establish live source
entitlement, source/recipient rights or deployment of a proposed public URL.

## Core Principles

- Bind every price to the exact accepted store, collected topic, snapshot and
  observation time. A bounded collected sample is not every store promotion.
- Keep source descriptions and prices separate from calculated savings. Current
  regular price is never a substitute for a prior promotional price.
- Price checks preserve the selected item/package and source currency. Cost
  estimates need actual supported service arithmetic, requested quantities and
  explicit unresolved lines; missing currency/weight is never guessed.
- Establish the actual permitted data recipients before catalog access. Local
  agents and external model providers can have different permission boundaries.
- Keep fresh stored deals, a fresh empty result, stale data, no completed
  collection, empty history and absent permission distinct. A request timestamp
  does not make stored prices newly observed.

## Context Requirements

This skill requires:
- The installation's actual app base URL, ending in `/`, and Python 3.12+ or an
  equivalent permitted client for the documented stored-read API.
- A five-digit US ZIP for stored store discovery, or an already accepted complete
  eight-character store ID. Use the stored directory and ask which exact
  name/address the person wants; never choose the first result for them.
- Source permission and user authorization covering the actual agent, provider,
  transport, display and retention involved; reuse valid established authority.
- For latest deals/prices, a topic returned by stored completed-topic discovery
  or an already verified collection scope. For dated history, optional literal
  term, product/item IDs and UTC time bounds.

This skill produces:
- Stored store choices with name/address, collection dates and limited search
  coverage, followed by the person's exact choice and completed-topic states.
- Latest collected deals or dated historical observations with full source facts,
  dates, unit/history limits and bounded coverage; or a precise stale, no-data,
  empty, permission or connection result with the next practical action.
- Price checks and requested-quantity estimates within supported collected scope,
  distinguishing known package prices, qualifying discounts, partial subtotals
  and unresolved quantities/currency/stock. Unsupported capabilities stay gaps.
- For setup requests, ordered installation/configuration guidance and the actual
  checks performed, without credentials or an invented deployment claim.

## Use Cases and Scenarios

### Route

Match the first applicable situation. Read the named playbook in full.

| User situation | Purpose | Workflow | Expected result |
|---|---|---|---|
| Need store choices from a ZIP, an exact store choice, or available collection topics | Find stored store choices and completed topic scopes | read `playbooks/choose-store-and-topic.md` in full | Exact person-selected store and relevant fresh topic, or precise directory/data gap |
| Check a known grocery/package price, estimate quantities or assess a grocery budget | Use stored prices and source-verified estimate arithmetic | read `playbooks/price-check-and-estimate.md` in full | Dated price facts and qualified full/partial estimate, or exact input/data gap |
| Find or compare the latest collected deals for an accepted store and topic | Read the service's latest completed collection | read `playbooks/main-procedure.md` in full | Fresh dated deals, fresh empty result, stale/no-data result or a permission gap |
| Search or retrieve dated past observations | Read retained history separately from latest deals | read `playbooks/stored-promotions.md` in full | Dated source observations or an explicit permission/availability gap |
| Install the skill/app, check setup, or recover a failed connection | Establish a usable permitted installation | read `playbooks/setup-and-recovery.md` in full | Working prerequisite checks or a bounded setup gap |
| Use the human page or ask about Cart/collection | Explain the human/operator boundary | read `references/user-guide.md` in full | Human steps or the appropriate operator dependency; no agent live-source request |

## Scenario Workflows

### Procedure Sequence

| Stage / owner | Prerequisite and output | Receiving check | Next / return / stop |
|---|---|---|---|
| Setup, `playbooks/setup-and-recovery.md` | Actual app URL and client/privacy context → service status or exact dependency | Read procedure accepts usable connection and current recipient permission | Enter a requested read only; setup-only stops |
| Store/topic choice, `playbooks/choose-store-and-topic.md` | ZIP or accepted store and permitted recipients → stored directory → person's exact choice → completed topics | Check directory date/coverage, confirmed store and each topic's freshness/state | Continue the requested deal/price/estimate task; dated history needs the accepted store only |
| Latest deals, `playbooks/main-procedure.md` | Accepted store/topic/recipient → latest completed snapshot → bounded report | Caller checks snapshot age, scope, source facts and result state | Complete, or return connection to setup and missing store/topic to its owner |
| Price check/estimate, `playbooks/price-check-and-estimate.md` | Accepted store/topic/item and requested quantities → stored-price read and supported estimate | Caller checks source identity, currency, quantity, line arithmetic, partial totals and exclusions | Complete with qualified costs or explicit unresolved lines; never live fallback |
| Dated history, `playbooks/stored-promotions.md` | Accepted store/recipient and history scope → bounded search or selected record | Caller checks observation dates and query/store binding | Complete; no automatic fallback between history and latest |

Direct read entry accepts current equivalent inputs; do not repeat setup, store
choice or authority already established. Missing store/topic enters the stored
discovery procedure before the requested read. Changed store, topic, query,
recipient or installation invalidates dependent results. Read procedures are
alternatives; stale/empty data never triggers a live search, collector or hidden
history substitution. A separate human web-app visit is not required when the
stored directory and topics provide the needed facts.

## Completion Criteria

- The requested stored-data or setup result exists and follows
  `schemas/output-contract.md`; no response from an old store/query is reused.
- Every price is traceable to its accepted store, scope and observation/snapshot
  time, with raw facts and calculations distinguishable.
- Fresh empty, stale, no completed collection, unknown history, missing unit
  basis, test data and permission gaps remain visible. Stop at the bounded result.

## Supporting Resources

- Before receiving source records, read `references/source-permissions.md` in full.
- Before app requests or interpreting results, read `references/api_reference.md`
  in full; read `research/official_docs/pages/API.md` in full for exact fields,
  error categories and limits.
- Before returning a comparison, read `schemas/output-contract.md` in full.
- For human installation and use, read `references/user-guide.md` in full.
- Before documentation maintenance or the optional step-listing command, read
  `schemas/command-rules.md` in full.
- Before the promotion CLI, read `schemas/command-rules.md` section
  "Stored promotion CLI" in full. It needs no Kroger credential or direct
  database access; source and recipient permissions still apply.
- Before revising this skill, read `skill-ci/README.md`,
  `skill-ci/skill-design.md` and `research/research-brief.md` in full. The
  development project record has a separate writer and is not a shopping input.

## Critical Constraints

- Use only this project's documented stored-read API through the selected app
  installation. Never call Kroger directly or the app's live store/product/deal
  searches, collector or Cart as part of this companion's agent procedure.
- Missing or stale data is an operator/data gap, not permission to refresh the
  source. No database mount, SQL, supplier credentials or model SDK is required.
- Do not infer third-party forwarding rights from API availability or the user's
  request. Do not invent a universal ban on agents either; check actual scope.
- Keep protected values, credentials and raw private records outside model
  context. A tool that automatically exposes disallowed payloads is unsuitable.
- Preserve full source descriptions and IDs, missing facts and monetary units.
  Do not compare this feed with competing retailers or harvest it into a cache.
- Do not label an unqualified estimate as `$/oz`, `$/lb` or a known per-item
  measure, fabricate prior prices, or call a collected low an all-time low.

## Recovery States

- **Completed:** the requested task and applicable checks are satisfied; live
  claims describe only the actual session and response observed.
- **Completed with gaps:** a useful bounded comparison or setup explanation is
  delivered with missing optional prices/history or untested conditions named.
- **Blocked:** required installation, exact store choice, permitted transport or
  source authority is absent. Give the smallest resolving action and stop the
  dependent operation while preserving useful permitted guidance.
