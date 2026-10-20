# Partner Catalog V2 contracts and qualification

## Detailed Content

### Source and access boundary

The selected official contract is **Catalog API V2 1.5.5**, retrieved on
2026-10-20 UTC from the publisher's public version inventory. Read the complete
local `research/official_docs/specs/catalog-api-v2.json` and its lossless Markdown
wrapper when designing an adapter. The mirror manifest records its document ID,
version, URLs, hashes and retrieval time. Official entry:
[Catalog API V2](https://developer.kroger.com/api-products/api/catalog-api-v2).

This is a Partner API. Its introduction says the catalog can be customized for
each partner. Public documentation, an optional UPC filter and successful
authentication cannot establish access to the whole selected store's assortment.
Obtain the actual assigned catalog, stores, fulfillment modes, exclusions and
applicable agreement before treating a result as an authoritative universe.

The contract uses client credentials and the exact scope
`urn:com:kroger:partner:catalog:products:read`. It lists production
`https://api.kroger.com` and certification `https://api-ce.kroger.com`. Append
the paths below directly; they do **not** start with `/v1`. The token URL is
separately `/v1/connect/oauth2/token`. Published environment/scope support is not
an assignment, a successful resource fetch or representative certification data.
This skill provides no authenticated client or safe credential adapter.

### Complete selected operation map

| Method and path | Input contract | Documented result |
|---|---|---|
| GET `/catalog/v2/products` | Required exact location and fulfillment; optional UPC list, product-update range, postal code, missing-price inclusion and page controls | Descriptive product information, including UPC/aliases, name, description, brand/categories, size metadata, images and product-page URL; page metadata |
| GET `/catalog/v2/products-inventory` | Required exact location and fulfillment; optional UPC list, stock/fulfillment/general update ranges, postal code, missing-price inclusion and page controls | Inventory, fulfillment and pricing information including active promotions, reference-price indicators, update times and possible postal-code prices; page metadata |
| GET `/catalog/v2/deleted-items` | Required exact location, fulfillment and deletion-time range; range maximum two days | Array of disabled product identifiers; no page controls or offer-removal semantics are documented |

The first two operations do not require `filter.upc.in` or a product term.
All three require `filter.locations.id.eq` and
`filter.locations.fulfillment.eq`; the documented fulfillment choices are
`DELIVERY`, `SHIP`, `PICKUP`, `INSTORE`. Preserve exact returned identifiers and
leading zeros. The location description says eight characters, while publisher
samples also use `MKTPLACE`; do not substitute that example for a selected store.

For Ocado delivery, the postal-code parameter `filter.postalCode.eq` is required
by its description even though it is not globally marked required. It accepts
five-digit ZIP or ZIP+4. This affects price context and customer-location privacy;
it is not a permission to retain a shopper's address or search.

`option.missingPrices=true` includes items without pricing. Its default/false
excludes them. Inventory prose describes an empty `prices` array for included
missing prices; preserve missing evidence, not an invented zero. A full-universe
design must account for records regardless of arithmetic usability.

The update filters are inclusive comma-separated start/end timestamps.
`products` has `filter.updatedAt.range`; inventory additionally has
`filter.stockLevelUpdatedAt.range` and `filter.fulfillmentUpdatedAt.range`.
There is a returned `priceUpdatedAt` field but no separately documented
`filter.priceUpdatedAt.range`. Disabled-item ranges use `filter.deletedAt.range`.
Do not invent filters from response field names.

`page.offset` is an integer, minimum/default zero. `page.size` defaults to 20;
prose allows 1–50 while schema permits 1–100. Use at most 50 pending source
clarification and authorized qualification. Response `meta.page` has offset,
size and optional `hasMore`; omission is not a documented terminal-page signal.
No stable sort, snapshot token, whole-assortment total or complete-offer count is
promised by this contract.

### Price and promotion meaning

Inventory nests locations → inventory → prices. Preserve every returned
inventory/price entry and its context; taking only the first entry may discard
source information. The schema has regular and promo price objects,
`discountLabel`, `referencePriceAmt` and `referenceNForCnt`. Its PriceCut example
has **regular plus reference-price fields and no promo object**. Requiring
`promo < regular` would therefore omit a documented promotion representation.
A reference price is not a dated historical promotion observation.

The regular/promo schema describes currency-bearing strings such as `USD 5.00`
in `unit`, an `nFor` object with quantity and price, `soldBy` (`UNIT` or `WEIGHT`)
and effective/expiry objects with value/timezone. The separate `postalCodes`
price branch uses `price` strings, integer `nFor.quantity` and string dates.
Different branches and contradictory examples need explicit source qualification;
do not silently coerce them into the Public Products price model.

Treat purchase quantities, sell-by basis, package size, currency, promotion dates
and shopper eligibility as separate facts. A monetary `unit` field or `WEIGHT`
does not identify ounces, pounds or another measurement basis. A package's
shipping weight is not proof of its consumable content. Mark a calculated unit
price unavailable when the denominator is unsupported. Preserve original source
text and show any permitted calculation separately.

### Source conflicts to resolve before an adapter is accepted

| Published conflict | Required treatment |
|---|---|
| Page-size prose 50 maximum versus schema 100 | Keep the smaller documented bound until clarified; no larger-page or completeness claim |
| UPC prose permits 50 distinct identifiers; string schema has numeric `maximum: 20` | Do not reinterpret a malformed numeric constraint as a reliable batch-size contract |
| Schema uses `nFor` object/string quantity and currency strings; examples use `nfor` arrays, numeric `unit` and separate `currency` | Retain both source forms; qualify actual entitled responses before choosing accepted representations |
| Inventory example places `soldBy` beside regular/promo; schema places it inside the price object | Preserve the conflict and test the actual source branch |
| Product example nests `meta.page.page`; schema/inventory examples use `meta.page` | Do not derive pagination solely from the product example |
| Several example timestamps have impossible hour values | Reject unusable dates as evidence while retaining an accountable source record; never repair a source date by guessing |
| Deleted-items description limits ranges to two days; example spans a month and code samples omit the required range | Follow the explicit two-day limit; examples do not grant longer recovery windows |
| Ocado example uses the string `"null"` for location prices while schema describes an array | Missing prices remain unavailable; no automatic numeric or truthy-string conversion |

### Full promotion coverage requires additional evidence

The contract describes active promotions but does not define a complete offer
universe covering every coupon, loyalty price, BOGO, mix-and-match, basket,
weekly digital or personalized offer. It provides no general offer-ID model,
clipping/eligibility/redemption/stacking contract or authoritative reconciliation
total. Absence here does not prove those programs lack other official sources.

Before claiming full selected-store coverage, establish all of these:

1. **Authoritative scope:** the actual entitled catalog/feed includes the entire
   selected store and required fulfillment context, with all exclusions known.
2. **Offer semantics:** every required promotion class, participating item,
   condition, identity, validity interval and eligibility distinction has an
   authorized source. Listing a personalized offer is separate from proving a
   particular shopper qualifies.
3. **Enumeration and recovery:** the supplier defines terminal-page behavior,
   ordering/snapshots or reconciliation, change/removal handling, bounded
   interruption recovery and freshness. Disabled products alone do not account
   for expired or withdrawn offers.
4. **Accountable processing:** missing prices/descriptions, unavailable stock,
   duplicate/conflicting records and unusable dates remain accounted for.
   Arithmetic qualification and shopper filters cannot silently shrink the
   claimed source universe.
5. **Actual reconciliation:** exercise the entitled source and each consumer,
   verify counts/identities against an authoritative supplier reference, and
   disclose exceptions. Synthetic tests establish only their simulated behavior.

Until those gates pass, describe a tested result by its actual bounded scope.
Adding terms, scanning all reachable product pages or increasing a cap does not
fulfill a full-promotion requirement.

### Data rights and release gates

Read `references/data-use-and-security.md` in full before retention or sharing.
The public Terms and policies restrict systematic database creation, permanent
copies/cache, redistribution and customer-derived activity handling. A Partner
grant must be checked against its actual additional terms and precedence; this
reference does not assume the Public AUP alone determines every Partner use.

Resolve authorized fields, stores/fulfillment, frequency/quotas, cache lifetime,
retention/expiry, public historical display, derived comparisons, revocation,
deletion/backups and audit obligations. Identify the server, a user's local agent
and an external model service as separate recipients. Technical access and user
consent alone do not override source restrictions. A locally entered policy file
records a review result; it cannot create a supplier permission.

Before publishing, separately review the exact original-code, hosted behavior,
assistant, source-data, branding and documentation surfaces. The spec declares a
`LICENSED` source with a publisher license URL; it does not license its mirror or
supplier responses under the project's software license. Keep collected supplier
documents outside public source/builds unless redistribution is established.

## Key Concepts

An entitled catalog can be customized. Product enumeration, promotion coverage,
shopper eligibility, price arithmetic and data-use rights are distinct contracts.

## Decision Criteria

Use Catalog V2 as a documented candidate for Partner qualification. Accept an
adapter only after its actual source shapes, scope, rights and reconciliation
protocol support the required consumer behavior. Return missing permissions or
semantics to their source owner; preserve supported independent work.

## Constraints & Limits

This reference is based on the collected public 1.5.5 contract. No grocery
resource request, actual entitlement, supplier agreement, full-coverage proof,
history collection or live customer behavior is established by this skill.
It is not a substitute for the actual applicable agreement or publication review.

## Common Patterns

For “find every promotion,” first qualify the authorized universe and offer
semantics. For “the scope is rejected,” preserve the access blocker without
credential guessing or repeated probes. For “prices are missing,” keep the
source record accountable and mark calculations unavailable.
