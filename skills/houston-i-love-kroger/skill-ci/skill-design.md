# Stored-service companion design

The accepted agent task is to get deals from our implemented database service,
rather than Kroger's API. A separate human web app supports store selection and
live browsing. The companion consumes stored latest snapshots and dated history
through the app proxy; it never triggers source fetches or collection.

## Intended outcome and boundaries

An answer helps a person decide what to buy: supported discounts and low reported
whole-package prices are separate reasons, fitted to supplied budget/category/
brand preferences. Curate a clearly counted selection using actual named,
sufficiently described fresh records; no generic DTO dump or unsupported value
claims. Unnamed/incomplete rows are explained rather than ranked as good deals.
It preserves exact store/topic, snapshot and observation dates, freshness,
limited coverage and source facts, or explains a specific permission/data gap.
Latest and history are separate questions. A fresh empty snapshot replaces old
deals; stale/no-data results do not cause live or historical fallback. No stored
store directory is implemented, so accepted IDs or human store choice are
prerequisites. Missing names/addresses are disclosed rather than fetched live.

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

One skill uses four procedures: latest deals, price check/estimate, dated history
and setup/recovery. Short references own permission decisions, interpretation and
human installation; the output schema owns report meanings. The default agent
interface is the Python standard-library client. Equivalent permitted clients
may implement the documented stored-read contract without changing its scope.

## Feature and operation map

| Feature | Interface and prerequisite | Acceptance and current evidence |
|---|---|---|
| Service status | `status` → GET `api/v1/promotions/status`; actual app URL | Fixed capability projection; permission is separate from collection availability. Synthetic loopback checked. |
| Latest collected deals | `latest --store --topic` → POST `api/v1/promotions/latest`; exact accepted ID and approved operator topic | Exact DTO/store/topic binding, fresh-empty/no_data/stale/permission distinction, snapshot/attempt/page/coverage validation. Synthetic native HTTP and boundary tests. |
| Item price check | `prices --store --topic` with optional exact product/item IDs → POST `api/v1/promotions/prices` | Fresh snapshot-bound regular/promo prices and explicit unavailable facts; source qualification/context preserved. Synthetic HTTP and exact-identity tests. |
| Requested-quantity estimate | `estimate --store --item TOPIC PRODUCT_ID ITEM_ID QUANTITY` repeated 1–10 → POST `api/v1/promotions/estimate` | Source-only prices, whole quantities 1–99, 4 KB bound, line multiplication/subtotal reconciliation, partial/unresolved/unknown/mixed currency and context-qualified sums. Synthetic tests; complete means arithmetic coverage only. |
| Dated history search | `search --store` with optional literal term, IDs/time bounds and cursor | Store-bound retained observations, bounded pages and qualification preserved. Synthetic loopback and response checks. |
| Retrieve selected observation | `retrieve --store --observation-id` | Rechecks store/record binding and current rights/retention; not_found distinct from no past promotion. Synthetic checks. |
| Source/recipient authority | Permission reference and acknowledgement flag | Actual rights before output; flag creates none. Missing recipient authority blocks network record mode in tests. |
| Human app/skill/tool setup | Complete local folder and selected manuals | Plain-language instructions, actual URL and runtime, private operator settings. Cross-host discovery and human usability remain unobserved here. |
| Exact-store selection | Accepted supplied ID or human chooses in app | No stored metadata directory; no automatic agent live ZIP lookup. |
| Freshness/coverage reporting | Snapshot dates/age/maxAge, latestAttempt, topic sample/page | Default operator 24 hours; not supplier validity or live stock. Changed cursor restarts a bounded read and never mixes snapshots. |
| Price qualification | Flat observation fields, latest availability/calculated fields | Full source facts, explicit unsupported_source_price with null invalid values; latest requires qualified promotions. No invented unit basis or history wrapper. |
| Documentation collection/audit | Allowlisted local fetch/refresh CLIs | Six complete sources/four reviewed exclusions, no private files or network. Integrity and source-drift checks are separate from interpretation. |
| Step listing | `list_skill_steps.py` | Local read-only discovery; no procedure execution. |
| Live Kroger/store/product/Cart/collector operations | Excluded from agent companion | Human/operator manuals explain boundaries; no client command and no fallback. |

## Procedure sequence and handoffs

Setup-only checks the stored service and stops. Direct latest/history entry can
reuse valid URL, exact store and current source/recipient authority. Missing
store choice returns to the person; missing approved topic or collection goes
to the operator. A failed read returns a typed connection/compatibility gap.

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

`promotions.py status|latest|prices|estimate|search|retrieve` uses only fixed stored-read app
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
