# Local documentation maintenance tools

## Quick Start

From the skill folder, run:

```text
python scripts/refresh_docs.py --check --json --no-input
```

Read `schemas/command-rules.md` in full before other operations. Paths in that
file resolve from the skill root, one folder above this directory.

## What It Does

- Collect five explicitly selected public first-party app Markdown documents.
- Audit their inventory, exact bytes, identities, version, exclusions and hashes.
- Optionally compare the snapshot with an explicitly selected app checkout.
- Refresh the selected snapshot locally; never query a shopper, account or API.

## Requirements

Python 3.12 or newer, standard library only. Executed here with Python 3.14.
The shopping skill itself needs no Python runtime when using a host's existing
browser or HTTP tool. Collection requires ordinary local files, not linked paths.

If you want to run these optional maintenance commands:

1. Install Python from the [official Python downloads](https://www.python.org/downloads/)
   if it is not already installed. Open PowerShell on Windows or Terminal on
   macOS/Linux, then change into the companion's folder containing `SKILL.md`.
2. Run `python --version` and check that it reports 3.12 or newer. On macOS/Linux,
   use `python3 --version` if that is the installed command, and replace the
   initial `python` in every example here with `python3`.
3. If the command is missing after installation, close and reopen the terminal.
   For an audit failure, follow the returned recovery message and the command
   contract; do not delete unrelated files. Use the repository's
   [help guidance](../../../README.md#help-and-feedback) if you need to report a
   problem, removing private paths, configuration and data before sharing output.

## Examples

From the skill folder in a complete app checkout:

```text
python scripts/fetch_docs.py --url repo:/ --output research/official_docs --json --no-input
python scripts/refresh_docs.py --check --repository ../.. --json --no-input
python scripts/refresh_docs.py --refresh --repository ../.. --json --no-input
python scripts/list_skill_steps.py
```

The final command is the read-only step utility. It prints Markdown playbook/step
headings; --json, --no-input, --no-color and --help are also supported. Fetch/audit commands support human
text, `--json`, `--no-input`, `--no-color`, `--verbose` and `--help`. They never
prompt. Help is plain text; JSON execution returns one object. See the command
rules for exits, file effects and recovery after interrupted writes.
