# Kroger permission request templates

Use these templates to prepare a request for your installation. A request is
not an access or data-use grant. The public
acceptable-use policy restricts systematically gathering API data into a
database; a working client key does not establish retention rights.

## Request access to complete store promotions

The current public product search does not establish complete promotion
coverage. Searching more words or following its available pages does not prove
that every promotion has been found.

Kroger's [Partner Catalog API V2](https://developer.kroger.com/api-products/api/catalog-api-v2)
documents store-specific inventory with active promotions, including searches
without a product term. It requires separately assigned partner access. Its
published contract does not establish coverage of every promotion type or a
consistent snapshot across pages. Access alone therefore does not make this
app's results complete.

1. Open the [Partner Request form](https://developer.kroger.com/support/contact?option=partner_request).
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
   `invalid_scope` response means that requested access has not been established;
   retrying or changing the app's labels does not grant it.
6. Keep full-coverage claims and collection disabled until the source can be
   reconciled against all required offers, its use is permitted, and actual use
   passes verification. Missing prices, unavailable stock or purchase conditions
   must not silently remove promotions from a complete listing.

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

Use Kroger's current
[partner inquiry route](https://developer.kroger.com/support/contact?option=partner_request)
to ask which agreement, program and endpoints could authorize this specific use.
Sending a message remains a separate operator action.

> We are developing an independent grocery-deal finder. A person enters a ZIP,
> chooses an exact store and views current promotions. We would also like a
> separately operated collector to retain dated, store-specific product prices
> so we can compare a current offer with past reported promotion prices and,
> when the measurement basis is explicit, past unit prices.
>
> Please confirm whether this is permitted, under which agreement and source,
> and what approval is required. Please specify authorized endpoints and scopes;
> whether complete store promotion or historical feeds exist; coverage and
> completeness limits; exact store/item identity; purchase and loyalty conditions;
> taxes, currency, fulfillment, unit basis, timestamps and promotion validity.
>
> Please address collection frequency and quota, retained fields, retention and
> cache lifetime, database creation, derived savings/comparisons, human display,
> automated-client access and any permitted forwarding to an agent or AI provider.
> We need to distinguish our server, a user's local agent and an external model
> service as actual recipients. Please state attribution, branding, publication
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
