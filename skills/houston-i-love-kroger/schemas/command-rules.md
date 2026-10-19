# Input and output rules

## When to read this

Read this file in full before running the skill's documentation tools or its
optional step-listing utility. Run examples from the skill folder. App requests
are owned by the collected API manual, not these maintenance commands.

## Inputs and outputs

### Read-only step listing

```text
python scripts/list_skill_steps.py
python scripts/list_skill_steps.py --json --no-input --no-color
```

This utility reads the local playbooks and prints Markdown headings by default.
It also accepts --json, --no-input, --no-color and --help; no mode prompts or uses
credentials/network inputs. Exit 0 means listing succeeded, 1 means unavailable
or unreadable playbooks, 2 means invalid arguments, and 130 means interruption.
It neither executes the procedures nor qualifies their behavior. JSON execution
returns one object; help is normal usage text. Expected errors are fixed messages
without raw exception details.

### Documentation collection

Requires Python 3.12 or newer, standard library only; executed with Python 3.14.
The collector accepts only the reviewed first-party `repo:/` inventory:

```text
python scripts/fetch_docs.py --url repo:/ --output research/official_docs --json --no-input
```

The repository defaults to the app checkout containing this skill. If installed
elsewhere, provide `--repository` with the actual app folder. No URL fetch,
account access, API search, private settings or runtime database read occurs.
The inventory allowlists API.md, USER_GUIDE.md, SELF_HOSTING.md, HISTORY.md and
KROGER_PERMISSION_REQUEST.md from the app's docs folder. Every selected source
must be substantive UTF-8 Markdown and no more than one megabyte. Linked paths,
unsupported files, traversal and output outside this skill's exact
research/official_docs folder are refused.

Collection reads all selected sources before publishing any page, preserves
exact bytes including code blocks, and writes per-page hashes and source identity,
counts, package version, observation time and reviewed exclusions. Files are
replaced atomically one at a time; the manifest is written last. This is not a
multi-file transaction. An I/O interruption after writes start can leave a mixed
snapshot that must fail audit; do not accept it as a completed collection.

### Documentation audit and refresh

```text
python scripts/refresh_docs.py --check --json --no-input
python scripts/refresh_docs.py --check --repository ../.. --json --no-input
python scripts/refresh_docs.py --refresh --repository ../.. --json --no-input
```

`--check` is read-only and local-only. It verifies the selected inventory, source
identities, version metadata, counts, complete page presence/hashes, exclusions
and absence of unaccounted pages. Without `--repository`, source freshness is
explicitly not checked. With it, the audit compares package version and every
selected current document hash. `--refresh` recollects the reviewed inventory,
then audits it. A changed source invalidates dependent instructions until it is
read and reconciled; matching hashes do not prove comprehension.

Both documentation CLIs accept `--json`, `--no-input`, `--no-color`, `--verbose`
and `--help`. No mode prompts. `--json` emits one clean object; `--verbose` adds
per-page relative identities/hashes. Help prints normal usage and exits 0.
Human execution prints labeled success/error messages, with color only on a
capable terminal unless NO_COLOR or --no-color disables it. Single-purpose
commands have no menu. See scripts/README.md for the short introduction.

JSON success has `ok: true` and `result`; failure has `ok: false` and an `error`
with fixed `code`, plain-language `message` and `recovery`. No private paths,
credentials, raw file errors or catalog payloads are printed.

### Deterministic source-tool tests

```text
python -B -m unittest discover -s tests -p test_documentation_tools.py
```

Tests use a disposable synthetic filesystem and standard library only. They
check exact bytes/repeated refresh, corruption, current-source drift, missing
source, allowlist enforcement, output/source boundaries and unexpected pages.
They do not execute shopping, browser actions, models or a live API. Exit 0 means
these tests passed; nonzero means a failed assertion or environment problem.

## Checks and failures

Documentation CLIs exit 0 for their named check, 1 for collection/integrity/I/O
failure, 2 for invalid or unsupported input and 130 for interruption. JSON is
clean on success and expected failure. Raw input-parser errors do not dump
tracebacks. A stale snapshot is a failure with a refresh/reconciliation action,
not a warning that silently permits dependent authoring.

After interruption, audit first. Recollect only the selected known documents
when needed. Unaccounted files are reported for inspection, never automatically
deleted. Do not remove private data or unrelated files to repair an audit.
These tools establish selected source-byte integrity and accounting only; live
permission, deployment, legal rights and agent execution remain separate.
