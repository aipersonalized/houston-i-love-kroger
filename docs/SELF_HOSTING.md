# Install, configure and run the app

Use this guide only to run an installation. People using a hosted app need only
the [user guide](USER_GUIDE.md), a browser and its supplied address. No AI
provider, paid model account or global Python installation is required.

Native operation has been checked on Windows with Node.js 22.23.2. The locked
database dependency is `better-sqlite3@13.0.3`. Other runtime/platform combinations
need qualification. The [Compose option](#6a-optional-compose-installation) runs
the web app and private database service separately; supplied container files
alone do not prove a particular image or host has been tested or deployed.

Permission for systematic Kroger history/directory collection and retained-data
use remains unestablished for this project. Ordinary Public current-price access
does not require Partner enrollment; see the [permission guide](KROGER_PERMISSION_REQUEST.md).
New databases start empty and permission-gated. Installing the app, supplying
API credentials or enabling a setting cannot create source rights. Cart is
optional and disabled by default.

## 1. Prepare a native installation

1. Install Node.js with npm from [Node.js](https://nodejs.org/). The package
   requires Node.js 22.21 or newer and a compatible native database binding;
   Node.js 22.23.2 is the checked native version.
2. Open PowerShell on Windows or a terminal on your system. Run `node --version`
   and `npm --version`. Both should print a version. Reopen the terminal if the
   installed commands are not yet found.
3. Obtain the reviewed version from the
   [project repository](https://github.com/aipersonalized/houston-i-love-kroger),
   using **Code → Download ZIP** and extracting it, or a reviewed source checkout.
   A public repository may not yet contain the version described by a development
   checkout. Check the release/version before following its instructions.
4. Open that folder in your file manager; it should contain `package.json`.
   Open a terminal there, or use `cd` followed by your actual folder path.
5. Install the locked dependencies:

   ```text
   npm ci --ignore-scripts
   ```

6. Check the native binding and synthetic behavior:

   ```text
   npm run check
   npm test
   ```

Tests use temporary databases and synthetic data, without real source collection.
The locked dependency supplies prebuilt bindings and declares no lifecycle
install script. `--ignore-scripts` intentionally skips npm's implicit native
build as well. It applies to that install only and does not prevent `npm start`
or tests. No compiler or globally installed Python is needed for the qualified
prebuilt targets. Recheck the choice when updating dependencies.

Plain `npm ci` with npm 10.9.8 can attempt `node-gyp` and fail looking for Python.
Use the documented command rather than installing guessed compiler tools.
npm 12.1.0 may warn about a blocked automatic build while the prebuilt binding
still works. A passing binding test is better evidence than that warning alone.
For an actual load failure, record Node/npm versions, OS, CPU architecture and
the non-sensitive error. Check package completeness and prebuilt compatibility;
do not broaden global script permissions or replace the database dependency to
hide the failure. npm documents
[implicit native builds](https://docs.npmjs.com/cli/v10/using-npm/scripts/) and
[ignore-scripts](https://docs.npmjs.com/cli/v10/commands/npm-ci/#ignore-scripts).

## 2. Try the page with no credentials

1. Run `npm start` from the project folder.
2. Open `http://localhost:4173/apps/houston-i-love-kroger/`.
3. Expect the connection setup notice, disabled searches and no shopping offers.
4. Keep the terminal open while using the page. Stop it with Ctrl+C.

With no remote service configured, startup creates/verifies the local history
database under `.runtime/`. It does not collect history, sign in a shopper or
query Kroger merely because the page opens. The local database supports current
promotion comparisons; the separate stored-observation search UI needs the
private HTTP service described in section 4a.

## 3. Configure current-price access privately

1. Read the official [Kroger Quick Start](https://developer.kroger.com/documentation/public/getting-started/quick-start),
   [Applications Help](https://developer.kroger.com/documentation/support/website-help/applications),
   [Acceptable Use](https://developer.kroger.com/documentation/public/getting-started/acceptable-use)
   and [Terms](https://developer.kroger.com/terms). Confirm the intended use is
   covered. The project's software license grants no supplier permission.
2. Follow current account/application-registration instructions at the
   [developer portal](https://developer.kroger.com/) in your own browser. Complete
   required verification. This project has not qualified authenticated
   registration/credential issuance; it cannot promise approval or particular
   account controls. For an uncertain prior submission, inspect the application
   list or ask Kroger support before submitting again.
3. Use a truthful application name and registration details allowed by Kroger.
   A repository name does not select an acceptable registered name. Do not invent
   a deployment, callback or grant to fill a portal field.
4. Obtain your own client ID/secret for Locations and public Products with
   `product.compact`. Browsing needs no shopper password or Cart grant.
5. In your file manager copy `.env.example` to `.env` beside `package.json`.
   Check it is not accidentally named `.env.txt`.
6. Edit it privately. Enter the client ID after `KROGER_CLIENT_ID=` and secret
   after `KROGER_CLIENT_SECRET=`. Never paste them into chat, screenshots, issues,
   commands, browser scripts or an online credential encoder.
7. Use `KROGER_ENVIRONMENT=production` for that environment, or `certification`
   for sandbox access. Sandbox prices are not verified shopping offers and
   never receive production history.
8. Save and restart with `npm start`. Loaded credentials clear the setup notice;
   that only proves settings are present. A successful exact-store search is
   separate evidence of actual access.
9. Follow the [user guide](USER_GUIDE.md) to find a store and search a grocery.
   Check all-priced versus promotion-only views, details, source filters and
   the visit-only list. If access is rejected, inspect environment/application
   status and actual scopes privately.

`.env` is ignored by Git, but remains readable to anyone with file access.
Restrict it to the operator/runtime and keep it out of shared folders, screenshots
and public hosting. A private deployment environment or secret manager can
supply settings instead; the native npm scripts load `.env` if it exists.

## 4. Choose the settings and storage mode

| Setting | Default / purpose |
| --- | --- |
| `HOST`, `PORT` | `127.0.0.1`, `4173`; local web listener. |
| `APP_BASE_PATH` | `/apps/houston-i-love-kroger/`; simple folder names, leading/trailing `/`; `/` supported. |
| `PUBLIC_ORIGIN` | Blank locally; exact HTTP(S) origin without a path, credentials, query or fragment. HTTPS is required for Cart. |
| `KROGER_ENVIRONMENT` | `production` or `certification`. |
| `HISTORY_DB_PATH` | Local SQLite filename; blank uses the installed project's `.runtime/history.sqlite`. Explicit relative paths resolve from the process working directory. |
| `PROMOTION_SERVICE_URL` | Blank uses local comparison mode. An HTTP(S) origin selects the separate private service. No path, credentials, query or fragment. |
| `PROMOTION_SERVICE_TOKEN` | Private shared app/service token; required with the app's service URL. 32–512 printable ASCII characters without spaces. |
| `PROMOTION_SERVICE_HOST`, `PROMOTION_SERVICE_PORT` | Private service listener, default `127.0.0.1:4174`; not the app listener. |
| `PROMOTION_MAX_AGE_SECONDS` | Private service's latest-deal freshness rule, default86400; supported1–604800 seconds. A site policy, not a supplier price guarantee. |
| `KROGER_CART_ENABLED`, `KROGER_CART_GRANTED` | Both default `false`; configuration flags, not proof of actual supplier assignment. |
| `KROGER_CART_REDIRECT_URI` | Blank by default. If set, must equal `PUBLIC_ORIGIN` plus `APP_BASE_PATH` plus `api/v1/cart/callback`, over HTTPS. |

Use an absolute private database path in a service configuration. SQLite needs
a writable local directory for the database and WAL/SHM sidecars. Do not put it
under public assets or an unqualified network share. Protect policies, plans,
sidecars and backups with actual OS access controls; Unix mode requests alone
do not establish Windows ACL protection.

### 4a. Native private promotion service

Use this mode for stored-observation search/retrieval and promotion comparisons
through one private database authority. Do not run another independently writable
database copy for the app.

1. Stop the app while changing its configuration. Choose the authoritative
   private `HISTORY_DB_PATH`; preserve any existing database.
2. Generate a fresh random secret in your password/secret manager. Set it
   privately as `PROMOTION_SERVICE_TOKEN`. Set the app's `PROMOTION_SERVICE_URL`
   to `http://127.0.0.1:4174` for the default local service. The app and service
   must use the same token. A single private `.env` can supply both processes;
   separate runtime environments must receive the same value securely.
3. Keep `PROMOTION_SERVICE_HOST=127.0.0.1` for local use. In a terminal in the
   project folder, start:

   ```text
   npm run promotions:serve
   ```

4. Expect `Private promotion service is listening. Source permission is checked
   separately.` Leave this terminal open. `http://127.0.0.1:4174/healthz` returns
   only `{"ok":true}`; this is liveness, not source permission or coverage.
5. In another terminal in the same project, run `npm start`. In this mode the
   web process uses HTTP and does not open/initialize a SQLite file.
6. Open the app's `api/v1/status` URL to check `promotionService`. A fresh
   database should remain `permission_required`. With actual permission later
   established, exercise an exact-store history search and detail retrieval.
7. Stop each process with Ctrl+C. A stopped private service makes history
   unavailable; current-price searches can still succeed independently.

The private token belongs only to the backend/service runtime. Never place it
in browser code, URLs, command arguments, assistant instructions or public source.
Do not expose port 4174 publicly. Use authenticated encrypted transport across
untrusted networks. The client has a five-second whole-response deadline, 2 MiB
response cap, no redirects, automatic retries or result cache.

Follow [PROMOTION_SERVICE.md](PROMOTION_SERVICE.md) for its full private protocol
and [HISTORY.md](HISTORY.md) for actual reviewed rights and operator writes.
No HTTP request enables collection or permission. New installations do not
contain real historical observations.

### 4b. Optional Cart configuration

Leave both Cart flags false unless Kroger has actually assigned the required
`cart.basic:write` access and registered your exact HTTPS callback. A pending
application, shopper consent, sample policy or setting does not create a grant.
Live Cart authorization/writes remain unqualified for this project.

For an authorized installation, verify all of the following before enabling:

1. Actual production assignment and credentials match the installed application.
2. `PUBLIC_ORIGIN` is the actual HTTPS origin, and the callback registered with
   Kroger exactly matches the configured path, for example
   `https://groceries.example/apps/houston-i-love-kroger/api/v1/cart/callback`.
   This example is not a registered URL.
3. Privately set `KROGER_CART_REDIRECT_URI` to that registered URI and both flags
   to `true`, then restart. Qualify sign-in/callback/session behavior with a
   separately authorized real account before offering it to shoppers.
4. Suppress callback query/code/state and cookie/token logging at the app route,
   proxy, edge and error tooling. Keep one app process for the in-memory session;
   a restart loses it. Replicas do not share sessions or quota counters.
5. Check notices disclose the secure HttpOnly cookie, server-memory authorization,
   session expiry within 30 minutes, periodic cleanup, disconnect/restart limits, direct
   image requests and external Kroger destinations.

Keep the access check separate from shopper sign-in. Privately open the existing
application in Kroger's developer portal and confirm its actual production Cart
assignment and registered callback. Do not create another application to work
around a pending or uncertain result. The portal's private controls and this
installation's real callback/grant have not been qualified by the local tests;
use the portal's current instructions and reconcile the existing application's
status before changing its configuration. Product-search access alone is not
evidence of Cart access.

When access and activation are authorized, make these checks in order:

1. Keep both Cart flags `false` while arranging your HTTPS address and private
   logging rules above. Set `PUBLIC_ORIGIN` to the address before the first `/`
   after the host, and keep the full app folder in `APP_BASE_PATH`. For example,
   the origin is `https://groceries.example` and the folder is
   `/apps/houston-i-love-kroger/`; neither example establishes a real service.
2. Join that origin, folder and `api/v1/cart/callback` without removing the
   folder's trailing slash. Privately compare the resulting complete address
   with the callback registered for the same production application. Every
   character of the configured callback must match its registered address.
3. Enter the credentials and settings privately in the installation's secret
   configuration, following [step 3](#3-configure-current-price-access-privately). Do not paste
   them into a shell command, an assistant, a support ticket or a screenshot.
   Set both Cart flags `true` only after verifying actual access, then restart
   the app using the normal start procedure.
4. Open the hosted app yourself and expand its optional Cart panel. It should
   offer **Connect a Kroger cart**. This proves only that local configuration
   is complete. It does not prove Kroger has granted access.
5. With separately authorized human testing, follow the
   [shopper sign-in steps](USER_GUIDE.md#6-optional-add-the-list-to-a-kroger-cart).
   Confirm that denying sign-in adds nothing, a fresh connection can be started,
   and a permitted connection returns to this app. Return to the original tab
   and check the connection; do not copy callback addresses or account details.
   Sign-in itself never adds the shopping list.
6. Qualifying an actual add requires a separate, explicit choice of items and
   quantities. If authorized, send it once and check the actual cart at Kroger.
   A successful sign-in is not permission for this test. If its outcome is
   uncertain, follow the recovery guide below before any new add.

To stop offering Cart, privately set `KROGER_CART_ENABLED=false` and restart the
app. Leave `KROGER_CART_GRANTED=false` whenever actual assignment is absent or
unverified. A restart discards local connections; it does not undo cart changes
or revoke a shopper's Kroger permissions. Check the disabled state in the app
and never use a restart as proof that a previous uncertain add did not succeed.

The app uses state and PKCE and discards refresh tokens. Sign-in alone adds no
items. Every write needs the explicit add action; no payment/order is handled.
There is no cart readback, undo, idempotency key or automatic add retry. Follow
[Cart usage and unknown-outcome recovery](USER_GUIDE.md#6-optional-add-the-list-to-a-kroger-cart)
before using a connected account.

## 5. Troubleshoot locally

| Problem | Check / recovery |
| --- | --- |
| Page unreachable | Keep the app terminal running; use the exact configured port/base path. |
| Port occupied | Stop your own earlier instance or select a different port; preserve unrelated processes. |
| Setup notice persists | Check the `.env` filename, both credential fields and restart. Do not share the file. |
| No products/promotions | Try another term and remove local filters. The sample is bounded. |
| Busy, provider or daily budget limit | Respect the wait shown; do not restart to bypass quotas. |
| Database cannot open | Check storage permissions, file identity, schema and free space. Linked/unrelated files are refused. Do not delete history as a repair. |
| Private service cannot start | Check token format, listener/port and authoritative database access privately. |
| History unavailable | Check the paired token, URL, listener/network and production environment. A failure is not empty history. |
| History permission required | Review actual rights/scope/expiry; do not change fabricated policy values to bypass the gate. |
| Cart setup/connection failed | Check actual assignment, registered callback, HTTPS origin and session state. Never share callback codes or cookies. |
| Cart add unknown | Inspect the actual cart at Kroger before any reconnect/new add. Do not automate a replay. |

After source changes, run `npm run check`, `npm test` and relevant real-interface
evaluation. Synthetic tests establish no live access, real checkout prices,
actual retention rights or production capacity.

## 6. Prepare public hosting

Before publication, complete the exact-candidate licensing/legal-liability review
and qualify the actual host. See [release preparation](RELEASING.md). A hosted
setup page with blank credentials establishes no live or historical-source
permission. MIT covers original software, not supplier data or branding rights.

A host needs HTTPS at its edge, a supervisor, private secrets, private local
database storage at the service owner and a path-preserving reverse proxy.
Set the actual `PUBLIC_ORIGIN` before binding the app beyond loopback. Expose
only the web app. Do not serve the source tree, `.env`, database, private service,
policies, collection plans or fixtures as public files.

Quotas/admission counters and Cart sessions are process-local and reset on
restart. Coordinate upstream quotas across web and collector processes; verify
edge limits, capacity, backup/deletion and real task behavior. The defaults are
bounded starting limits, not measured production capacity.

Before live use, edit **Privacy and use notes** in `public/index.html` for your
actual installation:

1. Replace the `aipersonalized.io` operator/hosting paragraphs with your operator,
   providers, data recipients, purpose and actual retention. That deployment's
   statements do not describe every self-hosted copy.
2. Disable access logs for these routes, including the bare-path redirect and
   callback. Do not log request bodies, catalog payloads, OAuth parameters,
   cookies, tokens or customer search/location activity. Check edge/error tools
   separately; default logging can retain information outside the app.
3. Replace the example log-rotation statements with verified settings. Size
   rotation does not guarantee deletion at a fixed age or control edge retention.
   Use a real private support contact if provided, never invented details or a
   public issue for private records.
4. Preserve the direct Kroger image request, possible existing-cookie and
   product/cart destination disclosures. Preserve the optional Cart session
   explanation when enabled; closing a page does not immediately erase its
   server-memory session.
5. Keep **Privacy**, **Use notes**, official terms, lawful-use restrictions and
   independent-project notice visible. Recheck the delivered page against actual
   behavior before release or a change in collection, sharing or retention.

No analytics or external AI forwarding is built into the app. Hosting can add
behavior, so inspect the delivered page as well as source. An assistant recipient
and historical collection/display each require applicable source permission.

## 6a. Optional Compose installation

This separate path uses Linux containers, Docker Engine and modern Compose.
Follow [Docker's installation guide](https://docs.docker.com/engine/install/)
for your platform. Container compatibility and your host/network must be tested
separately from native Windows checks.

1. Obtain the reviewed source and open a terminal in its folder. Run
   `docker version` and `docker compose version`; both should work.
2. Copy `.env.example` to private `.env`, and `compose.example.yaml` to private
   `compose.yaml`. Both private files are ignored by Git. Use your secret manager
   to create `PROMOTION_SERVICE_TOKEN` in `.env`; Compose requires it even when
   source permission is pending. Keep Kroger credentials blank initially and
   Cart flags false. Keep `PUBLIC_ORIGIN=http://localhost:4173` for this local
   example, or configure your actual origin before hosting.
3. Review the recipe: `app` publishes only `127.0.0.1:4173`; `promotions` has no
   host port and shares the token privately with the app. Only the promotion
   service mounts the persistent `promotions-data` volume during ordinary use.
   The web app reaches `http://promotions:4174` and opens no local database.
4. The optional `collector` is in the **operator** profile and stays off during
   ordinary startup. Do not enable the profile or run its write command until
   [history prerequisites](HISTORY.md) are met. Its mere presence starts no
   collection or schedule.
5. Build and start the reviewed private configuration:

   ```text
   docker compose -f compose.yaml build
   docker compose -f compose.yaml up -d
   docker compose -f compose.yaml ps
   ```

6. Open `http://localhost:4173/apps/houston-i-love-kroger/`. Expect setup mode,
   disabled searches, no invented groceries, disabled Cart and permission-gated
   history. The app status route should return `configured: false` and a history
   capability status. Health checks confirm reachable listeners, not live rights.
7. After actual current-price access is established, supply credentials privately
   and recreate the affected service from the reviewed configuration. Exercise
   the real task and privacy notices. Do not enable collection as a side effect.
8. Stop while preserving storage with:

   ```text
   docker compose -f compose.yaml stop
   ```

The image uses `node:22.23.2-bookworm-slim` by default. For a release record the
resolved image digest and qualify it; the build accepts `NODE_IMAGE` for an
explicit reviewed image reference. It installs locked dependencies using
`npm ci --ignore-scripts --omit=dev` and checks the native binding with an
in-memory `SELECT 1`. It installs no compiler toolchain. Requalify new runtime
images or CPU architectures; never copy host `node_modules` into Linux.

The strict build context excludes private configuration, history, Git data,
fixtures and skill files. The image includes runtime source, migrations and
operator scripts; it loads no `.env` by itself. Compose supplies environment
settings. It runs as the unprivileged `node` user with read-only source, dropped
capabilities and starting limits of 0.5 CPU, `256m` memory and 64 processes per
service. Logs rotate at 1 MB/two files; this is not a time-based retention rule.
The complete `/data` directory must be writable to the service identity for
SQLite and its sidecars. Existing volumes need compatible ownership/access.

For HTTPS hosting, place your own reverse proxy before the loopback app port.
Keep the full base path and public `Host`, disable caching/retries/access logs
on these routes, and allow enough time for the app's 35-second deadline. A
host-based NGINX example inside your reviewed HTTPS server is:

```nginx
location = /apps/houston-i-love-kroger {
    access_log off;
    return 308 /apps/houston-i-love-kroger/;
}
location ^~ /apps/houston-i-love-kroger/ {
    access_log off;
    proxy_pass http://127.0.0.1:4173;
    proxy_set_header Host $host;
    proxy_cache off;
    proxy_buffering off;
    proxy_read_timeout 40s;
    proxy_next_upstream off;
}
```

A containerized proxy needs reviewed private network wiring and an app-resolving
upstream instead; its own `127.0.0.1` refers to that proxy container. Do not expose
the database service to solve routing. NGINX documents path preservation in
[proxy_pass](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).
For 502s check listener, path, Host and network route. For storage failures check
volume access/free space; never use volume deletion as a restart or upgrade.

## 7. Back up, upgrade and recover

1. Stop the app, private service and any operator collector/maintenance writer.
   Prevent a supervisor from restarting them. In Compose, stop all affected
   services and jobs, while preserving the named volume.
2. Make a consistent private backup of the authoritative database and remaining
   `-wal`/`-shm` sidecars together while writers are stopped. Do not copy a live
   SQLite file alone. Backups obey the same retention/revocation duties.
3. Keep private source-policy evidence separately. Retain the previous reviewed
   code/image and compatible stopped-state backup as the rollback reference.
4. Install the reviewed update with `npm ci --ignore-scripts`, or rebuild the
   container from the exact committed source. Run checks and evaluate actual
   supported interfaces before release.
5. Schema version **6** preserves the description/brand and paging additions from
   version 3 and adds completed-snapshot permission, retention, target and product
   availability facts introduced in version 4, then adds private collector lease,
   rolling request reservations and backoff, then adds directory rights,
   ZIP-query snapshots/store metadata and explicit labels for new completed
   product jobs. Existing topic hashes stay unnamed. Stop all collectors and services
   before upgrading; do not run mixed-version collectors against one file.
   Verified version 1/2/3/4/5 databases upgrade transactionally
   after checksum/schema checks. Legacy missing text or snapshot provenance is
   never guessed: latest-deal reads cannot use unqualified old snapshots, while
   dated reads still require valid row provenance and rights. Unknown or modified
   schemas are refused.
6. Recheck listener status, exact-store products, list calculations and permitted
   history search/retrieval. Record the exact source/image, actual checks and
   untested paths. Liveness alone does not qualify the upgrade.
7. An older version cannot open schema 6. For rollback, stop services and restore
   a compatible, still-authorized backup with its matching version. There is no
   in-place schema downgrade. Account for new observations since the backup and
   reconcile expiry, scope and revocation before serving any restored data.

Purge removes scoped database rows, not guaranteed physical traces in free pages,
WAL, backups or devices. Qualify a separate erasure process if your agreement
requires one. No production backup service or successful recovery rehearsal is
established by these instructions. See [history maintenance](HISTORY.md) and
[service recovery](PROMOTION_SERVICE.md#7-upgrade-recover-and-troubleshoot).

## 8. Optional stored ZIP and topic discovery

An assistant can discover stores and collected topics through our database
without using the live human store-search endpoint. This requires a basis covering
directory database collection and the intended display/recipient uses, explicit
operator-chosen ZIPs and a completed directory collection. Product API access or
a product-history policy does not supply that basis unless its actual scope also
covers the directory. Agent access alone does not require Partner enrollment.

1. Finish the private service setup in [section 4a](#4a-native-private-promotion-service).
   Keep its token private. The public app needs no new credentials, database
   mount or AI-provider adapter; it proxies the new fixed read operations.
2. Read [the directory operator guide](HISTORY.md#collect-a-stored-zip-directory-separately)
   and obtain the actual source/recipient grant before enabling anything.
3. Copy the disabled `config/store-directory-plan.example.json` into the private
   directory plan. Enter only explicit approved ZIPs. Prepare the separate
   reviewed directory-policy metadata privately; never put private agreements,
   credentials or personal details into Git or assistant chat.
4. Use `npm run stores:collect -- --help` and its dry run first. A dry run makes
   no network/database/policy operation and reports its inspection limits.
   Default pending/disabled plans make zero source requests and store no results.
5. After the grant/configuration are qualified, run the bounded operator job once
   against the service's authoritative database. Keep scheduling external and
   finite. The runtime container includes `scripts/collect-stores.js` and the
   disabled example; private live plans/policies must be supplied privately,
   like the existing history operator task. Do not initialize a separate web
   database and assume the service sees it.
6. Ask the stored-only companion client for `promotions.py stores --zip ZIP`, using the actual app address and
   established recipient authority. It returns stored name/address/ID facts,
   observation time and fixed ten-mile/first-ten query limits. Choose the exact
   store, then use `topics --store STORE_ID` to discover readable completed scope.
   These reads never contact Kroger. The full human/CLI steps are in the
   [user guide](USER_GUIDE.md).
7. Check fresh-empty, no-data, stale, denied and service-failure recovery before
   offering this workflow. No failure should become an empty-directory claim
   or a live fallback. New source collection must remain disabled without rights.

The service's existing `PROMOTION_MAX_AGE_SECONDS` controls the stored directory
and topic freshness threshold too, default 86,400 seconds. This is an operator
policy, not a supplier availability promise. A source first page is not all
nearby stores or full promotion coverage. Clear old selections when the ZIP,
store, snapshot, permission or installation changes.

Schema 6 is required. Follow the stop-all-processes/consistent-backup procedure
above before upgrading. An older file's topic hashes remain unknown until new
permitted completed collections retain labels; no backfill or private-plan
guessing occurs. Separate rights still gate real collection and public output.

## 9. Install the parallel shopping companion

Current agent shopping uses the same app server as human browsing. It does not
need the optional private history service or directory database. Keep Cart
disabled unless a separate explicitly authorized workflow requires it; the
companion has no Cart commands.

1. Obtain the reviewed app/skill version containing `skills/houston-i-love-kroger`.
   Keep the entire skill folder, including both Python clients and manuals.
   This guide describes a development candidate until its release is verified.
2. On the assistant's execution host, install Python 3.12+ if needed. In a terminal
   run `python --version` (or `python3` on hosts that use that name). There are no
   Python packages or model SDKs to install. Local checks used Python 3.14;
   other hosts need their own execution checks.
3. Follow that assistant's actual import/local-folder instructions. This project
   provides no automatic hosted connector. A remote assistant cannot reach
   another computer's localhost merely because the folder was copied there.
4. Supply only the app base URL ending `/`, through `--base-url` or optional
   `HOUSTON_APP_URL`. HTTPS is required except loopback HTTP. Do not give the
   companion Kroger credentials, private service tokens or database access.
5. From the complete skill folder run:

   ```text
   python scripts/shopping.py --help
   python scripts/shopping.py status --base-url http://localhost:4173/apps/houston-i-love-kroger/ --json --no-input
   python scripts/shopping.py products --store TEST0001 --term milk --summary-only --dry-run --json --no-input
   ```

   Replace the status address with the actual installation URL. The final
   command is a synthetic preview, making no network request or price claim.
   Configured status is not proof of valid access; history permission is
   separate from current shopping. A missing new route means check the base
   path and deployed app version, not configure a database to repair it.
6. Review the chosen assistant/tool/provider's actual retention and secondary-use
   controls against source terms and user privacy. Use the
   [recipient guide](../skills/houston-i-love-kroger/references/source-permissions.md).
   Full records require a valid existing review; `--data-use-approved` only
   acknowledges it. Unknown controls leave a record-output gap; fixed summaries
   are available for authorized diagnostics. No persistent search/catalog logs,
   cache, model training or independent/onward reuse belongs to the task path.
7. Follow [assistant shopping](USER_GUIDE.md#9-ask-an-assistant-through-the-app):
   understand the list, find ZIP choices, wait for exact-store confirmation,
   search requested groceries, match packages and freshly estimate selected
   quantities. Check full/partial results, unknown currency/basis and finite
   coverage. The client does not save a list or start a collector.

Use `promotions.py` separately for explicit saved directory/topic/deal/price and
dated-history reads. Its missing/stale results never automatically become live
shopping. Remove the imported skill folder using your host's normal mechanism
to stop companion discovery; this does not stop your app server or erase history.
