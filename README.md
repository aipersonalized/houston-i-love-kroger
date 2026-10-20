# Houston I Love Kroger

Plan your Kroger trip with prices for the store you actually visit. Enter a ZIP
code, choose your store, browse regular prices and reported promotions, then
build a shopping list with an estimated total and items grouped by aisle.

Original project code and companion instructions use the [MIT License](LICENSE).
Searches cover a limited set of products, not a complete weekly ad or coupon
feed. Historical collection still requires actual source permission; the
database service never fills that gap with sample prices.

[Setup](docs/SELF_HOSTING.md) · [Shopping guide](docs/USER_GUIDE.md) ·
[HTTP API](docs/API.md) · [Companion skill](skills/houston-i-love-kroger/SKILL.md)

For integration work, the optional [Kroger API reference skill](skills/kroger-api/SKILL.md)
includes a [step-by-step setup guide](skills/kroger-api/references/user-guide.md).
It collects public documentation locally; it is separate from the shopping app
and supplies no credentials or grocery API access. Supplier documents are
excluded from this project's source distribution.

[Open the hosted app](https://aipersonalized.io/apps/houston-i-love-kroger/)
or run your own installation below. A hosted operator controls its enabled
features and source permissions.

## Try it locally

You need Node.js 22.21 or newer with npm and a compatible native SQLite build.
Local operation has been checked on Windows and in a Linux container with
Node.js 22.23.2; other environments still need verification. No external AI service,
AI subscription or Kroger shopper account is required. You supply your own
permitted Kroger developer access; hosting and provider conditions are separate.

1. Open the [project repository](https://github.com/aipersonalized/houston-i-love-kroger),
   select **Code**, then **Download ZIP**. Extract the downloaded archive to a
   folder you control, or use a reviewed source checkout. Follow the
   [full installation guide](docs/SELF_HOSTING.md) for Node.js installation and
   common setup failures.
2. Open PowerShell on Windows, or your system's terminal, in the folder containing
   `package.json`. Run these commands one at a time:

   ```text
   npm ci --ignore-scripts
   npm test
   npm start
   ```

   The locked dependencies supply prebuilt SQLite bindings. Installation skips
   unnecessary native-build scripts; the tests check that the binding works
   using synthetic fixtures and temporary databases.

3. Open `http://localhost:4173/apps/houston-i-love-kroger/`. Without credentials,
   expect **Store searches aren’t ready yet.** This lets you check
   that the page and local server are connected. It does not test Kroger access.
4. Follow [private API setup](docs/SELF_HOSTING.md#3-configure-current-price-access-privately),
   save credentials only in your local configuration and restart the server.
5. When access is available, enter a five-digit US ZIP, select **Find stores**,
   check the store's name and address, then select **Choose this store**.
   The initial sample searches milk, bread and eggs. Search `coffee`, for example,
   to request a different limited set. Read the displayed scope and retrieval
   time; empty results do not establish that the store has no promotions.

Leave the terminal open while using the app. Press Ctrl+C to stop it. Starting
the server creates private history storage, but does not collect prices. If the
page cannot connect or API access is rejected, use the
[troubleshooting steps](docs/SELF_HOSTING.md#5-troubleshoot-locally).

## What the comparison means

| Task | Result and limits |
|---|---|
| Choose a store | Up to ten nearby locations from the ZIP search; check the exact store before using its prices. |
| Browse or search | A small starter sample, or up to50 products for a grocery/brand term. Browse priced items or filter reported promotions; a regular price without a reported promo is not a broken price. |
| Order returned offers | Largest price drop, highest percent off or lowest reported price; ordering does not find more products. |
| Plan a shopping list | Visit-only quantities, an estimated total and aisle grouping for the selected store. Unknown/variable-weight prices stay unresolved; no checkout total is promised. |
| Read product and store details | Original product photos, package information, supplied labels and store hours/departments where Kroger provides them. Missing fields stay unknown. |
| Read unit estimates | Source-reported numeric estimates. Their measurement basis is unreported, so they are not verified prices per ounce, pound or item. |
| Compare collected history | Only suitable earlier observations for the exact store and item, after source permission is established. A new database is empty. |
| Ask an assistant about deals | The companion skill reads our database service for fresh collected deals, regular prices and quantity estimates. It does not call Kroger or collect data. Source permission, freshness and exact-store checks apply. |
| Read past prices | Search and retrieve permitted dated observations separately from current deal recommendations. A past sale is not automatically a current offer. |

Savings compare the current reported regular and promo prices. They do not
compare today's price with a previous sale. Check item identity, package size,
loyalty or purchase conditions, price and stock with your store before buying.
Currency is not supplied with current prices. The page shows numeric amounts
without assuming a currency symbol; list subtotals add only the resolved amounts.
The app does not clip coupons or place orders. An optional Cart connection can
add specifically requested items after shopper sign-in, when the installation
has the required Kroger access and registered callback. It starts disabled.

The browser sends searches to the installation's Node.js server, which queries
Kroger. The [JSON API](docs/API.md) provides live browsing for the human page and
separate database-only operations for the companion skill. The app sends no data
to an external AI service. An optional
agent or hosting service has its own data handling and permission requirements;
running the app locally does not establish permission to forward catalog data.

## Price history

The app has a real SQLite database, an independently running promotion data
service and a separate, bounded collection command.
No historical prices are supplied or invented. Collection starts disabled:
Kroger's public acceptable-use rules restrict systematically collecting API
responses into a database. Actual permission covering retention and display
must be established before enabling that source. See
[history setup and operation](docs/HISTORY.md) and the
[unsent permission-request draft](docs/KROGER_PERMISSION_REQUEST.md).

For the separate database service, follow
[promotion service setup](docs/PROMOTION_SERVICE.md). The web app talks to its
private authenticated HTTP API; agents use the public app proxy, not the database
file or a supplier secret. Deal lookup, price checks, estimates and history reads
never trigger collection or fall back to Kroger. Empty or stale collected data
stays unavailable until the operator has a permitted, completed collection.

History is tied to the exact store and item. A source-reported estimate without
a measurement basis is never relabelled as a verified price per ounce or pound.
Historical comparisons describe retained observations, not every past sale.

## Guides and development

- [Use the app](docs/USER_GUIDE.md)
- [Install, configure and host it](docs/SELF_HOSTING.md)
- [Use the shared human/agent HTTP API](docs/API.md)
- [Configure the history database and collector](docs/HISTORY.md)
- [Run the promotion database microservice](docs/PROMOTION_SERVICE.md)
- [Companion assistant skill](skills/houston-i-love-kroger/SKILL.md): authored
  instructions and a provider-neutral Python CLI for collected deals, price checks,
  shopping-list estimates and dated history. Actual recipient/source permission
  remains installation-specific.
- [Prepare a source release](docs/RELEASING.md): publication scope and operator checks.
- [Dependency notices](THIRD_PARTY_NOTICES.md)

For code changes, run:

```text
npm run check
npm test
```

These checks use synthetic fixtures and temporary databases. They do not verify
live API access, complete promotion coverage, source rights or real agent use.
The app uses Node.js, browser-standard HTML/CSS/JavaScript and SQLite.

## Help and feedback

Maintained by [aipersonalized](https://github.com/aipersonalized). For a hosted
installation's connection problems, contact its operator. A public project issue
tracker and private security-reporting route have not been established at this
checkpoint; no response time is promised. When a reporting route is available,
include the app version, operating system, steps to reproduce and the app's
error code. Remove credentials, personal information, private configuration,
database contents and raw API responses before sharing a report.

## License and source terms

See [LICENSE](LICENSE) for the MIT terms covering original project code and
companion instructions, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for
dependency notices. The software license does not grant Kroger API access,
catalog-data retention or redistribution rights, or trademark permission.

Independent project; no affiliation, endorsement or sponsorship by Kroger is
claimed. Source data, trademarks and third-party materials retain their own
terms. Source publication, live service operation and history collection have
separate checks described in the [release guide](docs/RELEASING.md).
