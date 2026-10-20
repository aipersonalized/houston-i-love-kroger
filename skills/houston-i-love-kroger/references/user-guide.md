# Install and use the companion skill

## Detailed Content

### 1. Choose human use or assistant use

This companion lets an assistant use the app API alongside the human web page:
find stores, match requested products/packages, recheck prices and estimate
quantities. Its explicit current-shopping commands can make the app contact
Kroger. Separate stored-only commands read collected deals and dated history;
neither starts collection or manages Cart. For the human page, read
`research/official_docs/pages/USER_GUIDE.md` in full to use those yourself.
No browser or supplier credentials are needed by the companion.

Original project materials use the repository's MIT LICENSE. Get the complete
project or companion folder from its actual supplied source. A folder copy does
not deploy a service, grant rights to supplier data or qualify an installation.
To self-host the app, read `research/official_docs/pages/SELF_HOSTING.md` and
`research/official_docs/pages/PROMOTION_SERVICE.md` in full. They cover the
operator's private app/service/database setup. Keep tokens and credentials out
of chat. The assistant only needs the app's public base URL.

### 2. Make the complete skill available to your assistant

1. Find `skills/houston-i-love-kroger` in the project. Keep `SKILL.md`,
   playbooks, references, schemas, scripts and collected manuals together.
   Copying only the entry file leaves the skill incomplete.
2. Follow your assistant host's actual local-skill import or folder instructions.
   This portable bundle does not choose a vendor-specific folder or plugin.
3. If the host reads local files but has no importer, explicitly ask it to read
   this folder's `SKILL.md`. That is manual use, not verified automatic discovery.
4. Refresh the session only as that host requires. Ask it to describe the skill.
   Expect current shopping plus separate stored ZIP choices, completed topics,
   collected prices/deals and dated history, an actual
   app URL and permitted data recipients.
5. Check whether it supports Python execution or a suitable app API client.
   This bundle does not install a remote connector. If unavailable, follow the
   human app guide yourself; an installed folder does not create a connector.

No provider API key, model SDK, `agents/openai.yaml` or particular model is
required. Discovery/import across assistant hosts has not been universally tested.

### 3. Establish the URL and permissions

1. Get the app base URL from the operator, including its folder path and ending
   slash, such as the synthetic local example
   `http://localhost:4173/apps/houston-i-love-kroger/`. Other hosts require HTTPS.
   You never need to give the assistant a Kroger key, private token or database.
2. Establish that source rights and user privacy cover every tool, assistant and
   model provider that receives results. Read `references/source-permissions.md`
   in full. Asking for help or passing an acknowledgement flag does not grant
   source/recipient rights. Underlying agreements remain private.
3. Give the assistant a five-digit ZIP through your permitted privacy channel to
   find current choices, or explicitly request saved choices; reuse a complete
   store ID you have already confirmed. It will ask which exact returned
   name/address you want before checking products. No separate browser visit is
   required. Collected topics matter only for stored price/deal requests.
4. Directory metadata and product/history data have separate permissions. A
   permitted store directory does not establish price access. Use the actual
   operation's result; a promotion-status gap does not by itself block the directory.

Missing recipient permission blocks source-record output. The assistant can
still explain installation and fixed status without loading disallowed records.

### 4. Install and check the portable tool

1. Install Python 3.12 or newer from [Python](https://www.python.org/downloads/)
   if needed. Open PowerShell on Windows or Terminal on macOS/Linux and run
   `python --version`. If your system uses `python3`, use that name throughout.
   Close/reopen the terminal after installation if the command is missing.
2. Open a terminal in the complete companion folder containing `SKILL.md`.
   There are no Python packages or AI SDKs to install.
3. Run `python scripts/shopping.py --help` for current shopping and
   `python scripts/promotions.py --help` for stored-only operations.
4. Check your installation:

   ```text
   python scripts/shopping.py status --base-url http://localhost:4173/apps/houston-i-love-kroger/ --json --no-input
   ```

   Replace the address with your actual app URL. `configured: true` exits 0 but
   does not prove live source access; false exits 3. Check environment/test-data
   labels. History can remain permission-required while current browsing works.
   `promotions.py status` separately checks stored service availability.

The app must run before this client can connect. The tool makes no private file
or database reads, follows no redirects, uses no ambient proxy/cookies, retries
nothing automatically and saves no results. Machine mode prints one JSON object
and never prompts. Python 3.14 was used for local deterministic qualification;
other platforms/runtime versions need their own execution checks.

### Try current shopping through your assistant

1. Check actual recipient retention/secondary-use controls using
   `references/source-permissions.md`. Do not send private agreements or keys to
   chat. Reuse a valid existing review. Unknown controls mean fixed summary
   diagnostics until the record-output gap is resolved.
2. Ask: "Find Kroger choices for my ZIP, let me choose the store, then help with
   two packages of whole milk and coffee. Prefer my stated brands and ask before
   substituting." Supply quantities/package preferences/budget only when wanted.
3. The assistant runs `shopping.py stores --zip ZIP` at your actual base URL,
   shows bounded returned names/addresses, and waits for your exact choice.
   A previous valid store choice is reused. A store-only request finishes here.
4. It uses `shopping.py products --store STORE_ID --term TERM` for requested
   groceries, or `deals` for promotion questions. Full records add
   `--data-use-approved --json --no-input` after actual recipient rights exist.
   Use `--summary-only` for fixed counts without products/IDs/prices/ZIP.
5. Review matched brand, package size and variant. Unknown matches and unwanted
   substitutions stay unresolved. Searches are fuzzy, at most fifty products
   per page; reported per-unit estimates have no known measure basis.
6. A direct package check uses `shopping.py product --store STORE_ID
   --product-id PRODUCT_ID`. Use actual returned thirteen-digit IDs, preserving
   zeros. Known valid selections do not require repeated store discovery.
7. For accepted quantities, use `shopping.py estimate --store STORE_ID --item
   PRODUCT_ID ITEM_ID QUANTITY`, repeating --item for 1–10 distinct selections,
   whole quantity 1–99. Add the same base URL and output-permission flags.
   The app freshly rechecks products and calculates; you send no prices.
8. Read every unresolved line beside the numeric subtotal. The supported live
   model reports no currency, so the amount is unqualified arithmetic without
   a currency symbol or verified budget fit. Tax, fees, coupons and checkout
   changes are excluded. No resolved line means unknown, never free.
9. Ask separately for past prices when useful. Missing history is a data/rights
   gap, not permission to start collection. No companion command calls Cart.

From this folder, a synthetic preview you can copy is:

```text
python scripts/shopping.py estimate --store TEST0001 --item 0000000000001 00001 2 --summary-only --dry-run --json --no-input
```

Expect preview/network false/writes false, with no real price or checked time.
Replace all synthetic identifiers with actual confirmed selections before a
real request. For an unavailable new route, check the complete base URL and ask
the operator to update the app; a newer local tool does not update a hosted site.
For 429/busy, wait; the client never automatically retries or changes modes.

### 5. Choose your store and available collected topics

You can ask: "Use the stored service to find Kroger choices for my ZIP. Ask me
which location I want, then show what fresh collected topics are available."
Supply your ZIP through a channel permitted by your privacy rules.

1. Preview with a synthetic ZIP:

   ```text
   python scripts/promotions.py stores --zip 00000 --summary-only --dry-run --json --no-input
   ```

   Replace 00000 with your five digits and supply the actual `--base-url`.
   The preview makes no network request. To read the saved directory after
   recipient permission is established, remove `--dry-run` and replace
   `--summary-only` with `--data-use-approved`. Full output includes store choices;
   summary output deliberately omits ZIP, names, addresses and IDs.
2. Check the directory's observation date and freshness. Choose the exact store
   by its returned name and address. The assistant waits for your choice; it
   does not pick the first result. These are saved results from a limited
   ten-mile/up-to-ten-location query, not live distances or every nearby store.
   Missing names/addresses must not be invented.
3. Discover completed topics using the confirmed ID:

   ```text
   python scripts/promotions.py topics --store TEST0001 --data-use-approved --json --no-input
   ```

   Replace TEST0001 with the exact returned ID and supply your app URL. Each
   returned topic has a collection date, fresh/stale state and product count.
   Zero can mean a completed empty topic. Only fresh relevant topics support
   current-price recommendations. They are saved collection labels, not live
   grocery search words or a complete store catalog.
4. Explain which groceries or budget question you want help with. The assistant
   uses relevant returned fresh topics for the following deal/price/estimate
   steps. If the intended category is unclear, it asks rather than choosing the
   first topic. Dated-history-only requests need the confirmed store, not a
   current topic.

An empty fresh directory means that saved query returned no stores. `no_data`
means the required saved directory or named completed topics are missing;
saved topics without readable names cannot be guessed. `stale` means the
saved facts are too old. Permission or connection failures remain separate.
The assistant explains the operator/data gap and never calls Kroger or starts
collection to fill it.

### 6. Read latest collected deals

A useful assistant request is: "Use our stored service for my accepted store
and approved milk topic. What's a good discount, and what has a low package
price? Keep the collection date and limited coverage clear." Add a budget,
brand or category preference when it matters.

1. Preview a request using only synthetic example values:

   ```text
   python scripts/promotions.py latest --store TEST0001 --topic milk --summary-only --dry-run --json --no-input
   ```

   Expect `status: preview`, `network: false`, `writes: false`. TEST0001 is
   synthetic, not a selected store. Replace it and the topic with accepted real
   values and supply the same `--base-url` as your status check.
2. Remove `--dry-run` to send a bounded read. `--summary-only` prints fixed
   state/count/freshness facts rather than product names, prices or store IDs.
   It still reads the server and cannot authorize a prohibited data path.
3. Once actual source/recipient rights are established, replace
   `--summary-only` with `--data-use-approved` to receive deals. That flag
   acknowledges existing rights; server permission/retention checks still apply.
4. Read the snapshot observation/completion dates, age, freshness threshold,
   latest attempt and coverage before using any price. The default operator
   threshold is 24 hours; it does not guarantee supplier price validity or stock.
5. `available` with deals is a fresh dated result; `available` with none is a
   fresh completed empty topic. `no_data` means no usable completed exact-scope
   collection, while `stale` means the last completed sample is too old.
   `permission_required` is an authority gap. These latter states exit 3 and
   contain no deals. Do not ask the assistant to refresh Kroger or restore old
   history as if it were the latest result.
6. The default page is 20; `--limit` accepts 1–50. Follow `--cursor` only for
   the specified bounded task, keeping the same store, topic and page limit.
   If the server rejects a changed snapshot cursor, restart a bounded read and
   identify the new snapshot. Do not mix pages or sweep the catalog.

Keep full descriptions, item/package IDs, source prices and observation dates.
Savings are calculations from the stored pair. A missing normalized unit basis
stays unknown; package size cannot establish `$/oz` or `$/lb`. Latest rows do
not include a prior-history comparison. Confirm current price, conditions and
availability with the store before buying.

Expect a small explained selection in ordinary shopping language: product and
package, reported price, supported saving and why it fits your question. The
assistant distinguishes a good discount from low package spending and tells you
how many returned deals it selected. Raw IDs and technical fields are not the
default answer. Rankings cover fresh returned deals only; unnamed or incomplete
rows are not given invented names or unsupported recommendations.

### 7. Check a price and estimate requested quantities

The tool also reads regular-only prices and estimates selected quantities using
actual stored item prices. Neither operation calls Kroger, changes a cart or saves
a customer basket.

1. Read a bounded stored-price page for your accepted store and approved topic:

   ```text
   python scripts/promotions.py prices --store TEST0001 --topic milk --data-use-approved --json --no-input
   ```

   Replace the synthetic store/topic and supply your actual `--base-url`. Use
   `--summary-only` instead if you need fixed status/counts without source rows.
   Choose the intended product/package from actual returned records; known exact
   `--product-id`/`--item-id` can narrow the price read. Regular-only is a price
   fact, not a promotion. Unavailable/stale prices remain gaps.
2. Specify the selected product's actual IDs/topic and your desired whole-unit
   quantity. Preview safely using synthetic names:

   ```text
   python scripts/promotions.py estimate --store TEST0001 --item milk PRODUCT_ID ITEM_ID 2 --summary-only --dry-run --json --no-input
   ```

   Replace every synthetic name with the accepted returned identity and supply
   the actual app URL. `--item` is followed by topic, product ID, item ID and
   quantity, in that order. Quote text containing spaces in your shell. Repeat
   `--item` for up to 10 distinct product/item pairs. Quantities are whole numbers
   1–99; the request is at most 4 KB. The tool never accepts your own price values.
3. Remove `--dry-run` to read a real estimate. Once actual recipient permission
   is established, replace `--summary-only` with `--data-use-approved` to return
   line costs and totals. The service rechecks fresh source records and permission.
4. Read each named package, requested quantity, line amount, collection date and
   unresolved reason. Weight/unknown-quantity, missing, stale or unavailable lines
   have no supported amount. A partial subtotal excludes unresolved lines.
5. Check the currency and context qualifications next to the amount. Uniform
   unknown currency permits only an explicitly unqualified numerical sum with no
   currency symbol; mixed currencies have no combined total. Currency is never
   inferred from store location. A qualified subtotal needs matching source
   context and no unresolved lines. Tax, fees, coupons, eligibility verification
   and checkout changes remain excluded. `complete` means all requested lines
   were calculated; it never means an amount is guaranteed payable at checkout.

Ask the assistant to explain a budget fit or alternatives only using actual
compatible returned products and supported quantities. Expect a plain-language
qualified estimate, not an invented total. Compare prices with history only when
item/package, currency and basis match. `evaluatedAt` records estimate check time;
source observation dates still say when its prices were collected.

### 8. Search dated history or retrieve one observation

Use this separate route when you actually want earlier retained observations,
not as an automatic substitute for missing/stale latest data.

1. Run a bounded history search with your accepted store and actual app URL:

   ```text
   python scripts/promotions.py search --store TEST0001 --term milk --summary-only --json --no-input
   ```

   Replace TEST0001 and supply `--base-url`. Here `--term` is an optional
   literal description filter, distinct from latest `--topic`. Product/item
   IDs and `--from`/`--to` UTC times can narrow the scope. Use `--help`.
2. To return records after the actual permission check, replace
   `--summary-only` with `--data-use-approved`. Pages default to 20, maximum
   50; a matching `--cursor` keeps the same query and limits.
3. Retrieve a selected observation using its returned ID:

   ```text
   python scripts/promotions.py retrieve --store TEST0001 --observation-id 1 --data-use-approved --json --no-input
   ```

   Replace both synthetic IDs and provide your actual base URL. Permission and
   retention are checked again. `not_found` exits 3 and does not prove the
   promotion never occurred.
4. Read source, observation date, currency, item/package and qualification.
   Regular-only/unqualified observations are not verified promotions; past
   prices are not current checkout offers or proof of all-time lows.

History begins empty unless the operator has separately collected approved data.
Neither this tool nor human shopper searches populate it. Failed collection,
pending permission and empty retained history remain different results.

### 9. Recover without exposing private settings

Available data, complete/partial estimates and previews exit 0. A partial or
unqualified estimate still needs its stated limits. Exit 1 means a request/format failure, 2 means invalid inputs and 3 means a
permission/data/availability gap. Follow the fixed recovery, verify the actual
URL and respect request limits. A rejected cursor can require a new bounded
snapshot read; unavailable or stale data goes to the operator. Never post raw
errors, credentials, grants or private records in support requests.

Human app/self-hosting instructions are available even when agent transport or
permission is missing. They do not authorize the agent to run live searches,
collection, cart changes or source inquiries.

## Key Concepts

- **Skill installation:** making the whole folder available through a host's
  supported mechanism; it does not deploy a service or grant source rights.
- **Latest result:** a completed dated store/topic sample within an operator
  freshness threshold; it is not a live quote.
- **History result:** a retained dated observation with limited coverage.
- **Operational candidate:** authored instructions and bounded tool checks;
  model behavior and actual installation availability need separate evidence.

## Decision Criteria

| Need | Use |
|---|---|
| Assistant reads latest collected deals | Stored latest route with accepted store/topic. |
| Assistant examines past observations | Separate history search/retrieve route. |
| Check current item prices or requested quantities | Current-shopping product/recheck/estimate route; source-backed arithmetic, unknown currency and partial lines preserved. |
| Explicitly use saved prices/quantities | Stored prices and source-backed estimate route; preserve freshness/qualifications/partial amounts. |
| Find current nearby stores | Current ZIP lookup, bounded returned choices and exact person choice before products. |
| Explicitly choose saved stores/collected topics | Stored ZIP snapshot, exact person choice and completed-topic discovery. |
| Shop directly in the browser | Separate human page and collected human guide. |
| Run your own app/service | Collected self-hosting/private-service manuals. |
| Missing source authority or client | Setup/status explanation and human instructions without raw model exposure. |

## Constraints & Limits

No universal assistant-host import, platform, public deployment, live account
entitlement or supplier-data right is established by this guide. Copying the
skill installs no connector and permits no catalog forwarding. The root MIT
LICENSE covers original project material; supplier data rights are separate.

## Common Patterns

Use the requested mode's status when access is uncertain. Reuse a valid accepted
store and current authority, plus topic for stored prices. Read only the
requested bounded current or saved scope; finish with source dates, relevant
freshness, coverage and remaining gaps. No failure silently changes modes.
