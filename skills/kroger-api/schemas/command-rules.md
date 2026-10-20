# Input and output rules

## When to read this

Read in full before running scripts or interpreting their results. Run from the
skill folder; paths are configurable and no user-specific installation is needed.
Python3.11+ standard library only; observed runtime Python3.14/Windows.

## Inputs and outputs

### Fetch and refresh

```bash
python scripts/fetch_docs.py --url https://developer.kroger.com --output research/official_docs --json
python scripts/refresh_docs.py --check --json
python scripts/refresh_docs.py --refresh --json
python scripts/refresh_docs.py --repair --json
python scripts/refresh_docs.py --import-terms public-terms.txt --publisher-modified YYYY-MM-DD --json --no-input
python scripts/refresh_docs.py --accept-removed https://developer.kroger.com/documentation/obsolete-page --review-note "Source and surviving consumers reviewed; obsolete guidance replaced." --json
```

Fetcher requires --url (exact official source, optional trailing slash) and
--output (empty or collector-owned directory). --resume obtains current inventory
but reuses hash-verified unchanged article IDs; ID reuse is not remote freshness.
Refresher requires one mode and optionally --output; default is this skill's
research/official_docs directory resolved from the script, independent of cwd.

Both accept --help, --json, --no-input, --quiet, --verbose, --no-color, --dry-run.
No prompts in any mode. Dry-run validates options without network/file writes.
JSON stdout is one result object; human TTY adds orientation/color unless disabled
or NO_COLOR is set. Verbose fetch additionally reports public page statuses;
refresh audit has no extra verbose details. Banners/colors are presentation only.

Fetch/full refresh perform sequential public GETs to fixed official external
content and public spec services, minimum1second between starts, bounded30second
timeouts, up to three total attempts (two retries), honoring short Retry-After delays and stopping
on longer delays. No authorization header, cookie jar, browser session, API
credentials, environment secret lookup or grocery API execution. No arbitrary
host/query crawling is permitted; fixed source restriction protects collection
identity and does not tie the tool to a person's environment.

Files:official inventory.json; one exact Markdown body per external article;
five Public API and one selected Partner Catalog V2 OpenAPI JSON files plus
lossless fenced Markdown wrappers; manifest
with canonical URL, content URL, source/version/time, SHA256, byte count, status,
family, exclusions and explicit failures/link gaps. Older spec versions are
listed in other_versions, outside the selected publisher-current-version scope.
No article exclusions are currently configured (zero); fetch/refresh share one
implementation/policy. Failed retrieval preserves prior article files but marks
the corresponding entry failed; partial files are never success entries.
Removed inventory URLs are recorded and require review; no automatic deletion.
Unresolved removals survive successive refresh/repair runs until reinstatement
or explicit reviewed acceptance. `--accept-removed URL` is a separate offline
write mode, requires a non-sensitive single-line `--review-note` of 1–240
characters and accepts one URL already recorded as unresolved. Review the source,
affected guidance/consumers and disposition first. Replace the illustrative URL
above with an actual recorded URL. It records URL/time/disposition in
`accepted_removal_reviews`, clears only that pending gate and preserves old
source files. It does not fetch, delete, verify the review's substance or imply
other gates passed; run --check afterward. A source that returns and disappears
again needs a new review. --check remains read-only.

`terms-browser-source.json` is an independent public-article input; ordinary
fetch/refresh never overwrites it. Expected UTF-8 JSON fields:
source_url=https://developer.kroger.com/terms, retrieved_at(ISO8601UTC), method,
publisher_modified(YYYY-MM-DD), content(complete public main article text).
An operator obtains a public-only capture via their supported browser/human
workflow. Do not export private pages. A local pass
cannot establish its current remote freshness.

For a fresh checkout, first run fetch into the selected mirror. Missing Terms
keeps that initial collection incomplete while saving other good sources.
Then `--import-terms TEXTFILE --publisher-modified YYYY-MM-DD` imports an
explicitly supplied complete public UTF-8 Terms article into that owned mirror,
without network requests. Supply the date actually displayed by the article;
the `YYYY-MM-DD` example is a placeholder, not a literal valid date. The importer
requires the expected article title, modification label, all ten section markers,
final forum marker and a minimum length, rejecting HTML/navigation-only input.
These checks do not authenticate source text, prove completeness or verify the
supplied modification date. The operator owns comparison with the current public
article. This is not a private-record reader or sanitizer.

The import writes the source JSON and updates only the manifest's Terms entry,
recording local import time and operator-supplied provenance. It never prints
the article. Existing capture replacement requires explicit `--replace-terms`;
otherwise it refuses without overwriting. A partial filesystem failure can leave
the capture and manifest inconsistent: preserve files, inspect the error and
repeat only the authorized import or restore a known good pair, then --check.
`--publisher-modified` and `--replace-terms` are valid only with --import-terms.
Keep the supplied plain-text article and generated supplier mirror out of public
source/builds unless redistribution is separately established. The portable core
does not bundle these supplier files. Run --check after import; import success
alone is not an overall source audit, remote freshness or rights result.

--check makes no network requests/writes. It validates manifest/source identity,
inventory hash and coverage, file paths/hashes/lengths, counts, source failures,
required specs (including Catalog V2) and Terms input. It reports nested-link gaps explicitly; the one
known partner cross-link is not a missing required public source. It does not
establish article correctness, remote freshness, license rights, account access
or authenticated behavior. Review changed source content separately.

Result fields:ok(boolean), message(string), counts(indexed/saved/failed/excluded)
when collection is available; audit also returns public_specs (five),
partner_specs (one selected Catalog contract), nested_link_gaps,
retrieved_at. Error results have ok=false and fixed recovery instructions.
Exit0:bounded operation passed; fetch1:incomplete recorded collection;
fetch2:invalid option/source/local-state failure; refresh1:source/audit failure;
argparse2:invalid arguments;130:interrupted. Help exits0. Do not parse English
messages as a stable API or infer production readiness from exit0.

### Step listing

`python scripts/list_skill_steps.py` reads local playbooks and prints their
numbered steps. No inputs, network or file writes; exit0 listed,1unavailable or
unreadable playbooks. Its generated plain-text contract is separate from JSON
collection output. `--help` is supported. This utility does not execute playbooks.

### Synthetic regression suite

`python -m unittest discover -s evals -p "test_*.py" -v` uses disposable synthetic
source/mirror fixtures, no live network, account access or model calls. Exit0
means those tests passed; unittest nonzero means failure. It checks parser/path,
source fidelity, offline integrity and meaningful malformed/failure conditions.

## Checks and failures

Valid:the commands above with explicit paths. Invalid:fetch --url on another
host, nonempty unowned output, private URLs, injected queries, malformed source
identity or unsafe paths. Correct input/restore a good mirror and rerun; do not
silently fall back to another source. On429/access failure wait; no identity or
proxy rotation. On interrupted collection preserve valid files and use --repair,
then full refresh when freshness matters. Check output paths before cleanup.
