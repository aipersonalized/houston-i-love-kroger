# Companion operational-use design

The accepted task is ZIP → nearby stores → exact store → bounded reported
promotions, with current savings, available estimates and qualified prior
observations. Audience: people and their permitted agents. The skill is an
authored provider-neutral candidate, not a live-qualified shopping service.

## Scope and baseline

The original development scaffold contained no operational procedures. Keep
local development records outside the public distribution. Keep one skill,
two procedures, concise interpretation/permission references, a human installation
guide and a report contract. Do not add an agent host integration or HTTP client
when a host's existing permitted tool can perform the documented requests.

The generated example helper/asset and optional provider metadata were retired
after dependency inspection. The portable skill has no provider-specific runtime
dependency. Local development archives are outside its distribution.

## Sources and decisions

The first-party inventory selects API, human-use, self-hosting, history and
permission-question documents. Exact copies and hashes live in
`research/official_docs`; the package version plus working-document hashes
identify the snapshot. No deployment or release is inferred from that version.
The source owner remains the app's `docs/` tree. Relative links inside source
copies retain their original source context; external/unselected linked material
is outside collection scope and is not silently treated as read.

Local collection and audit CLIs are deliberately specific to these five public
files. They never scan the repository, read `.env` or runtime databases, or make
network requests. This satisfies the selected first-party documentation gate
without inventing a Node/framework tutorial dependency. Audits establish bytes
and accounting; instruction meaning and actual agent behavior need separate work.

## Feature and verification map

| Feature | Status | Owner / acceptance evidence |
|---|---|---|
| Store/sample/search/report workflow | Authored | Main procedure; exact ID, bounded scope, raw/calculated separation. |
| Setup and recovery | Authored | Setup procedure; configured status distinct from live access. |
| Recipient/source-permission gate | Authored | Permission reference; unknown authority blocks payload exposure, not every form of guidance. |
| Human skill/app installation and use | Authored | User guide plus selected complete app manuals. |
| Unit estimates and history states | Authored | API reference/output contract; absent basis and failed/pending/empty states remain distinct. |
| Documentation fetch CLI | Implemented, locally exercised | Allowlisted local files, five exact source snapshots. |
| Documentation audit/refresh CLI | Implemented, locally exercised | Hash/accounting checks and source-drift detection; no network. |
| Source inventory, mirror and version record | Collected | Manifest/exclusions; package version plus exact document hashes. |
| Source reading and manual reconciliation | Performed for selected scope | Research brief; source price/date/history decisions traced to app docs/source. |
| Static workflow/template/link checks | Passed bounded checks | Nine canonical checks and workflow validation with zero findings; no behavioral assurance. |
| Synthetic collector/audit boundary tests | Passed 8 tests | Standard-library tests, including quoted/padded paths; no grocery fallback data. |
| Independent review | Accepted with disclosed limits | Independent read-only review passed eight tool tests, nine canonical checks, current five-page source audit and static task walkthroughs; root's project record owns the receiving result. No model trial or live qualification. |
| Model trials, live API and actual host discovery | Unperformed | Explicit future task/permission required. |
| Purchases, customer accounts, coupons and collector execution | Outside shopping scope | Separate tasks/owners; no implied authorization. |

## Procedure sequence and handoffs

Setup accepts actual installation and tool/privacy context and returns observed
status or a precise gap. Shopping accepts equivalent current inputs directly,
checks recipients, resolves exact store, requests a bounded set and returns the
output-contract meanings. Setup-only stops without a search. An accepted store
can skip ZIP discovery; a rejected store or stale response returns to identity,
not an automatic first-result choice. Changed recipients return to permission.

Static walkthroughs cover success, direct entry, missing ZIP/store choice,
unconfigured status, source permission unknown, empty results, one supplied unit
estimate, failed history read, certification mismatch and stale response. They
are authored trace checks, not observations of an agent following the skill.

## Tool design and recovery

`fetch_docs.py --url repo:/ --output research/official_docs` copies only the
reviewed five source files. `refresh_docs.py --check` audits locally; an explicit
`--repository` also checks current source drift. `--refresh` recollects and audits.
Shared internal code owns validation and file accounting. Expected failures are
typed with recovery, JSON is clean, terminal messages are labeled, and no mode
prompts. A single-purpose utility has no menu. Atomic file replacement is not a
multi-file transaction; after interruption run the audit before accepting the
snapshot. Never infer retention rights from collection of these public manuals.

The step-listing utility retains default Markdown output and adds help, JSON,
noninteractive/color controls and fixed errors. It is discovery only, not a
catalog client or procedure executor. Terminal presentation and interruption
signals remain unobserved; captured help/JSON/error behavior has its own scope.

## Remaining qualification

The project-authored source and companion use the root MIT LICENSE. Public
deployment, live Kroger access, underlying catalog forwarding/retention rights
and host/model behavior are not established here.
Human browser evidence belongs to the app owner. Review any source changes and
repeat only checks affected by them. No model trial runs without an explicit
request covering its recipients, data, cost and effects.
