import { AppError } from './errors.js';
import { historyAvailability } from './history.js';

export const SAMPLE_TOPICS = Object.freeze(['milk', 'bread', 'eggs']);
export const SAMPLE_QUERY_LIMIT = 15;
export const SEARCH_QUERY_LIMIT = 50;
export const MAX_ITEMS_PER_PRODUCT = 10;

export function validateStoreSearch(value) {
  exactObject(value, ['zipCode']);
  if (typeof value.zipCode !== 'string' || !/^\d{5}$/.test(value.zipCode)) {
    throw new AppError('invalid_zip', 'Enter a five-digit US ZIP code.');
  }
  return { zipCode: value.zipCode };
}

export function validateDealSearch(value) {
  exactObject(value, ['locationId'], ['term', 'sort']);
  if (typeof value.locationId !== 'string' || !/^[a-zA-Z0-9]{8}$/.test(value.locationId)) {
    throw new AppError('invalid_store', 'Choose a store before searching for deals.');
  }
  let term = null;
  if (Object.hasOwn(value, 'term')) {
    if (typeof value.term !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value.term)) {
      throw new AppError('invalid_search', 'Use 3–80 characters and no more than eight words.');
    }
    term = value.term.trim().replace(/\s+/gu, ' ');
    if (term.length < 3 || term.length > 80 || term.split(' ').length > 8) {
      throw new AppError('invalid_search', 'Use 3–80 characters and no more than eight words.');
    }
  }
  const sort = value.sort ?? 'savings';
  if (!['savings', 'percent', 'price'].includes(sort)) {
    throw new AppError('invalid_sort', 'Choose savings, percent or price for sorting.');
  }
  return { locationId: value.locationId, term, sort };
}

function exactObject(value, fields, optional = []) {
  if (!isObject(value) || Object.keys(value).some(key => !fields.includes(key) && !optional.includes(key)) ||
      fields.some(key => !Object.hasOwn(value, key))) {
    throw new AppError('invalid_request', 'Use only the documented fields in the JSON search body.');
  }
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function invalidUpstream() {
  return new AppError('upstream_format', 'Kroger returned an unsupported result. Try a more specific search or try again later.', 502);
}

// Reject unsupported values instead of shortening or changing source facts.
function textField(value, maxLength) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > maxLength) throw invalidUpstream();
  return value;
}

function copyPrice(value) {
  if (value == null) return {};
  if (!isObject(value)) throw invalidUpstream();
  const price = {};
  for (const key of ['regular', 'promo', 'regularPerUnitEstimate', 'promoPerUnitEstimate']) {
    if (!Object.hasOwn(value, key)) continue;
    if (value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]))) throw invalidUpstream();
    price[key] = value[key];
  }
  for (const key of ['effectiveDate', 'expirationDate']) {
    if (!Object.hasOwn(value, key)) continue;
    if (value[key] === null) { price[key] = null; continue; }
    if (!isObject(value[key])) throw invalidUpstream();
    price[key] = {};
    for (const field of ['value', 'timezone']) {
      if (Object.hasOwn(value[key], field)) price[key][field] = textField(value[key][field], 80);
    }
  }
  return price;
}

// Only whole-cent item prices are ranked. Per-unit estimates retain their
// precision and are never used as a substitute for an item's selling price.
function cents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || Math.abs(result / 100 - value) > 1e-8) return null;
  return result;
}

function explicitInstant(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendar.valueOf()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function datesAllowComparison(price, now) {
  for (const key of ['effectiveDate', 'expirationDate']) {
    if (!Object.hasOwn(price, key)) continue;
    // Date-only/local-time values do not establish an unambiguous window.
    const instant = explicitInstant(price[key]?.value);
    if (instant === null || (key === 'effectiveDate' && instant > now) ||
        (key === 'expirationDate' && instant <= now)) return false;
  }
  return true;
}

function perUnit(price) {
  const usable = value => typeof value === 'number' && value > 0 ? value : null;
  const regularEstimate = usable(price.regularPerUnitEstimate);
  const promoEstimate = usable(price.promoPerUnitEstimate);
  const present = regularEstimate !== null || promoEstimate !== null;
  return {
    status: present ? 'reported_estimate' : 'unavailable', regularEstimate, promoEstimate,
    basis: null, isEstimate: true,
    message: present ? 'Kroger-reported estimate; its unit basis is not supplied.'
      : 'No usable per-unit estimate was returned. No unit basis is inferred from package size.',
  };
}

export function compareOffers(products, { now = Date.now() } = {}) {
  if (!Array.isArray(products) || products.length > SEARCH_QUERY_LIMIT) throw invalidUpstream();
  const summary = { products: products.length, items: 0, unpriced: 0, notDiscounted: 0,
    unqualifiedDates: 0, outOfStock: 0, duplicateItems: 0, conflictingItems: 0,
    incompleteProducts: 0, notInStore: 0 };
  const groups = new Map();
  for (const product of products) {
    if (!isObject(product)) throw invalidUpstream();
    const description = textField(product.description, 512);
    const productId = textField(product.productId, 64);
    const brand = textField(product.brand, 200);
    if (product.items != null && (!Array.isArray(product.items) || product.items.length > MAX_ITEMS_PER_PRODUCT)) throw invalidUpstream();
    if (!description || !product.items) { summary.incompleteProducts++; continue; }
    for (const item of product.items) {
      summary.items++;
      if (!isObject(item)) throw invalidUpstream();
      if ((item.inventory != null && !isObject(item.inventory)) || (item.fulfillment != null && !isObject(item.fulfillment))) throw invalidUpstream();
      if (item.fulfillment?.instore != null && typeof item.fulfillment.instore !== 'boolean') throw invalidUpstream();
      const source = {
        productId, itemId: textField(item.itemId, 64), description, brand,
        size: textField(item.size, 100), soldBy: textField(item.soldBy, 40),
        price: copyPrice(item.price), stockLevel: textField(item.inventory?.stockLevel, 80),
      };
      const inStore = item.fulfillment?.instore ?? null;
      const fingerprint = JSON.stringify([source, inStore]);
      // Unknown identities remain separate. Conflicting observations of one
      // exact product/item are excluded rather than choosing the cheaper one.
      const key = source.productId && source.itemId ? JSON.stringify([source.productId, source.itemId]) : Symbol();
      const existing = groups.get(key);
      if (!existing) groups.set(key, { source, inStore, fingerprint, conflict: false });
      else if (existing.fingerprint === fingerprint) summary.duplicateItems++;
      else existing.conflict = true;
    }
  }
  const offers = [];
  for (const { source, inStore, conflict } of groups.values()) {
    if (conflict) { summary.conflictingItems++; continue; }
    if (inStore === false) { summary.notInStore++; continue; }
    if (source.stockLevel === 'TEMPORARILY_OUT_OF_STOCK') { summary.outOfStock++; continue; }
    const regular = cents(source.price.regular);
    const promo = cents(source.price.promo);
    if (regular === null || promo === null) { summary.unpriced++; continue; }
    if (promo >= regular) { summary.notDiscounted++; continue; }
    if (!datesAllowComparison(source.price, now)) { summary.unqualifiedDates++; continue; }
    offers.push({ source,
      calculated: { savingsCents: regular - promo, percentOff: ((regular - promo) / regular) * 100 },
      perUnit: perUnit(source.price), history: historyAvailability(),
      dateStatus: Object.hasOwn(source.price, 'effectiveDate') || Object.hasOwn(source.price, 'expirationDate')
        ? 'within_reported_window' : 'not_provided',
    });
  }
  return { offers, summary };
}
