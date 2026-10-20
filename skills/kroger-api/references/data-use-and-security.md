# Data-use, security and brand boundaries

## Detailed Content

Read the current official [Acceptable Use](https://developer.kroger.com/documentation/public/getting-started/acceptable-use),
[Branding](https://developer.kroger.com/documentation/public/getting-started/branding)
and [Terms](https://developer.kroger.com/terms) before release. Complete copies
and2026-10-19 provenance are in the mirror. This is a source-based issue checklist,
not a legal enforceability opinion or permission grant.

| Material | Published boundary | Integration consequence |
|---|---|---|
| Search/view activity | No tracking/sharing/storage of derived customer behavior | No persistent API-derived preference/history analytics |
| Cart | Add only explicitly requested items; no derived activity tracking/sharing/storage | No silent additions or persistent cart history |
| Temporary added-item display | End data when app/site/browser closes | Do not treat durable local storage as an unrestricted session cache |
| Customer location | No tracking/sharing/storage | Do not log queries, GPS or customer-location associations |
| Profile ID | Display only to associated customer; no mapped customer-data storage/sharing | No profile-ID user table key or cross-service linking |
| Product/store data | Exact display or relevant omission/filtering; no altered values/systematic database gathering | Keep source facts unchanged; no catalog warehouse or retailer comparisons |
| API content copies/cache | Terms5e restricts permanent copies/cache beyond headers absent permission | No invented cache duration; actual response headers/rights still required |
| Shared API | Terms4a restricts substantial API replication/sublicensing | A workflow app/agent endpoint needs actual design and rights review |

An assistant provider can be a third party. Customer OAuth permission does not
automatically permit forwarding API-derived searches, cart activity, profile ID
or location to that provider. Separate user-authored notes from API-derived data
by provenance; renaming a derived record does not change its restrictions.

Terms3d requires an accurate privacy policy;4b requires confidential credentials
and prohibits embedding them in open source. Use installation-owned private
secret storage and fixed status outputs. Never paste credentials into chat,
command lines, online encoders, example configs, screenshots or Git. The official
Quick Start links an online encoder; this skill deliberately does not recommend
sending credentials there. Encoding is not encryption. No secret entry adapter
or isolation enforcement is bundled here.

For a hosted operator, credentials belong in that installation's trusted runtime,
not in a shopper's browser or shared assistant instructions. For a self-hosted
operator, use their own credentials and configuration. PKCE public-client support
does not justify exposing a confidential client secret. Browser/native public
client identifiers still remain outside the workspace agent-context boundary.

Registered application names cannot contain or sound like Kroger or imply
endorsement; names must be unique. This rule concerns the registration/consent
name and does not silently rename a user's repository. Product images retain
their original form, without cropping, overlays or filters. Primary logos need
the qualifying non-monetized Add to Cart use or prior permission; integration
logos have separate conditions. Funding can involve indirect monetization, so
do not assume donation links preserve an exemption. Terms6c prohibits unapproved
endorsement/partnership claims.

Source copies in `research/official_docs/` and reconnaissance are third-party
evidence. Their public availability does not transfer ownership or establish
permission to distribute the full mirror under the project's open-source
license. Retain attribution and resolve publication/packaging separately.

## Key Concepts

Public-source research, shopper API data, user-authored content and project code
have different provenance/rights. No universal privacy or licensing clearance
is claimed from a documentation audit.

## Decision Criteria

Before implementing storage/sharing, identify field origin, purpose, destinations,
retention/deletion and applicable source permission. A missing permission blocks
that dependent feature. Browse-only transient design can proceed independently.

## Constraints & Limits

No private values, token calls, account submissions, live cache headers or live
customer operations were inspected/tested. No generic model-output sanitizer
can be presumed safe. Use qualified deterministic private handling with fixed
results, or direct human operation, before private execution.

## Common Patterns

Report `authorization_required`, `permission_denied`, `request_failed` or
`write_outcome_unknown` from a qualified adapter rather than raw server records.
These are suggested output categories, not an adapter implemented by this skill.
