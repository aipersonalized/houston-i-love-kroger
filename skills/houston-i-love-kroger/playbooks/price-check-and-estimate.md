# Check stored item prices and estimate requested quantities

Help a person understand reported grocery prices and the qualified cost of their
requested quantities. Use our stored service's actual price and arithmetic
results; disclose partial subtotals and unresolved lines in ordinary language.
This is a cost estimate from dated observations, not checkout or a cart.

## Continued From

`SKILL.md` price-check/estimate route, or a requested continuation from latest
deals with valid store/topic and recipient context. A discovery request does not
choose quantities; accept the person's requested whole-package quantities.

## Resources

Before source records, read `references/source-permissions.md` in full. Before
price/estimate operations, read `references/api_reference.md` and
`schemas/command-rules.md` section "Stored promotion CLI" in full; read
`research/official_docs/pages/API.md` section "Stored price checks and basket estimates"
for exact request/response fields. Before reporting, read
`schemas/output-contract.md` in full.

## Step 1: Accept the installation, store, scope and requested task

Reuse a valid actual app URL, complete accepted store ID, known approved
collection topic(s) and source/recipient authority. When store/topic is missing,
read and follow `playbooks/choose-store-and-topic.md` in full, using stored ZIP
choices, the person's exact store choice and completed-topic discovery. Never
obtain these through live source searches. An absent or stale stored collection
is an operator/data gap rather than a mandatory human web-app handoff.

Establish whether the person wants a known item/package price, a quantity
estimate, a budget comparison or alternatives. Accept supplied category/brand/
budget preferences; do not infer a budget or basket quantity. Missing selected
item identity returns to a bounded stored-price read and the person's choice.
A missing price/estimate capability is a disclosed capability gap, never
permission to query Kroger or invent a calculation.

## Step 2: Check actual stored prices and item/package identity

Run `python scripts/promotions.py prices --store STORE_ID --topic TOPIC
--base-url BASE_URL --data-use-approved --json --no-input` from the skill folder,
replacing named values with accepted inputs. Optional `--product-id` and
`--item-id` narrow to known exact IDs. Otherwise inspect only the requested
bounded page, default 20 and maximum 50. An exact known product/item can narrow
that read; otherwise inspect only the requested bounded page and bind the
person's chosen product/package to actual returned IDs. Follow only a matching
snapshot/query cursor for the specified task. Do not mix snapshots.

Check freshness, observation dates, coverage, source currency and each price's
qualification/availability. A usable regular-only price can answer a price
question; do not call it a promotion. A qualified promotional price may support
a discount claim. Missing/invalid/zero/stale/expired/stock-excluded prices remain
unavailable with their reason. Package text does not supply a normalized unit
basis or make incompatible products comparable.

For "cheap" or alternatives, distinguish low reported package outlay from a
good percentage or amount discount. Compare only actual fresh returned records
with compatible context. Keep supplied preferences and limited coverage clear.
An unnamed/incomplete product is insufficient evidence for a useful pick.

## Step 3: Estimate requested quantities through supported arithmetic

Run `python scripts/promotions.py estimate --store STORE_ID --item TOPIC
PRODUCT_ID ITEM_ID QUANTITY --base-url BASE_URL --data-use-approved --json
--no-input`, replacing all named values with accepted inputs. Repeat `--item`
for 1–10 unique product/item pairs, each with whole quantity 1–99; request size
is at most 4 KB. Use `--dry-run` to validate without network or writes.
Use this stateless operation only after selected products/
packages and requested whole-unit quantities are accepted. Supply only actual
returned source-backed IDs, their collection topic and quantities. Never send
caller-supplied prices, choose arbitrary replacement items or initialize/save a
customer basket. The service must recheck current source rights, selected facts
and freshness rather than trusting an earlier client response.

Preserve the returned unit/line amounts, currency, snapshot dates, qualification
and unresolved reasons. Check line arithmetic and subtotal consistency through
the client/service's actual supported calculation. Do not make up totals in
prose when the operation or required inputs are unavailable. Weight-priced,
unknown-quantity, unavailable, stale, incompatible-currency or missing-context
lines remain unresolved as reported.

A reported numerical subtotal with unreported currency is explicitly an
unqualified numerical estimate without a currency symbol. A qualified monetary
subtotal needs compatible source currency/context. Never infer USD from the
store location, combine mixed currencies or label a partial subtotal as the
basket's complete cost. Taxes, deposits, fees, coupons and checkout conditions
remain excluded unless the service actually reports them.

## Step 4: Explain the price or cost and finish

Lead with the named item/package price, or the qualified estimate and its limits.
Show requested quantity and supported line cost where useful. Put unresolved
lines/exclusions beside a partial amount so the person can understand what it
covers. State source collection/check time and finite coverage concisely,
keeping raw IDs/DTO fields as traceability rather than default report columns.

For a budget, compare only a qualified compatible estimate against the supplied
budget. If context or lines are unresolved, explain that the budget fit cannot
be established and identify the missing fact. Suggest alternatives only from
actual compatible fresh returned products; do not promise cheapest storewide,
health quality or a present checkout total.

Historical comparison is a separate requested read. Match exact item/package,
currency/basis and dated observations before claiming a difference. Incompatible
or regular-only historical facts do not establish current promotional savings.
Provide one practical next action and stop; no order, coupon, Cart/session,
customer archive or collector action follows.

## Gotchas

- Whole-package quantity is not a standardized price-per-ounce/pound calculation.
- Regular-only priced products can answer price checks without being good deals.
- Missing currency and missing stock are qualifications, never guessed defaults.
- Partial numeric estimates and qualified monetary totals are different results.

## Checklist

- [ ] Exact store, approved topic, selected package and recipients are accepted.
- [ ] Prices and requested quantities came from actual source facts/user input.
- [ ] Real supported arithmetic, freshness and line/subtotal qualifications match.
- [ ] Unresolved lines, currency and exclusions are clear beside the amount.
- [ ] No live source, purchase, Cart, collection or saved customer basket occurred.

## Recovery from interruption

Recheck changed scope/rights and source facts before recalculating. If a snapshot
changed or item is no longer readable, return to the bounded stored-price read
and preserve the person's intended quantity without substituting another item.
No failure authorizes live lookup, source collection or a guessed price.

## Handoff

Producer: price-check/estimate procedure. Receiver: caller. Deliver named
selected products/packages, requested quantities, supported line/subtotal
arithmetic, qualification/unresolved reasons, source dates/coverage and actual
checks. The caller accepts those meanings before relying on the amount. Return
missing preferences/quantities to the person, collection/rights/service gaps to
the operator, and stop at the requested qualified cost result.
