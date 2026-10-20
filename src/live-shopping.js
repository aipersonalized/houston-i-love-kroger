import { AppError } from './errors.js';
import { compareOffers } from './deals.js';
import { priceQualificationGaps, storedAvailability, storedEstimateTotals } from './stored-pricing.js';

export const MAX_LIVE_ESTIMATE_ITEMS = 10;
const PRODUCT_ID = /^\d{13}$/u;
const LOCATION_ID = /^[a-zA-Z0-9]{8}$/u;

function exactFields(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

export function validateProductRetrieve(value) {
  if (!exactFields(value, ['locationId', 'productId']) ||
      typeof value.locationId !== 'string' || !LOCATION_ID.test(value.locationId) ||
      typeof value.productId !== 'string' || !PRODUCT_ID.test(value.productId)) {
    throw new AppError('invalid_request', 'Use the exact eight-character store ID and thirteen-digit product ID returned by product search.');
  }
  return { locationId: value.locationId, productId: value.productId };
}

export function validateLiveEstimate(value) {
  if (!exactFields(value, ['locationId', 'items']) ||
      typeof value.locationId !== 'string' || !LOCATION_ID.test(value.locationId) ||
      !Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_LIVE_ESTIMATE_ITEMS) {
    throw new AppError('invalid_request', 'Use an exact store and one to ten distinct product/item selections with whole quantities from 1 to 99.');
  }
  const seen = new Set();
  const items = value.items.map(item => {
    if (!exactFields(item, ['productId', 'itemId', 'quantity']) ||
        typeof item.productId !== 'string' || !PRODUCT_ID.test(item.productId) ||
        typeof item.itemId !== 'string' || item.itemId.length < 1 || item.itemId.length > 64 ||
        item.itemId !== item.itemId.trim() || /[\p{Cc}\p{Cf}]/u.test(item.itemId) ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
      throw new AppError('invalid_request', 'Select returned product/item IDs and a whole quantity from 1 to 99; do not submit prices or checkout fields.');
    }
    const key = JSON.stringify([item.productId, item.itemId]);
    if (seen.has(key)) throw new AppError('invalid_request', 'Combine quantities for a product/item pair before estimating.');
    seen.add(key);
    return { productId: item.productId, itemId: item.itemId, quantity: item.quantity };
  });
  return { locationId: value.locationId, items };
}

function checkCancellation(signal) {
  if (signal?.aborted) throw new AppError('request_cancelled', 'The search was cancelled.', 499);
}

// Validate at the app boundary as well as the real client boundary. An injected
// adapter cannot turn a different product into a successful exact-ID recheck.
export async function readSelectedProduct(client, { locationId, productId }, { signal } = {}) {
  checkCancellation(signal);
  if (typeof client.getProduct !== 'function') {
    throw new AppError('product_retrieval_unavailable', 'This installation cannot recheck an exact product. Ask its operator to update the product connection.', 503);
  }
  const product = await client.getProduct(locationId, productId, { signal });
  checkCancellation(signal);
  if (!product || typeof product !== 'object' || Array.isArray(product) || product.productId !== productId) {
    throw new AppError('upstream_format', 'Kroger returned a different or unsupported product. Search again before selecting an item.', 502);
  }
  return product;
}

function estimateLine(item, read, normalized) {
  const evidence = normalized?.sourceEvidence.records.filter(record => record.source.productId === item.productId && record.source.itemId === item.itemId) ?? [];
  const conflict = evidence.some(record => record.dispositions.includes('identity_conflict'));
  const selected = normalized?.products.find(product => product.source.productId === item.productId && product.source.itemId === item.itemId) ?? null;
  const source = conflict ? null : selected?.source ?? evidence[0]?.source ?? null;
  const dispositions = new Set(evidence.flatMap(record => record.dispositions));
  let reason = read.product === null ? 'product_not_found' : evidence.length === 0 ? 'item_not_found' : null;
  if (reason === null) {
    if (conflict) reason = 'identity_conflict';
    else if (dispositions.has('missing_description')) reason = 'incomplete_product';
    else if (dispositions.has('not_in_store')) reason = 'not_in_store';
    else if (['TEMPORARILY_OUT_OF_STOCK', 'OUT_OF_STOCK'].includes(source.stockLevel)) reason = 'out_of_stock';
    else if (dispositions.has('unqualified_dates')) reason = 'unqualified_dates';
    else if (!selected) reason = dispositions.has('missing_regular_price') ? 'missing_regular_price'
      : dispositions.has('unsupported_price') ? 'unsupported_price' : 'missing_price';
    else if (typeof source.soldBy !== 'string' || source.soldBy.toLowerCase() !== 'unit') reason = 'variable_or_unknown_quantity_basis';
  }
  const unit = selected?.pricing.currentCents ?? null;
  const amount = reason === null ? unit * item.quantity : null;
  if (reason === null && (!Number.isSafeInteger(unit) || unit <= 0 || !Number.isSafeInteger(amount) || amount <= 0)) {
    reason = 'arithmetic_overflow';
  }
  // The current normalized Public Products contract does not establish these
  // purchase conditions. Store location, soldBy and arithmetic supply none of
  // them. Keep this separate from the unchanged stored-price source model.
  const qualificationGaps = source ? priceQualificationGaps({ currency: null, priceBasis: null,
    eligibilityKey: null, modality: null, availability: storedAvailability(source.fulfillment?.instore ?? null, source.stockLevel) }) : [];
  return { ...item, status: reason === null ? 'estimated' : 'unresolved', reason,
    unitPriceCents: reason === null ? unit : null, lineTotalCents: reason === null ? amount : null,
    currency: null, retrievedAt: read.retrievedAt, source, pricing: selected?.pricing ?? null,
    sourceEvidence: evidence, qualificationGaps };
}

export async function estimateLiveBasket(client, input, { signal, now = Date.now } = {}) {
  const reads = new Map();
  // A finite shopper-selected list is rechecked once per unique product, in
  // order. No concurrent fan-out, search expansion, storage or source traversal.
  for (const { productId } of input.items) {
    if (reads.has(productId)) continue;
    let product;
    try { product = await readSelectedProduct(client, { locationId: input.locationId, productId }, { signal }); }
    catch (error) {
      checkCancellation(signal);
      if (!(error instanceof AppError) || error.code !== 'upstream_not_found') throw error;
      product = null;
    }
    const retrieved = now();
    // Reject malformed facts before starting another product read. Evaluate
    // all retained facts again at the common final instant for date expiry.
    if (product !== null) compareOffers([product], { now: retrieved });
    reads.set(productId, { product, retrievedAt: new Date(retrieved).toISOString() });
  }
  checkCancellation(signal);
  const evaluated = now();
  const evaluatedAt = new Date(evaluated).toISOString();
  const normalized = new Map([...reads].map(([id, read]) => [id, read.product === null ? null : compareOffers([read.product], { now: evaluated })]));
  const lines = input.items.map(item => estimateLine(item, reads.get(item.productId), normalized.get(item.productId)));
  const totals = storedEstimateTotals(lines);
  return { status: totals.unresolvedLineCount === 0 ? 'complete' : 'partial', locationId: input.locationId,
    retrievedAt: evaluatedAt, evaluatedAt, lines, totals,
    coverage: { type: 'selected_products', requestedLineCount: lines.length, recheckedProductCount: reads.size,
      exhaustive: false, message: 'Fresh checks of the selected products only; no complete catalog or promotion coverage.' },
    exclusions: ['tax', 'fees', 'coupons', 'eligibility_verification', 'checkout_changes'] };
}
