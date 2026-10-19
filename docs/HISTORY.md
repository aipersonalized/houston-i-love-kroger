# Collect and maintain price history

History starts empty. The app has no purchased, imported or backfilled historical
price dataset. Shopper searches never write observations. A separate operator
command can collect a small, fixed set of store/topic samples after permission
and API access are established.

## 1. Understand the source requirement

Kroger's public acceptable-use policy restricts systematically gathering API
response data into a database. Its public API documentation does not establish
a complete historical-price or store-promotion endpoint. Partner documentation
also does not grant access or retention rights. See the
[permission request draft](KROGER_PERMISSION_REQUEST.md); it has not been sent.

This collector therefore starts disabled, with the `kroger-public` source marked
pending. API credentials, the user's request to build the app, a successful test
or a hand-written policy file cannot grant Kroger's permission. Obtain and review
the actual agreement first. The common human/agent endpoint requires historical
collection, human display and automated-client access to be covered together.
Forwarding data to an external model service needs its own applicable permission.

## 2. Initialize private storage

1. Complete [local installation](SELF_HOSTING.md). Open a terminal in the project.
2. If desired, set `HISTORY_DB_PATH` in your private `.env` to a private persistent
   database filename. Blank uses `.runtime/history.sqlite` in the project.
3. Run:

   ```text
   npm run history:init -- --json --no-input
   ```

4. Expect `status: ready`, schema version 2 and an observation count. On first
   use it should be zero. Repeating initialization preserves existing history.
5. Protect this folder with your operating system's access controls. Unix
   directory mode requests do not establish Windows ACL protection. Keep the
   database, sidecars, private plans, policies and backups out of public folders.

The SQLite adapter uses foreign keys, WAL journaling, full synchronization,
prepared queries and transactional writes. Opening an unrelated or incompatible
database, a changed migration or linked database path is refused. Do not change
the migration files after creating a database and expect an automatic upgrade.
The verified version-1 schema upgrades transactionally to version 2. The original
migration remains unchanged. Version 2 records a hash of each operator topic so
later scope narrowing can be enforced. Legacy rows with unknown topic provenance
are excluded and eligible for purge; their topic is never guessed.

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
4. For later runs the reviewed policy is stored; omit `--source-policy` unless
   recording a newly reviewed policy. Do not edit a prior policy's identity to
   disguise a changed scope or expiry.
   A superseded policy cannot become current again, including a replay of the
   original setup command. Newly imported policies cannot predate the active
   review. Use the actual current reviewed policy; do not change dates or
   references merely to bypass a rejection.
5. View current results in the app. Empty, incompatible, insufficient and
   unavailable history remain distinct. A successful collection need not produce
   a qualified numerical comparison.

Run `npm run history:collect -- --help` for the complete command. The direct
collector exits 0 for completion/already-collected/dry-run, 1 for collection or
storage failure, 2 for invalid setup, 3 for blocked prerequisites and 130 for
cancellation. npm may add its own failure wrapper. Neither output nor logs
include raw catalog payloads or credentials.

## 6. Run a bounded schedule

After a successful authorized run, an operator may run:

```text
npm run history:collect -- --plan config/collection-plan.json --watch --max-runs 2 --json --no-input
```

This runs at most twice using the plan's interval, and exits immediately when
blocked, failed or cancelled. Stop it with Ctrl+C. There is no always-on service,
operating-system task or cloud scheduler installed by these commands. A separate
supervisor must honor permissions, expiry, quota and duplicate-job behavior.
Do not run overlapping collectors against the same plan. Completed-job keys
limit duplicate storage; they are not a distributed network-work lease.

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

Observations retain source/store/product/item identity, package size, sale unit,
reported prices and estimates, source dates, observation time, permission scope
and retention deadline. No raw response, shopper identity, ZIP search or saved
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
