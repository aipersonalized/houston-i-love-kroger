# Houston I Love Kroger

Compare reported Kroger promotions at the store you plan to visit. Enter a ZIP
code, choose the exact store, then search a grocery or brand and order the
returned offers by savings or promo price.

This is an early source release. Original project code and companion
instructions use the [MIT License](LICENSE). Live API access and permission to
collect and display historical prices remain unverified. Promotion searches
cover a limited set of products, not a complete weekly ad or coupon feed.

[Setup](docs/SELF_HOSTING.md) · [Shopping guide](docs/USER_GUIDE.md) ·
[HTTP API](docs/API.md) · [Companion skill](skills/houston-i-love-kroger/SKILL.md)

## Try it locally

You need Node.js 22.21 or newer with npm and a compatible native SQLite build.
Local operation has been checked on Windows with Node.js 22.23.2; other systems
and production hosting still need verification. No external AI service,
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
   expect **This installation needs a Kroger connection**. This lets you check
   that the page and local server are connected. It does not test Kroger access.
4. Follow [private API setup](docs/SELF_HOSTING.md#3-obtain-and-configure-api-access-privately),
   save credentials only in your local configuration and restart the server.
5. When access is available, enter a five-digit US ZIP, select **Find stores**,
   check the store's full ID and address, then select **Choose this store**.
   The initial sample searches milk, bread and eggs. Search `coffee`, for example,
   to request a different limited set. Read the displayed scope and retrieval
   time; empty results do not establish that the store has no promotions.

Leave the terminal open while using the app. Press Ctrl+C to stop it. Starting
the server creates private history storage, but does not collect prices. If the
page cannot connect or API access is rejected, use the
[troubleshooting steps](docs/SELF_HOSTING.md#5-operate-and-troubleshoot-locally).

## What the comparison means

| Task | Result and limits |
|---|---|
| Choose a store | Up to ten nearby locations from the ZIP search; check the exact store before using its prices. |
| Browse or search | A small starter sample, or up to 50 products for a grocery/brand term. Only qualifying reported promotions appear. |
| Order returned offers | Biggest dollar savings, highest percent off or lowest promo price; ordering does not find more products. |
| Read unit estimates | Source-reported numeric estimates. Their measurement basis is unreported, so they are not verified prices per ounce, pound or item. |
| Compare collected history | Only suitable earlier observations for the exact store and item, after source permission is established. A new database is empty. |

Savings compare the current reported regular and promo prices. They do not
compare today's price with a previous sale. Check item identity, package size,
loyalty or purchase conditions, price and stock with your store before buying.
The app does not clip coupons, manage a cart or place orders.

The browser sends searches to the installation's Node.js server, which queries
Kroger. The same [JSON API](docs/API.md) supports humans, agents and other
authorized clients. The app sends no data to an external AI service. An optional
agent or hosting service has its own data handling and permission requirements;
running the app locally does not establish permission to forward catalog data.

## Price history

The app has a real SQLite database and a separate, bounded collection command.
No historical prices are supplied or invented. Collection starts disabled:
Kroger's public acceptable-use rules restrict systematically collecting API
responses into a database. Actual permission covering retention and display
must be established before enabling that source. See
[history setup and operation](docs/HISTORY.md) and the
[unsent permission-request draft](docs/KROGER_PERMISSION_REQUEST.md).

History is tied to the exact store and item. A source-reported estimate without
a measurement basis is never relabelled as a verified price per ounce or pound.
Historical comparisons describe retained observations, not every past sale.

## Guides and development

- [Use the app](docs/USER_GUIDE.md)
- [Install, configure and host it](docs/SELF_HOSTING.md)
- [Use the shared human/agent HTTP API](docs/API.md)
- [Configure the history database and collector](docs/HISTORY.md)
- [Companion assistant skill](skills/houston-i-love-kroger/SKILL.md): authored
  candidate for the app's API; live agent qualification remains unfinished.
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
