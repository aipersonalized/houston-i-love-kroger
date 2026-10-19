import { orderOffers } from './ordering.js';

const byId = id => document.getElementById(id);
const ui = Object.fromEntries([
  'data-banner', 'connection-notice', 'connection-title', 'connection-message', 'retry-connection',
  'store-form', 'zip-code', 'find-stores', 'zip-error', 'store-status', 'cancel-stores',
  'stores-region', 'stores-heading', 'stores-coverage', 'stores-list', 'deals-title',
  'initial-state', 'selected-store', 'selected-store-name', 'selected-store-address',
  'selected-store-id', 'change-store', 'deal-form', 'search-term', 'search-deals',
  'search-error', 'deal-status', 'cancel-deals', 'results-region', 'result-count',
  'retrieved-at', 'sort-order', 'sample-coverage', 'query-coverage', 'empty-results',
  'offers-list', 'excluded-summary', 'history-title', 'history-message',
].map(id => [id, byId(id)]));

// Current-visit state only. Inputs never enter a URL or browser storage.
const state = {
  alive: true, connection: 'checking', configured: false, environment: null,
  dataSource: null, selectedStore: null, stores: [], results: null,
  requests: { connection: null, stores: null, deals: null },
  sequence: { connection: 0, stores: 0, deals: 0 },
};
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});

class SearchError extends Error {
  constructor(code = 'connection_failed', retryAfter = null) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const errorMessages = {
  invalid_zip: 'Enter a five-digit US ZIP code, then search again.',
  invalid_store: 'Choose a store from a new store search, then try again.',
  invalid_search: 'Use 3–80 characters and no more than eight words, or leave the search blank for the starter sample.',
  setup_required: 'This installation needs a Kroger API connection. Ask its operator to finish setup.',
  connection_rejected: 'The Kroger connection was rejected. Ask this installation’s operator to check its API settings.',
  permission_denied: 'Kroger did not allow this search. Ask the operator to check API permissions.',
  busy: 'This installation is busy. Wait a moment before searching again.',
  provider_limit: 'Kroger has limited requests. Wait before searching again.',
  budget_reached: 'This installation has reached its daily request budget. Try again later.',
  upstream_format: 'Kroger returned an unexpected result. Try again later.',
  upstream_size: 'The result was too large. Try a more specific grocery or brand.',
  upstream_unavailable: 'Kroger could not complete this search. Try again shortly.',
  request_cancelled: 'The search was cancelled. You can search again.',
  origin_not_allowed: 'Open this app directly at its configured address, then try again.',
  invalid_host: 'Open this installation at its configured address.',
  connection_failed: 'This installation could not be reached. Check your connection and try again.',
  timed_out: 'The search took too long. Try again shortly.',
  invalid_response: 'The result could not be read. Try again or ask the operator to check this installation.',
};

function describeError(error) {
  const message = errorMessages[error.code] || 'The search could not finish. Try again shortly.';
  const delay = error.retryAfter;
  if (Number.isInteger(delay) && delay > 0 && delay <= 86_400) {
    return `${message} Wait at least ${delay < 60 ? `${delay} seconds` : `${Math.ceil(delay / 60)} minutes`} before retrying.`;
  }
  return message;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function setStatus(kind, message = '', isError = false) {
  const target = ui[`${kind}-status`];
  target.textContent = message;
  target.classList.toggle('is-error', isError);
}

function abortRequest(kind) {
  state.sequence[kind]++;
  state.requests[kind]?.abort();
  state.requests[kind] = null;
}

function isCurrent(kind, sequence) {
  return state.alive && sequence === state.sequence[kind];
}

function updateControls() {
  const ready = state.alive && state.connection === 'ready' && state.configured;
  ui['zip-code'].disabled = !ready;
  ui['find-stores'].disabled = !ready || Boolean(state.requests.stores);
  ui['cancel-stores'].hidden = !state.requests.stores;
  ui['search-term'].disabled = !ready || !state.selectedStore;
  ui['search-deals'].disabled = !ready || !state.selectedStore || Boolean(state.requests.deals);
  ui['cancel-deals'].hidden = !state.requests.deals;
  ui['sort-order'].disabled = !state.results || state.results.offers.length < 2;
  ui['store-form'].setAttribute('aria-busy', String(Boolean(state.requests.stores)));
  ui['deal-form'].setAttribute('aria-busy', String(Boolean(state.requests.deals)));
}

function setDataBanner(dataSource = state.dataSource) {
  if (dataSource === 'synthetic-fixture') {
    ui['data-banner'].textContent = 'TEST DATA ONLY — synthetic stores and prices for interface testing. Not real shopping offers.';
    ui['data-banner'].hidden = false;
  } else if (state.environment === 'certification') {
    ui['data-banner'].textContent = 'SANDBOX DATA — Kroger’s certification environment. These results are not verified live shopping offers.';
    ui['data-banner'].hidden = false;
  } else {
    ui['data-banner'].textContent = '';
    ui['data-banner'].hidden = true;
  }
}

async function request(kind, path, body) {
  abortRequest(kind);
  const sequence = state.sequence[kind];
  const controller = new AbortController();
  state.requests[kind] = controller;
  updateControls();
  let timedOut = false;
  const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
  try {
    const response = await fetch(new URL(path, document.baseURI), {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? { Accept: 'application/json' } : {
        Accept: 'application/json', 'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new SearchError('invalid_response');
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw new SearchError('invalid_response'); }
    if (!response.ok || payload?.ok !== true) {
      const retry = response.headers.get('retry-after');
      throw new SearchError(typeof payload?.error?.code === 'string' ? payload.error.code : 'invalid_response',
        retry && /^\d+$/.test(retry) ? Number(retry) : null);
    }
    if (!isCurrent(kind, sequence)) return null;
    return payload;
  } catch (error) {
    if (!isCurrent(kind, sequence)) return null;
    if (timedOut) throw new SearchError('timed_out');
    if (controller.signal.aborted) return null;
    throw error instanceof SearchError ? error : new SearchError();
  } finally {
    window.clearTimeout(timer);
    if (isCurrent(kind, sequence)) {
      state.requests[kind] = null;
      updateControls();
    }
  }
}

async function checkConnection() {
  state.connection = 'checking';
  ui['connection-notice'].hidden = false;
  ui['connection-notice'].classList.remove('notice-error');
  ui['connection-title'].textContent = 'Checking the store connection…';
  ui['connection-message'].textContent = 'Search will be available when this installation is ready.';
  ui['retry-connection'].hidden = true;
  updateControls();
  try {
    const payload = await request('connection', './api/v1/status');
    if (!payload) return;
    if (typeof payload.configured !== 'boolean' || !['production', 'certification'].includes(payload.environment)) {
      throw new SearchError('invalid_response');
    }
    state.configured = payload.configured;
    state.environment = payload.environment;
    state.dataSource = payload.dataSource;
    setDataBanner();
    if (state.configured) {
      state.connection = 'ready';
      ui['connection-notice'].hidden = true;
    } else {
      state.connection = 'setup';
      ui['connection-title'].textContent = 'This installation needs a Kroger connection.';
      ui['connection-message'].textContent = 'The operator must finish API setup before stores or prices can be loaded. No sample shopping offers are substituted.';
      ui['retry-connection'].hidden = false;
    }
  } catch (error) {
    state.connection = 'offline';
    state.configured = false;
    ui['connection-notice'].classList.add('notice-error');
    ui['connection-title'].textContent = 'The store connection could not be checked.';
    ui['connection-message'].textContent = describeError(error);
    ui['retry-connection'].hidden = false;
  }
  updateControls();
}

function clearResults() {
  state.results = null;
  ui['results-region'].hidden = true;
  ui['offers-list'].replaceChildren();
  for (const id of ['result-count', 'retrieved-at', 'sample-coverage', 'query-coverage', 'excluded-summary']) ui[id].textContent = '';
  ui['sort-order'].value = 'savings';
}

function clearSelection() {
  abortRequest('deals');
  state.selectedStore = null;
  clearResults();
  ui['selected-store'].hidden = true;
  ui['deal-form'].hidden = true;
  ui['initial-state'].hidden = false;
  ui['deals-title'].textContent = 'What’s worth a look.';
  for (const id of ['selected-store-name', 'selected-store-address', 'selected-store-id']) ui[id].textContent = '';
  ui['search-term'].value = '';
  ui['search-error'].textContent = '';
  ui['search-term'].removeAttribute('aria-invalid');
  setStatus('deal');
  updateControls();
}

function storeAddress(store) {
  const address = store.address || {};
  const cityState = [address.city, address.state].filter(Boolean).join(', ');
  return [address.addressLine1, address.addressLine2, [cityState, address.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    || 'Address not supplied by Kroger. Check the location before choosing.';
}

function validStores(stores) {
  return Array.isArray(stores) && stores.length <= 10 && stores.every(store =>
    typeof store?.locationId === 'string' && /^[a-zA-Z0-9]{8}$/.test(store.locationId) &&
    typeof store.name === 'string' && store.address && typeof store.address === 'object' &&
    Object.values(store.address).every(value => typeof value === 'string'));
}

function renderStores() {
  ui['stores-list'].replaceChildren();
  state.stores.forEach(store => {
    const item = element('li');
    const card = element('article', 'store-card');
    const selected = state.selectedStore?.locationId === store.locationId;
    card.classList.toggle('is-selected', selected);
    card.append(element('h4', '', store.name), element('p', '', storeAddress(store)),
      element('p', 'store-id', `Store ID: ${store.locationId}`));
    const button = element('button', 'button button-secondary', selected ? 'Selected store' : 'Choose this store');
    button.type = 'button';
    button.disabled = selected;
    button.setAttribute('aria-label', `${selected ? 'Selected' : 'Choose'} ${store.name}, ${storeAddress(store)}, store ID ${store.locationId}`);
    button.addEventListener('click', () => selectStore(store));
    card.append(button);
    item.append(card);
    ui['stores-list'].append(item);
  });
}

function selectStore(store) {
  clearSelection();
  state.selectedStore = store;
  ui['initial-state'].hidden = true;
  ui['selected-store'].hidden = false;
  ui['deal-form'].hidden = false;
  ui['deals-title'].textContent = 'Promotions at your store.';
  ui['selected-store-name'].textContent = store.name;
  ui['selected-store-address'].textContent = storeAddress(store);
  ui['selected-store-id'].textContent = `Store ID: ${store.locationId}`;
  renderStores();
  updateControls();
  ui['deals-title'].focus();
  void loadDeals();
}

async function searchStores(event) {
  event.preventDefault();
  if (state.connection !== 'ready' || state.requests.stores) return;
  const zipCode = ui['zip-code'].value.trim();
  if (!/^\d{5}$/.test(zipCode)) {
    ui['zip-error'].textContent = errorMessages.invalid_zip;
    ui['zip-code'].setAttribute('aria-invalid', 'true');
    ui['zip-code'].focus();
    return;
  }
  clearSelection();
  state.stores = [];
  ui['stores-region'].hidden = true;
  ui['stores-list'].replaceChildren();
  ui['zip-error'].textContent = '';
  ui['zip-code'].removeAttribute('aria-invalid');
  setStatus('store', 'Finding nearby stores…');
  try {
    const payload = await request('stores', './api/v1/stores/search', { zipCode });
    if (!payload) return;
    if (!validStores(payload.stores)) throw new SearchError('invalid_response');
    state.stores = payload.stores;
    setDataBanner(payload.dataSource);
    if (!state.stores.length) {
      setStatus('store', 'No Kroger stores were returned within this search area. Try another ZIP code.');
      return;
    }
    ui['stores-region'].hidden = false;
    ui['stores-heading'].textContent = `${state.stores.length} nearby ${state.stores.length === 1 ? 'store' : 'stores'}`;
    const radius = Number.isFinite(payload.radiusInMiles) ? `${payload.radiusInMiles} miles` : 'the returned area';
    const limit = Number.isInteger(payload.limit) ? `${payload.limit} locations` : 'a limited number of locations';
    ui['stores-coverage'].textContent = `Up to ${limit} within ${radius}. Match the name, address and full store ID.`;
    renderStores();
    setStatus('store', 'Stores loaded. Choose your exact location.');
    ui['stores-heading'].focus();
  } catch (error) {
    setStatus('store', describeError(error), true);
  }
}

function validOffers(payload) {
  return payload.scope?.locationId === state.selectedStore?.locationId &&
    ['sample', 'search'].includes(payload.scope?.mode) &&
    Array.isArray(payload.scope.topics) && payload.scope.topics.every(topic => typeof topic === 'string') &&
    Array.isArray(payload.offers) && payload.offers.length <= 500 &&
    payload.offers.every(offer => typeof offer?.source?.description === 'string' &&
      Number.isFinite(offer.source.price?.regular) && Number.isFinite(offer.source.price?.promo) &&
      offer.source.price.promo > 0 && offer.source.price.regular > offer.source.price.promo &&
      Number.isFinite(offer.calculated?.savingsCents) && Number.isFinite(offer.calculated?.percentOff));
}

async function loadDeals() {
  if (!state.selectedStore || state.connection !== 'ready') return;
  const term = ui['search-term'].value.trim().replace(/\s+/gu, ' ');
  if (term && (term.length < 3 || term.length > 80 || term.split(' ').length > 8 || /[\p{Cc}\p{Cf}]/u.test(term))) {
    ui['search-error'].textContent = errorMessages.invalid_search;
    ui['search-term'].setAttribute('aria-invalid', 'true');
    ui['search-term'].focus();
    return;
  }
  abortRequest('deals');
  clearResults();
  ui['search-error'].textContent = '';
  ui['search-term'].removeAttribute('aria-invalid');
  setStatus('deal', term ? 'Looking for qualifying promotions for this search…' : 'Loading a starter promotion sample for this store…');
  const locationId = state.selectedStore.locationId;
  try {
    const payload = await request('deals', './api/v1/deals/search', { locationId, ...(term ? { term } : {}) });
    if (!payload) return;
    if (!validOffers(payload)) throw new SearchError('invalid_response');
    state.results = payload;
    setDataBanner(payload.dataSource);
    ui['results-region'].hidden = false;
    renderResults();
    setStatus('deal', `${payload.offers.length} qualifying ${payload.offers.length === 1 ? 'promotion' : 'promotions'} loaded for the selected store.`);
  } catch (error) {
    setStatus('deal', describeError(error), true);
  }
  updateControls();
}

function readableDate(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateTime.format(date) : null;
}

function priceDate(label, date) {
  if (typeof date?.value !== 'string') return null;
  const readable = readableDate(date.value);
  if (!readable) return null;
  // Preserve supplied timezone provenance rather than guessing store-local time.
  return `${label}: ${readable}${typeof date.timezone === 'string' && date.timezone ? ` (source timezone: ${date.timezone})` : ''}`;
}

function appendUnitComparison(target, offer) {
  const unit = offer.perUnit;
  const regular = unit?.regularEstimate;
  const promo = unit?.promoEstimate;
  const hasRegular = Number.isFinite(regular) && regular > 0;
  const hasPromo = Number.isFinite(promo) && promo > 0;
  if (unit?.status === 'reported_estimate' && (hasRegular || hasPromo)) {
    const line = element('p', 'unit-line');
    line.append(element('strong', '', 'Reported unit-price estimates: '),
      document.createTextNode(`${hasPromo ? `$${String(promo)} promo` : 'Promo estimate not supplied'} · ${hasRegular ? `$${String(regular)} regular` : 'regular estimate not supplied'}.`));
    target.append(line, element('p', 'unit-line', 'Unit basis not supplied by Kroger. These are estimates; do not compare them as a known price per oz, lb, or item.'));
  } else {
    target.append(element('p', 'unit-line', 'Unit comparison unavailable — no usable unit-price estimate was supplied. A unit basis is not inferred from package size.'));
  }
}

function appendHistory(target, history) {
  // History observations are source-qualified by the backend. Current regular
  // prices never stand in for historical promotions.
  const status = history?.status;
  let message = 'Historical promo comparison unavailable. Past promotion prices have not been established.';
  if (history?.reason === 'no_authorized_source') message = 'Historical promo comparison unavailable — no authorized historical promotion source is connected.';
  if (history?.reason === 'history_read_failed') message = 'Historical promo comparison unavailable — stored history could not be read. Past prices remain unknown.';
  if (history?.reason === 'history_environment_mismatch') message = 'Historical promo comparison unavailable in the certification environment. These sandbox prices have no matching production-history comparison.';
  if (status === 'permission_required') message = 'Historical promo comparison unavailable — collection requires the operator’s data-source permission.';
  if (['no_observations', 'empty'].includes(status)) message = 'Historical promo comparison: no observations have been collected for this item and store.';
  if (['one_observation', 'insufficient_history'].includes(status)) message = 'Historical promo comparison: not enough comparable observations have been collected yet.';
  if (status === 'incomparable') message = 'Historical prices were observed, but their item or price context cannot be compared reliably with this offer.';
  const comparable = status === 'comparable';
  const observations = Number.isInteger(history?.observationCount) && history.observationCount >= 0 ? history.observationCount : null;
  if (comparable) message = `Collected promotion history${observations === null ? '' : ` · ${observations} prior ${observations === 1 ? 'observation' : 'observations'}`}.`;
  target.append(element('p', 'unit-line offer-history', message));
  if (comparable || status === 'incomparable' || status === 'insufficient_history') {
    const prior = readableDate(history?.lastObservedAt);
    const lowDate = readableDate(history?.lowestObservedAt);
    if (Number.isFinite(history?.lastPromo) && history.lastPromo > 0 && prior) {
      target.append(element('p', 'unit-line', `Most recent collected promo: ${money.format(history.lastPromo)} · ${prior}.`));
    }
    if (Number.isFinite(history?.lowestPromo) && history.lowestPromo > 0 && lowDate) {
      target.append(element('p', 'unit-line', `Lowest collected promo: ${money.format(history.lowestPromo)} · ${lowDate}. This covers retained prior observations, not an all-time low.`));
    }
    if (comparable && Number.isInteger(history?.deltaFromLastCents)) {
      const delta = history.deltaFromLastCents;
      target.append(element('p', 'unit-line', delta === 0 ? 'The current promo matches the most recent comparable collected promo.'
        : `The current promo is ${money.format(Math.abs(delta) / 100)} ${delta < 0 ? 'lower' : 'higher'} than the most recent comparable collected promo.`));
    }
    if (Array.isArray(history?.sourceLabels) && history.sourceLabels.every(label => typeof label === 'string') && history.sourceLabels.length) {
      target.append(element('p', 'unit-line', `History sources: ${history.sourceLabels.join('; ')}.`));
    }
    if (history?.unitComparison?.status === 'basis_unreported') {
      target.append(element('p', 'unit-line', 'Historical unit-price comparison unavailable — a standardized unit basis was not reported.'));
    }
  }
}

function renderOffer(offer, index) {
  const source = offer.source;
  const item = element('li');
  const article = element('article', 'offer');
  const details = element('div', 'offer-product');
  const kicker = element('p', 'offer-kicker');
  kicker.append(element('span', 'offer-index', String(index + 1).padStart(2, '0')),
    element('span', '', 'Reported promotion'));
  details.append(kicker, element('h4', '', source.description));
  if (source.size) details.append(element('p', 'offer-size', source.size));
  if (source.brand) details.append(element('p', 'offer-size', `Brand: ${source.brand}`));

  const prices = element('div', 'offer-price-block');
  const pair = element('div');
  pair.append(element('p', 'promo-label', 'Promo price'), element('strong', 'promo-price', money.format(source.price.promo)),
    element('p', 'regular-price', `Regular ${money.format(source.price.regular)}`));
  prices.append(pair, element('span', 'savings-badge', `Save ${money.format(offer.calculated.savingsCents / 100)} · ${percent.format(offer.calculated.percentOff)}%`));

  const facts = element('div', 'offer-details');
  appendUnitComparison(facts, offer);
  appendHistory(facts, offer.history ?? state.results.history);
  const stock = { HIGH: 'Stock reported: high', LOW: 'Stock reported: low', TEMPORARILY_OUT_OF_STOCK: 'Reported temporarily out of stock' }[source.stockLevel]
    || (source.stockLevel ? `Stock reported: ${source.stockLevel} (unrecognized level)` : 'Stock level not supplied');
  const factLine = element('p', 'offer-facts');
  factLine.append(element('span', '', `${stock} · availability not guaranteed`), element('span', '', 'Savings calculated from current regular price'));
  if (source.soldBy) factLine.append(element('span', '', `Sold by: ${source.soldBy}`));
  facts.append(factLine);
  const identifiers = [`Product ID: ${source.productId || 'not supplied'}`, `Item ID: ${source.itemId || 'not supplied'}`];
  facts.append(element('p', 'source-identifiers', identifiers.join(' · ')));
  const dates = [priceDate('Effective', source.price.effectiveDate), priceDate('Expires', source.price.expirationDate)].filter(Boolean);
  if (dates.length) facts.append(element('p', 'offer-dates', dates.join(' · ')));
  else facts.append(element('p', 'offer-dates', 'Promotion dates not supplied. Confirm the offer with your store.'));
  article.append(details, prices, facts);
  item.append(article);
  return item;
}

function renderHistorySummary(history) {
  const status = history?.status;
  let title = 'Historical comparison unavailable';
  let message = 'Historical promotion prices are unavailable. Today’s regular price is not a previous promotion price.';
  if (history?.reason === 'no_authorized_source') message = 'No authorized historical promotion source is connected. Today’s regular price is not a previous promotion price.';
  if (history?.reason === 'history_read_failed') {
    title = 'Stored history could not be read';
    message = 'Current-price results are still shown. This failure does not establish that the item has no past observations. Try again later or contact the operator.';
  }
  if (history?.reason === 'history_environment_mismatch') {
    title = 'History unavailable for sandbox prices';
    message = 'This installation is using Kroger’s certification environment. Its sandbox prices are not compared with production-history observations.';
  }
  if (['no_observations', 'empty'].includes(status)) {
    title = 'Price history is starting fresh';
    message = 'No observations have been collected yet. Historical comparisons will need dated, comparable observations for this same store and item.';
  } else if (['one_observation', 'insufficient_history'].includes(status)) {
    title = 'More price observations are needed';
    message = 'A first observation is not a price trend. There are not enough comparable historical promotions to make a comparison yet.';
  } else if (status === 'permission_required') {
    title = 'Historical collection needs source permission';
    message = 'The database starts empty. The operator needs permission to retain data from a source before collection can begin. Searches do not populate history.';
  } else if (['available', 'ready', 'comparable'].includes(status)) {
    title = 'History covers collected observations';
    message = 'Available item comparisons are shown above with dates and source names. An empty or incompatible item history stays marked. A collected low is limited to retained prior observations.';
  }
  ui['history-title'].textContent = title;
  ui['history-message'].textContent = message;
}

function renderResults() {
  const payload = state.results;
  if (!payload) return;
  const offers = orderOffers(payload.offers, ui['sort-order'].value);
  const count = offers.length;
  ui['result-count'].textContent = `${count} qualifying ${count === 1 ? 'promotion' : 'promotions'}`;
  const retrieved = readableDate(payload.retrievedAt);
  ui['retrieved-at'].textContent = retrieved ? `Retrieved ${retrieved}` : 'Retrieval time not supplied.';
  const sample = payload.scope.mode === 'sample';
  const topics = payload.scope.topics.join(', ');
  const limit = Number.isInteger(payload.scope.productLimit) ? ` Up to ${payload.scope.productLimit} products total` : ' A limited number of products';
  const perQuery = Number.isInteger(payload.scope.perQueryLimit) ? `, at most ${payload.scope.perQueryLimit} per topic.` : '.';
  ui['sample-coverage'].textContent = `${sample ? 'Starter sample' : 'Product search'} — queried topics: ${topics}.${limit}${perQuery}`;
  ui['query-coverage'].textContent = 'In-store API results only. This is not a complete promotion list, digital coupon feed or full weekly ad. Rankings apply only to the returned qualifying items.';
  ui['empty-results'].hidden = count !== 0;
  ui['offers-list'].replaceChildren(...offers.map(renderOffer));
  const summary = payload.summary || {};
  const excluded = [
    ['unpriced', 'missing usable prices'], ['notDiscounted', 'no lower promo price'],
    ['unqualifiedDates', 'unqualified promotion dates'], ['outOfStock', 'reported out of stock'],
    ['duplicateItems', 'duplicates'], ['conflictingItems', 'conflicting prices'],
    ['incompleteProducts', 'incomplete products'], ['notInStore', 'not available in store'],
  ].filter(([key]) => Number.isInteger(summary[key]) && summary[key] > 0)
    .map(([key, label]) => `${summary[key]} ${label}`);
  ui['excluded-summary'].textContent = `${Number.isInteger(summary.products) ? `${summary.products} returned products examined. ` : ''}${excluded.length ? `Excluded item counts: ${excluded.join('; ')}.` : ''}`;
  renderHistorySummary(payload.history);
  updateControls();
}

ui['store-form'].addEventListener('submit', event => { void searchStores(event); });
ui['zip-code'].addEventListener('input', () => {
  abortRequest('stores');
  clearSelection();
  state.stores = [];
  ui['stores-list'].replaceChildren();
  ui['stores-region'].hidden = true;
  ui['zip-error'].textContent = '';
  ui['zip-code'].removeAttribute('aria-invalid');
  setStatus('store');
  updateControls();
});
ui['deal-form'].addEventListener('submit', event => { event.preventDefault(); void loadDeals(); });
ui['search-term'].addEventListener('input', () => {
  const hadResults = Boolean(state.results || state.requests.deals);
  abortRequest('deals');
  clearResults();
  ui['search-error'].textContent = '';
  ui['search-term'].removeAttribute('aria-invalid');
  setStatus('deal', hadResults ? 'Search changed. Submit to load results for the new search.' : 'Submit your search, or leave it blank for the starter sample.');
  updateControls();
});
ui['cancel-stores'].addEventListener('click', () => {
  abortRequest('stores');
  setStatus('store', 'Store search cancelled. You can search again.');
  updateControls();
  ui['find-stores'].focus();
});
ui['cancel-deals'].addEventListener('click', () => {
  abortRequest('deals');
  setStatus('deal', 'Promotion search cancelled. You can search again.');
  updateControls();
  ui['search-deals'].focus();
});
ui['change-store'].addEventListener('click', () => {
  clearSelection();
  renderStores();
  ui['zip-code'].focus();
  setStatus('store', 'Choose another returned store, or change the ZIP code to search a different area.');
});
ui['sort-order'].addEventListener('change', () => {
  renderResults();
  const label = ui['sort-order'].selectedOptions[0]?.textContent || 'the selected order';
  setStatus('deal', `Returned promotions reordered: ${label.toLowerCase()}. No new search was sent.`);
});
ui['retry-connection'].addEventListener('click', () => { void checkConnection(); });

window.addEventListener('pagehide', () => {
  state.alive = false;
  for (const kind of ['connection', 'stores', 'deals']) abortRequest(kind);
  clearSelection();
  state.stores = [];
  state.configured = false;
  ui['zip-code'].value = '';
  ui['stores-list'].replaceChildren();
  ui['stores-region'].hidden = true;
  ui['stores-coverage'].textContent = '';
  setStatus('store');
  updateControls();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { state.alive = true; void checkConnection(); }
});

void checkConnection();
