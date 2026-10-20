# Prepare a source release

This manual is for the person preparing the app and its companion skill for
publication. It describes a source candidate, not an npm package or a deployed
service. The package remains private to prevent accidental registry publication.
Use native Git to review an exact candidate; no release builder is required.

## 1. Keep the intended source boundary

The source candidate includes:

- Root `.env.example`, `.gitignore`, `LICENSE`, `README.md`,
  `THIRD_PARTY_NOTICES.md`, `package.json` and `package-lock.json`.
- Portable `Dockerfile`, `.dockerignore` and `compose.example.yaml` for optional
  container hosting; a private `compose.yaml` is not a release file.
- Application code in `public/`, `src/`, `scripts/` and `migrations/`.
- Synthetic tests in `tests/` and the disabled
  `config/collection-plan.example.json` and
  `config/store-directory-plan.example.json`.
- Human and operator manuals in `docs/`.
- The companion at `skills/houston-i-love-kroger/`, excluding the local-only
  paths below. Its six project-authored manual copies under
  `research/official_docs/pages/`, plus their manifest and exclusions file, are
  part of the companion's documented workflow.
- The 18 first-party Kroger API skill files explicitly allowed by `.gitignore`
  under `skills/kroger-api/`: the entry point and vocabulary, scripts and their
  README, command schema, three playbooks, five reusable references, integration
  template, synthetic test suite and improvement guide. Its
  [setup guide](../skills/kroger-api/references/user-guide.md) explains how to
  build the excluded supplier mirror locally. No mirror is bundled.

The source candidate excludes these local paths, as recorded in
`.gitignore`:

| Path or pattern | Reason |
|---|---|
| `/AGENTS.md` | Workspace instructions, not public app or companion instructions. |
| `/skills/houston-i-love-kroger/references/project-record.md` | Local development decisions and evidence. |
| Non-allowlisted paths under `/skills/kroger-api/`, including `research/`, `public-terms.txt`, `agents/`, local reports and evaluation outputs | Supplier originals, Terms captures/inputs, local task records and optional provider metadata; only the reviewed first-party core is included. |
| `/skills/houston-i-love-kroger/evaluations/` | Local evaluation reports, not proof of live qualification. |
| `/skills/houston-i-love-kroger/research/recon/`, `/skills/houston-i-love-kroger/research/sources/` | Disposable research and source-tool captures. |
| `/.env`, `/.env.*` except `.env.example`, `/compose.yaml`, `/compose.override.yaml` | Private runtime configuration. |
| `/.runtime/`, SQLite/database patterns, `/config/*` except the two public examples | History, permission policies, collection plans and runtime storage. |
| `node_modules/`, `.venv/`, `__pycache__/`, `*.py[cod]`, `.cache/`, `dist/`, `coverage/`, `.DS_Store` | Installed packages, caches, build output and local metadata. |

Keep excluded local files in place. Exclusion is not a deletion request, a
copyright clearance or proof that a file contains no sensitive values. Keep
agreements, backups, credentials and operational records outside public source.
An ignore rule does not remove files already tracked by Git and cannot screen
arbitrary files or old commits for secrets.

## 2. Work in a separate development worktree

Keep this project in its own Git repository with independent history. Its
development and `main` worktrees share that history. Keep worktrees outside
other projects' repositories. In the project terminal, inspect:

```text
git status --short --branch
git worktree list
git branch --show-current
```

Use `main` for integration and release. Make source, documentation, skill and
container changes in a separate worktree on `dev` or a descriptive `dev/` branch.
Reuse an existing appropriate worktree. For a clean repository with an existing
`main` commit, this example creates a sibling worktree and a new development
branch; choose an unused path and branch name:

```text
git worktree add -b dev/next-change ../houston-i-love-kroger-dev main
```

A new repository needs a reviewed initial commit before linked worktrees can be
created. Select the intended public author identity locally and include only
the reviewed source boundary. This bootstrap does not replace development
checks, actual-use evaluation or the final publication review. Preserve dirty
work; do not reset it or initialize another repository inside a worktree.

## 3. Commit the scoped candidate on development

Read source changes, new files, dependency notices and public manuals in the
development worktree. Check links against the public inventory, including the
companion's documentation copies. Inspect the live state before staging:

```text
git status --short
```

Stage only reviewed paths from the inclusion list. These commands are a starting
list for this candidate; inspect every file under a staged directory first. Keep
the app and two skill groups visible in separate staging steps:

```text
git add -- .env.example .gitignore .dockerignore Dockerfile compose.example.yaml LICENSE README.md THIRD_PARTY_NOTICES.md package.json package-lock.json config/collection-plan.example.json config/store-directory-plan.example.json docs migrations public scripts src tests
git add -- skills/houston-i-love-kroger
git add -- skills/kroger-api
git diff --cached --name-only
git diff --cached --check
git diff --cached
```

Compare the staged inventory with section 1, including new files that a usual
diff might omit before staging. Do not use a forced add to bypass the exclusions.
Use `git ls-files -- skills/kroger-api` to inspect the tracked technology-skill
inventory. Additional files require an explicit source-boundary review before
changing its allowlist; never add supplier captures to make the tests portable.
If an unexpected file is staged, stop and correct the index while preserving
the working file before continuing. An existing tracked excluded file or a
commit containing private material requires a separate scoped review; ignoring
it now does not make earlier history safe to publish.

Commit the inspected candidate on the development branch, then record both its
commit and source-tree identities:

```text
git commit -m "Prepare verified source candidate"
git rev-parse HEAD
git rev-parse "HEAD^{tree}"
```

The commit identifies source and public metadata. A staged-tree identity alone
does not establish committed development, tested use or integration into `main`.

## 4. Check and evaluate the committed development candidate

Run applicable checks and bind the results to that commit:

```text
npm run check
npm test
```

Reuse accepted passing evidence for unchanged behavior, with its matching
source identified. These tests use synthetic fixtures and temporary databases;
they do not establish live API entitlement, retention rights, hosted capacity
or observed agent performance. If selected manuals change, refresh and audit
the companion's first-party snapshot using its
[documentation command contract](../skills/houston-i-love-kroger/schemas/command-rules.md).
Do not include generated evaluation reports or source caches in the release.

Then exercise the relevant real interface in a development preview. For browser
changes, use the actual page and check the affected desktop/mobile, keyboard,
success and failure states. Use clearly labeled synthetic data when supplier
access or permission is unavailable; never fill a real history database with
test products. For API/CLI changes, exercise their supported interface. For
documentation-only changes, follow the affected instructions/scenarios and
check links. Container changes require an actual image build and isolated
startup/health/resource/persistence checks before deploying that image.

Record what ran and its limits. A required missing check blocks merge. Fix
failures on development, commit corrections and repeat affected checks; do not
call a static walkthrough actual browser or model use.

## 5. Merge passing development into main

Reconcile any changes on `main` in development first and repeat affected checks.
In the clean `main` worktree, merge the accepted development branch. For the
example branch above:

```text
git status --short --branch
git merge --ff-only dev/next-change
git rev-parse HEAD
git rev-parse "HEAD^{tree}"
```

If the merge cannot proceed, stop and resolve the branch relationship in
development without discarding other work. Verify the resulting `main` commit
and tree contain the accepted candidate. Copying development files into a
release folder does not replace the merge.

## 6. Review and publish committed main

Supply the actual `main` commit/tree, author metadata, complete refs/history to
be sent, intended destination and check evidence to the maintainer's licensing
and legal-liability review. This process requires that review before a public
source push, skill release, package, app or documentation publication. Resolve
required findings on development, recheck and merge corrections before final
review. A selected license or passing tests cannot replace the gate.

Publish or deploy only the accepted committed `main` version, with no additional
uncommitted source. Record the artifact/image identity, destination and rollback
reference, then verify the actual public task and files. Keep source publishing
and hosted-app deployment separate. Never archive the working folder: ignored
records may remain there. Derive a source archive from the reviewed revision
and inspect its final inventory. A tree review does not review earlier commits.

MIT covers the original project materials identified by [LICENSE](../LICENSE).
Dependency notices remain in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
Neither grants supplier data, documentation, account or trademark rights.

Source publication does not establish a working Kroger connection, a hosted
installation or permission to collect price history. Before offering a live
service, complete the actual-host checks in [SELF_HOSTING.md](SELF_HOSTING.md).
Before collecting or showing historical data, establish the actual source
permission and controls in [HISTORY.md](HISTORY.md). Keep history disabled until
those prerequisites are met.
