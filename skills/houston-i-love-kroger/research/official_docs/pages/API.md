# HTTP API

Humans, scripts and assistant clients use the same three operations and pricing
rules. Start with a ZIP code, choose an exact returned store, then request that
store's promotion sample or refine it with a product search.

These are application endpoints. They do not provide arbitrary access to the
Kroger API. They cannot sign shoppers in, clip coupons, change a cart or check out.
API availability does not grant permission to retain, redistribute or send its
data to an assistant provider. The installation's source permissions,
[Kroger Acceptable Use](https://developer.kroger.com/documentation/public/getting-started/acceptable-use)
and [Kroger Terms](https://developer.kroger.com/terms) still apply.

Before using a live installation, read its **Privacy** and **Use notes** links
on the app page. They are available without running a search, at the configured
base page followed by `#privacy-notice` and `#use-notes`. They explain the
operator, search handling and hosting logs. Use the API for ordinary store and
product browsing. Do not bulk-collect, archive, alter or resell API content,
track customer searches or locations, or compare Kroger prices with other
retailers. An assistant's ability to call this API does not grant permission
to forward its results to that assistant's provider.

## Address and request rules

The default local app address is
`http://localhost:4173/apps/houston-i-love-kroger/`. Every path below is relative
to the configured `APP_BASE_PATH`. For example, the status URL at that address is
`http://localhost:4173/apps/houston-i-love-kroger/api/v1/status`.

| Method | Relative path | Purpose |
| --- | --- | --- |
| `GET` | `api/v1/status` | Check configuration and history capability. |
| `POST` | `api/v1/stores/search` | Find nearby Kroger locations from a ZIP code. |
| `POST` | `api/v1/deals/search` | Compare reported promotions at one selected store. |

Send search values in an `application/json` request body. Search query strings
are rejected. Bodies may contain only the fields documented for that operation.
Do not send Kroger credentials to these endpoints. The operator configures them
privately on the trusted server.

Responses use JSON and `Cache-Control: no-store`. Browser searches must come
from the installation's configured origin. Native HTTP clients may omit the
`Origin` header. The app sends no CORS permission headers. Origin checking is a
browser protection, not authentication; these are public read operations on an
installation that is reachable over the network.

Successful searches return `ok: true`, `apiVersion: 1`, `dataSource` and an ISO
UTC `retrievedAt` timestamp. `dataSource` is normally `kroger-api`.
`synthetic-fixture` is reserved for explicit interface testing. Certification
environment data must not be presented as verified live shopping offers.

## Check status

`GET api/v1/status` takes no query parameters or body. It does not contact Kroger.

Illustrative response for an installation with no configured credentials and no
reviewed history permission:

```json
{
  "ok": true,
  "apiVersion": 1,
  "configured": false,
  "environment": "production",
  "dataSource": "kroger-api",
  "history": {
    "status": "permission_required",
    "reason": "source_permission_required",
    "message": "Historical collection and shared display require reviewed source permission."
  }
}
```

`configured` means both credential settings are present. It does not prove that
they are valid, assigned to the selected environment or authorized for a search.
`environment` is `production` or `certification`. The status response does not
contain credentials, database paths, source permission documents or shopper data.

## Find nearby stores

`POST api/v1/stores/search` accepts exactly one field:

```json
{ "zipCode": "77001" }
```

`zipCode` must be a string of five US ZIP digits. Leading zeros are preserved.
The request asks Kroger for up to ten Kroger-chain locations within ten miles.
It does not calculate an exact distance from a person's address or promise that
the result includes every nearby grocery store.

The following response uses **synthetic stores for explanation only**:

```json
{
  "ok": true,
  "apiVersion": 1,
  "stores": [
    {
      "locationId": "01400001",
      "name": "Example store",
      "address": {
        "addressLine1": "1 Example Street",
        "city": "Example city",
        "state": "TX",
        "zipCode": "77001"
      }
    }
  ],
  "radiusInMiles": 10,
  "limit": 10,
  "dataSource": "synthetic-fixture",
  "retrievedAt": "2026-10-19T18:00:00.000Z"
}
```

Address fields are omitted when Kroger does not supply them. Match the store's
name, address and complete `locationId` before continuing. An empty `stores`
array is a successful search with no returned matches. Try another ZIP code if
needed. The response does not echo the person's search ZIP.

## Find and rank promotions at a store

`POST api/v1/deals/search` accepts:

| Field | Required | Meaning |
| --- | --- | --- |
| `locationId` | Yes | Exact eight-character alphanumeric store ID; keep leading zeros. |
| `term` | No | A search with 3–80 characters and at most eight words. Omit it for the starter sample. |
| `sort` | No | `savings` (default), `percent` or `price`. |

An omitted term immediately loads the selected store's starter sample:

```json
{ "locationId": "01400001" }
```

That sample makes three sequential product searches, for `milk`, `bread` and
`eggs`, with at most fifteen products per search. It returns qualifying
promotions among those results. It does not discover every store promotion,
scan departments or harvest a catalog.

To refine the sample, provide a term:

```json
{ "locationId": "01400001", "term": "whole milk", "sort": "price" }
```

A term search requests at most fifty products in one page. It uses Kroger's
fuzzy search; a result need not exactly repeat the search words. The application
trims and collapses whitespace in valid search text. Control characters, blank
supplied terms, unsupported fields and unsupported sort values are rejected.

Every product request includes the chosen store and the in-store fulfillment
filter `ais`. No nationwide price is substituted when local pricing is missing.
The response always echoes the store under `scope.locationId`; clients must
discard a response if it belongs to a previously selected store.

### Response example

All store IDs, products, prices and times in this example are **synthetic**.
They are not real shopping offers or evidence of a connected installation.

```json
{
  "ok": true,
  "apiVersion": 1,
  "scope": {
    "locationId": "01400001",
    "mode": "sample",
    "term": null,
    "topics": ["milk", "bread", "eggs"],
    "queries": [
      { "term": "milk", "returnedProducts": 1 },
      { "term": "bread", "returnedProducts": 0 },
      { "term": "eggs", "returnedProducts": 0 }
    ],
    "sort": "savings",
    "productLimit": 45,
    "perQueryLimit": 15,
    "fulfillment": "ais",
    "exhaustive": false,
    "coverage": "A bounded sample of up to 15 products each for milk, bread and eggs. This does not cover all store promotions."
  },
  "offers": [
    {
      "source": {
        "productId": "0000000000001",
        "itemId": "0000000000001",
        "description": "Example milk",
        "brand": "Example brand",
        "size": "1 gal",
        "soldBy": "unit",
        "price": {
          "regular": 4,
          "promo": 3,
          "regularPerUnitEstimate": 0.03125,
          "promoPerUnitEstimate": 0.0234375
        },
        "stockLevel": null
      },
      "calculated": { "savingsCents": 100, "percentOff": 25 },
      "perUnit": {
        "status": "reported_estimate",
        "regularEstimate": 0.03125,
        "promoEstimate": 0.0234375,
        "basis": null,
        "isEstimate": true,
        "message": "Kroger-reported estimate; its unit basis is not supplied."
      },
      "history": {
        "status": "permission_required",
        "observationCount": 0,
        "lastPromo": null,
        "lowestPromo": null,
        "deltaFromLastCents": null,
        "sourceLabels": [],
        "unitComparison": { "status": "basis_unreported" },
        "message": "Historical collection and shared display require reviewed source permission."
      },
      "dateStatus": "not_provided"
    }
  ],
  "summary": {
    "products": 1,
    "items": 1,
    "unpriced": 0,
    "notDiscounted": 0,
    "unqualifiedDates": 0,
    "outOfStock": 0,
    "duplicateItems": 0,
    "conflictingItems": 0,
    "incompleteProducts": 0,
    "notInStore": 0
  },
  "history": {
    "status": "permission_required",
    "reason": "source_permission_required",
    "message": "Historical collection and shared display require reviewed source permission."
  },
  "dataSource": "synthetic-fixture",
  "retrievedAt": "2026-10-19T18:00:00.000Z"
}
```

For a term search, `scope.mode` is `search`, `scope.term` is the normalized term,
`topics` and `queries` each contain that single search, and both limits are 50.
`scope.exhaustive` remains `false`. Query counts include returned products before
duplicate removal and promotion qualification.

### Source values, calculations and missing information

`source` preserves returned text and the relevant supplied price values.
Optional product/item identifiers, brand, size, sold-by and stock fields can be `null`.
Optional price fields remain omitted or `null` as returned. Unsupported types or
oversized fields cause a fixed upstream error; text is never silently shortened.

`calculated.savingsCents` is the app's difference between current regular and
promo prices in whole cents. `percentOff` is that difference divided by the
regular price, multiplied by 100. These are calculations against the current
regular price. They do not measure historical savings, coupon eligibility or
the amount that will appear at checkout.

`savings` sorts by descending calculated savings; `percent` by descending
percentage; `price` by ascending reported promo price. Ties use descending
savings, then descending percentage, then the original result order. The web
interface uses the same sorting function and can rerank the current results
without another upstream call. Price ranking does not establish that different
package sizes or units have comparable value.

`perUnit` keeps usable positive `regularPerUnitEstimate` and
`promoPerUnitEstimate` values at their supplied precision. Either estimate can
be `null`. Its status is `reported_estimate` when at least one usable estimate
exists, otherwise `unavailable`. The current public API does not document the
measure basis for these estimates, so `basis` is `null`. Do not label them
`$/oz`, `$/lb` or a known per-item price, or infer a unit from package text.
The raw `source.soldBy` and `source.size` values remain separate facts.

When present, `source.price.effectiveDate` and `expirationDate` retain their
`value` and `timezone` fields. Qualification requires a valid timestamp with an
explicit `Z` or UTC offset: effective time at or before retrieval, expiration
strictly after retrieval. Ambiguous date-only/local-time windows are excluded.
`dateStatus` is `within_reported_window` for a qualifying reported window, or
`not_provided` when neither date was supplied. The latter does not establish a
promotion's start or end time.

Stock is advisory. `HIGH`, `LOW`, an unknown returned stock string, or missing
inventory does not guarantee availability. Checkout confirms stock, price and
offer conditions.

### Qualification summary

| Field | Meaning |
| --- | --- |
| `products` | Total product records returned across this request's queries. |
| `items` | Item records examined in products with displayable details. |
| `unpriced` | Items without usable positive whole-cent regular and promo prices, including zero promos. |
| `notDiscounted` | Items whose usable promo price is not below regular price. |
| `unqualifiedDates` | Otherwise qualifying items with ambiguous, invalid, future or expired reported windows. |
| `outOfStock` | Items explicitly reported `TEMPORARILY_OUT_OF_STOCK`. |
| `duplicateItems` | Repeated identical observations with the same known product and item IDs. |
| `conflictingItems` | Known product/item identity groups excluded because relevant source observations disagree. |
| `incompleteProducts` | Product records without a usable description or item list. |
| `notInStore` | Items explicitly reporting `fulfillment.instore: false`. |

Counts explain filtering; they are not a partition that can always be added to
the offer count. Conflicting groups are excluded as a whole. Unknown identifiers
remain separate rather than being merged by similar names. An empty `offers`
array is a successful search with no qualifying promotions in this bounded
result, not proof that the store has no promotions.

## Historical comparisons

The normal server opens the local history database and reads its comparison
provider. Search requests do not add snapshots, ZIPs, search terms, shopper
profiles or customer behavior to that database. Historical collection is a
separate operator workflow with reviewed source permissions and retention
controls. Merely having API credentials does not authorize a history collection.
Current Kroger public API documentation does not provide a verified historical
promotion endpoint.

Top-level `history` describes the provider capability and can contain `status`,
`reason` and `message`. Default source permission is pending, producing
`permission_required`. An approved provider can report `available` even when a
particular item has no retained observations. No provider produces `unavailable`
with `reason: no_authorized_source`; a failed read produces `unavailable` with
`reason: history_read_failed`. Certification responses produce `unavailable`
with `reason: history_environment_mismatch`; the production history provider is
not called and no prior production prices are attached. Current-price results
remain available after an independent history read failure.

Each offer has its own `history`:

| Status | How to interpret it |
| --- | --- |
| `permission_required` | The source's required permission is absent, expired, revoked or outside the approved scope. A zero count here is not a completed search for observations. |
| `no_observations` | Permission permits lookup, but no earlier retained observations were found for this exact store and item. |
| `incomparable` | Identity, dates or price conditions are missing or differ. Dated prior prices may be shown without a qualified saving claim. |
| `insufficient_history` | One qualifying prior promotional observation exists; it does not establish a trend. |
| `comparable` | At least two qualifying prior promotional observations and the required matching price context exist. Coverage is still limited to collected observations. |
| `unavailable` | No provider is connected or the provider could not be read. Inspect `reason` and `message`. |

The database provider returns `observationCount`, nullable `lastPromo`,
`lowestPromo` and `deltaFromLastCents`, `sourceLabels`, `unitComparison` and a
message. Where observations support them, `firstObservedAt`, `lastObservedAt`
and `lowestObservedAt` are ISO UTC timestamps. Counts refer to retained matching
observations; some may lack a qualifying promotional price. `lowestPromo` is
the lowest qualifying collected promo, never an all-time low.

A qualified price delta requires exact store, product, item, size, sold-by,
currency, price basis, modality and eligibility matching. The prior observation
must be strictly earlier than the current retrieval and within its permitted
retention period. `deltaFromLastCents` is current promo minus last qualifying
collected promo: negative means the current quote is lower. It is `null` when
comparison context is missing. One prior observation can support this bounded
delta while still returning `insufficient_history`.

`unitComparison.status` is `basis_unreported`, `no_history` or `comparable`.
Only explicit, equal measure bases and compatible price conditions allow
historical unit comparison. A comparable unit result includes `basis`,
`lastPromoEstimate`, `lowestPromoEstimate` and nullable
`deltaFromLastEstimate`. Missing basis is not repaired by parsing package size.
The current public-product response does not supply all of the context required
for a qualified historical comparison; an authorized source must establish it.

## Errors and recovery

Application errors have an HTTP error status and this fixed shape:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_store",
    "message": "Choose a store before searching for deals."
  }
}
```

Use `error.code` for program logic. Messages are plain-language recovery hints
and may change. Raw upstream bodies, credentials and private exception details
are not returned. A disconnected or malformed HTTP transport can close without
an application JSON response; clients must also handle connection failures.

| HTTP status | Code | Recovery |
| --- | --- | --- |
| 400 | `invalid_request`, `invalid_json` | Send a complete JSON object with only documented fields. |
| 400 | `invalid_zip`, `invalid_store`, `invalid_search`, `invalid_sort` | Correct the named input; preserve store IDs as strings. |
| 400 | `query_not_allowed` | Move search inputs from the URL to the JSON body. |
| 403 | `invalid_host`, `origin_not_allowed` | Use the installation's configured address and browser origin. |
| 404 | `not_found` | Check the base path and operation name. |
| 405 | `method_not_allowed` | Use POST for a search; the response includes `Allow: POST`. |
| 408 | `request_timeout` | Send a complete request again later. |
| 413 | `request_too_large` | Keep the UTF-8 JSON body at or below 4,096 bytes. |
| 415 | `invalid_content_type` | Set `Content-Type: application/json`. |
| 429 | `busy` | Respect `Retry-After`; the installation's request or concurrency limit was reached. |
| 429 | `budget_reached` | Wait for the local upstream budget to reset; do not restart to bypass it. |
| 429 | `provider_limit` | Respect the provider-limit delay; actual Kroger reset behavior may differ. |
| 499 | `request_cancelled` | The caller cancelled; a closed connection may receive no response. |
| 500 | `internal_error` | Try later; ask the operator to check the installation if it persists. |
| 502 | `upstream_format`, `upstream_size` | Try a more specific search or try later; no partial result is substituted. |
| 502 | `upstream_rejected`, `upstream_not_found` | Check or reselect the store and search term. |
| 502 | `upstream_unavailable` | Kroger failed or timed out; retry later with a bounded delay. |
| 503 | `setup_required`, `connection_rejected`, `permission_denied` | The operator must check API setup, environment or permissions. |

All 429 categories include an integer `Retry-After` delay in seconds. The app
does not automatically retry 400, 403 or 5xx responses. It may renew an access
token and retry one safe read once after an upstream 401. A new shopper search
is still a new upstream request; avoid retry loops and repeated topic scans.

## Resource and data limits

These are application limits, separate from Kroger's published quotas:

| Resource | Limit |
| --- | --- |
| Search request body | 4,096 bytes. |
| App search requests | 30 per 60-second global installation window, including admitted invalid/setup requests. |
| Active app searches/uploads | 4; no waiting queue. |
| Upstream HTTP attempts | Default local budget of 1,000 per 24 hours, including token requests, failures and the bounded 401 renewal/retry. |
| One upstream HTTP request | 10 seconds, including response-body reading. |
| App request cancellation deadline | 35 seconds; incoming request-body timeout is 20 seconds. |
| Upstream JSON body | 2,000,000 bytes; token responses 16,384 bytes. |
| Store results | Up to 10 in one ten-mile search. |
| Starter sample | Up to 45 product records: three fixed topics, fifteen each. |
| Refined search | Up to 50 product records, one page. |
| Item variants | Up to 10 per product, at most 500 offers for a refined search. |
| Source text | Description 512, brand 200, size 100, sold-by 40, identifiers 64, stock string 80, date value/timezone 80 characters. |

The local HTTP budget and app rate counter are process-local. Their windows
start with local activity and reset on restart; multiple processes do not share
them. They are not proof of Kroger's quota balance or reset time. A production
operator must coordinate quotas across server and collection processes.

Queries and product results are transient. There is no shopper search cache,
analytics log, customer account table or API endpoint for writing price history.
The separate authorized collection workflow owns historical observations. HTTP
clients and assistant providers must also respect source permissions and avoid
persisting or forwarding derived customer activity merely because this API can
return it.

## Client compatibility and verification

Treat missing or unknown optional facts as unavailable. Preserve source fields
separately from app calculations, keep IDs as strings and tolerate new response
fields. Request models reject unknown input fields. Read `scope` and history
status before making a claim about coverage, value, availability or history.

Backend tests exercise the real request listener in memory, with synthetic data
and mocked upstream fetch. They cover validation, ranking, duplicate/conflict
handling, price/date/unit limits, token renewal, cancellation, budgets and history
provider outcomes. These tests do not qualify live credentials, real checkout
prices, provider permissions, hosted access or legal redistribution rights.

The upstream integration follows the reviewed 2026-10-19 public contracts:
[Products 1.3.0](https://developer.kroger.com/api-products/api/product-api-public),
[Locations 1.2.3](https://developer.kroger.com/api-products/api/location-api-public)
and [Authorization 1.0.17](https://developer.kroger.com/api-products/api/authorization-endpoints-public).
These establish documented operations; authenticated production behavior remains
separate verification.
