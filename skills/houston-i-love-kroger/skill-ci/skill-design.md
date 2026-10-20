# Parallel app shopping companion design

The companion is a parallel app API interface to human shopping. Explicit
current shopping understands the person's list, gets an exact confirmed store,
matches bounded returned products and freshly estimates selected quantities.
The app owns source reads/arithmetic; the agent owns intent/package matching.
The preserved stored-only client reads stored ZIP choices, completed topics,
latest snapshots and dated history without source refresh. Neither mode starts
collection or Cart, and no stored failure silently enters current shopping.

## Intended outcome and boundaries

An answer helps a person decide what to buy: supported discounts and low reported
whole-package prices are separate reasons, fitted to supplied budget/category/
brand preferences. Curate a clearly counted selection using actual named,
sufficiently described fresh records; no generic DTO dump or unsupported value
claims. Unnamed/incomplete rows are explained rather than ranked as good deals.
It preserves exact store/topic, snapshot and observation dates, freshness,
limited coverage and source facts, or explains a specific permission/data gap.
Latest and history are separate questions. A fresh empty snapshot replaces old
deals; stale/no-data results do not cause live or historical fallback. Stored ZIP snapshots offer dated name/address/ID choices; the person confirms
the exact store before completed-topic and price reads. Missing or stale
metadata remains a gap rather than a live request or guessed identity.

Original project-authored material uses the root MIT LICENSE. Underlying source
data, its retention and actual tool/model recipients still need applicable rights.
No supplier key, private service token, database mount, SQL or model SDK belongs
to the portable companion.

## Sources and resource choices

The six first-party public manuals are the selected official corpus: API,
human use, self-hosting, history, private promotion service and permission
questions. `research/source-inventory.json` selects the files;
`research/official_docs/manifest.json` owns their exact bytes, dates, hashes,
version and reviewed exclusions. External tutorials and private runtime/account
records are not selected. Working local fetch/refresh CLIs maintain this corpus.
The integration owner refreshes changed app manuals before acceptance; a prior
integrity audit alone does not establish source freshness.

One skill uses six procedures: current shopping, stored store/topic choice, latest deals, price
check/estimate, dated history and setup/recovery. Short references own permission decisions, interpretation and
human installation; the output schema owns report meanings. Python standard-library
clients implement the two explicit modes. Equivalent permitted clients may use
the same documented app API within the selected scope.

## Feature and operation map

| Feature | Interface and prerequisite | Acceptance and current evidence |
|---|---|---|
| Current setup | `shopping.py status` → GET `api/v1/status` | Fixed configuration/environment/capability projection; not proof of live access. |
| Current store choices | `shopping.py stores --zip` | Bounded lookup; exact person-confirmed name/address/ID before products; store-only task finishes at choices. |
| Requested products/promotions | `shopping.py products`/`deals --store --term`, optional sort/start/includeAll | One bounded term page; source/pricing/per-unit/evidence/page/time checks; no exhaustive catalog traversal. |
| Exact current price | `shopping.py product --store --product-id` | Thirteen-digit returned ID, all variants/evidence, exact store; no identity inferred from UPC/name. |
| Fresh quantity estimate | `shopping.py estimate --store --item PRODUCT_ID ITEM_ID QUANTITY` | Server recheck, max10 pairs/qty1–99; exact identity/multiplication/subtotal/unresolved/unknown-currency checks. No caller prices or persistence. |
| Service status | `status` → GET `api/v1/promotions/status`; actual app URL | Fixed capability projection; permission is separate from collection availability. Synthetic loopback checked. |
| Latest collected deals | `latest --store --topic` → POST `api/v1/promotions/latest`; exact accepted ID and approved operator topic | Exact DTO/store/topic binding, fresh-empty/no_data/stale/permission distinction, snapshot/attempt/page/coverage validation. Synthetic native HTTP and boundary tests. |
| Item price check | `prices --store --topic` with optional exact product/item IDs → POST `api/v1/promotions/prices` | Fresh snapshot-bound regular/promo prices and explicit unavailable facts; source qualification/context preserved. Synthetic HTTP and exact-identity tests. |
| Requested-quantity estimate | `estimate --store --item TOPIC PRODUCT_ID ITEM_ID QUANTITY` repeated 1–10 → POST `api/v1/promotions/estimate` | Source-only prices, whole quantities 1–99, 4 KB bound, line multiplication/subtotal reconciliation, partial/unresolved/unknown/mixed currency and context-qualified sums. Synthetic tests; complete means arithmetic coverage only. |
| Dated history search | `search --store` with optional literal term, IDs/time bounds and cursor | Store-bound retained observations, bounded pages and qualification preserved. Synthetic loopback and response checks. |
| Retrieve selected observation | `retrieve --store --observation-id` | Rechecks store/record binding and current rights/retention; not_found distinct from no past promotion. Synthetic checks. |
| Source/recipient authority | Permission reference and acknowledgement flag | Actual rights before output; flag creates none. Missing recipient authority blocks network record mode in tests. |
| Human app/skill/tool setup | Complete local folder and selected manuals | Plain-language instructions, actual URL and runtime, private operator settings. Cross-host discovery and human usability remain unobserved here. |
| Exact-store selection | `stores --zip` or an already accepted complete ID | Dated bounded directory choices; person confirms exact name/address/ID; no live Locations fallback. |
| Collected topics | `topics --store` | Completed readable named jobs with snapshot/count/freshness; no private uncollected plans or guessed legacy labels. |
| Freshness/coverage reporting | Snapshot dates/age/maxAge, latestAttempt, topic sample/page | Default operator 24 hours; not supplier validity or live stock. Changed cursor restarts a bounded read and never mixes snapshots. |
| Price qualification | Flat observation fields, latest availability/calculated fields | Full source facts, explicit unsupported_source_price with null invalid values; latest requires qualified promotions. No invented unit basis or history wrapper. |
| Documentation collection/audit | Allowlisted local fetch/refresh CLIs | Six complete sources/four reviewed exclusions, no private files or network. Integrity and source-drift checks are separate from interpretation. |
| Step listing | `list_skill_steps.py` | Local read-only discovery; no procedure execution. |
| Direct supplier/Cart/collector operations | Excluded from companion | App-only requests; no direct Kroger client, Cart command or automatic source/history fallback. |

## Procedure sequence and handoffs

Current shopping reuses valid setup/store/recipients and source IDs for direct
price/recheck/estimate entry. Otherwise it understands the list/preferences,
gets live ZIP choices, waits for exact confirmation, searches requested terms,
matches packages and estimates selected quantities. All requested lines remain
visible, including lists over the ten-line request limit. Explicit batches are
separate checks, never a single supplier snapshot or qualified grand total.
Optional useful dated history remains a separate permitted read. Unknown
recipient controls create a record-output gap, not a universal agent ban or
history prerequisite for current shopping.

Stored setup checks the stored service and stops; current setup uses app status
without requiring that service. Direct latest/history entry can
reuse valid URL, exact store and current source/recipient authority. Missing store enters stored ZIP lookup and the person's exact choice; missing
topic enters completed-topic discovery. Missing/stale collection stays an operator/data gap. A failed read returns a typed connection/compatibility gap.

Latest requires the exact topic and selects the latest completed snapshot before
promotion qualification. Server provenance prevents superseded promotions from
reappearing, including regular-only/out-of-stock facts and fresh empty samples.
Failed/running attempts stay distinct from completed collections. The client
checks freshness and snapshot-bound pagination and never restores old prices.

History separately returns retained dated rows with limited coverage. Retrieval
rechecks the selected store/observation. Changed scope/recipient invalidates the
dependent result; no successful prior response creates permanent access.
Both routes stop after the requested bounded report.

## Tool design and recovery

`shopping.py` is a stateless run-and-exit reader with human terminal orientation
and direct commands; the app supplies the visual human flow. It imports unchanged
transport primitives from `promotions.py`, preserving that stored client's
behavior/tests. Keep both files together. Current responses allow up to8MB;
stored responses retain their 1MB limit. HTTPS/loopback, no redirects/proxies/
cookies/auth, bounded time, fixed errors and no cache/file/retry apply. Current
JSON parsing rejects duplicate keys/nonfinite values and preserves clean input
errors. Summary gives no rows/IDs/prices/ZIP; dry run gives no input values or
false checked time. Full mode acknowledges an actual source/recipient review.

`promotions.py status|stores|topics|latest|prices|estimate|search|retrieve` uses only fixed stored-read app
paths over HTTPS, with loopback HTTP for local use. It refuses URL credentials,
queries, fragments and redirects; uses no ambient proxy/cookie credentials;
bounds time and response bytes; and emits fixed recovery errors without raw
backend exceptions. It saves no data, writes no database and retries nothing.
A validated dry run performs no network or writes and omits supplied values.

Machine mode emits one JSON object without banners/colors/prompts. TTY human
mode supplies a short orientation and labelled colored status unless disabled.
This run-and-exit reader has no menu. Source-record output requires established
recipient authority; summary projects only fixed capability/count/freshness
facts. Summary still makes a server read and creates no rights.

The documentation tools atomically replace individual known files and write the
manifest last; a multi-file interruption can leave a mixed snapshot, so audit
before accepting it. They never scan private files or fetch runtime APIs.

## Verification and remaining qualification

`tests/test_shopping.py` covers current inputs/source-ID bounds, wrong scope and
private fields, source/pricing/per-unit/evidence/page/estimate arithmetic,
complete/empty/unresolved states, promo-only estimates and JavaScript millisecond
date precision. Actual subprocess loopback HTTP checks every current route/body,
plus proxy/redirect/JSON-content/size/duplicate/nonfinite/raw-error boundaries.
These synthetic tests establish no source rights, actual access, cross-platform
qualification or model performance. Root owns actual usage, receiving review,
exact-candidate manual refresh and publication checks.

`tests/test_promotions.py` runs synthetic loopback/native CLI and mock checks:
exact route/body, no credentials/query, permission gate, no-network dry run,
fresh-empty/no_data/stale/permission/unavailable states, snapshot/store/topic
binding, private-field rejection, latest price/availability calculations,
regular-only price checks, source-verified estimate arithmetic and partial/unknown/
mixed currency qualifications, and historical price qualification.
`tests/test_documentation_tools.py` checks
allowlist, exact bytes, drift, failure and filesystem boundaries using disposable
sources. These are executable tool checks, not model performance evidence.

Canonical artifact/workflow/link checks and the static scenarios in
`evals/scenarios.json` assess authored structure and transition coherence.
They do not establish host discovery, human-browser flows, supplier rights,
actual deployed service availability or an agent obeying the skill. Root app
acceptance owns real service/DB HTTP checks and human UI evidence. Model trials
require an explicit request; none was run by this revision.
