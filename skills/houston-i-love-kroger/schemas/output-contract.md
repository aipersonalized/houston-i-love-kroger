# Shopping and setup result contract

## When to read this

Read this file in full before returning a shopping comparison or setup result.
Use concise prose or a table; no output file or saved catalog copy is required.

## Inputs and outputs

For a shopping result, preserve these meanings:

| Required meaning | Evidence or explicit unavailable value |
|---|---|
| State | Completed, completed with gaps, blocked, empty result or known request failure. |
| Store | Exact chosen ID, full returned name and address through the permitted channel. |
| Source and time | Environment/dataSource, response retrieval time with timezone, source versus synthetic status. |
| Coverage | Mode, queried topics, product/per-query limits, fulfillment and incomplete promotion coverage. |
| Ranking | Dollars saved, percentage off or promo price; rankings cover returned qualifying offers only. |
| Offer identity | Full unaltered source description, item/package facts and IDs when supplied. |
| Current comparison | Source regular/promo USD values; calculated savings and percentage separately labeled. |
| Unit comparison | Each supplied estimate at its precision; missing measure basis or estimate explicit. |
| Historical comparison | Per-item status/reason, qualified prior prices/dates/source labels and observation count where available; no substituted regular price or all-time claim. |
| Limits and next action | Advisory stock, unknown validity/checkout conditions, excluded counts and useful recovery. |

Use the requested top subset only when its size is clear; state shown count and
returned total. Never hide omitted offers or abbreviate a source description to
make a table fit. Do not echo the person's ZIP or persist search values merely
to add context. Missing values remain unavailable, not zero.

For a setup result, state the installation identity, requested help, checks
actually executed, current configured/environment status, required permission
or tool gap and next action. Instructions given to a person are labeled as
instructions, not completed installations or submitted registrations.

## Checks and failures

Before delivering, verify store/query match, full source text, monetary units,
sample coverage, status/reason interpretation, actual observation dates and
allowed recipients. No live response means no live price report.

For example, `permission_required` means the history lookup was not authorized;
it does not establish an empty history. `history_read_failed` leaves history
unknown. Certification `history_environment_mismatch` is a separate environment
boundary. A bounded empty `offers` response means no qualifying promotions in
that response, not no deals at the store.

On an HTTP error, report its fixed code and practical recovery without raw
upstream text. On transport failure, report that no usable response was obtained.
Stop dependent work when identity, permission or required compatibility is
missing. These checks are manual report checks, not an invented output validator.
