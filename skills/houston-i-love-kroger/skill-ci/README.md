# Companion skill maintenance and qualification guide

## Who

People use the app directly; permitted agents use its app API in parallel for
current shopping or separate stored deals/history. Maintainers
own source/contract reconciliation. An
independent reviewer assesses the actual candidate and evidence. If model trials
are explicitly requested later, an orchestrator assigns a fresh trial agent and
separate reviewer; the author does not call a static walkthrough a trial.

## What

Supported tasks include current ZIP choices, requested product/promotion
searches, exact product rechecks and fresh selected-quantity estimates. Stored
tasks remain setup help, saved ZIP choices, completed-topic discovery,
latest completed store/topic snapshots, stored
item price checks, requested-quantity/budget estimates and separate history
search/retrieval. The person confirms the exact returned store or reuses a valid
confirmation. Live shopping calls only the app, which can query the source;
stored mode never refreshes it. Neither mode starts collection or Cart.
A useful shopping answer explains supported discounts and low whole-package
prices separately, matching supplied preferences. It preserves store/topic,
snapshot/observation dates, age and bounded coverage, full source facts,
separate arithmetic and missing unit/history facts without a raw DTO dump.
Missing authority blocks dependent data exposure while setup/manual guidance
remains useful. Required inputs and effects are owned by `SKILL.md` and its
procedures, not by a maintenance record.

## When

Review after a concrete failure, app contract/source change, host/tool change,
new intended use or an explicit review request. Recheck permission when its
actual recipients, scope or validity change. Do not turn this into repeated
confirmation for unchanged established authority.

## Where

The retained design is `skill-ci/skill-design.md`; findings/source scope are in
`research/research-brief.md`. The selected first-party manuals are under
`research/official_docs`, with inventory and hashes. Commands are in
`schemas/command-rules.md`; scripts are locally self-contained. Synthetic static
cases are in `evals/scenarios.json`. Creator validation can write a local
report under the ignored `evaluations/` directory; generated reports and
private maintenance records are not part of the public skill. Return
deterministic source-tool results to the caller's designated record owner.

## Why

Exact store/topic identity, sample limits and incomplete source fields make an answer
misleading if context is dropped. Supplier/user authority and a tool's real
recipients must be checked before exposure. Old regular prices, package text or
synthetic fixtures cannot repair missing historical or normalized-unit facts.
Stale/no-data and fresh empty snapshots differ; none triggers live-source or
history fallback. A failed attempt does not refresh the last completed sample.

## How

For a revision, inspect the current design, source inventory, complete affected
sources and actual app implementation. Refresh the selected manuals using the
documented local CLI and reconcile changed instructions; hashes alone do not
prove comprehension. Preserve the development record and unrelated work.

Run the creator's canonical artifact checks and workflow validator within the
authorized report-writing scope. Run local source-tool and promotion-client tests and review
their actual limits. Walk through the static scenarios, including returns and
resumption; report them as authored trace checks.

For requested model trials, supply realistic permitted installation/input/tool
context and natural task requests to fresh agents, without evaluation hints.
A separate reviewer checks available execution history, artifacts and outcome,
reports exact root causes and missing evidence, and returns fixes to their owner.
After corrections, repeat affected checks and only authorized trial cases. No
model tests, live searches or private account reads were performed by authoring.

## Quality Criteria

- Exact store/topic, source, snapshot/observation dates, freshness and limited
  coverage survive every handoff; request time never substitutes for observation.
- Full source facts and calculations are distinguishable; no silent truncation.
- Fresh empty, no completed collection, stale, permission-required and failed
  reads remain distinct. Missing unit basis and price qualification stay explicit.
- Setup facts, instructions and actual live success are not conflated.
- Source rights are matched to real recipients; no assumed universal agent ban.
- Commands, paths, snapshots, documented exits and recovery match implementation.
- Useful shopping picks explain supported value versus low package outlay;
  unnamed/incomplete rows and stale/expired data never get invented recommendations.
- Price/quantity estimates use real source-backed arithmetic, distinguish
  complete line coverage from checkout cost, and disclose partial sums,
  unresolved lines and unknown/mixed currency/context without inference.
- A task finishes at its bounded current or stored result; no purchase,
  collection, Cart or silent source/history fallback follows.
- Current source/page/store/date/estimate bindings are checked, with unknown
  currency, unresolved groceries and nonexhaustive coverage explicit. Full
  source-record mode acknowledges reviewed actual recipient controls.

## Evaluation Evidence

Static and deterministic check results must identify their candidate and method.
The workflow report covers structure, links and recovery-section presence only.
The documentation audit covers the selected bytes/inventory, not legal rights,
hosted availability or agent compliance. Independent review and model/live
qualification remain separate gates. Any future evidence must say exactly what
ran; no passing source check substitutes for an unobserved session.
