import { AppError } from './errors.js';
import { historyAvailability } from './history.js';
import { productDetails, fulfillment } from './catalog.js';

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

export function validateProductSearch(value) {
  exactObject(value, ['locationId'], ['term', 'sort', 'includeAll']);
  const { includeAll = true, ...search } = value;
  if (typeof includeAll !== 'boolean') throw new AppError('invalid_request', 'includeAll must be true or false.');
  return { ...validateDealSearch(search), includeAll };
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

function itemSource(product, item, detail) {
  if (!isObject(item) || (item.inventory != null && !isObject(item.inventory)) ||
      (item.fulfillment != null && !isObject(item.fulfillment))) throw invalidUpstream();
  return {
    productId: textField(product.productId, 64), itemId: textField(item.itemId, 64),
    description: textField(product.description, 512), brand: textField(product.brand, 200),
    size: textField(item.size, 100), soldBy: textField(item.soldBy, 40),
    price: copyPrice(item.price), stockLevel: textField(item.inventory?.stockLevel, 80),
    ...detail, fulfillment: fulfillment(item.fulfillment),
    nationalPrice: item.nationalPrice == null ? null : copyPrice(item.nationalPrice),
  };
}

// Evidence accounts for returned source rows independently of shopping/ranking
// eligibility. Indices locate this response only; they are not product IDs.
function sourceEvidence(products, offers, now) {
  const records = [];
  const groups = new Map();
  const ranked = new Set(offers.map(offer => JSON.stringify(offer.source)));
  products.forEach((product, productIndex) => {
    const detail = productDetails(product);
    const hasItems = Boolean(product.items?.length);
    const items = hasItems ? product.items : [null];
    items.forEach((item, itemIndex) => {
      if (hasItems && !isObject(item)) throw invalidUpstream();
      const fullSource = itemSource(product, item ?? {}, detail);
      const { productId, itemId, description, brand, size, soldBy, price, stockLevel,
        fulfillment: availability, categories, snapEligible, manufacturerDeclarations,
        organicClaimName, nonGmo, nonGmoClaimName } = fullSource;
      const source = { productId, itemId, description, brand, size, soldBy, price, stockLevel,
        fulfillment: availability, categories, snapEligible, manufacturerDeclarations,
        organicClaimName, nonGmo, nonGmoClaimName };
      const dispositions = [];
      if (item === null) dispositions.push('missing_items');
      if (!description) dispositions.push('missing_description');
      if (availability?.instore === false) dispositions.push('not_in_store');
      if (stockLevel === 'TEMPORARILY_OUT_OF_STOCK') dispositions.push('out_of_stock');
      const regular = cents(price.regular);
      const promo = cents(price.promo);
      const reportedPromotion = typeof price.promo === 'number' && price.promo > 0;
      if (price.regular == null) dispositions.push('missing_regular_price');
      else if (regular === null) dispositions.push('unsupported_price');
      if (!reportedPromotion) dispositions.push('no_positive_promo');
      else if (promo === null) dispositions.push('unsupported_price');
      else if (regular !== null && promo >= regular) dispositions.push('not_discounted');
      if (!datesAllowComparison(price, now)) dispositions.push('unqualified_dates');
      const record = { recordIndex: records.length, productIndex,
        itemIndex: item === null ? null : itemIndex, source, reportedPromotion,
        // Arithmetic capability is independent of stock, dates and whether a
        // source row is included in the strict offer list.
        savingsArithmeticAvailable: regular !== null && promo !== null && promo < regular,
        includedInOffers: item !== null && Boolean(description) && ranked.has(JSON.stringify(fullSource)),
        dispositions: [...new Set(dispositions)], duplicateOf: null };
      records.push(record);
      if (!productId || !itemId || item === null) return;
      const key = JSON.stringify([productId, itemId]);
      const fingerprint = JSON.stringify(fullSource);
      const group = groups.get(key);
      if (!group) groups.set(key, { fingerprints: new Map([[fingerprint, record.recordIndex]]), records: [record], conflict: false });
      else {
        if (group.fingerprints.has(fingerprint)) {
          record.dispositions.push('duplicate');
          record.duplicateOf = group.fingerprints.get(fingerprint);
          record.includedInOffers = false;
        } else {
          group.conflict = true;
          group.fingerprints.set(fingerprint, record.recordIndex);
        }
        group.records.push(record);
      }
    });
  });
  for (const group of groups.values()) if (group.conflict) {
    for (const record of group.records) {
      record.dispositions.push('identity_conflict');
    }
  }
  return { records, summary: { records: records.length,
    returnedProducts: products.length,
    returnedItems: records.filter(record => record.itemIndex !== null).length,
    reportedPromotions: records.filter(record => record.reportedPromotion).length,
    withoutSavingsArithmetic: records.filter(record => record.reportedPromotion && !record.savingsArithmeticAvailable).length,
    otherReportedPromotions: records.filter(record => record.reportedPromotion && !record.includedInOffers).length,
    missingItemLists: records.filter(record => record.itemIndex === null).length } };
}

export function compareOffers(products, { now = Date.now() } = {}) {
  if (!Array.isArray(products) || products.length > SEARCH_QUERY_LIMIT) throw invalidUpstream();
  const summary = { products: products.length, items: 0, unpriced: 0, notDiscounted: 0,
    unqualifiedDates: 0, outOfStock: 0, duplicateItems: 0, conflictingItems: 0,
    incompleteProducts: 0, notInStore: 0, noReportedPromotion: 0,
    missingRegularPrice: 0, unsupportedPrice: 0, usablePriced: 0, qualifyingPromotions: 0 };
  const groups = new Map();
  for (const product of products) {
    if (!isObject(product)) throw invalidUpstream();
    const description = textField(product.description, 512);
    const productId = textField(product.productId, 64);
    const brand = textField(product.brand, 200);
    const detail = productDetails(product);
    if (product.items != null && (!Array.isArray(product.items) || product.items.length > MAX_ITEMS_PER_PRODUCT)) throw invalidUpstream();
    if (!description || !product.items?.length) summary.incompleteProducts++;
    if (!product.items?.length) continue;
    for (const item of product.items) {
      summary.items++;
      if (!isObject(item)) throw invalidUpstream();
      if ((item.inventory != null && !isObject(item.inventory)) || (item.fulfillment != null && !isObject(item.fulfillment))) throw invalidUpstream();
      if (item.fulfillment?.instore != null && typeof item.fulfillment.instore !== 'boolean') throw invalidUpstream();
      const source = itemSource(product, item, detail);
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
  const pricedProducts = [];
  for (const { source, inStore, conflict } of groups.values()) {
    if (conflict) { summary.conflictingItems++; continue; }
    // Missing names do not qualify a shopping row, but their exact identities
    // and differing price facts must participate in conflict detection first.
    if (!source.description) continue;
    if (inStore === false) { summary.notInStore++; continue; }
    if (source.stockLevel === 'TEMPORARILY_OUT_OF_STOCK') { summary.outOfStock++; continue; }
    const regular = cents(source.price.regular);
    const promo = cents(source.price.promo);
    // v1's unpriced counter means "cannot compare both prices"; retain it for
    // compatibility, with disjoint, truthful reasons for the new interface.
    if (regular === null || promo === null) summary.unpriced++;
    const regularMissing = source.price.regular == null;
    const promoNotReported = source.price.promo == null || source.price.promo === 0;
    let reason = null;
    if (regularMissing) { summary.missingRegularPrice++; reason = 'missing_regular_price'; }
    else if (regular === null || (promo === null && !promoNotReported)) { summary.unsupportedPrice++; reason = 'unsupported_price'; }
    else if (promoNotReported) { summary.noReportedPromotion++; reason = 'no_reported_promotion'; }
    else if (promo >= regular) { summary.notDiscounted++; reason = 'not_discounted'; }
    else if (!datesAllowComparison(source.price, now)) { summary.unqualifiedDates++; reason = 'unqualified_dates'; }
    const qualifies = reason === null;
    // An unsupported/unqualified promotion does not displace a usable regular
    // price. A promo-only price is shown without inventing regular savings.
    const current = qualifies || regular === null && promo !== null && datesAllowComparison(source.price, now) ? promo : regular;
    if (current === null) continue;
    const offer = { source,
      calculated: qualifies ? { savingsCents: regular - promo, percentOff: ((regular - promo) / regular) * 100 } : null,
      perUnit: perUnit(source.price), history: historyAvailability(),
      dateStatus: Object.hasOwn(source.price, 'effectiveDate') || Object.hasOwn(source.price, 'expirationDate')
        ? datesAllowComparison(source.price, now) ? 'within_reported_window' : 'unqualified' : 'not_provided',
      pricing: { status: qualifies ? 'promotion' : regular === null ? 'unqualified_promotion' : 'regular_only',
        regularCents: regular, promoCents: promo, currentCents: current, reason },
    };
    pricedProducts.push(offer);
    if (qualifies) offers.push(offer);
  }
  summary.usablePriced = pricedProducts.length;
  summary.qualifyingPromotions = offers.length;
  return { offers, products: pricedProducts, summary,
    sourceEvidence: sourceEvidence(products, offers, now) };
}
