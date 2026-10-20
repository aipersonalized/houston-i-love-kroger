# Kroger API improvement guide

## Who

People and assistants designing/reviewing Public APIs and the selected Partner
Catalog V2 contract. A maintainer
owns sources/tools; a separate reviewer checks candidate evidence. Model-based
blind trials are separate, require an explicit request and were not run here.

## What

Support public setup/auth, Products/Locations browse contracts, customer Cart
addition, profile-ID boundaries and complete-promotion source qualification.
Useful results cite exact source/version,
preserve data-use restrictions and distinguish documented support from live use.
Inputs are non-sensitive intent, client/environment facts and accepted sources.

## When

Review after source/version changes, observed wrong answers, runtime changes,
new intended capabilities or an explicit user review request. Do not expand into
undocumented grocery endpoints or add private access to fix a source gap.

## Where

SKILL.md routes; playbooks own procedures; references own API/security/user
guidance; schemas own CLI contracts; scripts own collection; research/official_docs
owns locally collected third-party evidence. The portable source/bootstrap
contract is in [command rules](../schemas/command-rules.md) and
[collection design](../references/collection-design.md). A maintainer may keep
research, design, audit and independent-review records privately; they are not
required installation files and their historical results do not qualify a new
checkout or changed source version.

## Why

Official sources differ on limits/lifetimes, include broader partner examples and
restrict persistent customer behavior/sharing. Source fidelity and explicit
qualification prevent plausible but unauthorized/unreliable integration advice.

## How

Use synthetic inputs for local tests. After an authorized behavioral-evaluation
request, an evaluator defines bounded scenarios and dispatches a fresh agent with
a natural request without evaluation hints; an independent reviewer checks result
and available execution evidence. No model trial is implied by routine editing.
Return defects to their source/contract/tool owner, correct within scope, rerun
affected checks and only then repeat an authorized trial. Never request secrets
or expose customer activity to make evaluation convenient.

## Quality Criteria

Portable core, accessible nontechnical install/configure/use, exact public scope,
complete selected source accounting, lossless code/tables, no invented privileges,
clear missing-field/uncertain-write handling, clean noninteractive tool outputs,
source rights separation and honest platform/API evidence limits.

## Evaluation Evidence

[Synthetic tests](../evals/test_docs.py) exercise parser boundaries, offline
integrity, selected Partner source accounting/failure recovery and public Terms
bootstrap. They require a locally collected mirror; follow the user guide first.
Record actual command results, source versions, static walkthroughs and missing
live/model evidence at the maintainer's local evidence owner. Do not distribute
task reports or supplier originals merely to make those records reachable.
