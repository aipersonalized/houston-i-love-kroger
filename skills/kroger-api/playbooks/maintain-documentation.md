# Maintain official documentation

## Continued From

SKILL.md documentation route, or auth/operation work with an essential source
gap. This route is independent when only maintenance is requested.

## Resources

Read `schemas/command-rules.md` and `references/collection-design.md` in full
before commands. Inspect the current generated mirror manifest. If missing,
follow the bootstrap steps in `references/user-guide.md`. Read the changed official
articles/specs in full before changing dependent guidance.

## Step 1: Inspect the baseline

Run `python scripts/refresh_docs.py --check --json`. Check manifest versions,
retrieval times, Terms capture age and the requested decision's freshness need.
An offline pass proves local integrity, not current remote content or rights.

## Step 2: Collect current public sources when needed

Run `python scripts/refresh_docs.py --refresh --json` within collection authority.
For a new empty mirror use fetch_docs.py with explicit --url and --output per
the command contract. Tools use no credentials/cookies. Preserve prior good
files on failures; never relabel failure as exclusion. `--repair` reuses verified
IDs and cannot prove unchanged remote content; a full refresh does.

## Step 3: Reconcile changes and gaps

Balance42/current navigation pages as saved/excluded/failed, plus separate public
spec resources, including selected Partner Catalog V2. Review newly introduced categories/versions before expanding
scope. Inspect nested links and distinguish broken partner cross-links from
missing required public sources. Review source code/tables and compare spec JSON
with fenced Markdown. Browser Terms is independent: obtain a fresh public-only
main-article capture with provenance through supported human/browser handling.
An operator can import an explicitly supplied public UTF-8 article using the
offline --import-terms mode in the command contract. This checks expected
content markers, not remote authenticity or freshness. Automatic HTTP refresh
does not refresh it. Never inspect private tabs.

## Step 4: Accept or return the source baseline

Run the offline audit after refresh, record source/version changes, code/table
comparison, failures, Terms freshness and affected consumer decisions. Required
public article/spec/Terms failures block dependent guidance. A broken irrelevant
partner cross-link can remain an explicitly bounded gap. Stop on an unchanged
access blocker rather than hammering servers or adding credentials.

Pending removed-source URLs survive repeated refresh/repair. Review the old
source, surviving consumers and disposition before accepting one with the
separate --accept-removed/--review-note command in the command rules. It records
your review and preserves source files; rerun --check afterward. Reinstatement
clears a pending removal automatically, but a later new removal needs review.

## Gotchas

HTTP200 may be a Gatsby shell. The collector decodes actual public Markdown and
validates versioned JSON. Source copies do not acquire project licensing rights.

## Checklist

- [ ] Inventory/versions and required source files reconcile; hashes pass.
- [ ] Actual refresh, code/table fidelity and Terms freshness are distinguished.
- [ ] Changed facts, exclusions and failures are reported with their effects.

## Recovery from interruption

Inspect manifest and actual files. Resume with --repair only for verified prior
pages; use --refresh when current remote content is required. Preserve independent
good files and do not delete unrelated data or recreate private browser state.

## Handoff

Producer:documentation maintenance. Receiver:caller for maintenance-only, otherwise
auth/operation design. Transfer accepted source versions, timestamps, audit and
conflict/gap notes. Receiver checks relevant source sufficiency; essential missing
evidence returns here. No source collection authorizes grocery API execution.
