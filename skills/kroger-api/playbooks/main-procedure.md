# Design or review a documented operation

## Continued From

The operation route in SKILL.md, after accepting current sources and auth design
or a supplied verified equivalent. Deliver a contract/review, not a live request.

## Resources

Read `references/api_reference.md`, `references/data-use-and-security.md` and
`templates/integration-record.md` in full. Read the exact chosen operation in
`research/official_docs/specs/` and the corresponding public article in full.
For Catalog V2 or a complete-promotion request, read `references/catalog-v2.md`
in full; its selected contract and extra source-qualification gates apply.

## Step 1: Bind the requested result

Identify browse, cart-add, profile-ID or Partner catalog/promotion purpose, environment, client type,
permitted effects and non-sensitive inputs. Reject assumptions of coupon,
checkout, cart-read or partner entitlement. If authentication design is missing,
return to `playbooks/setup-and-auth.md`; source gaps return to maintenance.

## Step 2: Bind the operation and semantics

Name exact family/spec/version/method/path, assigned-scope prerequisite, input types,
filters, successful status and missing fields. Preserve strings with leading
zeros. Use explicit conservative list limits where sources disagree. For
store-specific product facts, bind the location context and ID-filter caveat.
Keep source text/price/images unchanged and stock advisory.

For Catalog V2, distinguish descriptive products, inventory/price rows and
disabled items. Apply its exact store/fulfillment context and source conflicts;
do not reuse the Public Products price model. A full-promotion requirement also
needs the authoritative scope, offer semantics, enumeration/recovery,
accountable processing and actual reconciliation gates in catalog-v2.md.
Missing entitlement or completeness evidence blocks that claim, not unrelated
documented design work.

## Step 3: Specify effects, privacy and recovery

For Cart, require an explicit current item/quantity request and customer consent;
handle204 without parsing JSON. Timeout/transport failure is an unknown write,
not an automatic retry. Public Cart cannot read back or undo it. Direct the
person to their Kroger cart for reconciliation through private handling. No
private invocation is permitted without a qualified adapter. Specify transient
display deletion and no derived activity/customer-location/profile-ID storage.

## Step 4: Check and deliver

Use the integration template, with official citations, known conflicts and
planned acceptance cases. For review, separate demonstrated defects from
untested behavior. Cover400validation,401expiry,403scope,404missing and transport
failure relevant to the operation. Stop after the requested contract or review.

## Gotchas

A204acknowledgment does not prove checkout, stock, price or purchase. Do not
substitute partner operations to fill a public workflow gap.

## Checklist

- [ ] Exact operation family/version and documented authorization identified.
- [ ] Source conflicts, missing fields, effects and data-use boundaries retained.
- [ ] Evidence distinguishes design, local tests and live qualification.

## Recovery from interruption

Inspect the accepted contract/source revision. Resume the unfinished design;
never repeat an uncertain registration, code exchange or cart write to reconstruct
state. Preserve useful non-sensitive evidence without customer-derived records.

## Handoff

Producer:this procedure. Receiver:caller or authorized implementation owner.
Deliver the integration record/review, source versions, checks and gaps. Receiver
accepts source/auth identity and safe execution prerequisites before any use.
Return missing auth to setup and source defects to maintenance. Stop here.
