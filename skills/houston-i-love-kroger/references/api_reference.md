# App operations and comparison meanings

## Detailed Content

### Scope and effects

This skill consumes the app's version-1 status, store search and deal search.
Searches contact Kroger through the app and consume its request budget. They do
not write price observations, sign in customers, add cart items, clip coupons,
place orders or install a collector. History ingestion and retention are operator
work, described separately in `research/official_docs/pages/HISTORY.md`.

Before issuing requests, read `research/official_docs/pages/API.md` in full. It
owns exact fields, limits, source/calculation semantics, history reasons and
typed errors. The installed snapshot's identities and hashes are in
`research/official_docs/manifest.json`; a live response still needs validation.

### Request sequence

Use the actual base URL with a trailing slash; append these relative paths.
`GET api/v1/status` carries no shopper input. Stores and deals use JSON POST
bodies with `Content-Type: application/json` and `Accept: application/json`.
Do not add search values to URLs. Do not follow redirects to unapproved hosts.

| Operation | Body | Receiving check |
|---|---|---|
| `GET api/v1/status` | None | Supported version; configured settings versus real access; environment/data source/history capability. |
| `POST api/v1/stores/search` | `zipCode`: five-digit string | Up to ten locations within ten miles; exact name/address/full ID; empty is allowed. |
| `POST api/v1/deals/search` | `locationId`; optional `term`, `sort` | Matching store and query scope; bounded sample or single term; no missing fields replaced by guesses. |

Omit `term` for the three-topic starter sample. A supplied term must contain
3–80 characters and no more than eight words. `sort` is `savings`, `percent` or
`price`. The default is savings. Invalid supplied fields are rejected rather
than silently ignored. Keep IDs as strings, including leading zeros.

### Price, unit and history interpretation

`source` values retain complete descriptions and relevant reported prices.
`calculated` savings use the current regular/promo pair. The per-unit object can
contain one or both usable estimates; show each supplied value without rounding
away its precision. `basis: null` forbids a normalized-unit assertion.

Top-level history is provider capability. Per-offer history is the actual item
result. `permission_required` is an authority gap, `no_observations` is a completed
permitted lookup with no retained matching prior rows, and `unavailable` needs its
reason inspected. `history_read_failed` leaves the history unknown;
`no_authorized_source` means no provider is connected;
`history_environment_mismatch` keeps certification data separate from production
history. None of these is proof that no past promotion occurred.

Prior prices are USD numbers with separate dates and source labels. The lowest
is limited to qualifying retained prior observations. A supplied qualified
`deltaFromLastCents` is current promo minus the last prior promo: negative is
lower now. A non-null qualified delta can accompany `insufficient_history`, but
one observation still establishes no trend. Null arithmetic stays unavailable.
`incomparable` prices can be described as dated observations without claiming a
qualified saving. Never derive missing comparison context from package text.

## Key Concepts

- **Store identity:** the accepted full `locationId` plus returned name/address.
- **Bounded scope:** the exact returned topics, limits and fulfillment context.
- **Raw source fact:** a reported description, item identity, price or stock value.
- **Calculation:** arithmetic against an identified source pair and basis.
- **Collected history:** earlier permitted observations, with limited coverage.

## Decision Criteria

| Condition | Action | Reason |
|---|---|---|
| Multiple plausible stores | Ask for exact location | ZIP/name alone is not identity. |
| Empty result | Report bounded emptiness | Search coverage is incomplete. |
| A newer store/query exists | Discard earlier response | Prevent mixed-location prices. |
| Unknown optional fact | Mark unavailable | Do not disguise missing data. |
| Unsupported response version/shape | Return compatibility gap | Do not infer a new contract. |

## Constraints & Limits

Source permissions are checked before payload access. The app has no agent
authentication boundary that independently grants catalog rights. Certification
and synthetic data require explicit labels. Current stock and price remain
advisory until confirmed by the store. No cross-retailer ranking or catalog
harvesting belongs to this workflow.

## Common Patterns

For a normal request: status → permitted ZIP lookup → exact store → sample or
requested term → one comparison. Reuse a verified existing store choice when
appropriate. For reordering, rank the returned set using the same documented
comparator; do not spend another source request only to change presentation.
