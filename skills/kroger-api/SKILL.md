---
name: kroger-api
description: Research, design and review Kroger Public APIs and the selected Partner Catalog V2 contract using a maintained official documentation mirror. Use for setup, OAuth, Products, Locations, Cart, Identity and promotion-source qualification; documentation does not grant access.
---

# Kroger API

Produce a source-grounded integration answer, request design or review with exact
operations, required authorization, data-use constraints and verification
gaps. The core requires no particular user, operating system, deployment host or
assistant provider. Bundled tools collect public documentation; they do not call
grocery APIs. Read [the user guide](references/user-guide.md) for step-by-step
installation, configuration and use.

## Core Principles

- Public and partner APIs have different capabilities and eligibility. Visible
  partner documentation does not grant partner access.
- Read `references/api_reference.md` in full before integration decisions. Use
  current operation schemas and retain conflicts with prose/tutorials.
- For Partner Catalog or full promotion-source questions, also read
  `references/catalog-v2.md` in full. Catalog customization, missing offer
  semantics and enumeration gaps prevent a blanket completeness claim.
- Read `references/data-use-and-security.md` in full before retention, shared
  agent endpoints, account linkage or cart design. API access and an open-source
  code license do not establish redistribution rights.
- Missing price/stock remains missing. A store selling a product or an optional
  stock signal does not guarantee checkout availability.
- Keep credentials and private customer information outside assistant context.
  This skill ships no qualified private-data adapter.

## Quick Command

From this folder, read `schemas/command-rules.md` in full, then audit the mirror
without contacting Kroger:

```bash
python scripts/refresh_docs.py --check --json
```

Python 3.11 or later is required by implementation; only Python 3.14 on Windows
has been exercised here. Use `python3` if that names your interpreter. No extra
packages are required.

## Context Requirements

This skill requires:

- Requested result and permitted effects; design/review is the default.
- Intended API family, environment, client type and retention needs as
  non-sensitive facts. Do not request real credentials.
- An accepted relevant official source baseline, with conflicts/gaps read.

This skill produces:

- An integration answer or reviewed contract with source version, authorization,
  input/output meanings, retention and failure behavior.
- A readiness statement separating documented support, local tests, observed UI
  and actual authenticated qualification.

## Use Cases and Scenarios

### Route

Match the first applicable situation and read its workflow before acting.

| User situation | Purpose | Workflow | Expected result |
|---|---|---|---|
| Install, configure or learn this skill | Establish portable setup | read `references/user-guide.md` in full | Local documentation audit or identified prerequisite |
| Refresh sources or investigate a source conflict | Maintain evidence | read `playbooks/maintain-documentation.md` in full | Audited mirror and reviewed changes/gaps |
| Plan account setup or OAuth | Design secure authorization | read `playbooks/setup-and-auth.md` in full | Setup/auth contract with private steps labeled untested |
| Design/review store, product, cart, identity or selected Partner Catalog integration | Bind a documented operation and its actual access/coverage boundary | read `playbooks/main-procedure.md` in full | Operation design and acceptance checks |

## Scenario Workflows

### Procedure Sequence

| Stage and owner | Prerequisites | Output and receiving check | Next / return / stop |
|---|---|---|---|
| Documentation, `playbooks/maintain-documentation.md` | Public source scope; refresh authority when needed | Audit plus article/spec/Terms identity and conflict review | Auth/operation accept baseline; essential source failures return here |
| Auth, `playbooks/setup-and-auth.md` | Accepted sources; environment and client type | Non-sensitive auth design; required human/private-adapter steps | Operation accepts grant/scope contract; setup-only stops |
| Operation, `playbooks/main-procedure.md` | Accepted source/auth contract or verified supplied equivalent | Exact operation, effects, semantics and checks | Caller accepts; missing scopes return to auth; missing sources to maintenance |

Documentation-only and setup-only requests stop at their result. Verified prior
inputs allow direct entry. Resume from actual artifacts and the last accepted
result. Never replay an uncertain registration or cart write. No handoff grants
permission for a later external action.

## Completion Criteria

- Name operation/version and cite relevant official sources, or identify the
  exact missing source and its consequence.
- State grants/scopes, environment, input boundaries, output meanings, data-use
  restrictions and meaningful failure paths.
- Report actual checks with their limits. Designs are not live API successes;
  private execution remains blocked without a qualified bounded adapter.

## Supporting Resources

- For exact operations/conflicts, read `references/api_reference.md` in full.
- For Catalog V2 or full-promotion source qualification, read `references/catalog-v2.md` in full.
- For nontechnical setup and operator/shopper paths, read `references/user-guide.md` in full.
- Before customer data, brand, retention or sharing choices, read `references/data-use-and-security.md` in full.
- Before tools, read `schemas/command-rules.md` in full.
- Before collection maintenance, read `references/collection-design.md` in full.
- Before relying on sources, run the offline audit and inspect the current
  `research/official_docs/manifest.json` plus the relevant complete source.
  If the mirror is absent, follow the user guide's bootstrap steps first;
  supplier documents and local task reports are excluded from the portable core.
- For a non-sensitive handoff, copy `templates/integration-record.md`.
- Before skill changes, read `skill-ci/README.md` in full and accept the actual
  current source/tool baseline. A maintainer may keep separate local research,
  design and evaluation records; these are not installation dependencies.
- When terminology matters, read `vocabulary.yaml` in full.

## Critical Constraints

- Do not read credential files, private pages, callback codes, token responses,
  customer records or filled-page captures into agent context.
- No authenticated API client or credential-entry adapter is provided. Execution
  needs independent qualified private handling or direct human operation.
- Cart writes require an explicit current item/quantity request. Public Cart has
  no documented read/delete/checkout operation in this corpus.
- Do not infer coupons, ads, loyalty or partner capabilities from examples.
- Do not equate an enumerable partner-customized catalog with all promotions.
- Keep required instructions/tools user-, environment- and AI-provider-agnostic.
  `agents/openai.yaml` is optional discovery metadata, never a dependency.
- Third-party source copies retain their rights; publishing them under this
  project's license requires separate redistribution clearance.

## Recovery States

- **Completed:** Requested reference/design/review and applicable checks delivered.
- **Completed with gaps:** Useful bounded findings delivered with named source/runtime gaps.
- **Blocked:** Required source, intent, authority or safe private adapter absent; preserve supported preparation and state the exact prerequisite.
