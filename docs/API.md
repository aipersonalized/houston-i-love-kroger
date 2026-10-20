# HTTP API

The human page can look up stores and current products through the site's
Kroger connection. The companion skill has a different read path: it gets latest
stored ZIP-query locations, completed collection topics, collected deals, regular prices, quantity estimates and dated history from this installation's promotion database
service. Companion requests do not call Kroger, refresh products or run the
collector. No empty or stale database result falls back to a supplier request.
Optional Cart writes belong to a separate explicit shopper authorization and
session contract below; they are outside the companion's read-only tool.

These are application endpoints. They do not provide arbitrary access to the
Kroger API. Cart is disabled by default and requires actual assigned access and
a registered callback before sign-in or an explicit add is available. No endpoint
clips coupons, reads a customer's cart or checks out.
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
| `POST` | `api/v1/promotions/stores` | Read a completed permission-approved stored ZIP query; no supplier call. |
| `POST` | `api/v1/promotions/topics` | Discover readable completed named collection topics for an exact store. |
| `POST` | `api/v1/products/search` | Browse usable store prices, including regular-only products. |
| `POST` | `api/v1/deals/search` | Promotion-only comparison interface. |
| `GET` | `api/v1/promotions/status` | Check the separate private history-service capability. |
| `POST` | `api/v1/promotions/latest` | Read latest completed, permission-approved deal snapshots; never fetch Kroger data. |
| `POST` | `api/v1/promotions/prices` | Price-check the latest collected store/topic sample, including regular prices. |
| `POST` | `api/v1/promotions/estimate` | Calculate requested quantities from stored prices, with unresolved lines separated. |
| `POST` | `api/v1/promotions/search` | Search permitted retained observations for an exact store. |
| `POST` | `api/v1/promotions/retrieve` | Read one permitted observation for an exact store. |
| `GET` | `api/v1/cart/status` | Check/create the optional browser cart session. |
| `POST` | `api/v1/cart/connect` | Start a shopper-authorized connection at Kroger. |
| `GET` | `api/v1/cart/callback` | Consume the registered OAuth callback; redirect to the fixed app page. |
| `POST` | `api/v1/cart/add` | Explicitly add listed quantities to the connected Kroger cart. |
| `POST` | `api/v1/cart/disconnect` | Discard the local app cart session. |

Send search values in an `application/json` request body. Search query strings
are rejected. Bodies may contain only the fields documented for that operation.
Do not send Kroger credentials to these endpoints. The operator configures them
privately on the trusted server.

Responses use JSON and `Cache-Control: no-store`. Browser searches must come
from the installation's configured origin. Native HTTP clients may omit the
`Origin` header. The app sends no CORS permission headers. Origin checking is a
browser protection, not authentication; these are public read operations on an
installation that is reachable over the network. Cart POSTs additionally require
the exact configured `Origin`, even for native clients; Cart also requires its
cookie session and, for add/disconnect, the session's CSRF value. The OAuth
callback is the only documented query-bearing operation. Do not log or retain
its authorization code, state or URL.

Successful searches return `ok: true`, `apiVersion: 1`, `dataSource` and an ISO
UTC `retrievedAt` timestamp. `dataSource` is normally `kroger-api`.
`synthetic-fixture` is reserved for explicit interface testing. Certification
environment data must not be presented as verified live shopping offers.

## Check status

`GET api/v1/status` takes no query parameters or body. It does not contact Kroger.
In remote-history mode it makes one bounded private-service status request.

Illustrative response for an installation with no configured credentials and no
reviewed history permission:

```json
{
  "ok": true,
  "apiVersion": 1,
  "configured": false,
  "environment": "production",
  "dataSource": "kroger-api",
  "capabilities": {
    "products": true,
    "basket": true,
    "cart": false,
    "promotionService": false
  },
  "cart": {
    "enabled": false,
    "configured": false,
    "connected": false,
    "status": "disabled"
  },
  "promotionService": {
    "status": "unavailable",
    "reason": "promotion_service_not_configured",
    "message": "The operator has not connected a promotions service."
  },
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

`capabilities.products` and `basket` identify implemented interfaces, not verified
live access or source grants. `cart` identifies configured Cart capability and
`promotionService` whether a private service client is configured. Top-level
`cart` is installation readiness, not a particular shopper's connection; use
`api/v1/cart/status` for that. Capability status does not enable collection.

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

Supplied optional location facts include `chain`, `phone`, `storeNumber`,
`divisionNumber`, `hours`, `departments` and `geolocation`. Hours preserve
`gmtOffset`, `timezone`, `Open24` and supplied weekday `open`, `close`, `open24`
facts. Departments preserve supplied ID/name/phone and hours; geolocation keeps
supplied `latLng`, latitude and longitude. Omitted/null facts stay unknown. These
are source reports, not verified holiday hours, precise shopper location or a
routing service.

## Browse all priced products

`POST api/v1/products/search` accepts the same store, optional term and sort as
the promotion endpoint below, plus optional boolean `includeAll` (default `true`).
Unknown fields, `null`/non-boolean `includeAll` and invalid inputs are rejected.

```json
{ "locationId": "01400001", "term": "whole milk", "includeAll": true, "sort": "price" }
```

This uses exactly the same bounded upstream searches and in-store `ais` filter
as the promotion endpoint. The response adds `scope.includeAll` and `products`.
`offers` still contains qualifying promotions only. `products` contains all usable
priced items when `includeAll` is true, or only qualifying offers when false.
The browser requests all priced results, then filters/ranks them locally without
another upstream request. It never searches a complete catalog.

Every priced item has `source`, nullable `calculated`, `perUnit`, `history`,
`dateStatus` and `pricing`:

| Field | Meaning |
| --- | --- |
| `pricing.status` | `promotion`, `regular_only` or `unqualified_promotion`. |
| `pricing.regularCents`, `promoCents` | Positive safe whole-cent prices, or `null` for an unusable/missing value. Raw supplied facts remain under `source.price`. |
| `pricing.currentCents` | Positive usable price selected for display; no zero/free price is invented. |
| `pricing.reason` | `null` for qualifying promotions, otherwise `missing_regular_price`, `unsupported_price`, `no_reported_promotion`, `not_discounted` or `unqualified_dates`. |
| `calculated` | Savings object for qualifying promotions; otherwise `null`. |
| `dateStatus` | `within_reported_window`, `not_provided` or `unqualified`. |

A usable regular price remains displayable when the promo is missing/zero,
unsupported, not lower or date-unqualified. A usable promo with qualified dates
can be displayed without a usable regular price, but no regular-price savings
are invented. Reported out-of-stock, explicitly non-in-store, conflicting and
unusable-price items remain excluded. Source `nationalPrice`, if supplied,
stays a separate fact and never substitutes for missing local pricing.

For `products`, `savings`/`percent` put qualified savings first and unqualified
savings after them; `price` sorts by `pricing.currentCents`. Ties use savings,
then percent, then original order. Promotion-only `offers` use the order below.
History comparisons are attached to qualifying current promotions; do not infer
a completed history lookup for every regular-price or promo-only product.
Those products report `history.status: unavailable` with
`reason: current_promotion_unqualified`, which does not claim there are no
stored observations. The separate exact-store history search remains available
when its service and source permissions allow it.

### Product facts, photos, links and local filters

`source` additionally preserves supplied `upc`, `productPageURI`, normalized
nullable `productUrl`, `categories`, `aliasProductIds`, `aisleLocations`, `images`,
`temperature`, `snapEligible`, `countryOrigin`, `manufacturerDeclarations`,
`allergens`, `allergensDescription`, `warnings`, `nonGmo`, `nonGmoClaimName`,
`organicClaimName`, `nutritionInformation`, item `fulfillment` and `nationalPrice`.
Fields are bounded and type-checked. Missing facts remain null, absent or empty
collections as appropriate; they are not completed from package text.

`nutritionInformation` may be a single object or an array of up to20 validated
nutrition contexts. The public Products schema describes an object, while
controlled production checks also returned arrays. The app preserves the
returned shape and validates every context; it does not keep only the first.
Nested arrays, non-object contexts and oversized arrays are unsupported. The
browser separates multiple contexts by a supplied preparation name or a numbered
nutrition label, with their own ingredients, serving and nutrient information.

The browser filters the returned sample by `pricing.status`, explicit
`snapEligible` true/false/unknown and exact reported manufacturer/dietary claims.
These are browser filters, not additional accepted HTTP request fields. Claims
do not establish allergen safety or app-certified eligibility.
When populated, the browser's **More about this product** details show
source-labelled categories, fulfillment, ingredients, allergens, warnings and
nutrition. Missing data does not imply safety or a negative ingredient claim.

The server admits image URLs only from HTTPS `www.kroger.com`, without
credentials or custom ports. It converts supported source-relative `/p/…`
product links to HTTPS Kroger product URLs. Unsupported destinations are omitted;
do not guess a URL from an ID. The browser loads supported photos directly from
Kroger with no-referrer and opens product links in a new tab. That image request
still discloses network/browser information and may carry existing Kroger
cookies under browser settings. Missing or failed photos use a text fallback.

### Visit-only shopping list

The browser shopping list is client memory, not an HTTP resource or server-side
saved basket. It keeps the selected store and each product's retrieval snapshot.
Identity uses exact product/item IDs, falling back to a reported UPC. Maximums
are 100 lines and whole quantities 1–99. Changing stores, editing the ZIP or
leaving/reloading clears the list. Searches for the same store do not clear it.

The estimate adds only known positive whole-cent prices for reported `unit`
sold-by items. Unknown basis, variable measure, invalid quantity, missing price
or wrong-store lines stay unresolved and excluded; a partial subtotal is labelled
as such. Tax, coupons and checkout conditions are not included. Aisle grouping
uses the first supplied position while retaining all positions on the line,
with a separate unknown group. It does not calculate a walking route.

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
      "dateStatus": "not_provided",
      "pricing": {
        "status": "promotion",
        "regularCents": 400,
        "promoCents": 300,
        "currentCents": 300,
        "reason": null
      }
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
    "notInStore": 0,
    "noReportedPromotion": 0,
    "missingRegularPrice": 0,
    "unsupportedPrice": 0,
    "usablePriced": 1,
    "qualifyingPromotions": 1
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

### Returned source evidence

Both current `deals/search` and `products/search` responses add `sourceEvidence`
independently of `offers`, `products`, `includeAll` and their existing summary.
Those existing fields retain their strict price, date, availability and identity
rules. Source evidence accounts for this returned page or starter sample only;
it does not enumerate the store or establish complete promotion coverage.

`sourceEvidence.records` preserves response order, with one record per returned
item and one placeholder for a product without an item list. Fifty products with
at most ten items each produce at most 500 evidence records; missing-item
placeholders remain inside this bound. Malformed source types still fail the
request rather than becoming invented evidence.

| Field | Meaning |
| :--- | :--- |
| `recordIndex` | Zero-based locator within this response, never a product identity. |
| `productIndex`, `itemIndex` | Positions in the combined returned products and their items. `itemIndex: null` identifies a missing-item placeholder. |
| `source` | Supplied product/item IDs, description, brand, size, sold-by basis, price fields, stock, fulfillment, categories, SNAP and dietary claims. Missing source text/IDs remain `null`; no fallback name becomes source data. |
| `reportedPromotion` | A finite positive `source.price.promo` was returned. This does not prove currency, validity, availability, eligibility or savings. Missing/zero/nonpositive promo values do not establish a free offer or absence of store sales. |
| `savingsArithmeticAvailable` | Pure arithmetic: both item amounts are usable positive whole hundredths and promo is lower. It ignores dates, stock, names and identity conflicts; it is not a validated offer. No calculated current price or savings is added to evidence. |
| `includedInOffers` | Literal membership of this particular row, once, in the unchanged strict `offers` list. It is not a source-truth or eligibility flag; inspect dispositions independently. |
| `dispositions` | All applicable fixed codes below, independently of source promotion presence. |
| `duplicateOf` | Earlier record index for an exact duplicate with known product/item identity; otherwise `null`. Missing identities are not synthesized or deduplicated. |

Disposition codes are `missing_items`, `missing_description`, `not_in_store`,
`out_of_stock`, `missing_regular_price`, `unsupported_price`,
`no_positive_promo`, `not_discounted`, `unqualified_dates`, `duplicate` and
`identity_conflict`. Conflicting variants are all retained and flagged; neither
version is chosen as truth. One intentional correction applies the existing
conflict rule before description eligibility: if a missing-name row has the
same exact product/item identity and differing price/details, neither variant
enters `offers` or `products`. The conflict and incomplete-product counters keep
their meanings. A product with no item identity stays unknown; no identity is
invented to group it with another item.

`sourceEvidence.summary` contains `records`, `returnedProducts`, `returnedItems`,
`missingItemLists`, `reportedPromotions`, `withoutSavingsArithmetic` (no usable
arithmetic pair), and `otherReportedPromotions` (positive reported promo outside
strict offers). Counts refer to returned records before shopper filters and
include repeats. Missing item lists are unknown sale status, not empty offers.

The browser's **Other reported sale prices** panel shows positive reported
promos outside strict offers, in source order, with the same SNAP/dietary filters.
It preserves numeric precision and raw date/timezone facts; it supplies no
shopping-list/cart action or guessed current price. Older responses without
`sourceEvidence` remain supported; a present malformed evidence object fails
visibly rather than being replaced with a successful empty list.
At that response boundary, included rows must match the literal `offers` array
exactly once through their shared source fields, with usable arithmetic and no
disqualifying dispositions. The browser recomputes numeric and date qualification
against `retrievedAt`, checks contiguous product/item coverage and missing-item
placeholders, and validates known-identity duplicate relationships. Unknown
product/item IDs remain permitted independent observations.

### Source values, calculations and missing information

The normalized displayed current prices retain no currency identifier. The
selected public schema defines none; that is not a claim that a raw supplier
response cannot contain additional fields. The human page formats
numeric amounts without assuming USD or another currency symbol and labels that
gap beside results and the shopping-list subtotal. Reported arithmetic is not a
qualified monetary or payable checkout total. Fields named `regularCents`,
`promoCents` or `savingsCents` express the application's integer hundredths of
the reported numeric amount; their names do not establish a source currency.

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
| `items` | Returned item records examined, including those whose product description is missing. Products without an item list contribute no items; their placeholders are counted separately in source evidence. |
| `unpriced` | Legacy count of items lacking one or both usable positive whole-cent comparison prices, including zero promos. A regular-price product can still be displayed. |
| `notDiscounted` | Items whose usable promo price is not below regular price. |
| `unqualifiedDates` | Otherwise qualifying items with ambiguous, invalid, future or expired reported windows. |
| `outOfStock` | Items explicitly reported `TEMPORARILY_OUT_OF_STOCK`. |
| `duplicateItems` | Repeated identical observations with the same known product and item IDs. |
| `conflictingItems` | Known product/item identity groups excluded because relevant source observations disagree. |
| `incompleteProducts` | Product records without a usable description or item list. |
| `notInStore` | Items explicitly reporting `fulfillment.instore: false`. |
| `noReportedPromotion` | Usable regular price with missing or zero promo; no free offer is inferred. |
| `missingRegularPrice` | Regular price absent/null; a usable promo can remain visible without savings. |
| `unsupportedPrice` | Unsupported/unusable regular price or supplied unusable nonzero promo. |
| `usablePriced` | Number of items retained for the all-priced product view. |
| `qualifyingPromotions` | Number retained for the promotion-only view. |

Counts explain filtering; they are not a partition that can always be added to
the offer count. Conflicting groups are excluded as a whole. Unknown identifiers
remain separate rather than being merged by similar names. An empty `offers`
array is a successful search with no qualifying promotions in this bounded
result, not proof that the store has no promotions.

## Historical comparisons

With `PROMOTION_SERVICE_URL` and its matching private token configured, the web
server uses the separate service and never opens a local history database.
Without them it retains the single-process local comparison mode; that mode
does not supply the stored-observation search endpoints. Search requests do not
add snapshots, ZIPs, search terms, shopper
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

## Latest collected deals

This is the companion skill's primary deal operation. It reads this
installation's promotion database, not Kroger. It never makes a supplier
request, refreshes data or starts collection. The human page's live product
search is a separate path; an empty, stale or blocked database result does not
fall back to it.

`POST api/v1/promotions/latest` accepts exactly:

| Field | Meaning |
| --- | --- |
| `locationId` | Required exact eight-character alphanumeric store reference. |
| `topic` | Required exact topic from the operator's approved collection plan. This selects a completed sample; it is not a live grocery search. |
| `limit` | Optional whole number 1–50, default20. |
| `cursor` | Optional opaque next cursor from this same store/topic/page limit. |

Keep store references as strings, preserving leading zeros. Supply an already
accepted store; use [stored store discovery](#stored-store-discovery) when an
approved directory snapshot exists, and [completed collection topics](#completed-collection-topics)
to select an actual readable collected scope. No stored read makes a live request.
A person can also choose a store on the app, then use its reference in
Store details. Do not have the companion make live store/product requests to
fill that gap. Omit unused fields; unsupported fields and clock/source/freshness
overrides are rejected.

Synthetic request example; replace the store and topic with your accepted scope:

```json
{ "locationId": "TEST0001", "topic": "milk", "limit": 20 }
```

The public response includes `ok: true`, `apiVersion: 1`, `status`, `locationId`,
`topic`, `deals`, `snapshot`, `latestAttempt`, `page`, `coverage`, and a reason
where applicable:

| Status | Meaning |
| --- | --- |
| `available` | A permitted, sufficiently recent completed sample was read. `deals: []` is valid: that sample has no currently qualifying retained promotions. |
| `no_data` | No completed collection or no readable completed snapshot exists. No current deal claim is made. |
| `stale` | The latest readable sample exceeds the operator's maximum age. No deals are returned as current. |
| `permission_required` | Current source/store/topic permission is absent, revoked, expired or outside scope. It is not an empty-result claim. |
| `unavailable` | Public proxy cannot serve this operation, for example because no service is configured or the installation is using certification. No supplier fallback occurs. |

The selected `snapshot` is null or contains its `snapshotId`, `observedAt`,
`completedAt`, `ageSeconds` and `maxAgeSeconds`. The service's operator setting
`PROMOTION_MAX_AGE_SECONDS` defaults to86400 (24hours), with a supported range
of1–604800 seconds. This is an installation freshness policy, not a promise
from Kroger that a price remains valid. Actual source retention and expiry can
exclude a snapshot earlier. Show the collection time and confirm price/stock
with the store before buying.

`latestAttempt` is null or contains fixed `status`, `startedAt`, `finishedAt`.
A failed collection does not replace the last complete sample or silently make
it fresh. Its last valid data still ages normally. Private failure messages,
source-policy evidence, credentials and storage details are never returned.

`page` has `limit`, `returned`, `truncated`, nullable `nextCursor`. A latest-deal
cursor binds the current snapshot and filters, rechecks permission/freshness,
and becomes invalid when a newer completed snapshot replaces it. Start again
at the first page after that change. It cannot resurrect an old deal.

`coverage` identifies `bounded_topic_sample`, the topic, one page per target,
the collection limit and returned product count when known, `completeCatalog:
false`, and an explanation. It does not imply every product or promotion at
the store was collected.

Each `deals` row uses the stored-observation fields below and adds:

- `availability`: supplied `inStore`/`stockLevel`, plus status
  `reported_in_stock` or `unreported`. Missing stock remains unknown.
- `calculated`: the reported numeric price difference in `savingsCents` and `percentOff`, calculated
  only from a usable regular/promo pair.
- `priceQualification`: distinguishes usable prices from unsupported source
  prices. Unsupported prices are never latest deals.

Amounts, currencies and measurement bases retain their reported meaning;
unreported currency/basis is not inferred from store geography or package text.
Historical observation lookup is separate and does not label every saved row a
current promotion.

### Which snapshot wins

The database chooses the newest complete job for the exact store/topic before
filtering prices. A complete empty sample replaces that topic's older result.
A newer completed observation of the same store/product/item suppresses an
older promotion even when the newer fact is regular-only, out of stock or has
an unsupported price. Thus selecting only the newest *qualifying* promotion
cannot bring back an expired or superseded deal.

Absence is reconciled only inside a completed bounded topic sample. It does not
prove catalog deletion or stock absence for the whole store. Original and
current grant, purpose, scope, retention, expiry and completed-run checks apply
to each read. Legacy jobs without original snapshot authority stay unreadable
as latest data rather than receiving invented backfilled permission.

## Stored price checks and basket estimates

### Check collected prices

Send `POST api/v1/promotions/prices` with an exact store and an approved collected
topic, just as for [latest deals](#latest-collected-deals):

```json
{ "locationId": "01400001", "topic": "coffee", "limit": 20 }
```

The example store is documentation data, not a recommendation. Optional
`productId` and `itemId` narrow the result to exact returned identifiers; preserve
leading zeros. `limit` is 1–50; pagination uses the returned `cursor` on the same
query. No term is forwarded to Kroger. This operation uses the same newest
completed snapshot, supersession, current permission, freshness and bounded
coverage rules as latest deals. A current regular-only fact cannot resurrect an
older promotion. Supplied price windows are checked at evaluation time.

The response uses the latest-deal envelope, with `products` instead of `deals`.
Each product preserves the observation's regular/promo amounts and missing source
context, plus availability and:

| Field | Meaning |
| --- | --- |
| `pricing.status` | `promotion`, `regular_only` or `unavailable`. |
| `pricing.currentCents` | Supported current numeric price in hundredths, or `null`; an unknown currency does not become USD. |
| `pricing.reason` | The reason current arithmetic is unavailable, or `null`. |
| `qualificationGaps` | Source context that is missing or unsupported for a qualified purchase estimate. |

A row can preserve source amounts while remaining unavailable for arithmetic.
For example, missing regular price prevents treating a promo-only amount as a
verified discount, and an expired, future or invalid supplied window prevents a
current-price estimate. Source zero, negative or unsupported precision never
establishes a free item. Unreported stock remains unknown. A regular price
without a qualifying discount is a valid regular-only price, when otherwise
usable. This lookup does not claim the lowest price in the store or catalog.

### Estimate a shopping list from collected prices

Send `POST api/v1/promotions/estimate`. Use identities actually returned by
collected price lookup; never guess a product ID from a name or supply your own
prices:

```json
{
  "locationId": "01400001",
  "items": [
    {
      "topic": "coffee",
      "productId": "0001111100001",
      "itemId": "0001111100001",
      "quantity": 2
    }
  ]
}
```

These are synthetic documentation identifiers. The request accepts 1–10 lines
and whole quantities 1–99. Each line needs its exact approved topic and source
product/item IDs. Combine duplicate identities before requesting. No caller
price, currency, coupon or tax fields are accepted. The public 4KB body limit
still applies; shorten a list if long identities exceed it. A request writes no
shopping list, performs no Cart action and triggers no collection or Kroger
request.

One database read transaction resolves each line against the latest completed
snapshot for its exact topic and store. Newer facts across topics can suppress
an older fact; the service does not substitute another package or price when an
exact item is missing. Whole quantities only support known unit/each pricing;
variable weight and unknown quantity bases remain unresolved.

| Response field | Meaning |
| --- | --- |
| `status` | `complete`, `partial`, `unavailable` or `permission_required`. Complete means every requested line has an arithmetic estimate, not a payable checkout quote. |
| `evaluatedAt` | When this estimate was calculated, separate from each snapshot's observation time. |
| `lines` | Requested identities and quantities, estimated/unresolved status, reason, nullable unit/line cents, source currency, observation and snapshot time, qualification gaps and source product facts where available. |
| `totals.reportedSubtotalCents` | Numeric sum of resolved line amounts when currencies can be grouped; `null` if no line resolves or currencies are incomparable. Unresolved lines never contribute zero. |
| `totals.qualifiedSubtotalCents` | `null` unless every requested line and required source context support a qualified same-currency estimate. Even then, checkout exclusions apply. |
| `totals.currency` | Common explicitly reported currency, or `null`. Never infer a symbol from location. |
| `totals.currencyQualification` | `source_reported`, `unreported`, `incomparable` or `unavailable`. |
| `totals.estimatedLineCount`, `totals.unresolvedLineCount` | Priced and unresolved line counts, not quantity totals. |
| `totals.qualificationGaps` | Missing source context and unresolved lines that limit the sum. |
| `exclusions` | Tax, fees, coupons, eligibility verification and checkout changes are excluded. |
| `coverage` | Bounded collected samples, never complete catalog coverage. |

If all resolved amounts have unreported currency, a numeric reported subtotal
may be shown only with `currency: null` and `currencyQualification: unreported`.
Do not add a dollar symbol or call it a verified total. Different explicit
currencies, or mixed known and unknown currencies, cannot be combined; line
amounts remain available and the combined subtotal is `null`. Missing eligibility,
price basis, modality or other required context stays explicit. A partial sum
must name the unresolved items rather than quietly omit them.

This stateless service supports price checks, quantities and bounded shopping
comparisons. It does not reserve stock, apply personal coupons, verify purchase
conditions, refresh source prices, read a customer's cart or place an order.

## Stored promotion search and retrieval

These public app operations proxy only the configured private service, in the
production environment. The app backend supplies its private service token;
shoppers/assistant clients must never receive or send that token. No service is
configured by default in native local mode. Certification returns `unavailable`
with `history_environment_mismatch` rather than reading production history.

`GET api/v1/promotions/status` returns `ok: true`, `apiVersion: 1`, `status`
and optional `reason`/`message`. A source permission gap is `permission_required`.
A missing service is `unavailable` with `promotion_service_not_configured`.
A failed status connection is `unavailable` with `promotion_service_unavailable`.
These are distinct from an available search with zero matches.

`POST api/v1/promotions/search` accepts:

| Field | Meaning |
| --- | --- |
| `locationId` | Required exact eight-character alphanumeric store ID. |
| `term` | Optional literal substring of retained description/brand, 1–80 characters; ASCII case-insensitive; `%` and `_` are literal. |
| `productId`, `itemId` | Optional exact source identifier strings, up to 100 characters. |
| `observedFrom`, `observedTo` | Optional inclusive valid UTC instants: `YYYY-MM-DDTHH:mm:ssZ` or with exactly three fractional digits; start cannot follow end. |
| `limit` | Whole number 1–50, default 20. |
| `cursor` | Opaque returned `page.nextCursor`, at most 512 characters through this app. Reuse with the same filters and limit. |

Omit unused fields; do not send empty/null text or control characters. Supply
text without surrounding whitespace. Unknown fields, source/clock overrides,
database paths and administrative controls are not accepted. The browser's
history form uses a 20-row limit, product words and optional exact product ID;
the other supported filters are available to HTTP clients.

```json
{ "locationId": "01400001", "productId": "0000000000001", "limit": 20 }
```

A service result is wrapped with `ok: true` and `apiVersion: 1`, then `status`,
`locationId`, `observations`, `page`, `coverage` and optional `reason`/`message`.
`page` contains `limit`, `returned`, `truncated` and nullable `nextCursor`.
Newest observation time comes first, with ID breaking ties. Pagination retains
the first page's insertion/time boundary across restarts; start a fresh search
to include later insertions. Every page checks present permission and retention,
so narrowing, revocation, expiry or purge can shrink later pages.

`POST api/v1/promotions/retrieve` accepts exactly `locationId` and the positive
decimal `observationId` string returned by search:

```json
{ "locationId": "01400001", "observationId": "1" }
```

The ID must be a safe positive integer represented as at most 16 decimal digits;
reuse the exact returned string rather than constructing one.
It returns `status`, `locationId`, one `observation` or `null`, and `coverage`
inside the app wrapper. Under otherwise permitted scope, unknown/wrong-store,
expired or inaccessible IDs return `not_found`; this does not disclose whether
an excluded row still exists. General source/store permission failure returns
`permission_required`. Missing service/environment responses can omit the data
and page fields; clients must inspect status before consuming them.

Each returned observation preserves exact source/store/product/item IDs, public
source label, nullable description/brand/size/sold-by, currency, price basis,
modality, eligibility and unit basis. `price` includes nullable regular/promo
values and cents, source estimates and source date objects. `observedAt` is the
observation timestamp. `dateQualification` is `qualified` or `unqualified` for
the observation time; `promotionStatus` is `reported_promotion` or
`not_verified_promotion`. `priceQualification` is `qualified` or
`unsupported_source_price`: unsupported source prices remain unavailable as
usable cents and cannot qualify a promotion. Neither field promises an offer
remains valid now.
Regular-only and zero-valued source facts can be returned; do not present them
all as verified promotions or free items. Legacy missing descriptions/brands
remain missing; text search cannot reconstruct them. Use exact IDs if known.

Coverage is a bounded, retained operator sample. Reads enforce original and
current grants, approved stores/topics/purposes, completed collection provenance,
expiry and shorter applicable retention. No HTTP operation enables permission,
imports data, starts collection or runs SQL. Real Kroger retention permission
remains unestablished for this project. See [HISTORY.md](HISTORY.md) for operator
writes and [PROMOTION_SERVICE.md](PROMOTION_SERVICE.md) for the separate private
HTTP contract, migration and limits. The private service's token and error shape
are different from this public app wrapper.

## Optional Cart session and explicit writes

Cart starts disabled. Readiness requires enabled configuration, actual assigned
`cart.basic:write` access, production credentials, HTTPS `PUBLIC_ORIGIN` and the
exact registered callback. The flags record operator configuration; they cannot
grant access. The current project has not qualified live Cart authorization or
writes. Reading products or adding to the visit-only list does not connect or
write a Kroger cart.

Use the installed browser workflow unless building an authorized session client.
Cart POSTs require exact `Origin`; add/disconnect also require the secure
HttpOnly `kroger_visit` cookie and `csrfToken` returned for that session. Preserve
these as private runtime session values, never as saved skill/example content.
Cart status and callback are not generic credential inspection endpoints.

1. `GET api/v1/cart/status` returns `{ok:true, cart:{…}}`. Cart fields include
   `enabled`, `configured`, `connected`, `status` and, when a session exists,
   `csrfToken`. Status creates a session only when Cart is configured.
2. `POST api/v1/cart/connect` takes `{}` and rotates the session identity. It
   returns `authorizationUrl` and `cart`. Send the shopper to that exact
   supported Kroger authorization URL only following their choice to connect.
3. Kroger returns to the registered `GET api/v1/cart/callback`. State and PKCE
   are checked; code/state are single-use, with a ten-minute authorization
   window. The app exchanges the code privately and redirects with 303 to its
   fixed base page. It never reflects callback values. Return to the original
   list tab and call cart status to check the connection. Status retires an
   expired pending authorization as `authorization_failed` while its session
   remains. A fresh connect rotates state, PKCE and the visit; never reuse a
   previous sign-in URL after denial, expiry or a changed visit.
4. Only with explicit authorization to add these quantities, call
   `POST api/v1/cart/add` with exactly `items` and `csrfToken`. Each of 1–50
   items contains `upc` (exact 13-digit string), whole `quantity` 1–99 and optional
   `modality` (`PICKUP` or `DELIVERY`). Combine duplicate UPC/modality entries;
   unknown item/body fields are rejected. No store selector is accepted.
5. Upstream 204 yields `{ok:true, acknowledged:true, cart:{…}, message:…}`.
   This acknowledges an add, not a readback of cart contents or a checkout.
   Every add sends the full quantities and may increase existing quantities.
   Verify the actual store, fulfillment, quantities and prices at Kroger.
6. `POST api/v1/cart/disconnect` takes only `csrfToken` and returns readiness
   under `cart`, while removing the app session and expiring the cookie.
   It neither undoes items nor revokes the account grant at Kroger.

The UI sends only eligible unit-priced list lines with source UPCs, combines
matching UPCs and refuses the entire add when any line is unresolved, a combined
quantity exceeds 99 or more than 50 UPC groups remain. The UI does not send a
modality or selected browsing store; review the real fulfillment at Kroger.
The API validates submitted UPCs/quantities, but does not certify their provenance,
reprice them or inspect the caller's shopping list.

Cart statuses are `disabled`, `setup_required`, `authorization_required`,
`authorization_failed`, `connected` and `write_outcome_unknown`. Tokens remain
only in server memory; refresh tokens are discarded. Sessions expire within
30 minutes, token usability can expire sooner, and periodic cleanup prunes
expired sessions. There are at most 200 sessions. Disconnect and server restart
discard sessions; closing a tab clears page memory without immediately removing
the server session. Multiple processes do not share it.

There is no automatic add retry, token-refresh retry or idempotency key. A timeout,
network failure, aborted response or unexpected upstream result after sending
the write can be `cart_write_outcome_unknown`. The session blocks further adds.
Token expiry removes token access but preserves `write_outcome_unknown` while
that session survives. The browser also keeps an observed unknown-outcome warning
for the rest of the page visit until an explicit disconnect, including across a
status refresh after session expiry or server restart. This page-memory guard
does not survive navigation and cannot reconcile the actual cart.
Inspect the actual Kroger cart before disconnecting/reconnecting and deciding
whether another write is needed. Client loss of an acknowledgement is also an
uncertain outcome even if the server's status says connected. A known rejection
does not authorize a different or repeated cart action.

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
| 503 | `promotion_service_unavailable` | The private history read failed. Retry a read later; this is not empty history. |
| 403 | `origin_required`, `cart_session_required` | Use the configured app origin and current cart cookie/CSRF session. |
| 400 | `invalid_cart_items` | Correct UPCs, quantities, modality and duplicate entries before a separately authorized write. |
| 401 | `cart_authorization_required` | Authorization is absent/expired; reconnect only after checking any prior uncertain write. |
| 503 | `cart_setup_required`, `cart_authorization_failed` | Check actual assignment and callback/setup, or start a new authorized sign-in. |
| 409 / 429 | `cart_busy` | Wait for the current action/capacity; do not replay an uncertain add. |
| 503 | `cart_rejected` | Kroger rejected the add; inspect the actual cart and permissions before deciding a next action. |
| 409 / 502 | `cart_write_outcome_unknown` | Inspect the actual Kroger cart before any new write. |
| 408 | `cart_cancelled` | Server cancellation occurred before it sent a cart request. Transport loss at the caller still needs outcome assessment. |

App search admission and provider-limit 429 responses include an integer
`Retry-After` delay in seconds; Cart session-capacity errors can omit it. The app
does not automatically retry 400, 403 or 5xx responses. It may renew an access
token and retry one safe read once after an upstream 401. A new shopper search
is still a new upstream request; avoid retry loops and repeated topic scans.

## Resource and data limits

These are application limits, separate from Kroger's published quotas:

| Resource | Limit |
| --- | --- |
| App POST request body | 4,096 bytes, including stored-history and Cart requests. |
| App POST requests | 30 per 60-second global installation window, including admitted invalid/setup requests. |
| Active app searches/uploads | 4; no waiting queue. |
| Upstream HTTP attempts | Default local budget of 1,000 per 24 hours, including token requests, failures and the bounded 401 renewal/retry. |
| One upstream HTTP request | 10 seconds, including response-body reading. |
| App request cancellation deadline | 35 seconds; incoming request-body timeout is 20 seconds. |
| Upstream JSON body | 2,000,000 bytes; token responses 16,384 bytes. |
| Store results | Up to 10 in one ten-mile search. |
| Starter sample | Up to 45 product records: three fixed topics, fifteen each. |
| Refined search | Up to 50 product records, one page. |
| Item variants | Up to 10 per product, at most 500 offers for a refined search. |
| Core source text | Description 512, brand 200, size 100, sold-by 40, identifiers 64, stock string 80, date value/timezone 80 characters. Additional catalog fields have their own fixed bounds. |

Private-service bounds are documented in [PROMOTION_SERVICE.md](PROMOTION_SERVICE.md).
Its larger private body limit does not raise the public app's 4,096-byte bound.
Remote requests have a five-second whole-response deadline, a 2 MiB response cap,
no redirects, no cache and no automatic retry. Current-price results survive an
independent comparison-service failure with history marked unavailable.

The local HTTP budget and app rate counter are process-local. Their windows
start with local activity and reset on restart; multiple processes do not share
them. They are not proof of Kroger's quota balance or reset time. A production
operator must coordinate quotas across server and collection processes.

Queries and product results are transient. The visit-only list has no server
write endpoint. Optional Cart writes use the separate temporary session above.
There is no shopper search cache, analytics log, customer account table or API
endpoint for writing price history.
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

## Stored store discovery

`POST api/v1/promotions/stores` accepts exactly `{ "zipCode": "00000" }`.
This ZIP is synthetic; use the person's accepted five-digit ZIP, preserving
leading zeros. Extra fields, radius/limit overrides, autocomplete and URLs are
rejected. This route reads our database only. It cannot call the live
`api/v1/stores/search`, fetch Kroger data, geocode or start collection.

Directory permission is separate from product-history permission. Operator
collection requires an actual grant for all three directory purposes and the
exact ZIP. The tool's recipient acknowledgement does not create that grant.
A product-status `available` response does not establish directory permission;
directory discovery can work while product-history permission is missing.

The response adds `ok: true` and `apiVersion: 1` to these fields:

| Field | Meaning |
| --- | --- |
| `status` | `available`, `no_data`, `stale`, `permission_required`, or a minimal `unavailable` operational response. |
| `zipCode` | Exact requested ZIP. It is not inferred from a returned store address. |
| `stores` | At most ten distinct returned stores; empty except when `available`. |
| `snapshot` | `null` without readable data; otherwise `snapshotId`, `observedAt`, `completedAt`, `ageSeconds`, `maxAgeSeconds`. |
| `latestAttempt` | `null` or fixed `status`, `startedAt`, `finishedAt`; a failed attempt does not refresh a completed snapshot. |
| `coverage` | `type: "bounded_zip_directory"`, exact `zipCode`, `radiusMiles: 10`, `limitPerQuery: 10`, `returnedStoreCount`, `completeNearbyStores: false`, and `message`. |
| `reason`, `message` | Optional fixed gap/recovery information. |

Each store has exactly `locationId`, nullable `name`, and `address`. The address
has nullable `addressLine1`, `addressLine2`, `city`, `county`, `state`, `zipCode`.
The full eight-character location ID stays a string. Missing metadata remains
null. No distance, nearest-store ordering or store coverage is invented.
`returnedStoreCount` preserves the raw query count and must exactly equal the
available store-row count. Repeated store identities, including exact repeats,
fail the collection; records are never silently dropped to make counts agree.

The operator collects one Public Locations query per explicit ZIP, using a
10-mile radius and first-page limit of ten. That establishes neither every
nearby store nor the nearest ten. The query ZIP can differ from a returned
store's address ZIP. A fresh completed empty query is `available` with `[]` and
count `0`; no completed query is `no_data/no_completed_directory`. Stale data
returns snapshot dates but no store rows. Original/current rights, retention,
expiry, scope and revocation are checked on every read. An unreadable completed
snapshot gives `no_data/snapshot_not_readable`; an old snapshot is never revived.

Show names, addresses, exact references, collection time and the query bounds.
Ask the person to choose a returned store; do not silently pick the first one.
Then call completed-topic discovery. Missing/stale/denied data is an operator
gap; the read never falls back to a supplier. A missing remote service or
certification environment returns the existing minimal `unavailable` envelope,
with no fabricated `stores` or completed-empty claim.

## Completed collection topics

`POST api/v1/promotions/topics` accepts exactly
`{ "locationId": "TEST0001" }`. The value is synthetic; use the chosen complete
store ID. This is a database read, not an operator-plan or live-source endpoint.

The response has `ok`, `apiVersion`, `status`, `locationId`, `topics`, and
`coverage: { "type": "completed_store_topics", "completeCatalog": false,
"message": "..." }`, with optional fixed `reason`/`message`.
Each of at most ten distinct topic entries has:

```json
{
  "topic": "milk",
  "status": "available",
  "snapshot": {
    "snapshotId": "1",
    "observedAt": "2026-01-02T12:00:00.000Z",
    "completedAt": "2026-01-02T12:00:01.000Z",
    "ageSeconds": 1,
    "maxAgeSeconds": 86400
  },
  "latestAttempt": null,
  "returnedProductCount": 0
}
```

This synthetic entry represents a fresh completed empty topic. Count `0` means
zero product results in that completed sample, not no collection or no store
promotions. Topic rows can be `available` or `stale`; the overall result is
`available` when any row is fresh, `stale` when every returned row is stale,
`no_data/no_completed_topics` when no readable named completion exists, or
`permission_required` when the exact store lacks product-history permission.
Operational `unavailable` has no invented topics. Permission-denied/no-data
results have `topics: []`.

Only completed store/topic samples under original and current permission are
listed. Running/failed attempts do not create topic labels; failures after a
completion remain visible as its `latestAttempt`. The endpoint does not expose
configured but uncollected targets, private source-policy references, credentials
or operator configuration. Legacy jobs had only topic hashes: schema 6 leaves
their labels unknown rather than guessing or reversing hashes. Known-label
legacy reads still work where their original provenance permits them.

Use a chosen fresh topic verbatim in `latest` or `prices`; use actual returned
product/item references in `estimate`. Stale topics provide dated scope and an
operator recovery action, not current recommendations. No response establishes
full selected-store promotion coverage or a complete topic universe.
