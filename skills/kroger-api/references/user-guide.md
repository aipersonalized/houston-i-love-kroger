# Install, configure and use Kroger API

## Detailed Content

### What this gives you

This is a folder of instructions plus small tools for keeping official API
documentation current. A person can read it without an assistant. An assistant
can use the same folder with any provider that supports local files. It does
not install a grocery app, create a Kroger account, place orders or supply a
secret-handling service. A hosted grocery app and its working URL have not been
released as part of this skill.

### Install: a person reading or using an assistant

1. Get the complete `kroger-api` folder from your project checkout or maintainer's
   approved distribution. Keep its files together. No published repository URL
   or license for redistributing the source mirror is assumed here.
2. Save it anywhere you can access, for example inside a project `skills` folder.
   There is no required username, drive, cloud service or assistant brand.
3. Open `SKILL.md` with a text editor or Markdown reader. Follow its links to
   this guide and the API reference. Reading requires no installation or account.
4. If using an assistant, add this folder using that host's documented skill/file
   mechanism, or tell it to read `SKILL.md` from your chosen path. Host support
   varies; this skill does not invent a universal installer or global directory.
   Ask it: “Use the Kroger API skill to explain product search at a selected
   store. Do not connect an account.” Expected result: an explanation with
   public operation/scope, source version, missing-price/stock caveats and limits.
5. Keep real credentials, customer searches and account pages out of the
   assistant. Reading this skill does not establish a safe private connection.

### Install: optional documentation tools

1. Reading this skill needs no Python. Only the optional tools need Python 3.11
   or newer, without extra packages. Windows/Python 3.14 was tested here;
   macOS/Linux instructions below are untested starting points.
2. Open a command window and select your saved folder using the matching steps
   below. Type one command per line and press Enter after each. Keep quotes
   around folder paths so spaces in names are handled correctly.

   **Windows:** Open the skill folder in File Explorer. Press Ctrl+L, then Ctrl+C
   to copy its folder address. Open Start, type `PowerShell`, then open Windows
   PowerShell or PowerShell. Replace the words between the quotes below with
   your copied address, keeping the quotes:

   ```powershell
   Set-Location -LiteralPath "PASTE YOUR FOLDER ADDRESS HERE"
   Get-Location
   Get-Item -LiteralPath 'SKILL.md','scripts'
   ```

   The results must show your chosen `kroger-api` folder, `SKILL.md` and `scripts`.
   If a path does not exist, return to File Explorer and open the folder that
   contains those two items; copy its address again and repeat the first command.
   Do not continue in a different folder. Windows navigation/inspection commands
   were exercised here; opening the menu was not automated.

   **macOS:** In Finder select the skill folder, hold Option and use Edit > Copy
   as Pathname. Open Spotlight with Command+Space, type `Terminal` and press
   Return. Replace the example path with your copied folder path, keeping quotes:

   ```bash
   cd "/full/path/to/kroger-api"
   pwd
   ls SKILL.md scripts
   ```

   **Linux:** Open your distribution's Terminal from its applications menu. In
   your file manager open the skill folder and copy its full location (often
   Ctrl+L, then Ctrl+C). Use the same three commands as macOS, replacing the
   example path with that location. File-manager/menu names vary. If `cd` fails
   or the two items are missing, correct the folder address before continuing.
   Native macOS/Linux commands and interface paths were not tested here.

3. Check Python before installing anything. On Windows type `python --version`;
   on macOS/Linux type `python3 --version`. A response such as `Python 3.14.0`
   identifies the installed version. You need 3.11 or later: 3.10 is too old;
   3.11, 3.12, 3.13, 3.14 or later meet the declared prerequisite. Only 3.14 has
   actually been exercised for these tools.

   If Windows cannot find Python, try `py -3.14 --version`. If that works, replace
   `python` with `py -3.14` at the start of every tool command below. On macOS/Linux
   replace it with `python3`. If you see an interactive prompt `>>>`, type `exit()`
   and press Enter, then repeat the version command including `--version`.

   If no supported interpreter works, use [Python downloads](https://www.python.org/downloads/)
   and its official platform help:
   [Windows](https://docs.python.org/3/using/windows.html),
   [macOS](https://docs.python.org/3/using/mac.html),
   [Unix/Linux](https://docs.python.org/3/using/unix.html).
   Windows guidance offers Python Install Manager from python.org or Microsoft
   Store. Install it using that page; its `py install 3.14` command installs the
   selected runtime. This is a step for you, not an installation performed by
   this skill. On macOS follow the official downloaded installer instructions.
   On Linux follow your distribution's supported package guidance; package names
   and administrator permissions differ, so do not replace system Python using
   a guessed universal command.

   After installation close the old command window, open a fresh one, repeat
   the folder steps and check the version again. If setup remains blocked, stop
   using the optional tools and keep reading the skill normally. Ask your
   computer administrator or project maintainer for help with your OS name,
   attempted command and short error message. Do not send credentials, account
   details or screenshots of private material.
4. If your copy omits `research/official_docs`, complete **Build the local source
   mirror** below first. Source documents are intentionally excluded from the
   portable project distribution; collection is not permission to redistribute.
   Otherwise type `python scripts/refresh_docs.py --check --json`. This reads local files
   only; it needs no Kroger account and sends no information to Kroger. Expected
   result: `"ok": true`,42 indexed/saved articles, `public_specs: 5` and
   `partner_specs: 1` (selected Catalog V2). The
   result also discloses a stale partner cross-link. Counts may change after
   a reviewed future update.
5. If a file/hash is missing or changed, keep any useful edits separately and
   ask the maintainer to check the mirror. To download current official public
   sources, first read `schemas/command-rules.md`, then type
   `python scripts/refresh_docs.py --refresh --json`. It makes public GET requests
   and replaces collector-owned documentation. It does not refresh the separate
   browser-captured Terms. Recheck that public source separately in your browser
   or through a permitted browser automation tool.
6. A network/rate-limit failure is an incomplete collection, not proof the API
   disappeared. Preserve files, wait as directed, and retry. Do not add account
   cookies or secrets to make public documentation collection work.

### Build the local source mirror

These steps download public documentation for your local review. They do not
create a Kroger account, grant API access, authorize retention of grocery data
or permit publishing supplier documents under the software license.

1. From the skill folder, read `schemas/command-rules.md`, then run:

   ```text
   python scripts/fetch_docs.py --url https://developer.kroger.com --output research/official_docs --json --no-input
   ```

   The first run saves public articles and selected specifications. It normally
   returns `"ok": false` until the separate public Terms capture is supplied.
   Open `research/official_docs/manifest.json` in a text editor. If only its
   `terms` entry failed and articles/specs are saved, continue below. If another
   entry failed, correct its stated source/network problem first. Do not treat a
   partial source collection as ready.
2. In your browser open [Kroger's public Terms](https://developer.kroger.com/terms).
   Copy only the complete main article, beginning with **Terms of Service**,
   including its displayed modification date and Sections 1–10, through the
   final Hamilton County provision. Paste it into a new plain-text editor file
   and save as UTF-8 `public-terms.txt` in the skill folder. Do not copy account
   pages, private communications or credentials. If the page's structure changed,
   stop and ask the maintainer to review the importer; do not invent missing text.
3. Import that public text locally. Replace `YYYY-MM-DD` with the modification
   date displayed by the article, in year-month-day form. For example, April 9,
   2019 becomes `2019-04-09`; verify the actual page before using that date.

   ```text
   python scripts/refresh_docs.py --import-terms public-terms.txt --publisher-modified YYYY-MM-DD --json --no-input
   ```

   Expected result: `"ok": true` and a message that public Terms text was
   imported. The tool records the local import time and supplied provenance;
   it does not verify the browser page, the supplied date or remote freshness.
   It refuses to replace an existing capture unless you explicitly add
   `--replace-terms` after reviewing the newer article. Keep this input file
   local and outside public archives along with the generated supplier mirror.
4. Run `python scripts/refresh_docs.py --check --json --no-input`. Expect a
   successful offline integrity result with separate Public/Partner counts and
   disclosed nested-link gaps. Then read the complete applicable sources before
   integration decisions. An audit pass verifies files and accounting; it grants
   no source rights and does not establish complete promotion coverage.
5. Future `--refresh` runs update public articles/specifications and preserve the
   separate Terms capture. Recheck/import Terms when its currentness matters.
   Real Python CLI fetch, import and audit paths were exercised with public or
   isolated synthetic inputs; the human copy/paste/editor steps are instructions,
   not an observed automated installation.

### Configure: an operator preparing a future integration

These steps describe official documentation, corroborated public controls and
the local privacy boundary. Authenticated registration and credential receipt
were not tested. Do not proceed on an uncertain earlier submission: inspect its
receipt privately or use a qualified bounded adapter before another submission.

1. Decide whether you operate the hosted installation or your own copy. A shopper
   using someone else's installed app normally should not create developer
   credentials; the operator owns them. No working hosted app is supplied here.
2. Read the official [Quick Start](https://developer.kroger.com/documentation/public/getting-started/quick-start),
   [Applications Help](https://developer.kroger.com/documentation/support/website-help/applications),
   [Acceptable Use](https://developer.kroger.com/documentation/public/getting-started/acceptable-use)
   and [Terms](https://developer.kroger.com/terms). Confirm the intended data use,
   app name and permissions before connecting customers.
3. In your own browser, open the developer site. Quick Start says to choose
   Create Account and verify the email link. Enter personal information yourself
   through private handling; do not share the form, email or identifiers in chat.
4. When registration is actually needed, official help routes to **Manage >
   Apps > Register**. Check the current page before use. Supply your own unique
   registration name (no “Kroger” or implied endorsement), a clear description
   and a support email entered privately.
5. Choose the environment. Production is live. Certification is test data and
   can be incomplete; customer accounts are unavailable there according to API
   Basics. Environment cannot be changed for that registration. Separate
   environments need separate named registrations; do not duplicate an uncertain
   prior application merely to follow this guide.
6. Select only the API products needed. Products/Locations support browsing;
   Cart/Identity involve customer sign-in/permission. Exact scopes must be
   assigned to your application; the published scope list alone is not approval.
   Partner Catalog V2 needs separately assigned partner access and the actual
   agreement. It is a candidate for inventory/promotions, not a guarantee of all
   offers. Read `catalog-v2.md` for customized scope and completeness gates.
7. For customer consent, obtain your real callback address from the actual
   installation. Enter it exactly as a Web Redirect URL. Do not guess a callback
   from a proposed website path. Homepage, logo, terms and privacy links describe
   your installation; help describes optional fields, while applicable Terms may
   still require a privacy policy. No callback/server exists in this skill.
8. Review the actual form and submit only within your authority. Success is the
   registration details/receipt, not a clicked button. If the outcome is unclear,
   stop and inspect privately rather than submitting again.
9. Official help says the secret is shown once. Save it directly in your approved
   private secret storage; keep it out of the repository, chat, screenshots,
   printed logs and online encoders. This skill has no credential-entry tool or
   API client; do not paste the values into its documentation tools.
10. The installation developer configures official API origin, environment,
    registered callback, assigned scopes and secret references through that
    installation's supported private mechanism. Configuration names are
    installation-specific; this guide does not invent `.env` keys or settings
    screens. A browser public client uses PKCE; a confidential server keeps its
    secret on the server. Read `api_reference.md` for the exact documented flow.
11. Before enabling live use, qualify safe credentials, redirects, denial,
    expiration/rotation, missing prices/stock, quotas/cache and customer-data
    boundaries. Registration, deployment and production operations remain
    separate work, not a result of installing this skill.

### Use: practical requests and expected results

1. Ask “Design a store search near a user-chosen area, without saving their
   location.” Expect Locations parameters, explicit result limit, transient data
   policy and no claim that any returned fuel station is a grocery store.
2. Ask “How should I display a product with no price or stock field?” Expect
   “unavailable” rather than zero or guaranteed in-stock, and unchanged source
   descriptions. This uses the reference; it does not fetch your account data.
3. Ask “Review this synthetic Add to Cart request.” Supply made-up product and
   quantity examples only. Expect public scope, required customer permission,
   204 handling, no automatic uncertain-write replay and no public read/delete
   assumption. Do not ask this documentation tool to send it.
4. Ask “Can I keep every customer's search/cart history?” Expect the documented
   restriction and an explanation of the blocked design dependency.
5. Ask “Can Catalog V2 list every promotion at my selected store?” Expect the
   three documented Partner operations, assigned scope, missing-price controls,
   optional terminal flag and explicit unresolved offer-universe/rights gates.
   No token or resource request should follow from this documentation question.
6. If a future hosted app is released, its own verified user guide must explain
   its actual URL, store selection, consent, explicit item/quantity addition,
   disconnect/deletion and Kroger checkout. Until then, these are required future
   controls, not buttons this skill claims exist.

### Troubleshooting

| What happens | What to do |
|---|---|
| Assistant cannot find skill | Provide the local SKILL.md path or use the host's supported file loader |
| Python command missing | Finish Python setup; try the installation's python3 command |
| Version below 3.11 | Select/install a supported interpreter using official platform help; do not blindly replace system Python |
| SKILL.md or scripts missing | Correct the folder address using the OS steps before running a tool |
| Local audit fails | Read its fixed message; preserve files; refresh or restore the correct mirror |
| Public refresh blocked | Retry later; never attach account cookies or bypass access restrictions |
| No secret after registration | Privately inspect official help/account recovery; never expose values or blindly re-register |
| API403 | Operator checks assigned/requested scope privately; not an endless token retry |
| Cart timeout | Treat outcome as unknown; person checks their Kroger cart before another addition |

## Key Concepts

An operator runs an integration; a shopper uses it. Installation of instructions
is separate from account registration and production service availability.

## Decision Criteria

Read-only guidance works without credentials. Account/private execution needs
the actual installation and safe human/private-adapter handling. Stop on that
missing dependency rather than requesting secrets in chat.

## Constraints & Limits

No installer, web app, authenticated runtime or universal host adapter is
bundled. Intended portability is supported by standard Python/path interfaces;
only the stated Windows/Python environment was tested. Source-copy publication
rights remain separate from the project's code license.

## Common Patterns

Start with a synthetic design question, verify source versions, and ask for
actual live qualification only when its safe execution path and authority exist.
