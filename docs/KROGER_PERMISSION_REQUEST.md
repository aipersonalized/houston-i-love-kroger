# Kroger permission request templates

Use these templates for a specific missing capability or data-use exception.
A request is not an access or data-use grant. If Kroger has already acknowledged
your request, follow up in that existing thread; do not submit a duplicate merely
because access or permission is still pending.

## Start with Public APIs and identify the actual restriction

Kroger's [Partnership Request guidance](https://developer.kroger.com/documentation/partner)
recommends Public APIs first, then Partner access as needed. Partner APIs require
additional security consideration and a contractual agreement; ordinary Public
Locations and Products use does not require becoming a partner.

The [Public API acceptable-use policy](https://developer.kroger.com/documentation/public/getting-started/acceptable-use)
expressly permits faithful display and relevant filtering of product and store
data. The app's live ZIP/store lookup and current-product search can proceed
within that use, documented access and quotas. Keep source names, descriptions,
addresses and prices unchanged. Label returned unit-price estimates as source
estimates. Show calculated savings and quantity costs separately, with their
assumptions and missing information clear.
The policy prohibits comparisons with other retailers; Terms section 4a also
restricts analysis used to develop marketing or business strategies targeting
Kroger customers. Neither provision says every within-Kroger shopping calculation
or agent interaction requires Partner access. Other terms still apply to the
actual use, including customer-data restrictions and the API-replication ban.

The separate scheduled collectors have a different problem. Both Products and
Locations prohibit "Systematically scraping or gathering response data to create
a database." The [Terms](https://developer.kroger.com/terms), section 5e, also
restrict database creation, permanent copies, caching beyond response headers
and specified reuse, subject to express content-owner permission or applicable
law. The Terms incorporate API policies and give applicable additional API terms
priority where they conflict. Ordinary display permission does not supply an
exception for scheduled database collection.

The history collector saves dated store/topic product observations. The directory
collector saves store identifiers, names and addresses from operator-chosen ZIP
queries. Both therefore need an applicable exception or authorized source terms
covering that collection and the intended retained-data use. Small samples,
private storage, low request rates and unchanged values do not remove the database
restriction. A working Public key, Partner status or a policy JSON file does not
supply that exception. No applicable legal exception has been established here.

Continue testing the Public current-price features and synthetic database flows
independently. Keep real history/directory collection disabled pending that
specific basis. Temporary response caching within permitted headers cannot
supply dated history; the Cart API's visit-only cache allowance does not authorize
a price database. Live lookups also do not meet the companion's database-only
requirement. A separately licensed real dataset could be an alternative if its
terms cover the intended use and an importer is implemented; this project has
neither such a dataset nor that import path. Synthetic fixtures test software,
not real shopping history. Complete promotion coverage remains a separate unmet
requirement.

## Request access to complete store promotions

The current public product search does not establish complete promotion
coverage. Searching more words or following its available pages does not prove
that every promotion has been found.

Kroger's [Partner Catalog API V2](https://developer.kroger.com/api-products/api/catalog-api-v2)
documents store-specific inventory with active promotions, including searches
without a product term. It requires separately assigned partner access. Its
published contract does not establish coverage of every promotion type or a
consistent snapshot across pages. Access alone therefore does not make this
app's results complete. Catalog V2 is a candidate to qualify, not evidence that
complete coverage necessarily requires Partner APIs; ask Kroger about any other
official source that can meet the requirement.

1. Follow up in an existing acknowledged access request. For a new Partner API
   request, open the [Partner Request form](https://developer.kroger.com/support/contact?option=partner_request).
2. Read the current form and select the partner-request topic if it is not
   already selected. Supply your own contact name and email through the form;
   the organization field is optional. Do not enter credentials or token values.
3. Review the draft below and identify your own registered application by its
   name if Kroger needs it. Do not put a client ID or secret in a public issue,
   repository, assistant conversation or screenshot.
4. Send the request only after you approve its contents. The app and this guide
   do not send it automatically, change assignments or accept an agreement.
5. Keep the response and any agreement private. Verify both the assigned access
   and the precise promotion coverage before implementing the source. An
   `invalid_scope` response means that requested scope has not been established;
   it does not negate working Public API access. Retrying or changing the app's
   labels does not grant the rejected scope.
6. Keep full-coverage claims disabled until the source can be reconciled against
   all required offers and actual use passes verification. Bounded collection
   has its own data-use gate; permission for a sample does not prove completeness.
   Missing prices, unavailable stock or purchase conditions must not silently
   remove promotions from a complete listing.

### Partner access request — review before sending

> Subject: Partner access and complete selected-store promotion feed qualification
>
> We are developing an independent open-source grocery-deal finder for humans
> and assistants. A shopper chooses an exact Kroger store and needs all currently
> active promotions, with applicable conditions and unit prices. We also want
> permission to compare these with dated historical promotion prices.
>
> Public Products search cannot establish exhaustive store coverage. We
> identified Catalog API V2 1.5.5, including `/catalog/v2/products-inventory` and
> the scope `urn:com:kroger:partner:catalog:products:read`. Please advise whether
> our use case qualifies for partner access, and what security review,
> agreement, commercial terms and application configuration are required.
>
> Please confirm whether the entitled source includes the entire selected
> store's assortment for each fulfillment method, without product or department
> exclusions. Which promotion classes are included: ordinary sales, price cuts,
> loyalty prices, weekly digital deals, other coupons, BOGO, mix-and-match,
> basket thresholds and personalized offers? Identify any additional authorized
> feeds needed for full coverage and any classes that remain unavailable.
>
> How are individual offers, participating products, purchase requirements,
> clipping or member eligibility, exclusions, redemption limits, stacking and
> effective/expiry times represented? Please distinguish listing a conditional
> offer from verifying an individual shopper's eligibility.
>
> How is exhaustive enumeration guaranteed? We need the supported snapshot or
> reconciliation protocol, terminal-page semantics when `hasMore` is omitted,
> ordering, updates, removals, interruption recovery, supported stores and
> fulfillment methods, freshness commitments and an authoritative way to check
> that no offers are missing.
>
> Please specify permission and conditions for public display, assistant access,
> price-history storage, derived unit-price comparisons, retention, caching,
> deletion and backups. Our server, a user's local agent and an external model
> service are distinct potential recipients. Please identify the permitted
> recipients and any required attribution or branding restrictions.
>
> If Catalog V2 does not cover this requirement, please identify the appropriate
> official complete promotion source. We will not infer full coverage or data-use
> permission from successful authentication alone.

The public form's labels and required fields were observed on 2026-10-19;
future versions may differ. Verify the submission receipt for your own request
and retain it privately. Published Catalog V2 support and a submission receipt
are not an actual entitlement or permission grant.

## Additional historical-data permission questions

Ask Kroger's developer team through your existing request or the current
[support contact route](https://developer.kroger.com/support/contact) whether it
can authorize this specific exception for Public data, or offer another source
whose terms cover it. Partner enrollment is not itself the exception, and the
published policy does not promise that an exception will be available. A Partner
request is appropriate if Kroger identifies a required Partner API or program.
Sending or following up remains a separate operator action.

> We are developing an independent grocery-deal finder. A person enters a ZIP,
> chooses an exact store and views current promotions. We would also like a
> separately operated collector to retain dated, store-specific product prices
> so we can compare a current offer with past reported promotion prices and,
> when the measurement basis is explicit, past unit prices.
>
> The Public Products policy prohibits systematic response gathering into a
> database, and Terms section 5e restricts database creation and specified reuse.
> Can Kroger provide an authorized exception or source terms that expressly cover
> this scheduled collection and retained-data use, including those restrictions?
> Please identify the approving authority, applicable content-owner permissions,
> source and conditions, and whether a separate agreement or program is needed.
> Please specify authorized endpoints and scopes;
> whether complete store promotion or historical feeds exist; coverage and
> completeness limits; exact store/item identity; purchase and loyalty conditions;
> taxes, currency, fulfillment, unit basis, timestamps and promotion validity.
>
> Please address collection frequency and quota, retained fields, retention and
> cache lifetime, database creation, derived savings/comparisons, human display,
> automated-client access and any permitted forwarding to an agent or AI provider.
> We need to distinguish our server, a user's local agent and an external model
> service as actual recipients, without assuming every agent needs a separate
> approval. Please confirm which uses and recipients the exception covers and
> any applicable restrictions. Please state attribution, branding, publication
> and open-source-example restrictions and whether source documentation may be
> redistributed with the project.
>
> Please also specify expiry, revocation, deletion, backup and audit obligations;
> whether approval is limited to particular stores, topics, operators or users;
> and how price changes, missing values and out-of-stock items should be treated.
> We can keep collection disabled until applicable permissions are verified.

Record any response privately and review its actual scope before creating a
bounded source-policy file. A policy JSON file alone cannot grant rights. Keep
account identifiers, correspondence, credentials and signatures out of this
repository. A partner documentation page is not partner entitlement.

## Stored store-directory permission questions

Include these questions when qualifying directory retention. The Locations
policy separately prohibits systematic database gathering. Product-history
permission covers it only if the actual terms also cover this directory use.

> We also want assistants to find store choices through our own read-only
> database service. May a separate collector retain dated ZIP-query results
> from Public Locations, including exact store identifiers, names and addresses,
> and return them to human users, local agents and external model services?
> Please identify the authorized exception or source terms covering the Locations
> database-gathering prohibition and Terms section 5e for this use. These are fixed
> operator-chosen ZIPs, not retained shopper locations or search histories.
> Please specify authorized ZIPs, query frequency, retained fields, freshness,
> retention, attribution, recipient restrictions, deletion and backup duties.
> The bounded directory would identify its radius and result limit and would
> not claim to include every nearby store. Please identify any required separate
> agreement or source for this use.

Keep directory collection disabled until its own actual permission is verified.
Record any granted scope separately from product-price and promotion rights.

The Partnership Request and Public acceptable-use articles were rechecked on
2026-10-20. The complete public Terms reviewed here were captured on 2026-10-19
and displayed a last-modified date of 2019-04-09; a later anonymous HTTP check
returned the site shell rather than the Terms article. Read the current complete
Terms and any additional source terms before relying on an exception. This guide
does not establish one or authorize a hosted deployment.
