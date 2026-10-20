# Read the latest collected deals for an exact store and topic

Help a person choose useful deals from the service's latest completed collection,
or explain missing permission, collection or freshness. Turn the returned facts
into a concise shopping recommendation, preserving age and limited coverage.
This procedure reads stored data and never refreshes Kroger prices.

## Continued From

`SKILL.md` latest-deals route, or setup with a usable permitted installation.
Direct entry accepts an existing valid store/topic choice and access context.

## Resources

Before source-record requests, read `references/source-permissions.md` in full.
Before the first request, read `references/api_reference.md` and
`schemas/command-rules.md` section "Stored promotion CLI" in full. Read
`research/official_docs/pages/API.md` section "Latest collected deals" for exact
HTTP fields. Before reporting, read `schemas/output-contract.md` in full.

## Step 1: Accept the installation and permitted recipients

Use the actual app base URL supplied by the operator, including its final `/`.
Confirm that source rights and user privacy cover every tool/agent/model
recipient. Reuse established current authority; `--data-use-approved` records
that check and cannot grant rights. Do not load raw records into a disallowed
channel and redact them afterward.

When connection or permission status is uncertain, run
`python scripts/promotions.py status --base-url BASE_URL --json --no-input`
from this skill folder, replacing BASE_URL. This uses only the stored service's
status endpoint. A successful `permission_required` response is a missing grant,
not an empty database. `available` does not establish a completed store/topic
collection. Setup gaps return to `playbooks/setup-and-recovery.md`.

## Step 2: Bind the accepted store and exact collection topic

Use the person's accepted complete eight-character store ID, including zeros.
If store choice or collected scope is missing, read and follow
`playbooks/choose-store-and-topic.md` in full. Use its stored ZIP choices and
completed-topic discovery, then accept the person's exact location. No separate
human web-app visit or live ZIP request is needed when stored data is usable.

Accept the person's category, budget or brand preferences when supplied. Use
them to select among known approved topics or filter the returned records;
do not imply that local filters enlarged collection coverage. If no preferences
are given, use the known accepted topic scope and explain its limits.

Use an exact fresh completed topic returned by discovery, or an already verified
operator-confirmed scope, such as `milk`.
Latest topics are exact collection labels, not arbitrary product substring
searches. Do not assume a starter sample or broaden to every topic. A missing
topic enters stored topic discovery; an absent/stale collection goes to the
operator. The person confirms an ambiguous store/scope. No gap causes live fallback.

## Step 3: Read one bounded latest-deals page

Run `python scripts/promotions.py latest --store STORE_ID --topic TOPIC
--base-url BASE_URL --data-use-approved --json --no-input`, replacing all named
values. Default page size is 20, maximum 50. The only request is to this app's
stored latest endpoint; it cannot start a collector or fetch live products.

Check that the returned store/topic match the accepted request. Preserve the
completed snapshot identity, observation and completion dates, age, operator
freshness threshold, latest-attempt status/times, coverage and page information.
The default threshold is 24 hours; it is an operator policy, not a supplier price
validity guarantee or a client override. Request time is not observation time.

Follow a matching cursor only for the person's specified bounded result. A
changed/expired snapshot cursor requires a new bounded request and a clearly
identified new snapshot; never combine pages from different snapshots or silently
truncate additional pages. Preserve returned order without inventing a ranking.

## Step 4: Interpret the state before comparing prices

| State | Meaning and action |
|---|---|
| `available`, deals present | Fresh under the operator's policy. Report dated collected facts and limited coverage; these are not live checkout quotes. |
| `available`, deals empty | A fresh completed snapshot has no qualifying deals in this topic/scope. Do not revive an older promotion. |
| `no_data` | No usable completed collection for this exact store/topic. Report its reason; it does not mean the store has no promotions. |
| `stale` | The completed snapshot exceeds the operator's freshness policy; deals are withheld. Report snapshot dates/age and the operator dependency. |
| `permission_required` | Source permission is absent, expired, revoked or outside scope. Stop source-record reads; do not call it empty. |
| `unavailable` or request failure | The service or read failed. No useful result was obtained; return the fixed recovery. |

A newer failed/pending attempt is distinct from the last completed snapshot.
Describe its fixed status and times when provided. A failed run does not prove
the accepted last completed snapshot was refreshed. Latest selection excludes
superseded promotions; never restore suppressed older rows from history.

For returned deals preserve full source description, item/package identity,
reported regular/promo prices and observation date. Describe supplied savings
separately as calculations from that stored pair. Show supplied unit estimates
at their precision and leave missing basis unknown; package text cannot invent
`$/oz` or `$/lb`. Latest rows contain no prior-history comparison; request dated
history separately only when asked, keeping context and qualification explicit.

## Step 5: Explain what looks useful or inexpensive and stop

Use the output contract to answer the person's shopping question in plain
language. Separate a good reported discount from a low whole-package price:
large savings do not by themselves mean low spending, and a cheap package may
not be good value for a different size. Rank only fresh returned qualifying deals
with enough description/package/price context. Use supplied discount arithmetic
or simple arithmetic against the identified stored pair; explain why each pick
fits the person's category, budget or brand preference. Do not invent a measure,
health benefit, comparable package or storewide ranking.

For "what's good/cheap/on deal?", give a small curated selection with full
product name/description, package when supplied, reported promo price, supported
saving and a short reason. State selected count, returned count and whether
another page exists; a curated selection is not the full database or store.
If rows are unnamed or lack usable context, explain the gap instead of inventing
names or calling them good deals. Preserve dates and missing facts in a short
coverage note, rather than dumping DTO fields, IDs or operator settings into the
shopping answer. Include one practical action, such as checking the selected
product/package and current price at the store. Confirm conditions/availability
before the person relies on a price. Never recommend stale or expired offers.

Stop after the requested stored result. Do not save a catalog copy, contact
Kroger, collect history, add a cart item or run history search as an unannounced
replacement for stale/empty latest data. Dated history is a separate requested
route in `playbooks/stored-promotions.md`.
For a requested item price check or quantity/budget estimate, enter
`playbooks/price-check-and-estimate.md` with the accepted store/topic/recipients.
Use actual stored-price and estimate operations rather than inventing totals in
prose. A discovery request alone does not choose quantities or authorize purchases.

## Gotchas

- Same store with a different exact topic is a different completed snapshot.
- A fresh empty snapshot replaces that topic's older deals.
- No completed collection, stale collection and fresh empty deals are different.
- Snapshot age says when data was collected; it does not establish offer expiry
  or present stock. Synthetic source labels never establish live prices.

## Checklist

- [ ] Exact store/topic, installation and recipient authority are accepted.
- [ ] Only the stored latest/status interface was used.
- [ ] Snapshot identity, dates, age, coverage and result state remain explicit.
- [ ] Source facts, calculations and unknowns are preserved without live fallback.

## Recovery from interruption

Recheck changed installation, recipient and store/topic inputs. Resume only with
a cursor still bound to the accepted snapshot; restart a bounded read if the
server rejects it. Do not turn an earlier request date into a new observation or
repeat failed collection through this reader. Preserve useful permitted results
as dated prior responses rather than claiming a refresh.

## Handoff

Producer: latest-deals procedure. Receiver: caller. Deliver accepted store/topic,
snapshot/observation dates and age, coverage, source facts, result state, actual
checks and remaining gaps. The caller checks those meanings before use. Return
connection failures to setup, store choice to the person and collection/freshness
or source authority to the operator. Stop at the requested bounded result.
