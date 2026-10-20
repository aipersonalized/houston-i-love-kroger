# Search and retrieve approved stored promotions

Return the requested dated observations for one accepted store, or explain the
specific missing permission, connection or record. This reads stored data; it
does not refresh prices, collect a catalog or change a shopping cart.

## Continued From

The stored-promotion route in SKILL.md, with the actual app base URL and an
approved recipient. A verified exact store choice can be reused.

## Resources

Read `references/source-permissions.md` and `schemas/command-rules.md` section
"Stored promotion CLI" in full before receiving source records. Read
`research/official_docs/pages/API.md` section "Stored promotion search and retrieval"
for the actual HTTP contract. For setup, read `references/user-guide.md`.

## Step 1: Establish the installation, store and recipient

Use the user's selected installation and exact full eight-character store ID.
If only a ZIP is supplied, read and follow `playbooks/choose-store-and-topic.md`
in full for stored directory lookup and the person's exact store choice; dated
history does not require a current topic. Do not guess a store from a ZIP.
Confirm that the source grant permits this
recipient, including any model service that receives tool output. Reuse valid
authority. The CLI's acknowledgement flag is not a new grant.

Run `python scripts/promotions.py status --base-url BASE_URL --json --no-input`
from the skill folder. Replace BASE_URL with the actual base address ending in
`/`; never supply credentials or query strings in the address. A successful
connection reporting permission_required is an authority gap, not an empty
database. Stop source-record requests while that gap remains.

## Step 2: Search the bounded approved observations

Use `python scripts/promotions.py search --store STORE_ID --term TERM
--base-url BASE_URL --data-use-approved --json --no-input`, replacing the named
values. `--term` is optional. Product/item IDs and UTC observation-date bounds
are alternatives or additional filters; consult --help for exact flags.

Request only what the user needs, at most 50 rows per page. Verify the exact
returned store, source, observation time and page coverage before use. Follow a
query-bound cursor only to fulfill a specified bounded request; do not harvest
all stored data or silently omit additional pages. `--summary-only` returns
fixed status/counts for diagnostics instead of source records.

## Step 3: Retrieve and explain a selected record

For a specific search result, use `python scripts/promotions.py retrieve
--store STORE_ID --observation-id OBSERVATION_ID --base-url BASE_URL
--data-use-approved --json --no-input`. The store and observation must match.
A not_found response does not establish that no promotion ever existed.
Permission and expiry are checked again on retrieval; previous access is not
permanent authority.

Keep complete source descriptions and price facts, units, source labels and
observation dates. A retained observation is a historical fact from the listed
scope, not a current checkout offer or an all-time low. An unqualified or
regular-only record must not be represented as a verified promotion. Apply the
existing output contract's source/calculation/unknown distinctions.

## Step 4: Return the requested result and stop

Keep this route separate from latest collected deals. Do not silently use it to
fill a stale, no-data or fresh-empty latest result, and never run live source
searches or collection as a fallback.

Return the requested matching observations with their dates and limited
coverage, or the precise permission/not-found/unavailable outcome. Do not save
or forward responses to a new recipient. This command never initializes a
database, imports policy, invokes collection or alters supplier permissions.

## Gotchas

- A successful connection reporting permission_required is not an empty database.
- Search pages contain retained observations, including explicitly labelled
  regular-only records; they do not establish current promotions or full coverage.
- The CLI flag acknowledges existing permission. It cannot create source rights
  or authorize a new recipient, and the server checks permission again.

## Checklist

- [ ] The installation, complete store ID and permitted recipients are accepted.
- [ ] Returned store, dates, source and bounded page match the requested search.
- [ ] Missing or revoked permission and unavailable records stay explicit.
- [ ] No collection, persistence, cart change or new forwarding occurred.

## Recovery from interruption

Run status when the connection or authority changed. Retry a read only after
respecting the reported limit and deciding it is needed. Expired, revoked or
unavailable data must not be reconstructed from earlier tool output or private
logs. Discard mismatched-store or unsupported responses; never substitute test
records or a current regular price for missing history.

## Handoff

Producer: stored-promotion procedure. Receiver: caller. Deliver the exact store,
requested dated results, source/coverage and actual checks, or the unresolved
dependency. The caller verifies recipient authority and record meaning. Return
installation problems to setup, ambiguous store choices to the user and source
permission questions to their actual authority; stop at the bounded request.
