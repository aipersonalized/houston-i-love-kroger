# App shopping operations and comparison meanings

## Detailed Content

### Scope and effects

The companion uses this project's version-1 app API. Explicit current shopping
and stored-data reads are separate modes. Latest stored deals and historical search/retrieval are
database reads. They do not contact Kroger, initialize a database, collect data,
alter grants or change a cart. No supplier credentials, private database mount,
SQL, model SDK or particular AI provider is required.

The human web app and explicit agent live-shopping procedure share the app's
current store/product API. Optional Cart remains outside the companion.
Missing/stale/empty service data never authorizes a live fallback. Stored ZIP
snapshots supply dated store choices; the person confirms the exact location.
Completed-topic discovery supplies actual readable collection labels. Collection,
source permission, retention and service configuration remain operator responsibilities.

Before requests, read `research/official_docs/pages/API.md` sections
"Stored store discovery", "Completed collection topics", "Latest collected deals",
"Stored price checks and basket estimates" and
"Stored promotion search and retrieval" in full.
They own exact DTO fields, limits, pagination and errors. Source identities and
hashes live in `research/official_docs/manifest.json`; a live response still
requires store/topic/version validation.

### Explicit current shopping

Read `schemas/command-rules.md` section "Current-shopping CLI" in full before
`shopping.py`. Its status/stores/products/deals/product/estimate commands map to
`api/v1/status`, `stores/search`, `products/search`, `deals/search`,
`products/retrieve` and `basket/estimate`. Bind every request to the actual app;
searches use JSON bodies, no query, credential, cookie or redirect.

Live ZIP lookup returns at most ten locations within ten miles. The person
confirms the exact returned store before products/prices. Explicit term searches
return one bounded fuzzy page, not every match/promotion. Next pages use only
matching reported continuation; no automatic traversal. Product recheck takes
the exact thirteen-digit source product ID and complete store ID; it retains
all returned variants/evidence and never chooses a replacement.

Live estimate accepts only selected source product/item IDs and quantities,
1–10 distinct pairs, whole 1–99. The app rechecks each unique product and
calculates at a final common evaluation time. Each line retains its own read
time. Complete/partial describe arithmetic coverage. Unknown currency, price
basis and purchase conditions keep the qualified subtotal null; unresolved
lines are not zero. Source amounts, per-unit estimates and app calculations
stay separate. Neither shopping nor estimates start collection, persist a
shopping list or call Cart. Current browsing does not require a history grant;
optional dated comparisons still have their own rights/retention checks.

The authoritative exact DTOs are in the collected API manual, sections "Recheck
an exact product" and "Estimate selected products from fresh checks". The
integration owner refreshes this collected manual with the accepted backend
candidate before delivery; an older mirror does not qualify new behavior.

### Stored request sequence

Use the actual app URL ending in `/` and append these relative paths. All POST
inputs use JSON with `Content-Type: application/json` and
`Accept: application/json`. Never put search/store values in URL queries.
Do not follow redirects or send source records to unapproved recipients.

| Operation | Body | Receiving check |
|---|---|---|
| `GET api/v1/promotions/status` | None | Stored-service permission/availability only; not proof of any store/topic collection. |
| `POST api/v1/promotions/stores` | Five-digit `zipCode` string | Matching ZIP, directory snapshot dates/age, bounded radius/cap and exact store names/addresses/IDs; directory permission is separate from product-history permission. |
| `POST api/v1/promotions/topics` | Exact accepted `locationId` | Matching store and completed readable topic labels, each snapshot/date/state/count; no configured-but-uncollected disclosure or complete-catalog claim. |
| `POST api/v1/promotions/latest` | Exact `locationId`, exact `topic`; optional `limit`, `cursor` | Matching store/topic, latest completed snapshot, freshness, fixed attempt status/times, bounded coverage and snapshot-bound page. |
| `POST api/v1/promotions/prices` | Exact `locationId`, `topic`; optional exact `productId`, `itemId`, `limit`, `cursor` | Same snapshot/freshness/coverage, `products` with usable regular/promo pricing or explicit unavailable reason. |
| `POST api/v1/promotions/estimate` | Exact `locationId`, 1–10 `items` with `topic`, `productId`, `itemId`, whole `quantity` 1–99 | Exact requested line identity/quantity, source-backed current amounts, real line/subtotal arithmetic, currency/context qualifications and unresolved lines. |
| `POST api/v1/promotions/search` | Exact `locationId`; optional literal `term`, IDs, UTC bounds, `limit`, `cursor` | Dated retained observations; query-bound pagination and explicit coverage. |
| `POST api/v1/promotions/retrieve` | `locationId`, `observationId` | Same store/record with current permission and retention checks. |

The Python tool maps these to `status`, `stores`, `topics`, `latest`, `prices`, `estimate`, `search`
and `retrieve`.
`latest --topic` selects an exact approved collection label. Historical
`search --term` matches a literal stored description; the two are not
interchangeable. Default page size is 20, maximum 50. The stored tool has no sort,
collector, live-store or live-product operation. Stored `stores --zip` is a
database read. Keep IDs as strings, including zeros.

### Stored store and topic choices

`stores` returns a stored ZIP query snapshot, never a fresh source query.
`available` may contain an empty `stores` list. `no_data`, `stale`,
`permission_required` and `unavailable` remain separate gaps. Snapshot and
latest-attempt fields use the existing dated/freshness meanings. Coverage is
`bounded_zip_directory`: source query radius ten miles, up to ten results,
`completeNearbyStores: false`. Do not infer distance or claim every nearby store.
Names/addresses can be missing; ask the person which exact returned location
they intend to visit rather than inventing metadata or choosing the first.

`topics` returns readable completed named collection jobs for the accepted store,
up to ten current permitted topics. Each row has `topic`, `status` (`available`
or `stale`), snapshot, latest-attempt and `returnedProductCount`. Zero can be a
completed empty collection. Overall state is `available` when any returned scope
is fresh, `stale` when all returned scopes are stale, or `no_data` when none are
readable. Permission/unavailable gaps stay explicit. Legacy jobs lacking retained
topic labels do not get names reconstructed from hashes/private configuration.
Configured but uncollected topics are not returned. Only fresh relevant scopes
support current-price recommendations; discovery proves no complete catalog.

### Stored price and quantity estimates

`prices` uses the same completed snapshot/freshness rules as latest deals but
returns regular-only products and explicit unavailable-price facts as well.
Each `pricing.currentCents` is the supported arithmetic amount when present;
raw source prices remain facts even if a date, price or stock condition prevents
using them. Preserve `qualificationGaps` for unreported/unverified currency,
price basis, eligibility, modality and fulfillment/stock. They are not guessed.

`estimate` accepts selected IDs/topics and requested quantities, never caller
prices. It rereads actual fresh stored facts, returns one line per requested
item, and multiplies only whole-unit (`soldBy: unit`) usable prices. Missing,
stale, unavailable and weight/unknown-quantity lines are unresolved, with null
amounts. The response `evaluatedAt` is check time, distinct from observedAt.

`complete` means all requested lines have arithmetic, not a guaranteed checkout
total. `partial` has unresolved lines; `unavailable` has no resolved prices.
Source permission can block all lines. `reportedSubtotalCents` sums resolved
lines only when currency is the same explicit supported currency or uniformly
unreported. Uniform unknown currency has `currency: null`, `unreported` and no
currency symbol; mixed known/unknown/unsupported currencies have no combined
sum. No resolvable lines produce null, never a fake zero. A qualified subtotal
requires no unresolved line or context gap. Tax, fees, coupons, eligibility
verification and checkout changes are excluded. Preserve that explanation next
to the amount; the service never runs checkout, Cart or a customer session.

### Latest snapshot and history are separate

Latest deals come from the most recent completed collection for the exact
store/topic, selected before deal qualification. A completed empty snapshot
replaces the topic's old promotions. Newer stored regular-only or unavailable
facts can suppress older promotion facts. Failed/pending attempts are reported
separately and do not become completed snapshots.

The operator's default freshness threshold is 86,400 seconds (24 hours).
`available` may contain qualifying deals or be a fresh empty result. `no_data`
means there is no usable completed exact-scope collection. `stale` withholds
deals beyond the freshness threshold. `permission_required` means no permitted
read. Preserve supplied reason, snapshot ID, observed/completed times, age,
threshold and fixed attempt status/time. Freshness is an operator rule, not an
offer validity or stock guarantee. A service failure leaves the result unknown.

Latest `deals` rows use the history observation fields plus supplied
`availability` and `calculated` savings. They contain no prior-history wrapper.
History `search` and `retrieve` return dated observations rather than current
offers or a latest snapshot. A regular-only/unqualified record is not a verified
promotion. Search emptiness means no permitted matching retained rows in that
bounded query. `not_found` does not prove a promotion never happened. Do not
use historical rows as a silent latest-deals fallback.

### Price, unit and history interpretation

Preserve full source descriptions, item/package identity, reported prices and
observation dates. Savings use the stored regular/promo pair and are separately
labelled calculations. Unit estimates can be absent or supplied individually;
preserve their precision. A missing unit basis forbids normalized-unit claims.

Qualified earlier comparisons retain source labels, dates and matching context.
A collected low covers retained qualifying rows only. One prior observation does
not establish a trend. Current regular prices, package text and test fixtures
cannot repair absent historical facts. Null arithmetic stays unavailable; failed
reads stay unknown.

## Key Concepts

- **Accepted store:** the complete `locationId` explicitly chosen by the person
  from stored name/address choices or supplied as an already verified choice.
- **Collection topic:** an exact approved operator label, not a live search term.
- **Snapshot:** the latest completed bounded store/topic collection and its age.
- **Observation:** a dated source fact; request time is a separate timestamp.
- **Collected history:** permitted retained rows with incomplete past coverage.

## Decision Criteria

| Condition | Action | Reason |
|---|---|---|
| Stored mode missing store/topic | Run stored ZIP/topic discovery and accept the person's exact choice | No live fallback, first-result assumption or unnecessary human-web handoff. |
| Fresh empty latest result | Report zero qualifying deals in the completed scope | Older rows must not reappear. |
| No completed collection or stale snapshot | Report the distinct data/freshness gap | A reader does not initiate collection. |
| Rejected cursor or changed snapshot | Restart a bounded requested read and disclose its new snapshot | Do not mix pages from collections. |
| Unsupported response or different store/topic | Discard and return compatibility gap | Do not infer a new contract. |

## Constraints & Limits

Source rights and actual recipients are checked before records enter model
context; a CLI acknowledgement does not grant rights. Service authentication
protects private storage but does not itself authorize data forwarding. Keep
synthetic data labelled. Do not harvest a catalog, compare competing retailers,
expose private configuration or claim current checkout availability.

## Common Patterns

Latest: permitted service status if needed → accepted exact store/topic → one
bounded latest page → dated snapshot result and stop. History: accepted exact
store/query → bounded retained search → selected record if requested → dated
result and stop. Setup-only and human instructions stop at their requested scope.
