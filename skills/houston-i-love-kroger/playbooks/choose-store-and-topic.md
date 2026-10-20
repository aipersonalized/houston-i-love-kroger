# Choose an exact store and collected scope from stored data

Use a person's ZIP to offer dated store choices, confirm their exact location,
then find completed collections relevant to the requested shopping task.

## Continued From

The store/topic route in `SKILL.md`, or a requested read missing its accepted
store or topic. Reuse a current verified store choice instead of asking again.

## Resources

Before source records, read `references/source-permissions.md` in full. Before
requests, read `references/api_reference.md` and `schemas/command-rules.md`
section "Stored promotion CLI" in full. Read `research/official_docs/pages/API.md`
sections "Stored store discovery" and "Completed collection topics" for exact
fields and limits. Before answering, read `schemas/output-contract.md` in full.

## Step 1: Accept the requested task and permitted installation

Use the actual app base URL and a permitted client. Establish recipient rights
for the requested directory or product data before exposing its records. The
directory and promotion collections have separate source permissions; a blocked
promotion-status response does not establish that directory access is blocked.
Evaluate the actual requested operation's result.

Accept a five-digit US ZIP as text, preserving zeros. Request only that missing
input; no street address or precise device location is needed. If the person has
already accepted a complete store ID, skip directory lookup and reuse it.
Do not ask for credentials, private agreements or database access.

## Step 2: Offer stored store choices and ask for the exact location

Run `python scripts/promotions.py stores --zip ZIP_CODE --base-url BASE_URL
--data-use-approved --json --no-input`, replacing the named values. This reads
the service's stored ZIP snapshot; it never calls Kroger or starts collection.
Check the echoed ZIP, snapshot observation/completion dates, age, freshness
threshold, latest-attempt state and directory coverage before using the choices.

For a fresh `available` response, show returned store names and addresses so the
person can identify the location they intend to visit. Keep the exact store ID
as traceability. Explain that these are dated results from a bounded search:
up to ten returned locations within the source query's ten-mile radius, not a
complete or distance-ranked nearby-store directory. Do not invent distance from
the ZIP, current hours, missing names/addresses or a closest-store claim.

Ask which exact location they want and wait for their choice. Even one returned
store is not an automatic choice. Match their answer to one returned complete
ID; resolve ambiguity with its actual name/address. If missing metadata prevents
identification, explain that gap rather than guessing. An existing verified
choice can be supplied directly without repeating discovery.

An `available` empty snapshot means no stores were returned in that saved
search, not that no Kroger exists nearby. `no_data`, `stale`,
`permission_required` and `unavailable` are distinct directory/data dependencies.
Explain the actual state and resolving operator action. Do not send the person
to the human app as a mandatory prerequisite when usable stored choices exist.
No missing/stale result authorizes a live lookup or collection.

## Step 3: Discover completed topics for the confirmed store

Reuse a still-valid accepted collection scope when it already matches the
confirmed store and requested task. Otherwise, for current deals, prices or a
budget/quantity estimate, run
`python scripts/promotions.py topics --store STORE_ID --base-url BASE_URL
--data-use-approved --json --no-input` with the person's confirmed ID. Check
the returned store and coverage. This lists completed readable collection
scopes, not private configured-but-uncollected plans or a complete catalog.

Read each returned topic's state, snapshot dates/age, returned product count and
latest-attempt facts. Zero can identify a completed empty collection, not a
missing collection.
Use only relevant fresh `available` scopes for current recommendations. A
`stale` topic or overall `no_data` result cannot support a current price; explain the difference
and operator dependency. Topics report collected coverage rather than new
grocery searches. Never guess an arbitrary search term is an accepted topic.

Use the person's stated category, brand or task to choose among relevant fresh
returned topics. Ask when their intended scope is unclear; do not silently pick
the first topic or broaden a specific task to every collection. State the finite
topics covered when answering a broader request. Empty completed-topic results
mean no usable returned named scope, not that the store has no deals. Older jobs
without retained labels do not become guessed topics; they need a new permitted
named collection.
For a dated-history-only request, the confirmed store is sufficient; no current
topic choice is required.

## Step 4: Continue the requested task or finish with the actual gap

Pass the confirmed exact store, relevant completed topic state/snapshot,
installation and permitted recipients to `playbooks/main-procedure.md` for
deals, `playbooks/price-check-and-estimate.md` for price/quantity/budget work, or
`playbooks/stored-promotions.md` for explicitly requested history. Their reads
recheck rights and freshness; discovery is not permanent permission.

For store-selection-only, return the confirmed location and directory date/
coverage and stop. For a blocked dependent task, explain the specific missing
directory, topic, permission or freshness fact and stop that read. Never trigger
source collection, a live request, a Cart action or a fabricated price.

## Gotchas

- A stored ZIP snapshot is dated source metadata, not a live location search.
- Directory permission and promotion permission are separate checks.
- A fresh topic can have zero qualifying deals; topic discovery proves neither
  every store promotion nor every historical price is present.

## Checklist

- [ ] Actual installation, ZIP/accepted store and recipient scope are established.
- [ ] Directory date/coverage and missing facts remain visible.
- [ ] The person chose the exact store; no first-result assumption occurred.
- [ ] Relevant completed topic states were checked before current-price work.
- [ ] Only the requested stored task continues; no source refresh occurs.

## Recovery from interruption

Reuse an accepted choice while its identity and user intent remain valid. Recheck
changed ZIP, store, recipients or collection state before dependent reads. If a
directory/topic snapshot became stale or unreadable, disclose that state and
return its operator dependency; do not recover it through a live search.

## Handoff

Producer: stored store/topic discovery. Receiver: caller or the already requested
deal, price/estimate or history procedure. Deliver the person-confirmed exact
store, supplied name/address, directory date/coverage, relevant completed topic
states, installation, permitted recipients and gaps. The receiver checks those
facts and rechecks its own read result. Stop for store-only work or missing
required facts; otherwise continue only the requested shopping task.
