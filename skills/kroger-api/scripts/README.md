# Public documentation tools

## Quick Start

From the skill folder run `python scripts/refresh_docs.py --check --json`.
Run either fetch_docs.py or refresh_docs.py with --help for its options.

## What It Does

- Fetch complete current external articles, five Public API specifications and
  the selected Partner Catalog V2 specification.
- Refresh the mirror and report failures/link gaps.
- Audit local source identities, files, hashes and coverage without network.
- Record a deliberate removed-source disposition after source/consumer review,
  preserving old files; ordinary refresh cannot clear this gate itself.
- Import a separately supplied complete public Terms text into the local mirror,
  with a displayed modification date and an explicit existing-capture guard.
- List playbook steps with `python scripts/list_skill_steps.py`.

## Requirements

Python3.11+ standard library. Tested Python3.14/Windows only. No Kroger account,
API secret, additional package, assistant provider or fixed installation path.
Full Terms input is separately captured, not refreshed by the HTTP tools.
Supplier originals and task reports are excluded from the portable distribution.
For a new checkout, follow the user guide's local source-bootstrap steps before
expecting an offline audit or mirror-dependent tests to pass. Collecting documents
does not grant grocery API access, data retention or redistribution permission.

## Examples

```bash
python scripts/refresh_docs.py --check --json
python scripts/refresh_docs.py --refresh --json
python scripts/fetch_docs.py --url https://developer.kroger.com --output research/official_docs --resume --json
python scripts/refresh_docs.py --import-terms public-terms.txt --publisher-modified YYYY-MM-DD --json --no-input
```

Read [command rules](../schemas/command-rules.md) before use and
[the user guide](../references/user-guide.md) for plain-language setup/recovery.
No tool executes grocery APIs or supplies private credential handling.
