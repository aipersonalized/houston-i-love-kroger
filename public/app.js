import { orderProducts } from './ordering.js';
import { addBasketItem, setBasketQuantity, estimateBasket, groupBasketByAisle, productKey, reportedAisles, cartItems } from './basket.js';
import { currentCents, filterProducts, declarationsFor, productDeclarations, validKrogerLink, productImage, exclusionText, historicalPrice, reportedProductDetails } from './catalog.js';

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
  'store-details', 'store-details-content', 'product-view', 'snap-filter-field', 'snap-filter',
  'declaration-filter-field', 'declaration-filter', 'empty-results-title', 'empty-results-message',
  'list-count', 'basket-store', 'clear-basket', 'basket-status', 'basket-empty', 'basket-content',
  'basket-total-label', 'basket-total', 'basket-unresolved', 'group-aisles', 'basket-lines',
  'cart-panel', 'cart-status', 'cart-list-note', 'connect-cart', 'cart-signin', 'add-cart', 'refresh-cart',
  'disconnect-cart', 'cart-unknown', 'history-store', 'history-form', 'history-term',
  'history-product-id', 'search-history', 'history-search-status', 'cancel-history',
  'history-coverage', 'history-results', 'more-history', 'history-detail',
  'history-detail-title', 'history-detail-content',
].map(id => [id, byId(id)]));

// Current-visit state only. Inputs never enter a URL or browser storage.
const state = {
  alive: true, connection: 'checking', configured: false, environment: null,
  dataSource: null, selectedStore: null, stores: [], results: null,
  basket: [], cart: null, cartUncertain: false, cartAcknowledged: false,
  history: null, historyQuery: null, historyCursor: null,
  requests: { connection: null, stores: null, deals: null, history: null, detail: null, cart: null },
  sequence: { connection: 0, stores: 0, deals: 0, history: 0, detail: 0, cart: 0 },
};
const amount = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  setup_required: 'Store searches aren’t ready yet. Try again later.',
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
  invalid_history_search: 'Use product words or a product ID with the supported length, then search again.',
  history_unavailable: 'Collected history could not be reached. Current prices are still available; try history again later.',
  promotion_service_unavailable: 'The collected-history service could not be reached. Current grocery prices remain available. Try history again later.',
  invalid_promotion_search: 'Check the product words or exact product ID, then search history again.',
  cart_disabled: 'Cart access is not enabled on this installation. Your visit-only shopping list is still available.',
  cart_setup_required: 'Cart connection isn’t available right now. You can keep using your shopping list.',
  cart_authorization_required: 'Sign in at Kroger to connect your cart.',
  cart_authorization_failed: 'Kroger cart sign-in could not be completed. Check the connection, then sign in again.',
  cart_write_outcome_unknown: 'Kroger may have received the add request. Check your cart at Kroger before adding again.',
  cart_session_required: 'Check the cart connection, then sign in at Kroger again.',
  cart_rejected: 'Kroger rejected this cart request. Check the connection and review your cart at Kroger.',
  cart_busy: 'A cart request is already underway. Wait for its result before continuing.',
  cart_csrf_invalid: 'The cart connection changed. Check the connection before trying again.',
  invalid_cart_items: 'Cart items need a reported 13-digit UPC and a whole-number quantity from 1 to 99.',
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
  ui['sort-order'].disabled = !state.results || state.results.products.length < 2;
  ui['history-term'].disabled = !state.alive || !state.selectedStore;
  ui['history-product-id'].disabled = !state.alive || !state.selectedStore;
  ui['search-history'].disabled = !state.alive || !state.selectedStore || Boolean(state.requests.history);
  ui['cancel-history'].hidden = !state.requests.history && !state.requests.detail;
  ui['more-history'].disabled = Boolean(state.requests.history);
  ui['history-form'].setAttribute('aria-busy', String(Boolean(state.requests.history)));
  ui['store-form'].setAttribute('aria-busy', String(Boolean(state.requests.stores)));
  ui['deal-form'].setAttribute('aria-busy', String(Boolean(state.requests.deals)));
  updateCartControls();
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

async function request(kind, path, body, { credentials = 'omit' } = {}) {
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
      signal: controller.signal, cache: 'no-store', credentials, redirect: 'error', referrerPolicy: 'no-referrer',
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
  ui['connection-message'].textContent = 'Getting ready to find stores and prices.';
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
    if (payload.cart) state.cart = payload.cart;
    setDataBanner();
    if (state.configured) {
      state.connection = 'ready';
      ui['connection-notice'].hidden = true;
    } else {
      state.connection = 'setup';
      ui['connection-title'].textContent = 'Store searches aren’t ready yet.';
      ui['connection-message'].textContent = 'Stores and prices can’t be loaded here yet. If you run this site, follow the project’s setup guide.';
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
  ui['snap-filter'].value = 'all';
  ui['declaration-filter'].replaceChildren(element('option', '', 'Any declaration'));
  ui['declaration-filter'].firstElementChild.value = '';
  ui['snap-filter-field'].hidden = true;
  ui['declaration-filter-field'].hidden = true;
}

function clearSelection() {
  abortRequest('deals');
  clearHistory();
  state.selectedStore = null;
  state.basket = [];
  state.cartAcknowledged = false;
  clearResults();
  ui['selected-store'].hidden = true;
  ui['deal-form'].hidden = true;
  ui['store-details'].hidden = true;
  ui['store-details'].open = false;
  ui['store-details-content'].replaceChildren();
  ui['initial-state'].hidden = false;
  ui['deals-title'].textContent = 'What’s worth a look.';
  for (const id of ['selected-store-name', 'selected-store-address', 'selected-store-id']) ui[id].textContent = '';
  ui['search-term'].value = '';
  ui['search-error'].textContent = '';
  ui['search-term'].removeAttribute('aria-invalid');
  setStatus('deal');
  renderBasket();
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
    Object.values(store.address).every(value => value === null || typeof value === 'string'));
}

function renderStores() {
  ui['stores-list'].replaceChildren();
  state.stores.forEach(store => {
    const item = element('li');
    const card = element('article', 'store-card');
    const selected = state.selectedStore?.locationId === store.locationId;
    card.classList.toggle('is-selected', selected);
    card.append(element('h4', '', store.name), element('p', '', storeAddress(store)));
    const button = element('button', 'button button-secondary', selected ? 'Selected store' : 'Choose this store');
    button.type = 'button';
    button.disabled = selected;
    button.setAttribute('aria-label', `${selected ? 'Selected' : 'Choose'} ${store.name}, ${storeAddress(store)}`);
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
  ui['store-details'].hidden = false;
  renderStoreDetails(store);
  ui['deals-title'].textContent = 'Groceries at your store.';
  ui['selected-store-name'].textContent = store.name;
  ui['selected-store-address'].textContent = storeAddress(store);
  ui['selected-store-id'].textContent = `Store reference for an assistant: ${store.locationId}`;
  ui['history-store'].textContent = `Past prices at ${store.name}. Search a grocery or brand, or leave the search blank to browse.`;
  renderBasket();
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

function validProducts(payload) {
  return payload.scope?.locationId === state.selectedStore?.locationId &&
    ['sample', 'search'].includes(payload.scope?.mode) &&
    Array.isArray(payload.scope.topics) && payload.scope.topics.every(topic => typeof topic === 'string') &&
    Array.isArray(payload.products) && payload.products.length <= 500 &&
    payload.products.every(product => typeof product?.source?.description === 'string' &&
      ['promotion', 'regular_only', 'unqualified_promotion'].includes(product.pricing?.status) &&
      currentCents(product) !== null && (product.pricing.status !== 'promotion' ||
        (Number.isFinite(product.calculated?.savingsCents) && Number.isFinite(product.calculated?.percentOff))));
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
  setStatus('deal', term ? 'Looking for reported grocery prices for this search…' : 'Loading a starter grocery sample for this store…');
  const locationId = state.selectedStore.locationId;
  try {
    const payload = await request('deals', './api/v1/products/search', { locationId, includeAll: true, ...(term ? { term } : {}) });
    if (!payload) return;
    if (!validProducts(payload)) throw new SearchError('invalid_response');
    state.results = payload;
    const declarations = declarationsFor(payload.products);
    ui['declaration-filter'].replaceChildren(...['', ...declarations].map(value => {
      const option = element('option', '', value || 'Any declaration'); option.value = value; return option;
    }));
    ui['declaration-filter-field'].hidden = declarations.length === 0;
    ui['snap-filter-field'].hidden = !payload.products.some(product => typeof product.source.snapEligible === 'boolean');
    setDataBanner(payload.dataSource);
    ui['results-region'].hidden = false;
    renderResults();
    setStatus('deal', `${payload.products.length} priced ${payload.products.length === 1 ? 'product' : 'products'} loaded for the selected store.`);
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
      document.createTextNode(`${hasPromo ? `${String(promo)} promo` : 'Promo estimate not supplied'} · ${hasRegular ? `${String(regular)} regular` : 'regular estimate not supplied'}.`));
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
  if (history?.reason === 'current_promotion_unqualified') message = 'There isn’t a qualifying sale price to compare. You can look up earlier prices under Past prices.';
  if (status === 'permission_required') message = 'Historical promo comparison unavailable — collection requires the operator’s data-source permission.';
  if (['no_observations', 'empty'].includes(status)) message = 'Historical promo comparison: no observations have been collected for this item and store.';
  if (['one_observation', 'insufficient_history'].includes(status)) message = 'Historical promo comparison: one comparable prior promotion has been collected. One observation does not establish a trend.';
  if (status === 'incomparable') message = 'Historical prices were observed, but their item or price context cannot be compared reliably with this offer.';
  const comparable = status === 'comparable';
  const observations = Number.isInteger(history?.observationCount) && history.observationCount >= 0 ? history.observationCount : null;
  if (comparable) message = `Collected promotion history${observations === null ? '' : ` · ${observations} prior ${observations === 1 ? 'observation' : 'observations'}`}.`;
  target.append(element('p', 'unit-line offer-history', message));
  if (comparable || status === 'incomparable' || status === 'insufficient_history') {
    const prior = readableDate(history?.lastObservedAt);
    const lowDate = readableDate(history?.lowestObservedAt);
    if (Number.isFinite(history?.lastPromo) && history.lastPromo > 0 && prior) {
      target.append(element('p', 'unit-line', `Most recent collected promo: ${amount.format(history.lastPromo)} · ${prior}.`));
    }
    if (Number.isFinite(history?.lowestPromo) && history.lowestPromo > 0 && lowDate) {
      target.append(element('p', 'unit-line', `Lowest collected promo: ${amount.format(history.lowestPromo)} · ${lowDate}. This covers retained prior observations, not an all-time low.`));
    }
    if ((comparable || status === 'insufficient_history') && Number.isInteger(history?.deltaFromLastCents)) {
      const delta = history.deltaFromLastCents;
      target.append(element('p', 'unit-line', delta === 0 ? 'The current promo matches the most recent comparable collected promo.'
        : `The current promo is ${amount.format(Math.abs(delta) / 100)} ${delta < 0 ? 'lower' : 'higher'} than the most recent comparable collected promo.`));
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
  const promoted = offer.pricing.status === 'promotion';
  const item = element('li');
  const article = element('article', 'offer');
  const details = element('div', 'offer-product');
  const photo = element('div', 'product-photo');
  const imageUrl = productImage(offer);
  const fallback = element('span', 'image-fallback', 'Image not supplied');
  if (imageUrl) {
    const image = element('img');
    image.alt = source.description;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.src = imageUrl;
    image.addEventListener('error', () => { image.remove(); photo.append(element('span', 'image-fallback', 'Image unavailable')); }, { once: true });
    photo.append(image);
  } else photo.append(fallback);
  const kicker = element('p', 'offer-kicker');
  kicker.append(element('span', 'offer-index', String(index + 1).padStart(2, '0')),
    element('span', '', promoted ? 'Reported promotion' : 'Reported price'));
  details.append(kicker, element('h4', '', source.description));
  if (source.size) details.append(element('p', 'offer-size', source.size));
  if (source.brand) details.append(element('p', 'offer-size', `Brand: ${source.brand}`));
  if (source.stockLevel === 'LOW' || source.stockLevel === 'HIGH') details.append(element('p', 'offer-size', `Stock reported ${source.stockLevel === 'LOW' ? 'low' : 'high'} · check with your store`));

  const prices = element('div', 'offer-price-block');
  const pair = element('div');
  pair.append(element('p', 'promo-label', promoted ? 'Promo price' : offer.pricing.regularCents === null ? 'Reported price' : 'Regular price'),
    element('strong', 'promo-price', amount.format(offer.pricing.currentCents / 100)));
  if (promoted) pair.append(element('p', 'regular-price', `Regular ${amount.format(offer.pricing.regularCents / 100)}`));
  prices.append(pair);
  if (promoted) prices.append(element('span', 'savings-badge', `Save ${amount.format(offer.calculated.savingsCents / 100)} · ${percent.format(offer.calculated.percentOff)}%`));
  else prices.append(element('p', 'field-hint', {
    no_reported_promotion: 'No promotion reported.',
    unsupported_price: 'A reported promotion price could not be used; regular price shown.',
    not_discounted: 'No lower promotion price reported.',
    unqualified_dates: 'The reported promotion dates could not be qualified; regular price shown.',
    missing_regular_price: 'Regular price unavailable; confirm this reported price with Kroger.',
  }[offer.pricing.reason] || 'No qualifying promotion.'));

  const facts = element('details', 'offer-details');
  facts.append(element('summary', '', 'Price and product details'));
  appendUnitComparison(facts, offer);
  if (promoted && !['unavailable', 'permission_required'].includes(offer.history?.status)) appendHistory(facts, offer.history);
  const stock = { HIGH: 'Stock reported: high', LOW: 'Stock reported: low', TEMPORARILY_OUT_OF_STOCK: 'Reported temporarily out of stock' }[source.stockLevel]
    || (source.stockLevel ? `Stock reported: ${source.stockLevel} (unrecognized level)` : 'Stock level not supplied');
  const factLine = element('p', 'offer-facts');
  factLine.append(element('span', '', `${stock} · availability not guaranteed`));
  if (promoted) factLine.append(element('span', '', 'Savings calculated from current regular price'));
  if (source.soldBy) factLine.append(element('span', '', `Sold by: ${source.soldBy}`));
  facts.append(factLine);
  const aisles = reportedAisles(offer);
  facts.append(element('p', 'unit-line', aisles.length ? `Kroger-reported location: ${aisles.join('; ')}` : 'Aisle location not reported.'));
  facts.append(element('p', 'unit-line', `Kroger-reported SNAP eligibility: ${typeof source.snapEligible === 'boolean' ? source.snapEligible ? 'eligible' : 'not eligible' : 'not supplied'}.`));
  const declarations = productDeclarations(offer);
  if (declarations.length) {
    facts.append(element('p', 'unit-line', `Kroger-reported declarations and claims: ${declarations.join('; ')}. Check the package for ingredients and allergens.`));
  }
  const reported = reportedProductDetails(offer);
  if (reported.length) {
    const disclosure = element('div', 'reported-details');
    disclosure.append(element('h5', '', 'More about this product'));
    const list = element('ul');
    for (const line of reported) list.append(element('li', 'unit-line', line));
    disclosure.append(list, element('p', 'field-hint', 'These are Kroger-reported facts and may be incomplete. Missing allergens or ingredients do not mean a product is safe for a particular diet. Check the package before buying or eating.'));
    facts.append(disclosure);
  }
  const dates = [priceDate('Reported effective', source.price?.effectiveDate), priceDate('Reported expiration', source.price?.expirationDate)].filter(Boolean);
  if (dates.length) facts.append(element('p', 'offer-dates', dates.join(' · ')));
  else if (promoted) facts.append(element('p', 'offer-dates', 'Promotion dates not supplied. Confirm the offer with your store.'));
  const actions = element('div', 'product-actions');
  const add = element('button', 'button button-secondary', 'Add to shopping list');
  add.type = 'button';
  add.setAttribute('aria-label', `Add ${source.description} to shopping list`);
  add.disabled = productKey(offer) === null;
  add.addEventListener('click', () => {
    try {
      state.basket = addBasketItem(state.basket, offer, state.selectedStore.locationId, state.results.retrievedAt);
      state.cartAcknowledged = false;
      renderBasket();
      ui['basket-status'].textContent = `${source.description} added to your shopping list.`;
      setStatus('deal', `${source.description} added to your shopping list. Choose quantities in Your shopping list below.`);
    } catch (error) {
      setStatus('deal', error.message === 'quantity_limit' ? 'This product is already at the list limit of 99.' : 'This list has reached its limit. Remove a line before adding another product.', true);
    }
  });
  actions.append(add);
  if (add.disabled) actions.append(element('p', 'field-hint', 'A stable product and item identity was not reported, so this result cannot be kept in the list.'));
  const productUrl = validKrogerLink(source.productUrl);
  if (productUrl) {
    const link = element('a', 'external-link', 'View product at Kroger ↗');
    link.href = productUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `View ${source.description} at Kroger (opens a new tab)`);
    actions.append(link);
  }
  article.append(photo, details, prices, facts, actions);
  item.append(article);
  return item;
}

function renderHistorySummary(history) {
  const status = history?.status;
  let title = 'Price history is unavailable.';
  let message = 'We can’t compare these prices with past sales yet. Savings shown above compare today’s regular and sale prices.';
  if (history?.reason === 'history_read_failed') {
    title = 'Past prices couldn’t be loaded.';
    message = 'You can still browse today’s prices. Try past prices again later.';
  }
  if (history?.reason === 'history_environment_mismatch') {
    title = 'These are test prices.';
    message = 'Past shopping prices aren’t compared with test results.';
  }
  if (['no_observations', 'empty'].includes(status)) {
    title = 'No matching past prices yet.';
    message = 'We haven’t saved matching past prices for these items at your store. That doesn’t mean they’ve never been on sale.';
  } else if (['one_observation', 'insufficient_history'].includes(status)) {
    title = 'One past sale is available.';
    message = 'You can compare with that sale, but one price isn’t enough to show a trend.';
  } else if (status === 'permission_required') {
    title = 'Price history isn’t available here yet.';
    message = 'You can browse today’s prices, but we can’t compare them with past sales. Your searches don’t save price history.';
  } else if (['available', 'ready', 'comparable'].includes(status)) {
    title = 'Compare with past prices.';
    message = 'Open an item’s price details to see available past prices and dates. They cover saved prices, not every sale the store has had.';
  }
  ui['history-title'].textContent = title;
  ui['history-message'].textContent = message;
}

function renderResults() {
  const payload = state.results;
  if (!payload) return;
  const offers = orderProducts(filterProducts(payload.products, {
    view: ui['product-view'].value, snap: ui['snap-filter'].value, declaration: ui['declaration-filter'].value,
  }), ui['sort-order'].value);
  const count = offers.length;
  const promoted = ui['product-view'].value === 'promotions';
  ui['result-count'].textContent = `${count} ${promoted ? 'promotions' : 'products'}${count !== payload.products.length ? ` of ${payload.products.length} priced products` : ''}`;
  const retrieved = readableDate(payload.retrievedAt);
  ui['retrieved-at'].textContent = retrieved ? `Checked ${retrieved}` : 'Price check time unavailable.';
  const sample = payload.scope.mode === 'sample';
  const topics = payload.scope.topics.join(', ');
  const limit = Number.isInteger(payload.scope.productLimit) ? ` up to ${payload.scope.productLimit} products` : ' a limited selection';
  ui['sample-coverage'].textContent = `${sample ? 'A starter selection of' : 'Results for'} ${topics}, covering${limit}.`;
  ui['query-coverage'].textContent = 'Sorted within these results. Compare package sizes as well as prices.';
  ui['empty-results'].hidden = count !== 0;
  ui['empty-results-title'].textContent = promoted ? 'No qualifying promotions match this view.' : 'No priced products match this view.';
  ui['offers-list'].replaceChildren(...offers.map(renderOffer));
  ui['excluded-summary'].textContent = exclusionText(payload.summary);
  renderHistorySummary(payload.history);
  updateControls();
}

function appendHours(target, hours, heading = 'Reported hours') {
  target.append(element('h4', '', heading));
  if (!hours || typeof hours !== 'object') {
    target.append(element('p', 'field-hint', 'Hours not supplied. Check with the store, including holidays.'));
    return;
  }
  const format = value => value?.open24 === true || value?.Open24 === true ? '24 hours' :
    typeof value?.open === 'string' && typeof value?.close === 'string' ? `${value.open}–${value.close}` : 'Not supplied';
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const reportedDays = days.filter(day => hours[day] && typeof hours[day] === 'object');
  if (reportedDays.length) {
    const list = element('dl', 'hours-list');
    for (const day of reportedDays) list.append(element('dt', '', day[0].toUpperCase() + day.slice(1)), element('dd', '', format(hours[day])));
    target.append(list);
  } else target.append(element('p', 'field-hint', format(hours)));
}

function renderStoreDetails(store) {
  const target = ui['store-details-content'];
  target.replaceChildren();
  target.append(element('p', 'field-hint', `Kroger-reported details for ${store.name}. Hours and department availability can change; confirm holiday hours with the store.`));
  const timezone = typeof store.timezone === 'string' ? store.timezone : store.timezone?.timezone || store.hours?.timezone;
  target.append(element('p', 'field-hint', `Store timezone: ${timezone || 'not supplied'}.`));
  if (store.phone) target.append(element('p', 'field-hint', `Store phone: ${store.phone}`));
  else target.append(element('p', 'field-hint', 'Store phone not supplied.'));
  appendHours(target, store.hours);
  target.append(element('h4', '', 'Reported departments'));
  if (Array.isArray(store.departments) && store.departments.length) {
    const list = element('ul', 'department-list');
    for (const department of store.departments) {
      const item = element('li');
      item.append(element('strong', '', department.name || `Department ${department.departmentId || '(name not supplied)'}`));
      if (department.phone) item.append(element('p', 'field-hint', `Phone: ${department.phone}`));
      if (department.hours) appendHours(item, department.hours, 'Department hours');
      list.append(item);
    }
    target.append(list);
  } else target.append(element('p', 'field-hint', 'Department details not supplied.'));
}

const listReasons = {
  variable_measure: 'Variable weight or measure — final amount is unknown.',
  unknown_measure: 'Sold-by basis not reported — this line cannot be estimated.',
  unknown_price: 'Usable item price unavailable.', different_store: 'Price belongs to another store.',
  invalid_quantity: 'Choose a whole-number quantity from 1 to 99.',
};

function renderBasketLine(line) {
  const item = element('li', 'basket-line');
  const facts = element('div', 'basket-line-facts');
  const name = line.product.source.description;
  facts.append(element('h4', '', name));
  if (line.product.source.size) facts.append(element('p', 'field-hint', line.product.source.size));
  facts.append(element('p', 'field-hint', line.aisles.length ? `Reported location: ${line.aisles.join('; ')}` : 'Aisle not reported.'));
  const retrieved = readableDate(line.retrievedAt);
  facts.append(element('p', 'field-hint', retrieved ? `Price snapshot: ${retrieved}.` : 'Price snapshot time not supplied.'));
  const quantity = element('div', 'basket-quantity');
  const input = element('input');
  input.type = 'number'; input.min = '1'; input.max = '99'; input.step = '1'; input.value = String(line.quantity);
  input.inputMode = 'numeric'; input.setAttribute('aria-label', `Quantity for ${name}`);
  input.setAttribute('aria-describedby', 'basket-status');
  const label = element('label', '', 'Quantity');
  label.append(input);
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (!input.value || !Number.isInteger(value) || value < 1 || value > 99) {
      input.setAttribute('aria-invalid', 'true');
      ui['basket-status'].textContent = 'Enter a whole-number quantity from 1 to 99. The previous quantity is still used in the estimate.';
      return;
    }
    state.basket = setBasketQuantity(state.basket, line.key, value);
    state.cartAcknowledged = false;
    input.removeAttribute('aria-invalid');
    const updated = estimateBasket(state.basket, state.selectedStore?.locationId);
    renderBasketTotals(updated);
    renderLineEstimate(estimate, updated.lines.find(entry => entry.key === line.key));
    updateCartControls();
    ui['basket-status'].textContent = `Quantity updated for ${name}.`;
  });
  input.dataset.lineKey = line.key;
  const remove = element('button', 'text-button', 'Remove');
  remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${name} from shopping list`);
  remove.addEventListener('click', () => {
    state.basket = state.basket.filter(entry => entry.key !== line.key);
    state.cartAcknowledged = false;
    renderBasket();
    ui['basket-status'].textContent = `${name} removed from your list.`;
    byId('basket-title').focus();
  });
  quantity.append(label, remove);
  const estimate = element('div', 'basket-line-estimate');
  renderLineEstimate(estimate, line);
  item.append(facts, quantity, estimate);
  return item;
}

function renderLineEstimate(target, line) {
  target.replaceChildren(element('strong', '', line.estimateCents === null ? 'Amount unresolved' : amount.format(line.estimateCents / 100)),
    element('p', 'field-hint', line.reason ? listReasons[line.reason] : `${amount.format(line.product.pricing.currentCents / 100)} × ${line.quantity}`));
}

function renderBasketTotals(estimate) {
  ui['list-count'].textContent = `(${state.basket.reduce((sum, line) => sum + line.quantity, 0)})`;
  ui['basket-total-label'].textContent = estimate.complete ? 'Estimated item subtotal' : 'Estimated subtotal of resolved lines';
  ui['basket-total'].textContent = amount.format(estimate.knownSubtotalCents / 100);
  ui['basket-unresolved'].textContent = estimate.unresolvedCount ? `${estimate.unresolvedCount} ${estimate.unresolvedCount === 1 ? 'line has' : 'lines have'} an unresolved amount and ${estimate.unresolvedCount === 1 ? 'is' : 'are'} excluded from this subtotal.` : 'All current list lines have a known unit-price estimate.';
}

function renderBasket() {
  const store = state.selectedStore;
  const estimate = estimateBasket(state.basket, store?.locationId);
  renderBasketTotals(estimate);
  ui['basket-store'].textContent = store ? `${store.name} · ${storeAddress(store)}` : 'Choose a store, then add groceries from its results.';
  ui['basket-empty'].hidden = state.basket.length > 0;
  ui['basket-content'].hidden = state.basket.length === 0;
  ui['clear-basket'].hidden = state.basket.length === 0;
  const groups = ui['group-aisles'].checked ? groupBasketByAisle(estimate.lines) : [{ aisle: undefined, entries: estimate.lines }];
  ui['basket-lines'].replaceChildren(...groups.map(group => {
    const section = element('div', 'aisle-group');
    if (group.aisle !== undefined) section.append(element('h3', 'aisle-heading', group.aisle || 'Aisle not reported'));
    const list = element('ul', 'basket-items');
    list.append(...group.entries.map(renderBasketLine));
    section.append(list); return section;
  }));
  updateCartControls();
}

function updateCartControls() {
  const cart = state.cart;
  ui['cart-panel'].hidden = cart?.status === 'disabled';
  const pending = Boolean(state.requests.cart);
  const uncertain = state.cartUncertain || cart?.status === 'write_outcome_unknown';
  const eligible = cartItems(state.basket, state.selectedStore?.locationId);
  ui['connect-cart'].hidden = !cart?.enabled || !cart?.configured || cart.connected || uncertain;
  ui['connect-cart'].disabled = pending || !state.alive;
  ui['disconnect-cart'].hidden = !cart?.connected && !cart?.csrfToken && !uncertain;
  ui['disconnect-cart'].disabled = pending || !cart?.csrfToken || !state.alive;
  ui['refresh-cart'].disabled = pending || !state.alive;
  ui['add-cart'].hidden = !cart?.connected || uncertain;
  ui['add-cart'].disabled = pending || !state.alive || !eligible.items.length || eligible.items.length > 50 || eligible.excludedCount > 0 || state.cartAcknowledged;
  ui['cart-unknown'].hidden = !uncertain;
  ui['cart-list-note'].textContent = !state.basket.length ? 'Add groceries to your shopping list before sending quantities to a connected Kroger cart.' :
    eligible.excludedCount ? `${eligible.excludedCount} list ${eligible.excludedCount === 1 ? 'line cannot' : 'lines cannot'} be sent. Cart adds need a known unit amount, a reported 13-digit UPC, and no more than 99 total units for each UPC. Remove or adjust those lines before sending.` :
    eligible.items.length > 50 ? 'Kroger cart adds are limited to 50 lines at a time. Reduce this list before adding.' :
      state.cartAcknowledged ? 'Kroger acknowledged the last add. Review your cart there. Changing this list will enable another add of the full listed quantities.' :
        'Each add sends the full listed quantities. Existing quantities in your Kroger cart can increase; this does not replace your cart.';
}

function describeCart(cart) {
  if (state.cartUncertain || cart?.status === 'write_outcome_unknown') return errorMessages.cart_write_outcome_unknown;
  return {
    disabled: errorMessages.cart_disabled, setup_required: errorMessages.cart_setup_required,
    authorization_required: errorMessages.cart_authorization_required,
    authorization_failed: errorMessages.cart_authorization_failed,
    connected: 'Your Kroger cart is connected. Only the explicit add button sends your list.',
  }[cart?.status] || 'Cart connection status is unavailable. Check again before continuing.';
}

async function checkCart() {
  ui['cart-status'].textContent = 'Checking cart connection…';
  try {
    const payload = await request('cart', './api/v1/cart/status', undefined, { credentials: 'same-origin' });
    if (!payload) return;
    if (!payload.cart || typeof payload.cart.status !== 'string') throw new SearchError('invalid_response');
    state.cart = payload.cart;
    if (state.cart.connected) {
      ui['cart-signin'].hidden = true;
      ui['cart-signin'].removeAttribute('href');
    }
    ui['cart-status'].textContent = describeCart(state.cart);
  } catch (error) { ui['cart-status'].textContent = describeError(error); }
  updateCartControls();
}

async function connectCart() {
  ui['cart-status'].textContent = 'Preparing Kroger sign-in…';
  state.cart = null;
  ui['cart-signin'].hidden = true;
  ui['cart-signin'].removeAttribute('href');
  try {
    const payload = await request('cart', './api/v1/cart/connect', {}, { credentials: 'same-origin' });
    if (!payload) return;
    // Connect rotates the browser session. Keep the matching CSRF value for
    // disconnect/recovery rather than reusing the previous session's token.
    state.cart = null;
    if (!payload.cart || payload.cart.configured !== true || payload.cart.enabled !== true ||
      payload.cart.connected !== false || payload.cart.status !== 'authorization_required' ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.cart.csrfToken)) throw new SearchError('invalid_response');
    state.cart = payload.cart;
    const url = new URL(payload.authorizationUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'api.kroger.com' ||
      url.pathname !== '/v1/connect/oauth2/authorize' || url.username || url.password || url.port) throw new SearchError('invalid_response');
    ui['cart-signin'].href = url.href;
    ui['cart-signin'].hidden = false;
    ui['cart-signin'].focus();
    ui['cart-status'].textContent = 'Continue to Kroger in the new tab, then return here and choose Check cart connection. Your shopping list stays in this page.';
  } catch (error) { ui['cart-status'].textContent = describeError(error); }
  updateCartControls();
}

async function disconnectCart() {
  if (!state.cart?.csrfToken || state.requests.cart) return;
  ui['cart-status'].textContent = 'Disconnecting the cart…';
  try {
    const payload = await request('cart', './api/v1/cart/disconnect', { csrfToken: state.cart.csrfToken }, { credentials: 'same-origin' });
    if (!payload) return;
    state.cart = payload.cart;
    ui['cart-signin'].hidden = true;
    ui['cart-signin'].removeAttribute('href');
    state.cartUncertain = false;
    state.cartAcknowledged = false;
    ui['cart-status'].textContent = 'Cart disconnected. Any previous cart changes remain at Kroger. Check those changes there before reconnecting and adding again.';
  } catch (error) { ui['cart-status'].textContent = describeError(error); }
  updateCartControls();
}

async function addCart() {
  if (ui['add-cart'].disabled || !state.cart?.csrfToken || state.requests.cart) return;
  const eligible = cartItems(state.basket, state.selectedStore?.locationId);
  if (eligible.excludedCount || !eligible.items.length || eligible.items.length > 50) return;
  ui['cart-status'].textContent = 'Sending the listed quantities to your Kroger cart…';
  try {
    const payload = await request('cart', './api/v1/cart/add', { items: eligible.items, csrfToken: state.cart.csrfToken }, { credentials: 'same-origin' });
    if (!payload) {
      if (state.alive) state.cartUncertain = true;
      return;
    }
    if (payload.acknowledged !== true || !payload.cart) throw new SearchError('invalid_response');
    state.cart = payload.cart;
    state.cartAcknowledged = true;
    ui['cart-status'].textContent = 'Kroger acknowledged the add request. Review the actual items, quantities, store and prices in your Kroger cart; no order has been placed.';
  } catch (error) {
    const knownRejections = ['cart_disabled', 'cart_setup_required', 'cart_session_required', 'cart_authorization_required', 'cart_csrf_invalid', 'invalid_cart_items', 'origin_not_allowed', 'invalid_host'];
    if (!knownRejections.includes(error.code)) state.cartUncertain = true;
    ui['cart-status'].textContent = state.cartUncertain ? errorMessages.cart_write_outcome_unknown : describeError(error);
  } finally { updateCartControls(); }
}

function clearHistory() {
  abortRequest('history'); abortRequest('detail');
  state.history = null; state.historyQuery = null; state.historyCursor = null;
  ui['history-results'].replaceChildren();
  ui['history-detail-content'].replaceChildren();
  ui['history-detail'].hidden = true;
  ui['history-term'].value = ''; ui['history-product-id'].value = '';
  ui['history-coverage'].textContent = '';
  ui['history-search-status'].textContent = 'Search your store’s past prices below.';
  ui['history-store'].textContent = 'Choose a store above to look for past prices.';
  ui['more-history'].hidden = true;
}

function historyScopeValid(payload) {
  return payload?.locationId === state.selectedStore?.locationId && ['available', 'permission_required', 'not_found', 'unavailable'].includes(payload.status);
}

function historyUnavailableMessage(payload) {
  if (payload.status === 'permission_required') return 'Price history isn’t available here yet. You can still browse today’s prices above.';
  if (payload.reason === 'history_environment_mismatch') return 'Past shopping prices aren’t available with this test connection.';
  if (payload.reason === 'promotion_service_not_configured') return 'Past prices aren’t available on this site yet.';
  return 'Past prices couldn’t be loaded. Try again later; today’s prices are still available above.';
}

function observationSummary(observation) {
  const date = readableDate(observation.observedAt) || 'Date unavailable';
  const promoted = observation.promotionStatus === 'reported_promotion';
  const price = historicalPrice(promoted ? observation.price?.promo : observation.price?.regular, observation.currency);
  return `${date} · ${promoted ? 'Sale price' : 'Regular price'}: ${price} · ${observation.sourceLabel || 'Source unavailable'}`;
}

function renderHistoryRows(observations) {
  return observations.map(observation => {
    const item = element('li', 'history-result');
    item.append(element('h3', '', observation.description || 'Product name unavailable'),
      element('p', 'field-hint', observationSummary(observation)));
    const button = element('button', 'text-button', 'See past price details');
    button.type = 'button';
    button.setAttribute('aria-label', `See past price details for ${observation.description || 'this product'}, ${readableDate(observation.observedAt) || 'date unknown'}`);
    button.addEventListener('click', () => { void loadHistoryDetail(observation.observationId); });
    item.append(button); return item;
  });
}

async function searchHistory({ more = false } = {}) {
  if (!state.selectedStore || state.requests.history) return;
  let query;
  if (more) {
    if (!state.historyQuery || !state.historyCursor) return;
    query = { ...state.historyQuery, cursor: state.historyCursor };
  } else {
    const term = ui['history-term'].value.trim();
    const productId = ui['history-product-id'].value.trim();
    if ((term && (term.length > 80 || /[\p{Cc}\p{Cf}]/u.test(term))) ||
      (productId && (productId.length > 100 || /[\p{Cc}\p{Cf}]/u.test(productId)))) {
      ui['history-search-status'].textContent = 'Try a shorter grocery or brand name, or check the product reference.';
      return;
    }
    query = { locationId: state.selectedStore.locationId, ...(term ? { term } : {}), ...(productId ? { productId } : {}), limit: 20 };
    state.historyQuery = query;
    state.history = null;
    state.historyCursor = null;
    ui['history-results'].replaceChildren();
    ui['history-detail'].hidden = true;
    ui['history-detail-content'].replaceChildren();
    abortRequest('detail');
  }
  ui['more-history'].hidden = true;
  ui['history-search-status'].textContent = 'Looking for past prices at your store…';
  try {
    const payload = await request('history', './api/v1/promotions/search', query);
    if (!payload) return;
    if (!historyScopeValid(payload)) throw new SearchError('invalid_response');
    if (payload.status === 'permission_required' || payload.status === 'unavailable') {
      ui['history-results'].replaceChildren();
      ui['history-coverage'].textContent = '';
      ui['history-search-status'].textContent = historyUnavailableMessage(payload);
      return;
    }
    if (!Array.isArray(payload.observations) || payload.observations.length > 50 ||
      payload.observations.some(observation => typeof observation?.observationId !== 'string' || observation.locationId !== state.selectedStore.locationId)) throw new SearchError('invalid_response');
    state.history = payload;
    ui['history-coverage'].textContent = 'These are saved prices for your store, not a complete record of its sales.';
    ui['history-results'].append(...renderHistoryRows(payload.observations));
    state.historyCursor = typeof payload.page?.nextCursor === 'string' ? payload.page.nextCursor : null;
    ui['more-history'].hidden = !state.historyCursor;
    const count = ui['history-results'].children.length;
    ui['history-search-status'].textContent = count ? `${count} past ${count === 1 ? 'price' : 'prices'} found.${payload.page?.truncated ? ' Choose Show more past prices to see the next page.' : ''}` : 'No matching past prices were found. Try another grocery or brand. This doesn’t mean the item has never been on sale.';
  } catch (error) { ui['history-search-status'].textContent = describeError(error); }
  updateControls();
}

async function loadHistoryDetail(observationId) {
  if (!state.selectedStore || typeof observationId !== 'string') return;
  ui['history-search-status'].textContent = 'Loading past price details…';
  ui['history-detail'].hidden = true;
  ui['history-detail-content'].replaceChildren();
  try {
    const payload = await request('detail', './api/v1/promotions/retrieve', { locationId: state.selectedStore.locationId, observationId });
    if (!payload) return;
    if (!historyScopeValid(payload)) throw new SearchError('invalid_response');
    if (payload.status !== 'available' || !payload.observation) {
      if (payload.status === 'permission_required') {
        state.history = null; state.historyCursor = null;
        ui['history-results'].replaceChildren();
        ui['more-history'].hidden = true;
        ui['history-coverage'].textContent = '';
      }
      ui['history-search-status'].textContent = ['permission_required', 'unavailable'].includes(payload.status) ? historyUnavailableMessage(payload) : 'This past price is no longer available. Search again to see what’s available now.';
      return;
    }
    const observation = payload.observation;
    if (observation.locationId !== state.selectedStore.locationId || observation.observationId !== observationId) throw new SearchError('invalid_response');
    const target = ui['history-detail-content'];
    target.append(element('h4', '', observation.description || 'Product description not supplied'), element('p', 'field-hint', observationSummary(observation)));
    const facts = element('dl', 'observation-facts');
    const fields = [
      ['Source', observation.sourceLabel], ['Package size', observation.size],
      ['Sold by', observation.soldBy],
      ['Regular price', historicalPrice(observation.price?.regular, observation.currency)],
    ];
    for (const [label, value] of fields) facts.append(element('dt', '', label), element('dd', '', typeof value === 'string' && value ? value : 'Not supplied'));
    target.append(facts);
    const dates = [priceDate('Reported effective', observation.price?.effectiveDate), priceDate('Reported expiration', observation.price?.expirationDate)].filter(Boolean);
    if (dates.length) target.append(element('p', 'field-hint', dates.join(' · ')));
    target.append(element('p', 'field-hint', 'This is a past price, not an offer you can buy today. Compare the same product, package and store. The lowest saved price may not be the store’s lowest-ever price.'));
    ui['history-detail'].hidden = false;
    ui['history-detail-title'].focus();
    ui['history-search-status'].textContent = 'Past price details loaded.';
  } catch (error) { ui['history-search-status'].textContent = describeError(error); }
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
  setStatus('deal', 'Grocery search cancelled. You can search again.');
  updateControls();
  ui['search-deals'].focus();
});
ui['change-store'].addEventListener('click', () => {
  clearSelection();
  renderStores();
  ui['zip-code'].focus();
  setStatus('store', 'Choose another returned store, or change the ZIP code to search a different area.');
});
for (const id of ['sort-order', 'product-view', 'snap-filter', 'declaration-filter']) ui[id].addEventListener('change', () => {
  renderResults();
  setStatus('deal', 'Returned groceries updated for the selected view, filters and order. No new search was sent.');
});
ui['clear-basket'].addEventListener('click', () => {
  state.basket = []; state.cartAcknowledged = false;
  renderBasket(); ui['basket-status'].textContent = 'Shopping list cleared. Any Kroger cart changes remain at Kroger.';
  byId('basket-title').focus();
});
ui['group-aisles'].addEventListener('change', () => { renderBasket(); ui['basket-status'].textContent = ui['group-aisles'].checked ? 'List grouped by the first reported aisle, with unknown locations last. No walking route is calculated.' : 'List shown in the order you added products.'; });
ui['cart-panel'].addEventListener('toggle', () => { if (ui['cart-panel'].open && !state.requests.cart) void checkCart(); });
ui['connect-cart'].addEventListener('click', () => { void connectCart(); });
ui['refresh-cart'].addEventListener('click', () => { void checkCart(); });
ui['disconnect-cart'].addEventListener('click', () => { void disconnectCart(); });
ui['add-cart'].addEventListener('click', () => { void addCart(); });
ui['history-form'].addEventListener('submit', event => { event.preventDefault(); void searchHistory(); });
ui['more-history'].addEventListener('click', () => { void searchHistory({ more: true }); });
for (const id of ['history-term', 'history-product-id']) ui[id].addEventListener('input', () => {
  abortRequest('history'); abortRequest('detail');
  state.history = null; state.historyQuery = null; state.historyCursor = null;
  ui['history-results'].replaceChildren(); ui['history-detail-content'].replaceChildren();
  ui['history-detail'].hidden = true; ui['more-history'].hidden = true;
  ui['history-coverage'].textContent = '';
  ui['history-search-status'].textContent = 'Historical search changed. Submit to search these product words or ID.';
  updateControls();
});
ui['cancel-history'].addEventListener('click', () => {
  abortRequest('history'); abortRequest('detail'); updateControls();
  ui['history-search-status'].textContent = 'Historical search cancelled. You can search again.';
  ui['search-history'].focus();
});
ui['retry-connection'].addEventListener('click', () => { void checkConnection(); });

window.addEventListener('pagehide', () => {
  state.alive = false;
  for (const kind of Object.keys(state.requests)) abortRequest(kind);
  clearSelection();
  state.stores = [];
  state.configured = false;
  state.cart = null; state.cartUncertain = false; state.cartAcknowledged = false;
  ui['cart-signin'].hidden = true; ui['cart-signin'].removeAttribute('href');
  ui['cart-status'].textContent = '';
  ui['basket-status'].textContent = '';
  ui['group-aisles'].checked = false;
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
renderBasket();
