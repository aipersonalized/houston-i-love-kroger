# Using Houston I Love Kroger

Choose your Kroger store, browse reported prices and promotions, and make a
shopping list for this page visit. You can also look for past prices when they
are available on the site you use.

This independent project is in development. It is not affiliated with, endorsed
by, or sponsored by The Kroger Co. Kroger is a trademark of its owner. The
software license does not grant rights to Kroger data or services.

## 1. Open an installation

1. Open the address supplied by your installation's operator. You need a browser
   with JavaScript and an internet connection. Hosted use needs no terminal,
   software installation or AI-provider account.
2. Read **Privacy** and **Use notes** beside the ZIP form or in the footer.
   These explain the installation's operator, search handling and hosting logs.
3. Wait for the connection check. Continue when **ZIP code** becomes available.
   Loaded settings alone do not prove live Kroger access.

**Store searches aren’t ready yet.** means this site cannot load stores or prices
yet. Try **Check again** later, or contact the person who runs the site. If you
run it yourself, follow [self-hosting](SELF_HOSTING.md). For **The store connection
could not be checked**, check your internet connection and try **Check again**;
contact the site operator if it persists. No made-up groceries replace a failure.

**TEST DATA ONLY** identifies synthetic examples. **SANDBOX DATA** identifies
Kroger's certification environment. Neither is a verified shopping offer.
A project address does not establish that the latest version is deployed there.
To run your own copy, use [self-hosting](SELF_HOSTING.md).

Ordinary browsing needs no customer sign-in. Optional Cart uses separate Kroger
sign-in and an explicit add action; it handles no payment or checkout. Never put
passwords, API secrets or service tokens into searches or support messages.

Use the app for ordinary browsing under the linked Kroger Terms and Acceptable
Use rules. Do not bulk-collect, archive, alter or resell API content, track
customer searches or locations, or compare Kroger prices with other retailers.
An assistant's access does not grant permission to send data to its provider.

## 2. Choose your store

1. Under **Find your store**, enter five US ZIP digits in **ZIP code**, without
   a street address or ZIP+4.
2. Select **Find stores**, or press Enter in the form.
3. Match the returned name and address to the location you plan to visit.
   Similar names can identify stores with different prices.
4. Select **Choose this store**. Check the selected name and address above the
   results before using a price.
5. Open **Store hours, departments and contact details** for supplied phone,
   hours, timezone and departments. Missing facts stay marked. Confirm hours
   with the store, especially on holidays. If an assistant needs the store's
   reference, it appears inside this section as **Store reference for an
   assistant**; you do not need it to browse.

The search asks for up to ten Kroger locations within ten miles, rather than
every nearby store. If none return, try a nearby ZIP. The app does not request
your device's precise location. Editing the ZIP or changing stores clears the
previous results, past-price results and shopping list.

Choosing a store immediately loads a starter grocery sample.

## 3. Browse groceries and promotions

The starter sample searches **milk**, **bread** and **eggs**, requesting up to
15 products per topic, or 45 before duplicate handling. It is a bounded sample,
not a complete catalog, weekly ad or digital-coupon feed.

To search for something else:

1. Keep the correct store selected.
2. In **Find a grocery or brand**, enter 3–80 characters and at most eight words,
   such as `whole milk` or `coffee`.
3. Select **Search**, or press Enter. A term search requests up to 50 products
   in one page. Kroger's approximate search may return related descriptions.
4. Read the selection covered by the search and the **Checked** time. Check
   descriptions and package sizes.

Clear the field and select **Search** for the starter sample. Editing text clears
the old results; it does not search on every keystroke. Your existing list stays
while you search the same store.

**Products to show** starts at **All priced products**. Usable regular-price
groceries stay visible alongside qualifying promotions. A reported price without
a usable regular comparison can appear without a savings claim. A zero or
missing promo does not make a product free; a usable regular price can still
appear. Conflicting details, reported out-of-stock items, explicitly unavailable
in-store fulfillment and unusable prices can exclude a result. Read **Result
details** for the reasons; counts can overlap.

Choose **Promotions only** for positive regular and lower promo prices with
qualified supplied dates. No matching promotion describes this returned sample,
not the whole store.

When relevant source facts exist in the loaded results, these filters appear:

- **SNAP eligibility**: reported eligible, reported not eligible,
  or not reported. Missing facts stay unknown.
- **Dietary labels**: an exact supplied claim.
  This is source wording, not the app's certification of a diet or allergy
  requirement. Missing claims remain unknown.

These labels come from Kroger. Filters work on the groceries already shown.
Relax them or change views if nothing matches. Check the package for ingredients
and allergens; these fields do not establish allergen safety.

Use **Show first** to reorder the loaded results:

| Option | Meaning |
| --- | --- |
| **Biggest dollar savings** | Largest calculated regular-minus-promo saving first; unqualified savings follow. |
| **Highest percent off** | Largest calculated percentage reduction first; unqualified savings follow. |
| **Lowest reported price** | Lowest usable displayed price first, including regular prices in the all-priced view. |

These orders do not discover more groceries or compare standardized prices per
ounce, pound or item. Smaller packages can have lower selling prices. A new
search resets ordering and source filters.

## 4. Read a product

Start with the name, brand, package size and price. A photo and a high/low stock
note appear when Kroger supplies them. Open **Price and product details** when
you want more information, such as the reported aisle, how an item is sold,
eligibility, unit estimates, sale dates or a past-price comparison.

- **Promo price**, **Regular price** or **Reported price** is Kroger's selected
  store snapshot, not a checkout quote. A note explains an unqualified promotion.
- **Save** compares the current regular and lower promo prices. It is not a
  past-week, competing-store or coupon saving.
- **Reported unit-price estimates** preserve supplied numeric estimates. Their
  measure basis is not supplied; do not label them as a known price per ounce,
  pound or item, or infer the basis from package size. Missing estimates stay
  unavailable.
- **Stock reported** is advisory, even when high. Confirm availability.
- Inside **Price and product details**, **More about this product** appears when
  extra facts are supplied, such as delivery options, ingredients, allergen
  statements, warnings and nutrition facts.
  Missing statements do not establish that an item is safe for a particular diet;
  check the package before buying or eating.
- Reported effective/expiration times use your browser's timezone; a source
  timezone appears where supplied. Missing dates do not establish an offer's end.
- Supported source photos may appear. **Image not supplied** or **Image
  unavailable** leaves the text usable; no replacement photo is invented.
- **View product at Kroger**, when a supported source link exists, opens a new
  tab. Check its item, store, price and conditions there.

Product images load directly from Kroger. Your browser sends the image address,
IP address and browser information to that host; browser cookie settings may
also allow existing Kroger cookies. This page does not send its referring
address. Product and cart links take you to Kroger under its own
[privacy notice](https://www.kroger.com/i/privacy-policy).

The retrieval time says when the app obtained the response, not when Kroger
changed every field. Confirm the item, price, purchase conditions and stock
before buying.

## 5. Make a list for this visit

1. Select **Add to shopping list** on a result. If it is unavailable, Kroger has
   not supplied enough information to identify that exact item for the list.
2. Follow **Your shopping list** near the top, or scroll to it.
3. Set **Quantity** to a whole number 1–99. Adding the same known item again
   increases its quantity. The list holds up to 100 distinct lines.
4. Read the line estimates and price snapshots. Only positive item prices for
   products reported as sold by the unit contribute to the subtotal.
5. For **Amount unresolved**, read the reason. Variable weight/measure, missing
   basis and other unresolved amounts are excluded. **Estimated subtotal of
   resolved lines** is a partial sum. Even a complete estimate excludes tax,
   coupons, variable weight and checkout conditions.
6. Select **Group by reported aisle** to group by the first supplied position.
   All reported positions stay on the line; unknown aisles have their own group.
   This is not an optimized walking route.
7. Use **Remove** for one line or **Clear list** for all lines.

Invalid quantities leave the last valid quantity in use; correct the field before
relying on the estimate. Prices do not refresh automatically. Re-adding a known
product from a later search updates its snapshot and increases its quantity, so
review the resulting quantity.

The list stays in page memory only. Reloading, leaving, editing the ZIP or
changing stores clears it. Adding to the list does not change a Kroger cart.
There is no saved-list account, export or cross-device synchronization.

## 6. Optional: add the list to a Kroger cart

Cart access is optional and may be unavailable on the site you use. When it is
unavailable, you can still use the shopping list. Signing in alone does not make
cart access available. If you run the site, its required Kroger access and setup
are explained in [self-hosting](SELF_HOSTING.md).

If Cart is available:

1. Expand **Optional: add this list to a Kroger cart**. Read the status and
   note about any items that cannot be sent. Adds need known unit amounts and a
   reported 13-digit barcode number (UPC). Remove or adjust every ineligible
   line first. At most 50 distinct UPCs can be sent, with at most 99 total units
   for each UPC.
2. Select **Connect a Kroger cart**, then **Continue to Kroger sign-in** to open
   a new tab. Sign in only at Kroger and decide whether to authorize Cart access.
3. Return to the original app tab and select **Check cart connection**. Your
   list stays in that tab. Failed/expired sign-in can be started again; sign-in
   adds no items.
4. Review the list. Select **Add listed quantities to Kroger cart** only when
   you want to add those quantities. Each add sends the full listed quantities
   and may increase existing cart quantities; it does not replace the cart. The
   selected browsing store does not set the store for your Kroger cart.
5. After acknowledgement, follow **Review your cart at Kroger**. Verify actual
   items, quantities, store, fulfillment, prices and stock. The app cannot read
   the cart, undo additions, clip coupons or place orders.

After acknowledgement, adding the unchanged list is disabled. Editing the list
enables another add of its full quantities; review Kroger's actual cart first.

If an add times out, disconnects or reports an **unknown** result, it may have
reached Kroger. Do not replay it. Inspect the actual cart first. The app blocks
another add in that uncertain session. Disconnect/reconnect only after checking
the outcome. Disconnect does not undo changes.

Optional Cart uses a secure, HttpOnly visit cookie and keeps authorization only
in server memory. The session expires within 30 minutes and the token may expire
sooner; expired sessions are cleaned up periodically. No refresh token is stored.
**Disconnect cart** or server restart discards the app session. Closing a tab
only clears the page list and does not immediately erase the server session.
Disconnect does not revoke an account grant at Kroger; use Kroger's controls.

## 7. Look for past prices

Past prices are available only when the site has permission to save and show
them. That permission remains unestablished for real Kroger history in this
project, so history can be unavailable even when today's prices work. Your
grocery searches do not save price history or fill a new history source.

When past prices are available:

1. Choose your store, then follow **Past prices** near the top or scroll to that
   section.
2. Enter a **Grocery or brand (optional)**, using up to 80 characters. Leave it
   blank to browse a limited selection. The search looks for that text within a
   saved product name or brand; it does not find approximate matches.
3. If you already have a product reference, expand **Find a specific product by
   its reference** and enter it in **Product reference** (up to 100 characters).
   This is optional; it can be combined with the grocery or brand search.
4. Select **Find past prices** for up to 20 of the newest matching saved prices.
5. Read the date, source, and sale or regular price. Use **See past price
   details** for the supplied source, package size, how the item was sold,
   regular price and any reported sale dates. Missing facts stay marked.
6. Use **Show more past prices** if available. Start a new search to change
   what you are looking for or include prices saved since the first page.

A past price is not a current deal. Saved prices can include regular prices or
reported zero values; these do not establish free offers or verified sales.
Some older entries lack a product name or brand. If a word search misses them,
try a product reference if you have one. Missing details are not guessed.

**Price history isn’t available here yet** or **Past prices aren’t available on
this site yet** means the site cannot show history; it does not mean the product
has never been on sale. **No matching past prices were found** means an available
search found no matches in its limited record. Try another grocery or brand.
**Past prices couldn’t be loaded** describes a failed lookup; try again later.
If **This past price is no longer available** appears when you open details,
search again. Permissions and how long saved prices may be kept are checked
each time, so an entry can become unavailable between actions.

Current promotion cards can also show a past-price comparison inside **Price
and product details**. A most recent or lowest saved sale price covers only
available, comparable past prices for the same store, product and package; it is
never an all-time low or a complete sales history. Today's regular price does not
stand in for a past sale. One comparable past price can show a difference, but
does not establish a trend. Missing currency, quantities, purchase conditions,
dates or units can prevent comparison. Read the item's explanation.

## 8. Cancel, start over or recover

**Cancel search** and **Cancel history search** stop this page waiting; a sent
request may already have reached its destination. The project name reloads the
starting page and clears page state. Use **Disconnect cart** separately to end
an optional cart session.

| Problem | Recovery |
| --- | --- |
| ZIP rejected | Enter exactly five digits. |
| Grocery search rejected | Use 3–80 characters and at most eight words, or clear it for the sample. |
| No products/promotions in a view | Clear source filters, choose all-priced products or try another grocery. Coverage stays bounded. |
| Missing photo, aisle, claim or hours | Use text details and confirm with Kroger; missing source facts stay unknown. |
| Quantity rejected | Enter a whole number 1–99; the previous valid quantity remains in use. |
| Partial estimate | Check unresolved lines; their amounts are excluded. |
| Busy, rate or daily budget limit | Wait for the displayed interval; rapid repetition will not help. |
| Connection or access rejected | Try again later or contact the person who runs the site; never share passwords or secrets. If you run it, use the setup guide. |
| Read failed or cannot be parsed | Retry later; use a more specific term for oversized results. No sample data replaces failure. |
| History unavailable | You can still try today's prices above. Try again later or contact the person who runs the site. |
| Cart add result unknown | Check the actual Kroger cart before any new add. No automatic replay or undo exists. |

Page inputs and list state do not enter browser local/session storage. Search
values travel in request bodies to the installation, then Kroger or its private
history service. Hosting/provider logs have separate behavior; read the actual
notices. Optional Cart has the separate cookie/server-memory behavior above.

Use Tab/Shift+Tab for controls, Enter for forms and standard browser keys for
selects and expandable details. **Skip to grocery finder** appears on keyboard
focus. On small screens, scroll below the store section for results; full
descriptions wrap. This guide certifies no particular screen reader or browser.
Operators should read [self-hosting](SELF_HOSTING.md), [history operations](HISTORY.md)
and the [private service guide](PROMOTION_SERVICE.md). Assistant clients should
use [the shared API contract](API.md).
