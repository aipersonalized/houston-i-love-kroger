# Shopping, stored-deal, history and setup result contract

## When to read this

Read this file in full before returning a current-shopping, stored-deal, history or setup result.
Use concise prose or a table; no output file or saved catalog copy is required.

### Human shopping answer

Lead with useful picks or the actual data gap. For "what's good, cheap or on
deal?", explain which fresh returned products have a supported discount and
which have a low reported whole-package price. These are separate judgments.
Match supplied category, budget and brand preferences; do not invent preferences,
compare incompatible packages or infer health quality from a discount.

A compact answer normally has product name/full source description, package
when known, reported promotional price/currency, supported savings and one short
reason it may help. A concise note gives collection/check time and sample limits,
then one useful next action. IDs, raw field names and operator settings remain
technical traceability, not default shopping columns. Translate freshness into
ordinary language; an old/stale or expired observation is not a recommendation.
If names or package/price context are missing, say there is too little evidence
to rank a useful pick. Do not invent a product label.

For a price check, lead with the exact named item/package's reported selling
price and currency, its observation date and any stock/qualification limit.
Regular-only stored prices are useful price facts; they are not promotions.
For requested quantities or a budget, use supported service/tool arithmetic and
show each selected item/package, quantity, qualifying line cost and a clearly
qualified full or partial subtotal. State unresolved missing/weight/currency/
stale/stock lines and exclusions (tax, deposits, fees, coupons and checkout
conditions) next to the amount. Do not label a partial or mixed-currency amount
as the total shopping cost. Do not invent USD from store location. Alternatives
must be actual returned products with compatible context, within known coverage.
Historical comparisons need matching item/package/currency/basis and dated facts;
incompatible observations are not evidence of savings today.

For a curated subset, state selected count, returned count and additional-page
availability. Preserve full descriptions for products actually shown. A ranking
is among the fresh qualifying returned deals, never cheapest storewide or across
retailers. Unknown currency, unit basis, stock and checkout conditions stay clear.

### Evidence carried into the answer

For current shopping, preserve requested groceries/quantities and any supplied
budget, brands, packages and substitution preferences. Match actual source
packages and name no-match/unresolved groceries instead of dropping them.
Reuse valid store confirmation. Source lookup times (`retrievedAt`) and final
estimate time (`evaluatedAt`) are distinct from stored observation dates.
Certification and synthetic results remain test data.

Current products can have regular-only prices, qualified promotions or promo-only
prices with no regular-price savings. Per-unit numbers keep source precision
and unknown measure basis. The supported current model reports no currency:
no symbol, verified monetary subtotal or verified budget fit follows. Complete
means requested-line arithmetic; partial leaves unresolved requested lines.
Show unresolved reasons beside amounts. No resolved lines gives null, never
zero. Date/stock/context gaps stay visible. Selected-product rechecks establish
no full promotion coverage, stable ordering or atomic supplier snapshot.

## Inputs and outputs

| Required meaning | Evidence or explicit unavailable value |
|---|---|
| State | Successful current bounded read/empty result, complete/partial arithmetic, or stored fresh deals/fresh empty/no completed collection/stale/permission/unavailable/not found/failure. |
| Store and query | Exact person-accepted ID; directory name/address and date when returned, never invented; exact completed topic for latest/prices or history filters. |
| Store discovery | Matching ZIP, dated stored directory snapshot, freshness/state, bounded radius/cap and explicit person choice; an empty saved search is not proof there are no nearby stores. |
| Topic discovery | Completed readable topic labels, each snapshot/state/date and returned count; fresh empty, all-stale, missing/unnamed collection and permission gaps remain distinct. No complete-catalog claim. |
| Source and dates | Source labels, each observation date, snapshot ID and observed/completed times with timezone; request time is distinct. Synthetic status remains explicit. |
| Latest freshness | Snapshot age and operator max-age threshold, default 24 hours; latest attempt status/times when supplied. No supplier validity guarantee follows. |
| Coverage | Exact returned bounded topic sample or retained-history query, collection product/page limits, returned count, incomplete coverage and additional-page state. |
| Order | Preserve server order or explain an explicitly requested local ordering of the returned page; do not imply a whole-store ranking. |
| Item identity | Full unaltered source description, item/package facts and IDs when supplied. |
| Comparison | Stored regular/promo source values with currency; savings and percentage separately identified as calculations from that dated pair. |
| Unit comparison | Each supplied estimate at its precision; missing measure basis/estimate explicit. |
| Past comparison | Qualified prior prices/dates/source labels and count where supplied; failed, insufficient or incomparable history remains explicit. Latest rows have no history wrapper. |
| Limits and next action | No live checkout quote or stock guarantee; conditions/validity stay bounded to supplied evidence; exact operator or connection dependency. |

For a curated or explicitly requested top subset, state shown count and returned total.
Do not silently omit pages or abbreviate source descriptions. Missing fields
stay unavailable, never zero. `available` with an empty deals list is a fresh
completed empty result, distinct from `no_data`, `stale` and
`permission_required`. Stale/no-data results must not be filled with history.

History search/retrieve returns dated retained observations. Do not describe an
old price as today's offer, a regular-only observation as a promotion, or a
collected low as an all-time low. No stored response means no stored-price claim.

For setup, state actual installation identity, requested help, checks executed,
service status, permission/client/data gaps and next action. Human instructions
are instructions rather than executed installations, registrations or reads.

For store choice, show usable returned names/addresses first and ask which exact
location the person wants. Do not choose a first/closest result or make the
human web app a mandatory handoff when stored data is usable. For topics, explain
which requested categories have fresh completed data and which remain gaps;
operator plan labels and raw DTOs are not the default shopping answer.

## Checks and failures

Before delivery, check store/topic/query and snapshot-bound pagination, complete
source text, currency, observation versus request dates, freshness/coverage,
actual recipients and result meanings. No completed collection does not mean no
store promotions; permission-required is not an empty read; an unavailable
service leaves records unknown. A failed collection attempt does not refresh the
last completed snapshot. Missing unit basis remains unknown.

Report fixed HTTP/tool code and useful recovery without raw server errors or
private configuration. Stop dependent work on missing identity, authority or
compatibility. No stored failure triggers a live search or collector. Deliberate
current reads use only the app; no direct supplier call occurs. These are
manual report checks rather than an invented automated output validator.
