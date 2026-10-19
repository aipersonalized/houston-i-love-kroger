# Prepare a source release

This manual is for the person preparing the app and its companion skill for
publication. It describes a source candidate, not an npm package or a deployed
service. The package remains private to prevent accidental registry publication.
Use native Git to review an exact candidate; no release builder is required.

## 1. Keep the intended source boundary

The first source candidate includes:

- Root `.env.example`, `.gitignore`, `LICENSE`, `README.md`,
  `THIRD_PARTY_NOTICES.md`, `package.json` and `package-lock.json`.
- Application code in `public/`, `src/`, `scripts/` and `migrations/`.
- Synthetic tests in `tests/` and the disabled
  `config/collection-plan.example.json`.
- Human and operator manuals in `docs/`.
- The companion at `skills/houston-i-love-kroger/`, excluding the local-only
  paths below. Its five project-authored manual copies under
  `research/official_docs/pages/`, plus their manifest and exclusions file, are
  part of the companion's documented workflow.

The first source candidate excludes these local paths, as recorded in
`.gitignore`:

| Path or pattern | Reason |
|---|---|
| `/AGENTS.md` | Workspace instructions, not public app or companion instructions. |
| `/skills/houston-i-love-kroger/references/project-record.md` | Local development decisions and evidence. |
| `/skills/kroger-api/` | Separate local technology skill containing a third-party documentation mirror whose redistribution is not cleared. |
| `/skills/houston-i-love-kroger/evaluations/` | Local evaluation reports, not proof of live qualification. |
| `/skills/houston-i-love-kroger/research/recon/`, `/skills/houston-i-love-kroger/research/sources/` | Disposable research and source-tool captures. |
| `/.env`, `/.env.*` except `.env.example` | Private runtime configuration. |
| `/.runtime/`, SQLite/database patterns, `/config/*` except the public example | History, permission policies, collection plans and runtime storage. |
| `node_modules/`, `.venv/`, `__pycache__/`, `*.py[cod]`, `.cache/`, `dist/`, `coverage/`, `.DS_Store` | Installed packages, caches, build output and local metadata. |

Keep excluded local files in place. Exclusion is not a deletion request, a
copyright clearance or proof that a file contains no sensitive values. Keep
agreements, backups, credentials and operational records outside public source.
An ignore rule does not remove files already tracked by Git and cannot screen
arbitrary files or old commits for secrets.

## 2. Check the candidate before staging

Open a terminal in the project folder. Read the source changes, new files,
dependency notices and public manuals. Confirm that instructions refer only to
files included in the candidate. Do not publish a link that works only because
an excluded developer file is present on the preparer's computer.

Run the app's documented checks when behavior changes:

```text
npm run check
npm test
```

Reuse accepted passing checks for unchanged behavior. These tests use synthetic
fixtures and temporary databases; they do not establish live API entitlement,
retention rights, hosting readiness or observed agent performance. If manuals
change, refresh and audit the companion's five-page first-party snapshot using
its [documentation command contract](../skills/houston-i-love-kroger/schemas/command-rules.md).
Do not add source caches or evaluation reports to make a candidate look complete.

## 3. Stage and identify the exact source tree

Inspect the live state before staging:

```text
git status --short
```

Stage only reviewed paths from the inclusion list. These commands are a starting
list for this candidate; inspect every file under a staged directory first. Keep
the two source groups separate so that the app and companion remain visible in
review:

```text
git add -- .env.example .gitignore LICENSE README.md THIRD_PARTY_NOTICES.md package.json package-lock.json config/collection-plan.example.json docs migrations public scripts src tests
git add -- skills/houston-i-love-kroger
git diff --cached --name-only
git diff --cached --check
git diff --cached
```

Compare the staged inventory with section 1, including new files that a usual
diff might omit before staging. Do not use a forced add to bypass the exclusions.
If an unexpected file is staged, stop and correct the index while preserving
the working file before continuing. An existing tracked excluded file or a
commit containing private material requires a separate scoped review; ignoring
it now does not make earlier history safe to publish.

After the inventory and contents match the intended candidate, record its
immutable Git tree identity:

```text
git write-tree
```

The printed object ID identifies exactly the staged contents. Supply that ID,
the intended distribution surface and check results to the maintainer's
licensing and legal-liability review. The maintainer's release process requires
that review before a public source push, skill release, package, app or
documentation publication. Resolve required findings and stage any corrections;
a changed tree needs a matching review. A selected license or passing tests
cannot replace this gate.

## 4. Keep publication and live operation distinct

Publish only the accepted candidate through an authorized destination, and
verify its actual public contents afterward. Never upload the working folder
as an archive: it may contain ignored local records. A Git tree review does not
review every earlier commit; review all history that would be sent as well.
Use a source archive derived from the accepted reviewed revision when an archive
is needed, and inspect its final inventory before distributing it.

MIT covers the original project materials identified by [LICENSE](../LICENSE).
Dependency notices remain in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
Neither grants supplier data, documentation, account or trademark rights.

Source publication does not establish a working Kroger connection, a hosted
installation or permission to collect price history. Before offering a live
service, complete the actual-host checks in [SELF_HOSTING.md](SELF_HOSTING.md).
Before collecting or showing historical data, establish the actual source
permission and controls in [HISTORY.md](HISTORY.md). Keep history disabled until
those prerequisites are met.
