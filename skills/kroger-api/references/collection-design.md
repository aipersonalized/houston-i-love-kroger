# Kroger documentation collection design

## Detailed Content

### When to Load

Read in full before maintaining the collection utilities.

### Quick Reference

Collect public documentation, never grocery API responses or account state. The
core uses Python standard library (3.11+ implementation prerequisite, observed
3.14/Windows execution) and has no model-provider dependency.

### Source contract

Observed 2026-10-19: developer.kroger.com is Gatsby; ordinary article HTML is a
navigation shell. The official documentation router reads the external content
inventory at `/api/v1/developer/content/manifests.json` and obtains base64 Markdown
from `/api/v1/developer/content/{id}.json`. The article response provides its
canonical URL, category, title and content. Preserve Markdown bytes rather than
converting rendered HTML, so code, tables and publisher comments survive.

The selected corpus is the complete **external documentation navigation**:
Public APIs, publicly exposed Partner API documentation (comparison evidence,
not partner access), and Support Resources. Follow article links by resolving
against this inventory; record links outside this bounded source separately.
API reference specifications and Terms require their own discovered official
source mapping; failure to collect them blocks dependent guidance. Selected
specifications include the five public families and Partner Catalog V2. The
broader Partner operation catalog remains outside this selected scope.

| ID | Operation | Interface | Effects and acceptance |
|---|---|---|---|
| F1 | Discover external articles | fixed HTTPS inventory | Public GET; validate categories and unique URL/ID mappings |
| F2 | Collect article | fixed content endpoint, manifest ID | Public GET; base64/UTF-8/body validation; atomic skill-local files, SHA256 |
| F3 | Reconcile nested links | Markdown links + inventory map | No arbitrary URL fetch; report unmapped links; essential public-source gaps block dependent guidance |
| F4 | Audit mirror | refresh --check | Offline; hashes, inventory totals, safe paths, no failed/unknown pages |
| F5 | Refresh | refresh --refresh | Repeat F1–F3 then F4; preserve prior good article on fetch failure, mark failed |
| F6 | Resume | fetch --resume | Still obtains inventory; reuses only matching source-ID verified files |
| F7 | Collect selected API specifications | fixed public version inventory and document services for five public slugs plus catalog-api-v2 | Public GETs only; source version/ID/shape validation, raw JSON plus lossless Markdown; selected Partner failures block the audit without erasing prior good bytes |
| F8 | Bootstrap independent public Terms capture | refresh --import-terms plus explicit displayed modification date | Offline import into an owned mirror; content-marker checks, no content output, explicit replacement guard; source authenticity/freshness and permissions remain unestablished |

Both tools are single-purpose argparse CLIs, with --help, --json, --no-input,
--dry-run, --verbose, --no-color and --quiet. No prompts or credentials. Human TTY
presentation has orientation/color; machine stdout is one JSON object when
requested. Exit 0 complete; 1 incomplete/failed audit; 2 invalid input; 130
interrupted. Errors are fixed categories with recovery advice, never server
bodies or private inputs. Request starts are sequential and spaced at least one
second. Up to three total attempts (two retries) for 429/5xx/transport errors, bounded Retry-After/backoff;
if a requested wait exceeds 60 seconds, stop rather than evade the limit.

## Key Concepts

The source is a moving external documentation revision, not a pinned API release.
Record publisher review comments where present and content fingerprints.

## Decision Criteria

Reject changed content shape, redirects outside the official host, empty/shell
articles, path collisions, missing IDs and duplicate URLs. Inspect unknown links;
the one known partner-only cross-link remains a disclosed nonblocking gap, not
an accepted complete-site claim. Exact current policies live in command rules.

## Constraints & Limits

No cookie jar, authorization headers, environment credentials, API execution,
registration or browser access. A successful offline audit establishes mirror
integrity; it cannot establish remote freshness or account entitlements.

## Common Patterns

Use a temporary directory for synthetic failure tests. Do not delete unrelated
files or claim that public partner documentation grants partner API access.
Pending removals survive repeated collection until reinstatement or an explicit
offline --accept-removed disposition after source/consumer review. That mode
records the review and preserves files; refresh never acknowledges itself.
