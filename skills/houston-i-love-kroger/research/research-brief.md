---
type: research
title: "Research: parallel app shopping companion"
source_manifest: "official_docs/manifest.json"
source_inventory: "source-inventory.json"
sources:
  - {id: api, url: "repo:/docs/API.md", title: "App HTTP API"}
  - {id: user-guide, url: "repo:/docs/USER_GUIDE.md", title: "Human shopping guide"}
  - {id: self-hosting, url: "repo:/docs/SELF_HOSTING.md", title: "App installation and configuration"}
  - {id: history, url: "repo:/docs/HISTORY.md", title: "History prerequisites and operator boundary"}
  - {id: promotion-service, url: "repo:/docs/PROMOTION_SERVICE.md", title: "Private promotions service and permission-aware reads"}
  - {id: permission-questions, url: "repo:/docs/KROGER_PERMISSION_REQUEST.md", title: "Source-permission questions, not a grant"}
provenance:
  generated: researched
  generated_by: agent
  method: "Retained first-party corpus, accepted backend contract, current source inspection and synthetic CLI checks. Exact manual hashes/dates/version remain at source_manifest."
trust_tier: source
summary: "Agents use the app API for explicit current shopping or separate stored deals/history, with actual returned facts and explicit scope."
---
# Parallel app shopping companion research brief

## Task and resolved scope

The user wants the companion to operate in parallel with the human app:
understand requested groceries/quantities/budget/preferences, find current ZIP
choices, wait for exact store acceptance, search products/promotions, match
packages and freshly estimate selected quantities. It uses our app API only;
the server owns source access and arithmetic. The preserved stored mode
also supports saved ZIP choices and exact store acceptance, completed
topic discovery, item price checks, requested-quantity costs, budget
fit and relevant comparisons within actual data coverage. The assistant's useful
deliverable is a concise, supported shopping choice:
product/package, reported price, supported discount and why it fits the person's
supplied preferences. Good discount and low package outlay are separate reasons.
A raw DTO dump is not that result. All rankings cover only fresh returned
qualifying deals and must disclose finite coverage.

Current commands use `api/v1/status`, `stores/search`, `products/search`,
`deals/search`, `products/retrieve`, `basket/estimate`. All reads are explicit
and bounded; a stored failure never enters current shopping automatically.
Stored commands still use only `api/v1/promotions/status|stores|topics|latest|
prices|estimate|search|retrieve`. Neither mode directly contacts Kroger, starts
collection, changes Cart/policy or reads a private database.

### Current-shopping source contract

The current implementation and first-party API manual define term pages,
source evidence, exact product rechecks and fresh selected-quantity estimates.
Thirteen-digit product IDs and unchanged item IDs come from returned facts.
Live estimates take at most ten distinct pairs/whole quantities 1–99, recheck
each product once and calculate without caller prices. Unknown currency,
price basis, eligibility and modality prevent qualified monetary totals.
Source per-unit estimates retain precision and unknown basis. Promo-only
amounts support unqualified numeric multiplication without regular savings.

`shopping.py` implements source/store/term/page/time checks, source/pricing/
evidence validation and line/subtotal arithmetic. It shares unchanged transport
primitives with `promotions.py`; both files ship together. Recipient reviews
check actual retention/training/secondary use/onward disclosure for the bounded
same-shopper task. Ordinary browsing does not inherit database-history rights
as a prerequisite; no blanket Partner or cloud-agent ban follows. Full promotion
coverage remains unmet. Integration refreshes the selected manuals from the
accepted joined candidate before final acceptance.

## Collected source scope and freshness

The selected corpus contains six complete first-party public manuals: API, human
use, self-hosting, history, private promotion service and permission questions.
Their exact source bytes, dates, package version, hashes, page accounting and
four reviewed exclusions are owned by `official_docs/manifest.json`. This file
links that record rather than copying hashes that can drift. Inventory selection
is owned by `source-inventory.json`.

Mirrored manuals preserve exact source bytes, including relative links. Resolve
those links from each manifest entry's original `source` path and `repo:/` URI,
not from the copied `pages` folder. Targets outside the six-manual inventory
require the original project source or manuals; they are not automatically
bundled, collected or qualified by this mirror.

Working local `fetch_docs.py` and `refresh_docs.py` collect and audit only those
allowlisted files. They do not scan the repository, open private settings/runtime
databases or make network requests. An integrity audit without an explicit
current repository reports source freshness as not checked. The integration
owner refreshes changed manuals and checks current-source identity before final
acceptance; prior hashes do not qualify new backend behavior.

The manuals' external links and private/operator execution surfaces are explicit
exclusions rather than assumed-read sources. App-authored documentation does
not establish a supplier grant. The question draft is not a permission receipt.
Original project software uses the selected root MIT LICENSE; supplier data
rights remain separate.

## Findings that change decisions

1. **The service is the data owner.** The private service owns SQLite, source
   policy and read-time retention checks. The public app proxies fixed reads.
   Source credentials/private service tokens and local database paths do not
   belong to the companion. The client has no database mount, SQL or model SDK.

2. **Latest means a completed exact-scope snapshot.** The accepted backend
   contract selects the latest completed exact-store/topic collection before
   promotion filtering. A fresh empty sample replaces old promotions for that
   topic. Newer regular-only, invalid-price or unavailable-item facts suppress
   older promotions; missing items reconcile only that bounded topic. Failed or
   running attempts are distinct from the last completed snapshot.

3. **Freshness and emptiness differ.** `available` may have fresh deals or be a
   fresh empty result. `no_data/no_completed_collection` means no usable
   completed collection; `snapshot_not_readable` preserves original/current
   rights and retention limits. `stale` withholds deals beyond the operator
   threshold, default 86,400 seconds. This threshold is not supplier validity.
   Request time does not refresh observation time.

4. **Inputs identify collected scope.** Latest requires an accepted full
   eight-character store ID and exact approved operator `topic`, not a generic
   live search term. Stored ZIP snapshots supply dated bounded name/address/ID choices; the person
   confirms their exact location. Completed-topic discovery lists only readable
   named collections and their freshness/counts, never private uncollected plans
   or guessed legacy hash labels. Directory permission is separate from
   product/history permission. In stored mode no live ZIP lookup or first-result choice
   occurs; missing/stale data remains an operator gap.

5. **Pages belong to a snapshot and query.** Latest uses bounded keyset pages,
   default 20 and maximum 50, with snapshot/query/store generation binding. A new
   completed snapshot or superseding item-state generation rejects an old
   cursor. Restart only the requested bounded read and disclose the changed
   snapshot; do not mix pages or harvest the catalog.

6. **History answers a separate question.** Search/retrieve return retained dated
   observations. An old promotion is not today's offer, and a regular-only or
   unsupported-price row is not a verified promotion. History never silently
   replaces stale/no-data/fresh-empty latest results.

7. **Prices require context.** Source descriptions, item/package identity,
   currency and stored prices remain separate from calculated discount. Latest
   rows add qualified savings and availability, but no prior-history wrapper.
   Historical `priceQualification: unsupported_source_price` keeps invalid
   public amounts null instead of inventing a free price. Missing currency,
   normalized unit basis or package context stays unknown. Do not infer health
   quality, comparable quantities or an all-time low.

8. **Recommendations need enough evidence.** Use named fresh qualifying rows to
   explain good discounts or low reported whole-package prices among the returned
   set. Respect supplied category/budget/brand preferences. Unnamed/incomplete
   records and stale/expired facts do not get invented product names or value
   rankings. State selected/returned counts, additional-page availability and
   collection/check time in ordinary language, with one practical next action.

9. **Actual recipients still matter.** Database storage and API access do not
   authorize forwarding to a tool/agent/model host. Match reviewed source rights
   and user privacy to actual recipients before exposure. Acknowledging
   `--data-use-approved` grants nothing. Summary output is fixed status/count/
   freshness metadata, not source records; it still makes a server read.

10. **Costs use actual supported arithmetic.** Stored price reads preserve usable
    regular-only prices separately from promotions and unavailable source facts.
    Estimates accept actual selected IDs/topics and whole quantities 1–99 for
    1–10 lines; no caller prices. The service rereads source facts in one
    transaction, computes line amounts and returns partial/unresolved lines.
    Complete means line arithmetic coverage, never a payable checkout total.
    Uniform unknown currency permits only an unqualified numerical sum without
    a currency symbol; mixed currency contexts cannot be summed. A qualified
    subtotal needs no unresolved line or missing context. Tax, fees, coupons,
    eligibility verification and checkout changes are excluded. Weight/unknown
    quantity bases remain unresolved rather than being derived from package text.

11. **Setup is distinct from availability.** A usable app, successful service
    status or configured source credentials does not prove that a store/topic
    collection exists. Missing data remains an operator dependency. Human
    installation guidance is not executed setup, and a proposed URL is not a
    deployment.

## Tool and instruction checks

The original stored-history client baseline passed 12 synthetic tests. The
extended client was checked with Python 3.14 against disposable loopback HTTP
and mocks, including actual subprocess CLI calls. Its tests cover the stored
latest route/body, exact scope/snapshot/freshness/page/coverage, recipient gate,
no-network dry run, fresh-empty/no_data/stale/permission/unavailable distinctions,
historical price qualification, regular-only prices, source-backed line/subtotal
arithmetic, partial/no-resolved totals, missing/mixed currency, redirects and
unapproved private fields. Historical date/cursor validation follows the public
API's optional exactly-three fractional UTC digits and 512-character cursor bound.
The maintained test file is the authoritative current scenario coverage.

The local documentation audit passed six selected files and four reviewed
exclusions with source freshness explicitly not checked at the revision baseline.
Canonical structure/workflow and source-drift acceptance are separate checks;
their current actual results are returned to the designated project record owner.
Static scenarios in `evals/scenarios.json` are authored walkthrough cases, not
model trials. Qualitative shopping judgment remains agent reasoning, not a
hardcoded CLI label or price ranking.

The integration owner handles real public→private HTTP/database acceptance,
human browser evidence, final manual refresh and publication checks. Companion
authoring performed no real Kroger call, source collection, protected account
read, hosted-agent trial or deployment. No model trial was run.

## Remaining qualification and maintenance

Each installation's source rights, recipient scope, fresh populated collection
and actual app URL need their own evidence. Cross-platform Python execution and
assistant discovery/import are not universally established by local tests.
Re-read changed contract/source sections and refresh/reconcile affected manuals
before acceptance. Reuse unaffected valid evidence. The separately owned private
project record retains final candidate identities, checks and unresolved gates.
