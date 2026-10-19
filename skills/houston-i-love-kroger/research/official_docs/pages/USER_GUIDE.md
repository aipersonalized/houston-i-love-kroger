# Using Houston I Love Kroger

Choose a Kroger store, view a small sample of reported promotions, and search
for groceries you want to compare. The app shows current reported prices and
calculated savings. Historical comparisons appear only when suitable prior
observations exist.

This is an independent project in development. It is not affiliated with,
endorsed by, or sponsored by The Kroger Co. Kroger is a trademark of its owner.
An intention to release open source does not itself grant a software license;
consult the repository's licensing information before reusing the software.

## 1. Open a working installation

Use the address supplied by the person running your installation. A proposed
project address is
`https://aipersonalized.io/apps/houston-i-love-kroger/`; that proposal does not
mean the app has been published there. A self-hosted installation may use a
different address or path.

If you want to run the app yourself, follow the
[self-hosting instructions](SELF_HOSTING.md) first, then return to this guide.
You need an internet connection and a browser with JavaScript enabled. The app
does not ask for your Kroger customer account, loyalty number, payment details,
or an AI-provider account.

Wait for the connection check near the top of the page:

- If the ZIP code field becomes available, continue below. Having connection
  settings loaded does not prove that a live Kroger request will succeed.
- If you see **This installation needs a Kroger connection**, the installation's
  operator must complete API setup. **Check again** repeats the readiness check;
  it does not create credentials or finish setup.
- If you see **The store connection could not be checked**, check your internet
  connection and use **Check again**. If it persists, contact the operator.
- A **TEST DATA ONLY** banner means stores and prices are synthetic examples for
  testing. They are not shopping offers. A **SANDBOX DATA** banner identifies
  Kroger's certification environment, whose results are not verified live
  shopping offers.

## 2. Find and choose your exact store

1. Under **Find your store**, enter a five-digit US ZIP code in **ZIP code**.
   Do not enter a street address or a ZIP+4 code.
2. Select **Find stores**, or press Enter while filling the form.
3. Wait for the nearby-store list. The current search requests up to ten Kroger
   locations within ten miles. The displayed search limits describe the actual
   request; a store list is not a promise of every nearby location.
4. Match the store's name, address, and full **Store ID** to the location you
   intend to visit. Stores with similar names can have different prices.
5. Select **Choose this store** for that location.

The selected store's name, address, and full ID appear above its promotions. Check
this information before using any displayed price. The app immediately requests
the starter sample; you do not need to enter a product search first.

If no stores are returned, try another nearby ZIP code. The app does not request
your device's precise location. Changing the ZIP code clears the previous store
and its prices so that results from different areas are not mixed.

## 3. Read the starter promotion sample

The starter sample currently searches **milk**, **bread**, and **eggs**, requesting
up to 15 products for each topic, or 45 products before duplicate handling. The
page displays the queried topics and limits with the results.

Only qualifying item offers are displayed. An item needs a usable regular price
and a lower usable promo price. Results can exclude missing prices, invalid or
out-of-window promotion dates, reported out-of-stock items, conflicting duplicate
data, and other incomplete results. The exclusion summary explains the returned
data that could not be used. Products and item offers are different counts: one
product can contain more than one item offer.

This is a bounded product search. It does not enumerate all promotions in the
store, include the complete weekly ad, or provide a digital-coupon feed. A small
result count does not mean that the store has few promotions.

## 4. Search for groceries you care about

1. Keep the correct location selected.
2. In **Find a grocery or brand**, enter a product or brand, such as `coffee` or
   `apples`. Use 3–80 characters and no more than eight words.
3. Select **Search**, or press Enter in the field.
4. Read the new search scope and retrieval time above the results.

A specific search requests up to 50 products at the selected store. Results can
include related descriptions because Kroger's product search is approximate.
Check the complete product description and package size yourself.

To return to the starter sample, clear the search field and select **Search**.
Editing a search clears the previous results; submit the edited text to load a
new set. There is no automatic search on every keystroke.

If the page says **No qualifying promotions in these results**, try another
grocery or brand, or return to the starter sample. This message describes the
limited returned results, not every product or promotion at the store.

## 5. Choose how to order the returned offers

Use **Show first** above the offer list:

| Option | What it places first |
| --- | --- |
| **Biggest dollar savings** | The largest difference between the current reported regular and promo prices. This is the initial order. |
| **Highest percent off** | The largest calculated percentage reduction from the current reported regular price. |
| **Lowest promo price** | The lowest reported promo selling price among the returned offers. |

Changing the order rearranges the loaded results without sending a new product
search. It does not discover additional products. A new search starts with the
initial order again.

These rankings answer different questions. The lowest selling price can belong
to a smaller package, and the largest percentage reduction can save fewer
dollars. None of these options ranks by a standardized price per ounce, pound,
or item.

## 6. Understand an offer

Each offer keeps the full source description visible. Read its package size,
brand, item identity, and **Sold by** information where supplied.

- **Promo price** and **Regular** are the current prices reported by Kroger for
  that item at the selected store. They are not checkout quotes.
- **Save** shows the calculated difference between that pair of current prices,
  followed by the calculated percent reduction. It does not compare with a
  previous week, a competing store, or a previous promotion.
- **Reported unit-price estimates** show the numeric estimate or estimates
  supplied by Kroger. If only one is supplied, the missing estimate is marked.
  Kroger's current response does not provide a standardized unit basis, so the
  app does not label these values as dollars per ounce, pound, or item and does
  not derive a basis from package size. Do not use them as a fair unit-price
  comparison without verifying the measure separately.
- **Unit comparison unavailable** means no usable unit-price estimate was
  supplied. It does not mean the item has no size or that its selling price is
  zero.
- **Stock reported** is an advisory source value. Even a high stock report does
  not guarantee that the product is available when you arrive.
- **Effective** or **Expires** dates appear when suitable dates are supplied.
  Displayed times include the browser's local timezone abbreviation; an
  additional source timezone is identified where supplied. Missing dates are
  explicitly marked and do not establish how long an offer lasts.

The retrieval time identifies when the app obtained the response, not a promise
that Kroger updated every price or stock field at that moment. Confirm the exact
item, price, loyalty or purchase conditions, and stock with your store before
buying. The app does not clip coupons, maintain a shopping cart, or place orders.

## 7. Interpret historical comparisons carefully

New history databases start empty. Browsing or searching the app does not collect
price history. An operator must configure a separate permitted collection
process; see [price-history setup and limits](HISTORY.md). A working current-price
connection does not establish permission to retain provider responses.

The default collection path remains gated by source permission. **Historical
collection needs source permission** means that the required permission is not
established for collection. This is separate from an empty database or an
ordinary temporary connection failure. No historical prices are invented to
fill the gap, and today's regular price is never substituted for a past promo
price.

Possible item states include:

| What you see | What it means |
| --- | --- |
| Historical comparison unavailable | A source or history-reading capability is not available. It does not establish that no past promotions occurred. |
| No observations collected | No stored prior observations were found for this item and store. |
| Not enough comparable observations | The collected data is not sufficient for a reliable comparison. A first observation is not a trend. |
| Historical prices cannot be compared reliably | Observations exist, but their item or price context does not match well enough. Any displayed past price stays qualified. |
| Collected promotion history | Dated, suitable prior observations can be shown with their public source names. |

When available, the **most recent collected promo** is the latest retained prior
observation for the matching context. A displayed dollar change compares today's
reported promo with that prior observation: lower means today's promo is cheaper,
and higher means it is more expensive. A missing comparison stays unavailable;
the app does not assume equality.

The **lowest collected promo** covers only retained qualifying prior observations,
not every historical promotion or an all-time low. Read its date and source.
Gaps between observations can hide better intervening offers. Historical
unit-price comparison remains unavailable when a standardized unit basis is
missing.

## 8. Change stores, cancel, or start over

- Select **Change store** to clear the current location's results. Choose another
  returned store, or edit the ZIP code and search a different area.
- During a pending search, **Cancel search** stops this page waiting for the
  result. You can submit a new search afterward. Cancellation does not establish
  that an already sent request was never received by Kroger.
- Selecting the project name at the top reloads the starting page. Reloading or
  leaving the page clears the app's current-visit selections and results.

The page uses memory for the current visit, not browser local or session storage.
Search values are sent in request bodies to the installation, rather than added
to the page URL. The installation then queries Kroger. The app does not send
searches to an external AI service or use them to populate its history database.
The operator controls any separate hosting or network logs; this guide does not
promise that the host or provider keeps no records.

## 9. Recover from a problem

| Problem | What to do |
| --- | --- |
| ZIP code is rejected | Use exactly five digits, without spaces, a street address, or ZIP+4. |
| Search text is rejected | Use 3–80 characters and at most eight words, or clear it for the starter sample. |
| Store list is empty | Try another nearby ZIP code. Availability of a store in this API search is limited. |
| No qualifying promotions | Try another term or the starter sample. There may be other store offers outside these results. |
| Connection or permissions are rejected | Ask the installation's operator to check API credentials, environment, and permissions. Do not enter API secrets into a grocery search field. |
| Installation is busy or Kroger limits requests | Wait for the interval shown in the message before trying again. Repeated rapid searches will not help. |
| Daily request budget is reached | Try later or ask the operator about the installation's request budget. |
| Search takes too long or fails | Wait briefly, then submit it again. Use a more specific term if the result is too large. |
| Unexpected result cannot be read | Retry later. If it persists, contact the operator; the app does not quietly replace the failed response with sample groceries. |
| History is unavailable | Current-price comparisons can still work. Read the history status and contact the operator if a permitted history source should be available. |

## Keyboard use and small screens

Use Tab and Shift+Tab to move among controls, Enter to submit forms, and your
browser's standard select-control keys to change **Show first**. A **Skip to deal
finder** link appears when focused near the start of keyboard navigation.

On narrow screens the store section appears before the promotions section, so
scroll down after choosing a location. Full product descriptions wrap instead of
being shortened. No particular screen-reader or browser combination is certified
by this guide; see the project's recorded testing limits.

For installation and operator tasks, use [self-hosting](SELF_HOSTING.md) and
[history configuration](HISTORY.md). For an agent or another application, use the
[API contract](API.md); human shopping does not require those technical steps.
