// Pure request and arithmetic rules for stored observations. This module has
// no network, storage, account, tax, coupon, or checkout operations.
export const MAX_ESTIMATE_ITEMS = 10;
export const MAX_ESTIMATE_QUANTITY = 99;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum &&
  value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value);
const storeId = value => typeof value === 'string' && /^[a-zA-Z0-9]{8}$/u.test(value);
const topic = value => boundedText(value, 80) && value.length >= 3 && value !== '*' && value.split(/\s+/u).length <= 8;
const exactFields = (value, required, optional = []) => object(value) &&
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));

export function validPriceSearchRequest(value) {
  return exactFields(value, ['locationId', 'topic'], ['productId', 'itemId', 'limit', 'cursor']) &&
    storeId(value.locationId) && topic(value.topic) &&
    ['productId', 'itemId'].every(key => value[key] === undefined || boundedText(value[key], 100)) &&
    (value.limit === undefined || Number.isInteger(value.limit) && value.limit >= 1 && value.limit <= 50) &&
    (value.cursor === undefined || typeof value.cursor === 'string' && value.cursor.length <= 512 && /^[a-zA-Z0-9_-]+$/u.test(value.cursor));
}

export function validEstimateRequest(value) {
  if (!exactFields(value, ['locationId', 'items']) || !storeId(value.locationId) || !Array.isArray(value.items) ||
      value.items.length < 1 || value.items.length > MAX_ESTIMATE_ITEMS) return false;
  const seen = new Set();
  return value.items.every(item => {
    if (!exactFields(item, ['topic', 'productId', 'itemId', 'quantity']) || !topic(item.topic) ||
        !boundedText(item.productId, 100) || !boundedText(item.itemId, 100) ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_ESTIMATE_QUANTITY) return false;
    const identity = JSON.stringify([item.productId, item.itemId]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function storedAvailability(inStore, stockLevel) {
  return { inStore, stockLevel, status: inStore === false ? 'not_in_store'
    : ['TEMPORARILY_OUT_OF_STOCK', 'OUT_OF_STOCK'].includes(stockLevel) ? 'reported_out_of_stock'
      : ['HIGH', 'LOW'].includes(stockLevel) ? 'reported_in_stock' : 'unreported' };
}

export function storedPriceDecision(product, windowCurrent) {
  let reason = null;
  if (product.availability.inStore === false) reason = 'not_in_store';
  else if (product.availability.status === 'reported_out_of_stock') reason = 'out_of_stock';
  else if (product.priceQualification !== 'qualified') reason = 'unsupported_source_price';
  else if (product.dateQualification !== 'qualified' || !windowCurrent) reason = 'unqualified_dates';
  const regular = product.price.regularCents;
  const promo = product.price.promoCents;
  if (reason === null && !(regular > 0)) reason = promo > 0 ? 'missing_regular_price' : 'missing_price';
  if (reason !== null) return { status: 'unavailable', currentCents: null, reason };
  const promotion = promo > 0 && promo < regular;
  return { status: promotion ? 'promotion' : 'regular_only', currentCents: promotion ? promo : regular, reason: null };
}

export function priceQualificationGaps(product) {
  const gaps = [];
  if (product.currency === null) gaps.push('currency_unreported');
  else if (!/^[A-Z]{3}$/u.test(product.currency)) gaps.push('currency_unsupported');
  // These are deliberately narrow supported calculation contexts, not new
  // source facts. Opaque or conditional values remain visible and unverified.
  if (product.priceBasis !== 'one-package') gaps.push(product.priceBasis === null ? 'price_basis_unreported' : 'price_basis_unverified');
  if (product.eligibilityKey !== 'all-shoppers') gaps.push(product.eligibilityKey === null ? 'eligibility_unreported' : 'eligibility_unverified');
  if (product.modality !== 'IN_STORE') gaps.push(product.modality === null ? 'modality_unreported' : 'modality_unverified');
  if (product.availability.inStore === null) gaps.push('in_store_fulfillment_unreported');
  if (product.availability.status === 'unreported') gaps.push('stock_unreported');
  return gaps;
}

export function estimateStoredLine({ item, product = null, snapshot = null, reason = null }) {
  if (reason === null) {
    if (!product) reason = 'not_in_latest_sample';
    else if (product.pricing.status === 'unavailable') reason = product.pricing.reason;
    else if (typeof product.soldBy !== 'string' || product.soldBy.toLowerCase() !== 'unit') reason = 'variable_or_unknown_quantity_basis';
  }
  const current = product?.pricing.currentCents ?? null;
  const amount = reason === null ? current * item.quantity : null;
  if (reason === null && (!Number.isSafeInteger(current) || current <= 0 || !Number.isSafeInteger(amount) || amount <= 0)) {
    reason = 'arithmetic_overflow';
  }
  return { ...item, status: reason === null ? 'estimated' : 'unresolved', reason,
    unitPriceCents: reason === null ? current : null, lineTotalCents: reason === null ? amount : null,
    currency: product?.currency ?? null, observationId: product?.observationId ?? null,
    observedAt: product?.observedAt ?? null, snapshot, product,
    qualificationGaps: product?.qualificationGaps ?? [] };
}

export function storedEstimateTotals(lines) {
  const estimated = lines.filter(line => line.status === 'estimated');
  const gaps = new Set(lines.flatMap(line => line.qualificationGaps));
  const unresolvedLineCount = lines.length - estimated.length;
  if (unresolvedLineCount) gaps.add('unresolved_lines');
  let currency = null;
  let currencyQualification = 'unavailable';
  let reportedSubtotalCents = null;
  if (estimated.length) {
    const currencies = new Set(estimated.map(line => line.currency));
    const sourceCurrency = estimated[0].currency;
    const homogeneous = currencies.size === 1 && (sourceCurrency === null || /^[A-Z]{3}$/u.test(sourceCurrency));
    if (homogeneous) {
      currency = sourceCurrency;
      currencyQualification = currency === null ? 'unreported' : 'source_reported';
      const sum = estimated.reduce((total, line) => total + line.lineTotalCents, 0);
      if (Number.isSafeInteger(sum) && sum > 0) reportedSubtotalCents = sum;
      else gaps.add('arithmetic_overflow');
    } else {
      currencyQualification = 'incomparable';
      gaps.add('currency_incomparable');
    }
  } else gaps.add('no_resolved_prices');
  return { reportedSubtotalCents,
    qualifiedSubtotalCents: reportedSubtotalCents !== null && gaps.size === 0 ? reportedSubtotalCents : null,
    currency, currencyQualification, estimatedLineCount: estimated.length, unresolvedLineCount,
    qualificationGaps: [...gaps].sort() };
}
