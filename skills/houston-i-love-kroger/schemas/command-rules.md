# Input and output rules

## When to read this

Read this file in full before running the skill's documentation tools or its
optional step-listing utility or promotion client. Run examples from the skill
folder. The collected API manual owns the exact server DTOs.

## Inputs and outputs

### Stored promotion CLI

`scripts/promotions.py` is a portable Python 3.12+ standard-library HTTP client.
It has been exercised with Python 3.14. It uses only this project's stored-read
service through the public app proxy. It never reads `.env`, supplier credentials
or database files, calls live store/product searches or starts collection.
Use actual source and recipient permission before returning
records to an agent/model service. `--data-use-approved` acknowledges that prior
check; it cannot grant rights or bypass server policy.

From this skill folder:

```text
python scripts/promotions.py --help
python scripts/promotions.py status --base-url http://localhost:4173/apps/houston-i-love-kroger/ --json --no-input
python scripts/promotions.py stores --zip 00000 --summary-only --dry-run --json --no-input
python scripts/promotions.py topics --store TEST0001 --summary-only --dry-run --json --no-input
python scripts/promotions.py latest --store TEST0001 --topic milk --summary-only --dry-run --json --no-input
python scripts/promotions.py prices --store TEST0001 --topic milk --summary-only --dry-run --json --no-input
python scripts/promotions.py estimate --store TEST0001 --item milk PRODUCT_ID ITEM_ID 2 --summary-only --dry-run --json --no-input
python scripts/promotions.py search --store TEST0001 --term milk --summary-only --json --no-input
python scripts/promotions.py retrieve --store TEST0001 --observation-id 1 --data-use-approved --json --no-input
```

The 00000/TEST0001/1 values are synthetic examples, not a real selected ZIP, store or record.
Set `HOUSTON_APP_URL` or supply `--base-url` ending in `/`. HTTPS is required
except for localhost/loopback HTTP. Credentials, address queries, fragments and
redirects are refused. Requests declare a client User-Agent, do not inherit a
proxy/cookie/credential configuration, use bounded timeouts and read at most 1 MB.

Operations: status GETs `api/v1/promotions/status`; stores/topics/latest/prices/
estimate/search/retrieve POST JSON to the matching relative `api/v1/promotions/`
path. `stores --zip` takes exactly five US ZIP digits and sends `zipCode` as a
string; it reads a stored directory snapshot, never live Locations. `topics
--store` sends the exact `locationId` and reads completed named collection
scopes. `--store` is required for topic/price/history operations and preserves zeros.
Latest/prices additionally require `--topic`, an exact operator-approved collection
label of 3–80 characters and at most eight words. `--limit` is 1–50, default 20;
`--cursor` must be the returned matching snapshot/query cursor (at most 512
URL-safe characters). Latest rejects historical search fields and has no sorting
or arbitrary live term. Prices additionally accepts exact `--product-id` and
`--item-id`; it returns usable regular/promo prices and explicit unavailable facts.
The operator alone configures freshness, default 24 hours.

Store discovery validates the matching ZIP, nullable name/address facts, exact
eight-character IDs, snapshot/freshness/attempt fields and bounded directory
coverage. `available` with no stores is a fresh saved empty search. Stale, no_data,
permission_required and unavailable are distinct gaps. Topic discovery validates
the matching store, up to ten completed named scopes and their available/stale
snapshot/attempt/count facts. Overall stale means all returned topics are stale;
no_data means no readable named completed topic. Legacy unnamed jobs and private
uncollected plan labels are not reconstructed or returned. Neither discovery
operation accepts caller clocks, source choices, live-search flags or collection.
Directory permission is independent of product-history permission.

Estimate takes `--store` and repeated `--item TOPIC PRODUCT_ID ITEM_ID QUANTITY`:
1–10 unique source-backed product/item pairs, each whole quantity 1–99. It sends
only IDs/topics/quantities, never caller prices, and enforces the 4 KB request
limit before network. No source calls or customer basket persistence occur.
It verifies selected identities, unit multiplication, line/subtotal sums, context
gaps and unknown/mixed currency handling. `complete` means line arithmetic
coverage only; `partial` means unresolved lines. Both preserve qualifiers and
excluded checkout costs. No resolvable line gives null totals, never fake zero.

Historical search filters are `--term` (literal text, 1–80 characters),
`--product-id`, `--item-id`, `--from`/`--to` (real UTC timestamps with no fraction
or exactly three fractional digits), `--limit`
(1–50, default 20) and `--cursor` from a matching page, at most 512 characters. Retrieval needs
`--observation-id`. History rejects `--topic`; it returns dated retained rows,
not current offers or a latest-deals fallback.

`--summary-only` emits fixed status/counts without source rows or store IDs.
For stores/topics it also omits ZIP, store names/addresses, topic labels and
source metadata; use established recipient permission and `--data-use-approved`
for the full choices needed to confirm an exact store and collected scope.
For latest/prices it also projects snapshot dates, age/threshold, fixed attempt
status/times and recognized reason; it omits topic, snapshot/observation IDs,
descriptions and prices. Summary still makes a server read and grants no rights.
Estimate summary gives evaluatedAt and resolved/unresolved line counts, with no
source rows, selections, prices or totals. Full estimates use backend evaluatedAt;
latest/prices adds tool checkedAt after a validated read, distinct from source
observation time and snapshot age. Dry-run contains no check/observation claim.
The default record mode requires actual permission and `--data-use-approved`.

Latest validates exact store/topic, completed snapshot dates/age, fixed attempt
status/time, page, coverage and full qualifying deal schema. `available` with an
empty list is a fresh completed empty result. `no_data`, `stale` and
`permission_required` are distinct and have no deals. An `unavailable` operational
envelope is a fixed service/environment gap without invented snapshot fields.
Rejected/changed cursors require a new bounded read; do not combine snapshots.
History includes `priceQualification`; `unsupported_source_price` retains its
explicit unqualified state with unsupported values null, never a free offer.

`--json`, `--no-input`, noninteractive output or `--quiet` emit one JSON object
without banners/colors/prompts. `--no-color` and NO_COLOR disable human color;
interactive human mode supplies orientation. `--dry-run` validates the inputs
and returns the operation/field names without network or writes. `--timeout`
is 1–35 seconds, default 15. `--verbose` does not expose backend exceptions.

Exit 0 means available/complete/partial/preview (including fresh empty);
1 request/format failure;
2 invalid input; 3 permission required, unavailable, no data, stale or not found.
A successful permission_required status is still exit 3. Errors are fixed
code/message/recovery objects; raw server
bodies, local exceptions and credentials are not printed. There is no automatic
retry, output file, database write or local result cache. Source/recipient policy
and fixed store binding are checked independently of command syntax.

Run deterministic tool checks from the repository root:
`python -B -m unittest discover -s skills/houston-i-love-kroger/tests -p test_promotions.py`.
They use synthetic loopback HTTP and no supplier data/account. These tests do
not establish actual source permission or universal server/client compatibility.

### Read-only step listing

```text
python scripts/list_skill_steps.py
python scripts/list_skill_steps.py --json --no-input --no-color
```

This utility reads the local playbooks and prints Markdown headings by default.
It also accepts --json, --no-input, --no-color and --help; no mode prompts or uses
credentials/network inputs. Exit 0 means listing succeeded, 1 means unavailable
or unreadable playbooks, 2 means invalid arguments, and 130 means interruption.
It neither executes the procedures nor qualifies their behavior. JSON execution
returns one object; help is normal usage text. Expected errors are fixed messages
without raw exception details.

### Documentation collection

Requires Python 3.12 or newer, standard library only; executed with Python 3.14.
The collector accepts only the reviewed first-party `repo:/` inventory:

```text
python scripts/fetch_docs.py --url repo:/ --output research/official_docs --json --no-input
```

The repository defaults to the app checkout containing this skill. If installed
elsewhere, provide `--repository` with the actual app folder. No URL fetch,
account access, API search, private settings or runtime database read occurs.
The inventory allowlists API.md, USER_GUIDE.md, SELF_HOSTING.md, HISTORY.md,
PROMOTION_SERVICE.md and KROGER_PERMISSION_REQUEST.md from the app's docs folder. Every selected source
must be substantive UTF-8 Markdown and no more than one megabyte. Linked paths,
unsupported files, traversal and output outside this skill's exact
research/official_docs folder are refused.

Collection reads all selected sources before publishing any page, preserves
exact bytes including code blocks, and writes per-page hashes and source identity,
counts, package version, observation time and reviewed exclusions. Files are
replaced atomically one at a time; the manifest is written last. This is not a
multi-file transaction. An I/O interruption after writes start can leave a mixed
snapshot that must fail audit; do not accept it as a completed collection.

### Documentation audit and refresh

```text
python scripts/refresh_docs.py --check --json --no-input
python scripts/refresh_docs.py --check --repository ../.. --json --no-input
python scripts/refresh_docs.py --refresh --repository ../.. --json --no-input
```

`--check` is read-only and local-only. It verifies the selected inventory, source
identities, version metadata, counts, complete page presence/hashes, exclusions
and absence of unaccounted pages. Without `--repository`, source freshness is
explicitly not checked. With it, the audit compares package version and every
selected current document hash. `--refresh` recollects the reviewed inventory,
then audits it. A changed source invalidates dependent instructions until it is
read and reconciled; matching hashes do not prove comprehension.

Both documentation CLIs accept `--json`, `--no-input`, `--no-color`, `--verbose`
and `--help`. No mode prompts. `--json` emits one clean object; `--verbose` adds
per-page relative identities/hashes. Help prints normal usage and exits 0.
Human execution prints labeled success/error messages, with color only on a
capable terminal unless NO_COLOR or --no-color disables it. Single-purpose
commands have no menu. See scripts/README.md for the short introduction.

JSON success has `ok: true` and `result`; failure has `ok: false` and an `error`
with fixed `code`, plain-language `message` and `recovery`. No private paths,
credentials, raw file errors or catalog payloads are printed.

### Deterministic source-tool tests

```text
python -B -m unittest discover -s tests -p test_documentation_tools.py
```

Tests use a disposable synthetic filesystem and standard library only. They
check exact bytes/repeated refresh, corruption, current-source drift, missing
source, allowlist enforcement, output/source boundaries and unexpected pages.
They do not execute shopping, browser actions, models or a live API. Exit 0 means
these tests passed; nonzero means a failed assertion or environment problem.

## Checks and failures

Documentation CLIs exit 0 for their named check, 1 for collection/integrity/I/O
failure, 2 for invalid or unsupported input and 130 for interruption. JSON is
clean on success and expected failure. Raw input-parser errors do not dump
tracebacks. A stale snapshot is a failure with a refresh/reconciliation action,
not a warning that silently permits dependent authoring.

After interruption, audit first. Recollect only the selected known documents
when needed. Unaccounted files are reported for inspection, never automatically
deleted. Do not remove private data or unrelated files to repair an audit.
These tools establish selected source-byte integrity and accounting only; live
permission, deployment, legal rights and agent execution remain separate.
