# Kroger API contract map

## Detailed Content

Observed source revision:2026-10-20 UTC. Exact complete definitions live in
`../research/official_docs/specs/`; the mirror manifest owns official document
IDs and retrieval times. Published support is not authenticated qualification.

### Public operation map

Paths below append to a configurable official origin, `https://api.kroger.com`
for production or `https://api-ce.kroger.com` for certification. Keep `/v1` in
the operation path exactly once. Credentials are tied to the selected environment.
API Basics warns CE has no customer accounts; Cart/Identity tests require
separately authorized production activity, even though specs list both origins.

| Family/version | Operation | Grant and public scope | Documented success |
|---|---|---|---|
| Products1.3.0 | GET `/v1/products` | Client credentials; `product.compact` | 200 product list and pagination metadata |
| Products1.3.0 | GET `/v1/products/{id}` | Same | 200 product detail |
| Location1.2.3 | GET `/v1/locations` | Client credentials; no scope required in operation description | 200 location list |
| Location1.2.3 | GET/HEAD `/v1/locations/{locationId}` | Same | GET200; HEAD204 when found |
| Location1.2.3 | GET `/v1/chains` | Same | 200 chain list |
| Location1.2.3 | GET/HEAD `/v1/chains/{name}` | Same | GET200; HEAD204 when found |
| Location1.2.3 | GET `/v1/departments` | Same | 200 department list |
| Location1.2.3 | GET/HEAD `/v1/departments/{id}` | Same | GET200; HEAD204 when found |
| Cart1.2.3 | PUT `/v1/cart/add` | Customer authorization code; `cart.basic:write` | 204 without a response body |
| Identity1.2.3 | GET `/v1/identity/profile` | Customer authorization code; `profile.compact` | 200 profile ID only |
| Authorization1.0.17 | GET `/v1/connect/oauth2/authorize` | Customer sign-in/consent | Redirect with code or denial |
| Authorization1.0.17 | POST `/v1/connect/oauth2/token` | Client credentials, authorization code or refresh | 200 token response; keep private |

Sources: [Products](https://developer.kroger.com/api-products/api/product-api-public),
[Locations](https://developer.kroger.com/api-products/api/location-api-public),
[Cart](https://developer.kroger.com/api-products/api/cart-api-public),
[Identity](https://developer.kroger.com/api-products/api/identity-api-public),
[Authorization](https://developer.kroger.com/api-products/api/authorization-endpoints-public).

### Selected Partner operation map

Read `references/catalog-v2.md` in full for these operations, exact parameter
and price shapes, conflicts, customized-catalog boundaries and full-promotion
qualification gates. These paths append directly to the official origin;
do not add `/v1`.

| Family/version | Operation | Grant and scope | Documented success |
|---|---|---|---|
| Partner Catalog V2 1.5.5 | GET `/catalog/v2/products` | Client credentials; separately assigned `urn:com:kroger:partner:catalog:products:read` | 200 descriptive product list and page metadata |
| Same | GET `/catalog/v2/products-inventory` | Same | 200 location/fulfillment inventory and pricing, including active promotions |
| Same | GET `/catalog/v2/deleted-items` | Same | 200 disabled product identifiers for the required deletion range |

This is a selected Partner contract, not complete coverage of Kroger's broader
Partner API catalog. Source: [Catalog V2](https://developer.kroger.com/api-products/api/catalog-api-v2).

### Products

Search needs an initial `filter.term`, `filter.brand` or `filter.productId`.
Term:minimum3 characters, maximum8 words in description. Brand matching is
case-sensitive; multiple brands use pipes. Product IDs preserve leading zeros;
the current search contract describes13 characters, comma lists and a maximum50
annotation on a string schema. Do not reinterpret that malformed annotation as
a numeric product-ID range. `filter.productId` explicitly ignores all other
query parameters: for store details use `/products/{id}?filter.locationId=...`.

Store context uses an8-character `filter.locationId`. Without it, nationwide
matches are not store-price quotes. Location context enables price, aisle,
fulfillment and optional inventory information. Preserve returned product text
and price values; omit irrelevant fields if needed. Unknown price is not zero;
promo zero is not verified free/coupon eligibility.

`filter.limit`:1–50; overview default10. `filter.start`:1–250 in current schema;
description calls it number skipped, while examples show start1. Do not promise
zero-based pagination or stable fuzzy ordering without a live check. Fulfillment
codes are `ais`, `csp`, `dth`, `sth`, comma-separated per description. In-store
means sold there, not guaranteed stock. `inventory.stockLevel`, if returned, is
`HIGH`, `LOW` or `TEMPORARILY_OUT_OF_STOCK`; omission means unavailable evidence.
Checkout confirms inventory. Product details schema permits productId/UPC
variants; use the returned identifier for the exact operation, not guessed barcode
truncation rules. Link construction uses the chain's returned `domain` and the
returned `productPageURI`, with a validated HTTPS URL builder.

### Locations

Near search accepts `filter.zipCode.near`, `filter.latLong.near` or paired
`filter.lat.near`/`filter.lon.near`. `filter.radiusInMiles`:1–100, default10;
ignored without a starting point. Current list schema `filter.limit`:1–200,
default10. Chain name, department and location-ID filters narrow results.
Location ID is8 characters; department ID2 characters; preserve leading zeros
and do not assume numeric-only input. A chain result may include a fuel station.
Use returned store/department timezone and hours, not the computer's timezone.
Overview says no pagination. Do not invent a `filter.start` Locations parameter.

### Cart and identity

Cart JSON shape is `{"items":[{"upc":"0001111060903","quantity":2,"modality":"PICKUP"}]}`
(publisher sample product code, not a live request). Item UPC and integer
quantity are required; `modality` is optional, `PICKUP` default or `DELIVERY`.
The schema does not specify quantity bounds; an app can require a positive
quantity as an application rule, without calling it an API guarantee.
Use `Content-Type: application/json`. No response JSON is promised for204.
No public cart read/delete/checkout exists in this selected contract. Quantity
addition semantics are not an idempotency guarantee: do not retry an uncertain
write automatically. Public Identity returns a profile ID, not email/loyalty;
Acceptable Use forbids using that ID as a customer-data correlation key.

### OAuth

Confidential client credentials:POST form `grant_type=client_credentials`, exact
assigned scope when needed, Basic authentication over client ID/secret on the
trusted server. API calls use `Authorization: Bearer ...`, never Basic.

Customer authorization code:scope, client_id, redirect_uri, response_type=code;
use random request-bound `state` and validate it on return. Current guide directs
browser/native clients to PKCE. Authorization1.0.17 supports S256 only;
code_verifier is43–128 URL-safe characters, generated fresh per authorization.
Send challenge during authorize and original verifier during token exchange.
Confidential clients retain Basic; public clients without a secret may omit
Basic and send client_id with code_verifier in the form. Redirect must match
registration and the original request. Handle denial before exchanging a code.
This documents support; CORS/deployed client-type behavior is still untested.

Refresh tokens rotate and become invalid after use. Serialize refresh and
atomically replace token pairs. Consume actual `expires_in` seconds and handle
expiry/revocation; hardcoded sample lifetimes are unreliable. Treat an uncertain
exchange as uncertain rather than replaying a single-use code/token blindly.

### Quotas and errors

Published overview quotas:Products10,000/day across its operations;
Locations1,600/day per endpoint family(locations/chains/departments);
Cart5,000/day; Identity5,000/day. API Basics says reset24hours after first call
and no individualized client quotas. These are published limits, not measured
enforcement or per-user allowances. Actual burst/reset headers are unverified.
Do not circumvent limits or claim partner limits for public applications.

400:validate exact request, not endless retry. 401:renew/re-authenticate through
private handling;403:check assigned/requested scopes and entitlement, not renewal
loops. 404:not found or unavailable context, not a fabricated empty success.
5xx/transport failure:bounded backoff for safe reads; writes need uncertain-effect
reconciliation. Preserve allowed fixed error categories; never emit raw bodies
or URLs containing credentials/customer data into agent logs.

## Key Concepts

**Documented** means official source support; **observed** means an actual
interface outcome. **Partner** is an eligibility boundary, not a richer public
request variant. **Store context** identifies evidence context, not customer GPS.

## Decision Criteria

| Conflict | Treatment |
|---|---|
| Tutorial product.personalized/cart.basic:rw/profile.full versus public scopes | Current public operation scope wins for this design; actual assignment still required |
| Location overview9999 versus schema200max | Explicit≤200 pending controlled verification; retain disagreement |
| Location root security 'any', operation 'N/A' described no scope | Do not send literal any/N/A as scope strings; verify assigned app behavior |
| Access1800 examples versus older172800 | Actual returned expiry governs |
| Refresh6months in concepts versus typically24hours in spec | No fixed refresh lifetime promise; handle invalidation and reauthorization |
| Spec lists CE for customer APIs, Basics says no CE accounts | Do not claim CE customer testing works |
| Tutorial client-readable token cookies/online encoder | Do not copy these into a production security design |
| Product list filter.productId plus location | Do not assume location survives; use contextual details operation |
| Product filter.limit schema50max versus error example200 | Preserve schema≤50; error example does not enlarge the contract |
| Comma product IDs versus length13 and numeric maximum on string | No guaranteed batch size; validate through authorized integration checks |
| Fulfillment prose comma list versus single-value enum | Use a single documented code until multi-value behavior is qualified |
| Department overview says location-specific list | `/v1/departments` has no location selector; use a location response's departments for store context |
| Identity ID object schema versus string example | Treat parser shape as unresolved until controlled response qualification |
| Auth grant_type authorization_code description versus code example | Use authorization_code, not the inconsistent example |

## Constraints & Limits

The public operation map and selected Partner Catalog map have distinct scopes.
Public coupons, clipping, weekly ads,
order history, checkout and loyalty are not verified by this selected corpus;
their absence here is not a claim about every Kroger program. This skill's
documentation tools make no authenticated grocery requests. Public schema examples include malformed snippets; preserve
the source while deriving implementation from the contract and actual checks.

## Common Patterns

For a browse request, bind transient user-selected store → term search with
location → unchanged source facts and advisory stock → explicit customer choice.
For cart, bind requested returned UPC/quantity → consent → one guarded write →
204 acknowledgment → human verifies their Kroger cart/checkout. These are design
patterns, not implemented app controls or successful live operations.
