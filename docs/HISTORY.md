# Collect and maintain price history

History starts empty. The app has no purchased, imported or backfilled historical
price dataset. Shopper searches never write observations. A separate operator
command can collect a small, fixed set of store/topic samples after permission
and API access are established.

The [shared shopping service](PROMOTION_SERVICE.md) owns this history database.
Its public read-only API serves the independent web and companion clients;
its older private `/v1/*` storage protocol retains token authentication. The web
app delegates searches, exact-observation retrieval and comparisons without
opening SQLite itself. The HTTP service has no policy-import, collection, SQL or other
write endpoint. Collection and maintenance remain private operator commands.
No real Kroger collection or retention grant is established by this guide.

## 1. Understand the source requirement

Kroger's public acceptable-use policy restricts systematically gathering API
response data into a database. Its public API documentation does not establish
a complete historical-price or store-promotion endpoint. Partner documentation
also does not grant access or retention rights. See the
[permission request draft](KROGER_PERMISSION_REQUEST.md) to prepare a request for
your installation. A submitted request is not an access or retention grant.

This collector therefore starts disabled, with the `kroger-public` source marked
pending. API credentials, the user's request to build the app, a successful test
or a hand-written policy file cannot grant Kroger's permission. Establish an
authorized exception or applicable source terms covering this database collection
and its intended reuse first; Partner enrollment alone does not do that. Review
the actual scope for human display, local agents and any external model recipient.
These are the app's policy purposes, not a rule that every agent needs a separate
agreement. Public live lookups and separately labelled current-price calculations
do not depend on this collector. The [permission guide](KROGER_PERMISSION_REQUEST.md#start-with-public-apis-and-identify-the-actual-restriction)
explains the database restriction and the independent full-coverage requirement.

## 2. Initialize private storage

1. Complete [local installation](SELF_HOSTING.md), including the locked
   `npm ci --ignore-scripts` install. Open a terminal in the project.
2. If desired, set `HISTORY_DB_PATH` in your private `.env` to a private persistent
   database filename. Blank uses `.runtime/history.sqlite` in the project.
3. Run:

   ```text
   npm run history:init -- --json --no-input
   ```

4. Expect `status: ready`, schema version 6 and an observation count. On first
   use it should be zero. Repeating initialization preserves existing history.
5. Protect this folder with your operating system's access controls. Unix
   directory mode requests do not establish Windows ACL protection. Keep the
   database, sidecars, private plans, policies and backups out of public folders.

The SQLite adapter uses foreign keys, WAL journaling, full synchronization,
prepared queries and transactional writes. Opening an unrelated or incompatible
database, a changed migration or linked database path is refused. Do not change
the migration files after creating a database and expect an automatic upgrade.
Verified version-1/2/3/4/5 schemas upgrade transactionally to version 6 after schema
and migration-checksum checks. Earlier migration files remain unchanged.
Version 2 added each operator topic's hash for later scope narrowing. Version 3
adds nullable description/brand and a paging index for store-specific reads.
Version4 adds original snapshot rights/retention and target scope, availability
and price-qualification facts for latest-deal reads. Legacy snapshot authority
is not backfilled or guessed; latest reads need a newly completed permitted job.
Missing legacy descriptions/brands remain null, and missing topic provenance is
never guessed from a product or plan. Rows without approved collection provenance
are excluded and eligible for purge. Legacy rows with valid rights/provenance can
still be found by exact IDs, even when words cannot match missing text.

Version 5 adds private source-wide collector lease, request-budget reservations
and backoff state. It changes no supplier observations or source permissions.
Stop every collector and service before upgrading the authoritative file; do not
mix schema-4 collectors with schema-5 processes. An already-open older writer
does not acquire the new lease. Older versions refuse to open a schema-5 file.
Keep the original consistent schema-4 backup with its matching application for
rollback; a schema-5 file has no in-place downgrade.

Version 6 adds separate directory rights, completed ZIP-query snapshots,
bounded store metadata and attempt state. New completed product jobs also retain
their explicit topic label for discovery. Old labels remain null; no source
facts, grants or labels are backfilled. Stop all older processes before migration;
older versions refuse schema 6, and already-open older writers do not know all
new metadata/policy rules. Rollback requires the matching stopped-state backup,
not an in-place downgrade. Collection remains disabled after migration.

In separate-service mode, set the operator command's `HISTORY_DB_PATH` to the
service's authoritative file in its private storage environment. Do not initialize
another file in the web container and assume it is the same database. Ordinary
Compose startup creates/opens the service volume; it does not run a collector.
The web app mounts no copy. See the [Compose setup](SELF_HOSTING.md#6a-optional-compose-installation)
for the actual services and private shared token. The token grants transport
access only; it does not establish permission to retain or display source data.

## 3. Make a bounded plan

1. Copy `config/collection-plan.example.json` to
   `config/collection-plan.json`. The example is disabled and contains no stores.
2. After rights review, choose exact stores using the app. Keep the complete
   eight-character store ID, including leading zeros.
3. Add only stores and topics covered by the actual permission. Each target has
   `locationId`, `term` and `fulfillment: "IN_STORE"`. A term is 3–80 characters,
   at most eight words. Do not use a shopper's search log to build the plan.
4. Keep `enabled: false` until the source policy and configuration are ready.

| Plan field | Meaning and bounds |
|---|---|
| `version` | `1` |
| `sourceId` | `kroger-public` for the implemented live Kroger collector |
| `enabled` | Explicit `true` required to collect |
| `intervalMinutes` | 60–10,080; default 1,440, not a recommendation overriding the grant |
| `maxRuns` | 1–100; default 1 |
| `limit` | 1–50 products per target; default 20 |
| `maxRequestsPerDay` | 4–1,000 conservative HTTP-attempt reservations per rolling 24 hours; default 40, shared by collectors using this database/source |
| `maxAttempts` | 1–3 Products-search attempts per target; default 1 disables collection retries |
| `retryBaseSeconds` | 1–60; default 1, doubled for the next retry, subject to a longer provider wait |
| `targets` | At most 10 unique store/topic pairs; no pagination |

One target makes one bounded Products search, using the API's in-store `ais`
filter. That filter does not establish current stock. No catalog crawl, weekly-ad
scrape, customer sign-in, coupon clipping or historical backfill is implemented.
Certification data is refused by the live history collector; it is not real
production price history.

The local operator plan is ignored by Git. An example target in a test or guide
does not establish that a store or topic has been approved.

## 4. Record reviewed permission

Keep the agreement and review outside the repository. A source-policy JSON file
records their bounded result; it cannot authenticate the agreement or replace a
review. Create it privately only after the actual permission is verified.

| Required field | Enter the actual reviewed value |
|---|---|
| `sourceId` | `kroger-public` |
| `status` | `verified`, only following actual verification |
| `sourceLabel` | A short, accurate source name |
| `evidenceReference`, `reviewReference` | Opaque local reference keys, not agreement text, URLs, account IDs or file paths; begin with an ASCII letter and use letters, numbers, `.`, `_`, `:`, `-`, up to 160 characters |
| `verifiedAt`, `expiresAt` | UTC timestamps such as the format `YYYY-MM-DDTHH:mm:ssZ`; actual verification must not be in the future and expiry must be later than now |
| `retentionDays` | Actual authorized retention, a whole number 1–3,660; implementation bounds do not grant that duration |
| `allowedPurposes` | All three strings: `historical-price-collection`, `historical-price-display`, `historical-agent-access` |
| `allowedLocationIds` | Finite approved list of 1–10 exact eight-character store IDs |
| `allowedTopics` | Finite approved list of 1–10 search topics; no wildcard |

Do not use fabricated permission dates or a copied example to make the gate pass.
The importer checks structure, scope and expiry, not legal authenticity. Apply
the workspace's publication review before exposing the resulting service.

## 5. Check, then run once

1. Run a check that writes nothing and makes no network requests:

   ```text
   npm run history:collect -- --plan config/collection-plan.json --dry-run --json
   ```

   A dry run does not open the database or inspect stored permission. It reports
   the permission gap even if a valid policy already exists there; it does not
   import a supplied policy. This keeps dry-run behavior free of writes.
2. After the real agreement, reviewed policy, plan and private production API
   settings are ready, replace the filename below with your private policy file:

   ```text
   npm run history:collect -- --plan config/collection-plan.json --source-policy "PATH-TO-YOUR-PRIVATE-POLICY.json" --once --json --no-input
   ```

3. Read the result. `completed` includes observation and request counts.
   `already_collected` means those jobs were already completed in the current
   interval. `blocked` means zero source requests and lists missing prerequisites.
   `deferred` means a collector lease, persisted backoff or local request budget
   prevented completion. Read its fixed category and `retryAt`; it may follow
   source calls earlier in an uncompleted run. No partial observations are saved.
4. For later runs the reviewed policy is stored; omit `--source-policy` unless
   recording a newly reviewed policy. Do not edit a prior policy's identity to
   disguise a changed scope or expiry.
   A superseded policy cannot become current again, including a replay of the
   original setup command. Newly imported policies cannot predate the active
   review. Use the actual current reviewed policy; do not change dates or
   references merely to bypass a rejection.
5. View current promotion comparisons or **Past prices** in the app.
   Stored search needs the separately configured private service. Empty,
   permission-required, incompatible, insufficient and unavailable remain
   distinct. Collection success need not produce a qualified comparison.

Run `npm run history:collect -- --help` for the complete command. The direct
collector exits 0 for completion/already-collected/dry-run, 1 for collection or
storage failure, 2 for invalid setup, 3 for blocked/deferred collection and 130 for
cancellation. npm may add its own failure wrapper. Neither output nor logs
include raw catalog payloads or credentials.

## 6. Run a bounded schedule

After a successful authorized run, an operator may run:

```text
npm run history:collect -- --plan config/collection-plan.json --watch --max-runs 2 --json --no-input
```

This runs at most twice using the plan's interval after each completed cycle,
and exits immediately when blocked, deferred, failed or cancelled. Stop it with
Ctrl+C. There is no always-on service,
operating-system task or cloud scheduler installed by these commands. A separate
supervisor must honor permissions, expiry, quota and duplicate-job behavior.

### Limits and recovery

1. Allocate `maxRequestsPerDay` from the installation's actual permitted quota.
   Each Products-search attempt reserves four HTTP attempts **before** starting,
   covering the current adapter's worst case: token, Products, one token renewal,
   and one Products retry. `requests` counts search attempts;
   `reservedHttpAttempts` counts conservative reservations, not measured HTTP
   traffic. Failed and uncertain attempts consume reservations. Restarting the
   process, changing topics or changing plans does not reset that source's budget.
   Every reservation remains counted for 24 hours after it was made, including
   across the first reservation's anniversary. A new attempt is admitted only
   when the preceding 24 hours have room for another four attempts. A lower
   operator budget still counts earlier reservations. This is a local safety
   limit; shopper requests, other databases/installations and other
   applications are not counted. Allocate their usage separately. It is not a
   statement of supplier quota or reset behavior.
2. Leave `maxAttempts: 1` unless retries fit the agreement and quota. Only safe
   read availability/transport failures and provider limits retry; rejected
   credentials/permissions, malformed data and unknown errors stop. Up to three
   attempts use exponential delay and the longer valid provider `Retry-After`
   (seconds or HTTP date). Provider limits wait at least 60 seconds. Waits over
   60 seconds are persisted and stop the run, rather than sleeping indefinitely
   or shortening the wait. A future start before `retryAt` makes no source calls.
   Permission is rechecked before each attempt and before publication.
3. Do not start overlapping collectors. A second process sees
   `collection_busy` and makes no source requests while the source's 120-second
   lease is valid. Each reservation refreshes the lease. The supplied adapter
   uses bounded HTTP deadlines; do not substitute an unbounded custom adapter.
   After a process terminates, wait for its lease to expire, then restart the
   same finite plan. The replacement marks abandoned attempts failed and starts
   again. A late worker whose lease expired cannot publish buffered results.
   A suspended process or uncertain network outcome can still duplicate source
   work; the lease does not promise exactly-once network delivery. Reservations
   remain consumed and completed bucket keys prevent duplicate stored jobs.
4. If quota is exhausted after some targets succeeded, the entire run remains
   unpublished. Wait until `retryAt`, then rerun the plan under current rights.
   Do not change the database, clock, source identity or budget to evade a limit.
   If a source or storage failure persists, stop the supervisor and investigate
   its fixed failure category. Never turn it into an empty or refreshed sample.
5. Restart the service against the same authoritative database. Completed
   snapshots survive a restart; buffered partial results do not. An empty
   completed target intentionally replaces its older sample. A failed refresh
   leaves the last complete sample with its original observation time and failed
   attempt status; stale or expired samples are not offered as current deals.

### Check the pipeline without supplier data

`npm test` uses temporary synthetic databases and source responses; it does not
read operator settings, call Kroger or authorize retention. The pipeline test
exercises the native source adapter, collector, SQLite and running private/public
HTTP services. To include all six operations of the actual Python companion,
install Python 3.12 or newer and obtain the separately released
[companion plugin](https://github.com/aipersonalized/houston-i-love-kroger-plugin).
Set `COMPANION_PYTHON` to that interpreter's command or full executable path and
`COMPANION_TOOL` to the plugin's `skills/houston-i-love-kroger/scripts/promotions.py`
file, then run `node --test tests/collection-pipeline.test.js`. See the
[PowerShell and POSIX examples](https://github.com/aipersonalized/houston-i-love-kroger/blob/main/docs/RELEASING.md#4-check-and-evaluate-the-committed-development-candidate).
The tests never guess a sibling checkout. The companion subprocess check
is included only when both settings are present, with explicit skipped subtests
otherwise; ordinary Node-only tests exercise
the same public read contract. Python 3.14 on Windows has been exercised here.

### Optional Compose operator jobs

The supplied `collector` service has `profiles: [operator]` and does not run with
ordinary `docker compose up`. It mounts the same `promotions-data` volume and a
read-only `./config` directory at `/operator`. Its runtime image already contains
the operator scripts; it does not load a host `.env` file itself. Compose supplies
private API settings. The service's default command names
`/operator/collection-plan.json` and runs once, with no schedule.

After actual source rights, current private policy, enabled finite plan and
production credentials are ready, an operator can run a bounded job from the
reviewed Compose folder. For a first import, place the private policy in the
ignored config directory and use its actual filename instead of the placeholder:

```text
docker compose -f compose.yaml --profile operator run --rm collector --plan /operator/collection-plan.json --source-policy /operator/YOUR-PRIVATE-POLICY.json --once --json --no-input
```

For later authorized runs, omit `--source-policy` unless importing a genuinely
new reviewed policy. A safe prerequisite-only check can replace `--once` with
`--dry-run`; it makes no source requests, opens no database and does not inspect
or import existing permission. A denied dry run must not be repaired by inventing
policy metadata. Do not start overlapping jobs or run the operator profile as an
always-on service. Keep private policy/config files out of Git and image builds.

To use the maintenance script in that same authoritative storage environment,
the reviewed recipe permits an explicit entrypoint override. For example,
read-only status is:

```text
docker compose -f compose.yaml --profile operator run --rm --entrypoint node collector scripts/maintain-history.js --status --json --no-input
```

Maintenance actions below can replace `--status` when intentionally authorized.
Do not use the default collector entrypoint for maintenance arguments, and do
not remove the volume as a substitute for scoped retention cleanup. These are
operator instructions, not evidence that a container job or live source was run.

## 7. Maintain retention and revocation

Use `npm run history:maintain -- --help` for the operator interface. Status is
read-only apart from normal database initialization/opening:

```text
npm run history:maintain -- --status --json --no-input
npm run history:maintain -- --purge-expired --dry-run --json
npm run history:maintain -- --purge-expired --json --no-input
```

Stop collection immediately when a grant expires or is revoked. To revoke the
implemented source and delete its retained observation rows, use the explicit
action only when that is the intended operator decision:

```text
npm run history:maintain -- --revoke-source kroger-public --purge --json --no-input
```

Revocation excludes the source immediately and cannot be reversed by importing
the same policy. Reinstatement is not implemented. Without `--purge`, revocation
excludes data from display but retains its rows. Expiry is enforced at reads;
schedule the purge command to remove expired/revoked rows rather than assuming
filtering physically deletes them. Current narrower store/topic scopes and the
shorter of original retention, current retention and grant expiry apply at reads
and purges. Importing a stricter policy shortens stored retention deadlines;
later loosening does not revive expired observations. Purge after tightening
retention as well.

SQL row deletion is not guaranteed physical erasure from SQLite free pages,
WAL, filesystem copies or backups. Review the actual deletion obligation and
qualify an appropriate storage/backup erasure process before collecting data
that requires it. This prototype does not implement universal physical erasure.
See [backup and recovery](SELF_HOSTING.md#7-back-up-upgrade-and-recover).

## How comparisons work

Observations retain source/store/product/item identity, supplied description and
brand, package size, sale unit,
reported prices and estimates, source dates, observation time, permission scope
and retention deadline. No raw response, shopper identity, shopper ZIP search or saved
shopping query is retained. Collection-run metadata reports bounded coverage.

The reader uses only earlier retained observations for the exact store and item.
Qualified arithmetic additionally needs matching, reported currency, price
basis, fulfillment and eligibility, valid dates and compatible package details.
The public Kroger schema leaves several of these unreported: dated earlier
prices may be shown as observations while the comparison stays `incomparable`.
A source-reported zero is not treated as a verified free offer or promotion.

The most recent and lowest values cover retained, date-qualified prior promotion
observations. They are not an all-time low or a complete promotion history.
One earlier qualified observation is marked insufficient history. Regular price
is never substituted for a historical promotion price. Unit arithmetic needs an
explicit common measurement basis; package text alone does not supply it.

## Latest deals from our database

The companion's stored-deal workflow gets deals from our database service,
without a live Kroger request. Its explicit current-shopping workflow is separate.
After actual collection permission and a successful operator run, use
`POST api/v1/promotions/latest` with the exact store reference and approved
operator topic. The [API contract](API.md#latest-collected-deals) and
[service guide](PROMOTION_SERVICE.md#how-the-independent-clients-connect) explain the
public read path, private database ownership and setup.

Latest deals come from the newest complete snapshot before qualifying rows.
An empty complete collection replaces its older topic sample; newer regular,
unavailable or unsupported-price facts prevent old promotions reappearing.
A failed run leaves the previous complete data with its true age, rather than
publishing partial prices or marking them refreshed. Old prices are not offered
as current after the configured freshness limit. Snapshot/cursor reads check
rights again and never run collection.

The default maximum age is24hours, configured by the operator, not the caller.
This is a site policy, not a supplier guarantee. History and latest deals cover
only approved retained samples. Missing latest data does not trigger a supplier
request or switch the companion to current-shopping mode. Use the independently permission-gated
[stored ZIP directory](API.md#stored-store-discovery) to choose an exact store,
then [completed topics](API.md#completed-collection-topics) to discover readable
collected scope. Missing data remains an operator dependency.

## Search and retrieve retained observations

1. Run the [shared service](PROMOTION_SERVICE.md) against the authoritative
   database and connect the app using `SHOPPING_SERVICE_URL`. Keep the private `/v1/*` token
   entirely in backend runtime configuration.
2. In the app choose the exact store, then **Past prices**. Enter an optional
   grocery or brand, or use the product-reference option, then select **Find
   past prices**. Leaving both blank reads a bounded sample, not every stored row.
3. Read the date/source, then **See past price details**. Use **Show more past
   prices** when available. Start a fresh search to change filters or
   include new insertions. Older rows may require exact IDs because text was
   never retained.
4. For scripts/agents, use the dedicated shared service's
   [promotion search/retrieval contract](API.md#stored-promotion-search-and-retrieval).
   Its optional exact item ID, inclusive UTC time filters, limit and cursor do
   not bypass any store, provenance or source-rights check.

Each read/page enforces original and current collection/display/agent purposes,
approved store/topic scope, completed collection provenance, grant expiry and
shorter applicable retention. A cursor freezes an insertion/time boundary for
pagination; it cannot freeze rights or resurrect an expired observation. A
renewed grant does not revive an expired original grant or shortened row deadline.

An available search with zero matches differs from `permission_required` or an
unavailable service. Under otherwise permitted scope, exact retrieval gives
`not_found` for absent, wrong-store, expired or inaccessible rows, without
revealing whether excluded rows remain. Source-policy evidence references and
private storage details are never returned.

Search results include authorized regular-only and source-zero observations,
not just verified promotions. `promotionStatus` and `dateQualification` describe
the stored fact at observation time, not a current free offer, current deal,
complete historical record or all-time low. Preserve unknown currency, basis,
fulfillment and eligibility rather than filling them from store geography.

For an upgrade, stop writers and take a consistent private backup first. Schema 6
has no in-place downgrade; restore a compatible backup with its matching older
version if rolling back, while reconciling later collection and current rights.
See [backup and recovery](SELF_HOSTING.md#7-back-up-upgrade-and-recover).

## Collect a stored ZIP directory separately

This optional operator task enables an assistant to start from a ZIP without
making live supplier requests. It does not collect a shopper's lookup history.
The operator chooses at most ten explicit ZIP queries in advance. The history
collector's stores/topics and grant do not enable directory collection.

1. Obtain and review an actual Public Locations data grant for systematic
   collection, human display, intended agent recipients, retained fields, query
   frequency, ZIP scope, retention, expiry, revocation and backups. API access
   alone does not grant any of these rights.
2. Copy `config/store-directory-plan.example.json` to private
   `config/store-directory-plan.json`. Keep `enabled: false`. The source is
   `kroger-public-locations`, separate from `kroger-public` product history.
3. Add only approved five-digit strings to `zipCodes`; preserve leading zeros.
   The plan fields are exactly `version: 1`, `sourceId`, `enabled`,
   `intervalMinutes` (60–10,080; default 1,440), `maxRequestsPerDay` (4–1,000;
   default 40), and `zipCodes` (zero to ten distinct ZIPs; at least one to run).
   Radius is fixed at ten miles and limit at ten first-page source records.
   Neither the plan nor read requests can expand those query bounds.
4. Prepare private directory-policy metadata only after the grant is verified:
   `sourceId`, `sourceLabel`, `status: "verified"`, opaque `evidenceReference`
   and `reviewReference`, actual UTC `verifiedAt`/`expiresAt`, `retentionDays`
   (1–3,660), `allowedZipCodes` (one to ten explicit strings), and
   `allowedPurposes` containing exactly `store-directory-collection`,
   `store-directory-display`, `store-directory-agent-access`. Keep actual
   agreements, identities, paths and private values outside these public files.
   A policy JSON file is not evidence that permission exists.
5. Run `npm run stores:collect -- --help`, then
   `npm run stores:collect -- --dry-run --json --no-input`. A dry run opens no
   database, reads/imports/reviews no policy, and makes no network request.
   It reports missing permission because existing stored rights were not read.
6. Only after actual rights, private credentials and approved scope are ready,
   set `enabled: true` and run once, supplying your private policy location:
   `npm run stores:collect -- --directory-policy config/directory-policy.json --once --json --no-input`.
   Use the authoritative service's private database, not a second web-container
   file. The command emits fixed counts/status, not store records or private
   configuration. The production adapter refuses certification or another source.
7. Expect `completed`, with snapshots/stores/request counts, or a precise
   blocked/deferred/failed state. All selected ZIP responses publish together
   only after current and original rights and the source lease are rechecked.
   An empty completed response replaces that ZIP's older snapshot. A failed ZIP
   publishes no partial replacement or refreshed date. Repeated store identities
   or conflicting metadata fail instead of silently dropping a store.
8. If scheduling externally, honor the reviewed frequency and finite plan. One
   scheduled bucket is idempotent while its completed snapshot is retained.
   Source-wide leases, conservative four-attempt reservations per query, a true
   rolling 24-hour local budget and provider backoff survive restart. There is
   no automatic directory retry or unbounded watcher. Local budgets do not
   replace the supplier's actual agreement or shared account limits.

The [stored directory API](API.md#stored-store-discovery) preserves query ZIP,
source identity, original rights, retrieval/completion times, raw result count
and the fixed query bounds in private storage. It returns only source-reported
store ID/name/address metadata, never inferred distance or coverage. A 10-mile
first-ten query is not every nearby store or verified nearest-store ordering.
Freshness uses the service's configured threshold (default 24 hours), not a
supplier validity guarantee. Fresh-empty, missing, failed-attempt, stale and
permission-denied outcomes remain distinct. Reads never collect or refresh.

Use `history:maintain -- --source kroger-public-locations --status --json` to
inspect local status, independent directory permission and global directory
counts. For expiry/scope tightening, use the same source with `--purge-expired`;
for an authorized revocation/deletion use
`history:maintain -- --revoke-source kroger-public-locations --purge --json`.
Directory snapshots/store rows are purged together; product history remains at
its own source. Rights revocation immediately blocks reads; reinstatement is
not implemented. A later broader grant never restores a shortened deadline.
Row deletion does not prove physical erasure from WAL, devices or backups.

An operator error after collection starts is not a zero-request result. An
unverified publication uses null counts; an escaped failure omits unknown
counts. Stop scheduling and inspect the recorded last attempt and storage before
retrying. A failed storage close is reported before any completion output.
Never treat a restart or a missing acknowledgment as proof no snapshot committed.
