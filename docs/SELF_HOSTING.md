# Install, configure and run the app

These instructions use no particular AI product or hosting company. Local
operation has been checked on Windows with Node.js 22.23.2; other operating
systems and production hosting have not yet been qualified.

## 1. Prepare your computer

1. Download a supported Node.js LTS release from [Node.js](https://nodejs.org/).
   Include npm when installing. This project requires Node.js 22.21 or newer;
   use a release supported by the native database package as well.
2. Open Terminal on macOS/Linux or PowerShell on Windows.
3. Run `node --version` and `npm --version`. Both should print a version.
   If either command is missing, close and reopen the terminal after installation.
4. Obtain a reviewed source checkout or archive from the project's distributor
   and put it in a folder you control. If it is an archive, extract it first.
   A public repository or downloadable release has not been verified at this
   development checkpoint; this guide does not supply an unverified download URL.
5. In the terminal, change into the project folder. You should see `package.json`
   when opening that folder in your file manager.
6. Run `npm ci`. Wait for it to finish. It installs the locked dependencies,
   including the native SQLite adapter. If the adapter is unavailable for your
   system, retain the error for diagnosis; do not disable dependency checks or
   install an unrelated database package as a substitute.

## 2. Try the page before adding credentials

1. Run `npm start`.
2. Open `http://localhost:4173/apps/houston-i-love-kroger/` in your browser.
3. Expect a setup notice. The app does not display made-up stores or offers.
4. Leave the terminal open while using the page. Press Ctrl+C to stop it.

Starting the server creates the private history database if needed. It does not
start price collection, sign in to a shopper account or contact Kroger for a
search merely because you opened the page.

## 3. Obtain and configure API access privately

1. Open the [Kroger developer portal](https://developer.kroger.com/). Read its
   official [Quick Start](https://developer.kroger.com/documentation/public/getting-started/quick-start),
   [Applications Help](https://developer.kroger.com/documentation/support/website-help/applications),
   [Acceptable Use](https://developer.kroger.com/documentation/public/getting-started/acceptable-use)
   and [Terms](https://developer.kroger.com/terms). Check that your intended use
   is covered before requesting or using access. This project's software license
   does not grant supplier permissions.
2. Follow the portal's current account and application-registration instructions
   in your own browser. Complete any account verification it requires. If you
   previously submitted an application and the response was uncertain, inspect
   your application list or ask Kroger support before submitting another.
   This project has not verified an authenticated registration or credential
   issuance, so these steps do not promise approval or specific account controls.
3. Use an application name allowed by Kroger's current registration rules. The
   repository name is not a recommendation for the registered name. If a portal
   step asks for information you cannot supply truthfully, pause and use Kroger's
   help; do not invent a deployed site or a working callback.
4. Obtain your own client ID and client secret with access for Locations and the
   public Products operations used here, using the official Quick Start.
   This application needs the Products `product.compact` scope. It does not use
   Cart or Identity and does not require a shopper's password.
5. In your file manager, copy `.env.example` to a new file named `.env` in the
   project folder. Ensure the filename is exactly `.env`, not `.env.txt`.
6. Open `.env` in a private local text editor. Enter your client ID after
   `KROGER_CLIENT_ID=` and client secret after `KROGER_CLIENT_SECRET=`.
   Never put these values in a chat, screenshot, issue, command argument or
   browser script. Do not use an online credential encoder.
7. Keep `KROGER_ENVIRONMENT=production` for real data, or choose `certification`
   for that environment. Certification responses are not verified store prices;
   production history is never attached to them.
8. Save the file and restart with `npm start`. The page's setup notice should
   clear when both settings are present. A configured status means settings were
   loaded; the first successful search is separate evidence of API access.
9. Enter a ZIP, choose a returned store, and check the result. If access is
   rejected, check the selected environment, application status and scope in the
   portal. Do not paste the secret into troubleshooting messages.

`.env` is ignored by Git. That does not protect it from file sharing, backups,
screenshots or a public web directory. Limit access to the operator and runtime.

## 4. Understand the settings

| Setting | Default / purpose |
|---|---|
| `HOST` | `127.0.0.1`, accessible only from this computer |
| `PORT` | `4173`; change it if another program already uses that port |
| `APP_BASE_PATH` | `/apps/houston-i-love-kroger/`; begins and ends with `/`; `/` is also supported |
| `PUBLIC_ORIGIN` | Blank locally; an exact origin such as `https://your-domain.example`, without a folder path |
| `KROGER_ENVIRONMENT` | `production` or `certification` |
| `HISTORY_DB_PATH` | Blank uses this project's `.runtime/history.sqlite`; an explicit file path can place it on private persistent storage |

Use a private deployment environment or secret manager instead of `.env` when
your host supports it. No credential value is public configuration. Relative
history paths resolve against the process working directory; use an absolute
private path in a service configuration. See [history operations](HISTORY.md).

## 5. Operate and troubleshoot locally

- **Page cannot connect:** check the terminal is running, then open the exact
  port and folder path.
- **Port already in use:** stop your own earlier instance or choose a different
  `PORT`. Do not stop another person's application.
- **Setup notice persists:** check `.env` spelling, both credential fields and
  restart. Do not share the file.
- **No promotions:** try a specific product or brand. The starter sample is
  deliberately small; missing data does not mean the whole store has no deals.
- **Search limit or busy message:** pause, then try again. The app bounds its
  work and does not silently bypass Kroger's quota.
- **Database cannot open:** check the chosen folder is writable and private.
  The app refuses symlink paths or an unrelated/incompatible database. Never
  erase a database just to make the error disappear.
- **History is unavailable:** current prices may still work. Configure history
  only after the source permission described in [HISTORY.md](HISTORY.md) exists.

Run `npm run check` and `npm test` after changing the code. The automated tests
use synthetic fixtures and temporary databases; passing them does not establish
live API entitlement, completeness of promotions or source retention rights.

## 6. Prepare hosting

Hosting is unfinished and the proposed public URL is not deployed. Before
publishing, complete the exact-candidate licensing and legal-liability review,
verify live access and test the actual host. MIT is selected for original project
code and companion instructions; it does not authorize hosting supplier data.
The source-release guide linked from the repository README defines the public
source boundary.
Do not treat these local instructions as deployment evidence.

A host needs a supported Node.js runtime, private persistent local storage for
SQLite, HTTPS at the public edge, a process supervisor, a private credential
store and a reverse proxy that preserves the configured path. Set
`PUBLIC_ORIGIN` to the actual HTTPS origin before binding beyond loopback. Bind
to a private interface where possible. Do not expose the database, source tree,
`.env`, collector plan, policy files or development fixtures through the proxy.

This prototype's request limits and API budget are local to one process and
reset on restart. Multiple replicas do not share them. Before a public launch,
verify supplier quota, edge rate limits, shared budgeting, traffic admission,
availability, backup and deletion behavior. Keep access logs from recording
search bodies, shopper IP histories or catalog payloads; inspect your proxy and
host defaults. No analytics or external AI forwarding is built into the app.

## 7. Back up, upgrade and recover

1. Stop the app and any collector you started with Ctrl+C before making an
   offline backup. Ensure your service supervisor will not restart them.
2. Back up the private database and any remaining SQLite `-wal`/`-shm` sidecars
   together while all writers are stopped. Backups require the same source
   retention, expiry and revocation controls as the live database.
3. Keep source-policy evidence outside public code and back it up privately.
4. For an upgrade, retain the previous reviewed code and a stopped-state database
   backup. Install dependencies with `npm ci` and run checks before restarting.
5. The current schema is version 2; the verified version-1 schema upgrades in a
   transaction. Migration checksum checks reject unexpected or incompatible
   contents. Do not use an older app against a newer schema.
6. Restore only a compatible, still-authorized backup into a private location
   while services are stopped. Reconcile expiry and revocations before serving.

Do not copy a running SQLite file by itself or put it on an unqualified shared
network drive. Backups and a recovery rehearsal are operator responsibilities;
no production backup service has been configured here.
