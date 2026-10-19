---
type: research
title: "Research: operational companion for the app"
sources:
  - id: api
    url: "repo:/docs/API.md"
    title: "App HTTP API"
    author: "Houston I Love Kroger project"
    published: null
    accessed: "2026-10-19T15:54:54.429208+00:00"
    type: local-first-party-document
    hash: "952fe1eb5bc032e013060ac915dbfea212b685456044233146678c0e1fb08677"
  - id: user-guide
    url: "repo:/docs/USER_GUIDE.md"
    title: "Human shopping guide"
    author: "Houston I Love Kroger project"
    published: null
    accessed: "2026-10-19T15:54:54.429208+00:00"
    type: local-first-party-document
    hash: "84100de326315634d7708cfe93a93044f9b24e6fcfc7391ad3701c4603f4ec0d"
  - id: self-hosting
    url: "repo:/docs/SELF_HOSTING.md"
    title: "App installation and configuration"
    author: "Houston I Love Kroger project"
    published: null
    accessed: "2026-10-19T16:22:45.728551+00:00"
    type: local-first-party-document
    hash: "d36159f8c35c1507e929c581815f733e31a08cd45c258b16bcc76a402f27fa44"
  - id: history
    url: "repo:/docs/HISTORY.md"
    title: "History prerequisites and operator boundary"
    author: "Houston I Love Kroger project"
    published: null
    accessed: "2026-10-19T15:54:54.429208+00:00"
    type: local-first-party-document
    hash: "6288e7b43fa59da725c35d27962ae8165d3940f196b1710393adbad3e53030bd"
  - id: kroger-permission-request
    url: "repo:/docs/KROGER_PERMISSION_REQUEST.md"
    title: "Source-permission questions, not a grant"
    author: "Houston I Love Kroger project"
    published: null
    accessed: "2026-10-19T15:54:54.429208+00:00"
    type: local-first-party-document
    hash: "55644461f1384cf564404ed6ac2e8d0e0a54328f38b19c5c1030ee6d5aeac598"
provenance:
  generated: researched
  generated_by: agent
  generated_at: "2026-10-19T15:54:54.574114+00:00"
  method: "local first-party collection, complete document review and app source inspection"
trust_tier: source
stale_after: 2027-04-17
summary: "The implemented app supports exact-store bounded comparisons; source recipients and missing history/unit context remain explicit gates."
---
# Operational companion research brief

## Task and resolved scope

The accepted first-release flow is ZIP → nearby Kroger stores → an exact chosen
store → current qualifying promotions, current regular/promo savings, available
unit estimates and properly qualified prior observations. The original scaffold's
meal-planning/cart possibilities are not implemented shopping capabilities.

## Collected primary sources

The selected official inventory is this project's five first-party app manuals,
not an internet tutorial. Exact source bytes, code fences, tables and wording are
preserved in `official_docs/pages`; `official_docs/manifest.json` owns the
observed package version, hashes, timestamps, page accounting and working-tree
snapshot identity. No commit, release or deployment is inferred. Local
`fetch_docs.py` and `refresh_docs.py` have both run; five pages, zero failures and
four reviewed exclusions reconciled. Current-source hash checking also passed.

Publication preparation refreshed the selected snapshot at 16:22 UTC on
2026-10-19. The updated self-hosting manual replaces a local technology-skill
dependency with official portal instructions and makes registration and live
qualification limits explicit. It was read and reconciled with the setup
procedure; the source hash above matches the current manifest and exact copy.

The docs' original publisher/source context remains at the app's docs directory.
External links and unselected source families are exclusions, not assumed-read
pages. No shopper records, private settings, accounts or live catalog responses
were collected. The source scope and tools are specific to this app.

## Findings that change instructions

1. **Identity precedes price:** ZIP discovery returns up to ten stores within
   ten miles. Full name/address/eight-character ID distinguish similar locations.
   The response scope must match the current accepted store and query.
2. **Coverage is bounded:** no term requests milk/bread/eggs, fifteen products
   each. A term requests one page of at most fifty products. Neither is a complete
   promotion, weekly-ad or coupon feed. Empty results do not establish no deals.
3. **Source and calculation differ:** source descriptions/prices remain complete;
   savings use only the current regular/promo pair. Qualification excludes
   unusable price/date/inventory/context cases rather than fabricating values.
4. **Unit basis is missing:** the public schema supplies estimates but no
   standardized measure. Either estimate can be absent. Keep supplied precision
   and never derive a basis from package text.
5. **History needs permission and context:** searches do not populate the
   database. Provider availability, item permission, zero observations,
   insufficient/incompatible history and failed reads are distinct. Certification
   quotes return `history_environment_mismatch` instead of production history.
6. **Qualified arithmetic is bounded:** prior values have dates/source labels;
   a qualified non-null delta can accompany one prior observation without
   establishing a trend. A collected low covers retained prior rows only.
7. **Recipients matter:** the app does not itself forward to an external AI
   service. A browser/HTTP tool may expose responses to one. Match reviewed source
   rights and user privacy to actual processors; neither universal permission nor
   a universal agent ban follows from public API availability.
8. **Setup is a different result:** configured status means settings are present,
   not that credentials work. The original project materials use the repository's
   MIT LICENSE; a public hosted address remains unestablished. Instructions are
   not an executed installation.

The selected API, human guide, self-hosting, history and permission-question
manuals supply these facts. App source inspection included request/ranking,
source normalization, UI state and history-provider contracts. Supplier policy
rights are not established by the app's descriptions or its permission draft.

## Design consequences and source gates

One provider-neutral skill uses two procedures with direct entry: shopping and
setup/recovery. Exact HTTP fields remain in the collected API contract.
Interpretation, recipient decisions, human installation and output meanings have
small dedicated owners. The optional standard step utility is retained; no new
catalog client is needed. Maintenance tools only collect this explicit public
manual inventory and audit source drift, so no runtime tutorial or new data
recipient is introduced.

Static walkthroughs and deterministic filesystem/tool tests do not prove an agent
will choose or obey the skill. Independent review and live/model/host evidence
remain separate. No model trial, browser workflow, private call or live API search
was executed by companion authoring.

## Remaining uncertainty and freshness

Actual live entitlement, source retention and automated-recipient permission,
public hosting and host/model behavior are unresolved. MIT is selected for the
original project materials; supplier data and third-party rights remain separate.
Database collection stays separately gated. Re-read changed app sources and
refresh/reconcile affected instructions immediately when hashes change; the
staleness date is an outer review reminder, not permission to ignore known drift.
The original development project record retains its separate writer and was not
modified by this work.
