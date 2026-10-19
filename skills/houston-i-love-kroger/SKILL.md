---
name: houston-i-love-kroger
description: "Use the Houston I Love Kroger app to find a ZIP-area store, choose its exact location and compare a bounded set of reported promotions, savings, unit estimates and qualified collected history. Also guide installation and recover from setup or search failures."
---

# Houston I Love Kroger

Return a store-specific comparison using the app's actual response, or a clear
explanation of the missing connection, permission or data. Help a person install
and use the same app without choosing an AI provider or assuming a public host.

**Readiness:** authored operational-use candidate for API version 1. Local
documentation and deterministic checks are separate from live API entitlement,
hosted availability and observed agent performance. None of those latter checks
is established by this skill. A proposed public URL is not a deployed service.

## Core Principles

- Bind every price to the user's exact chosen store, request scope and retrieval
  time. A bounded sample is not every promotion at the store.
- Keep source descriptions and prices separate from calculated savings. Current
  regular price is never a substitute for a prior promotional price.
- Establish the actual permitted data recipients before catalog access. Local
  agents and external model providers can have different permission boundaries.
- Report missing unit basis and historical evidence directly. A connection
  failure, empty history and absent source permission are different outcomes.

## Context Requirements

This skill requires:
- The installation's actual base URL, ending in `/`, and a browser or HTTP tool
  whose data handling is permitted for this task. No customer account is needed.
- A five-digit US ZIP through a channel allowed by the user's privacy rules,
  followed by the person's exact store choice or an already verified store ID.
- Source permission and user authorization covering the actual agent, provider,
  transport, display and retention involved; reuse valid established authority.
- Optional grocery/brand term and ranking preference. Default to the bounded
  starter sample and dollar savings when those choices are not supplied.

This skill produces:
- A current store-specific comparison with full descriptions, source prices,
  calculations, dates, unit/history limitations and bounded scope; or an explicit
  blocked/empty/error result with the next practical action.
- For setup requests, ordered installation/configuration guidance and the actual
  checks performed, without credentials or an invented deployment claim.

## Use Cases and Scenarios

### Route

Match the first applicable situation. Read the named playbook in full.

| User situation | Purpose | Workflow | Expected result |
|---|---|---|---|
| Install the skill/app, check setup, or recover a failed connection | Establish a usable permitted installation | read `playbooks/setup-and-recovery.md` in full | Working prerequisite checks or a bounded setup gap |
| Find nearby stores, choose a store, compare or refine its promotions | Use the actual app contract | read `playbooks/main-procedure.md` in full | Sourced comparison or explicit missing prerequisite/data |
| Buy groceries, manage a cart, clip coupons, or collect history | Recognize the capability boundary | read `references/api_reference.md` section "Scope and effects" | Explain the separate owner; no purchase or collector action |

## Scenario Workflows

### Procedure Sequence

| Stage / owner | Prerequisite and output | Receiving check | Next / return / stop |
|---|---|---|---|
| Setup, `playbooks/setup-and-recovery.md` | Actual base URL, host/tool capability and privacy context → observed status or exact missing dependency | Shopping procedure verifies current recipient permission and usable connection | Enter shopping only if requested; setup-only stops |
| Shopping, `playbooks/main-procedure.md` | Accepted access context → ZIP/store choice → bounded search → report | Caller checks store, scope, full source facts and unknowns | Complete, or return setup failures to setup; missing store preference returns to user |

Direct shopping entry is allowed with current equivalent inputs; do not repeat
setup or ask for authority already established. A supplied exact store choice
can skip ZIP discovery after confirming its identity. Changed store, query,
recipient or environment invalidates dependent results. Setup and shopping are
alternatives for single-purpose requests, not a reason to run both every time.

## Completion Criteria

- The requested comparison or setup result exists and follows
  `schemas/output-contract.md`; no response from an old store/query is reused.
- Every offer is traceable to the accepted app response, exact store, scope and
  retrieval time, with raw facts and calculations distinguishable.
- Empty results, unknown history, missing unit basis, test data and permission
  gaps remain visible. Stop when that requested bounded result is delivered.

## Supporting Resources

- Before requesting catalog data, read `references/source-permissions.md` in full.
- Before app requests or interpreting results, read `references/api_reference.md`
  in full; read `research/official_docs/pages/API.md` in full for exact fields,
  error categories and limits.
- Before returning a comparison, read `schemas/output-contract.md` in full.
- For human installation and use, read `references/user-guide.md` in full.
- Before documentation maintenance or the optional step-listing command, read
  `schemas/command-rules.md` in full.
- Before revising this skill, read `skill-ci/README.md`,
  `skill-ci/skill-design.md` and `research/research-brief.md` in full. The
  development project record has a separate writer and is not a shopping input.

## Critical Constraints

- Use only the selected installation and documented operations. No cart,
  checkout, account access, coupon action or history ingestion is authorized by
  a deal-comparison request.
- Do not infer third-party forwarding rights from API availability or the user's
  request. Do not invent a universal ban on agents either; check actual scope.
- Keep protected values, credentials and raw private records outside model
  context. A tool that automatically exposes disallowed payloads is unsuitable.
- Preserve full source descriptions and IDs, missing facts and monetary units.
  Do not compare this feed with competing retailers or harvest it into a cache.
- Do not label an unqualified estimate as `$/oz`, `$/lb` or a known per-item
  measure, fabricate prior prices, or call a collected low an all-time low.

## Recovery States

- **Completed:** the requested task and applicable checks are satisfied; live
  claims describe only the actual session and response observed.
- **Completed with gaps:** a useful bounded comparison or setup explanation is
  delivered with missing optional prices/history or untested conditions named.
- **Blocked:** required installation, exact store choice, permitted transport or
  source authority is absent. Give the smallest resolving action and stop the
  dependent operation while preserving useful permitted guidance.
