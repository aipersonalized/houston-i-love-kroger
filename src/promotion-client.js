import { priceQualificationGaps, storedAvailability, storedEstimateTotals } from './stored-pricing.js';

export class PromotionClientError extends Error {
  constructor(code = 'promotion_service_unavailable') {
    super(code === 'promotion_service_timeout' ? 'The private promotion service did not respond in time.' :
      code === 'promotion_request_invalid' ? 'Check the documented promotion fields and matching search cursor.' :
      code === 'promotion_service_configuration_invalid' ? 'Check the private promotion service configuration.' :
        'The private promotion service could not complete the request.');
    this.name = 'PromotionClientError'; this.code = code; this.status = code === 'promotion_request_invalid' ? 400 : 503;
  }
}

function configurationError() { throw new PromotionClientError('promotion_service_configuration_invalid'); }
const utc = instant => typeof instant === 'string' && Number.isFinite(Date.parse(instant)) && new Date(instant).toISOString() === instant;
const snapshotValid = snapshot => snapshot && typeof snapshot.snapshotId === 'string' && utc(snapshot.observedAt) &&
  utc(snapshot.completedAt) && snapshot.completedAt >= snapshot.observedAt && Number.isInteger(snapshot.ageSeconds) && snapshot.ageSeconds >= 0 &&
  Number.isInteger(snapshot.maxAgeSeconds) && snapshot.maxAgeSeconds >= 1 && snapshot.maxAgeSeconds <= 604_800;
const priceReasons = ['missing_price', 'missing_regular_price', 'unsupported_source_price', 'unqualified_dates', 'out_of_stock', 'not_in_store'];
const cents = value => value === null || Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000;
function validPriceProduct(row, locationId, snapshot) {
  if (!row || row.locationId !== locationId || typeof row.observationId !== 'string' || typeof row.productId !== 'string' ||
      typeof row.itemId !== 'string' || row.observedAt !== snapshot?.observedAt || !row.price ||
      ['currency', 'priceBasis', 'eligibilityKey', 'modality', 'soldBy'].some(key => row[key] !== null && typeof row[key] !== 'string') ||
      !['qualified', 'unsupported_source_price'].includes(row.priceQualification) || !['qualified', 'unqualified'].includes(row.dateQualification) ||
      !cents(row.price.regularCents) || !cents(row.price.promoCents) ||
      row.price.regular !== (row.price.regularCents === null ? null : row.price.regularCents / 100) ||
      row.price.promo !== (row.price.promoCents === null ? null : row.price.promoCents / 100) || !row.availability ||
      ![true, false, null].includes(row.availability.inStore) ||
      !(row.availability.stockLevel === null || typeof row.availability.stockLevel === 'string') ||
      row.availability.status !== storedAvailability(row.availability.inStore, row.availability.stockLevel).status ||
      !row.pricing || !['promotion', 'regular_only', 'unavailable'].includes(row.pricing.status) ||
      !Array.isArray(row.qualificationGaps) || JSON.stringify(row.qualificationGaps) !== JSON.stringify(priceQualificationGaps(row))) return false;
  const { status, currentCents, reason } = row.pricing;
  if (status === 'unavailable') return currentCents === null && priceReasons.includes(reason) && row.calculated === null;
  if (reason !== null || row.priceQualification !== 'qualified' || row.dateQualification !== 'qualified' ||
      row.availability.inStore === false || row.availability.status === 'reported_out_of_stock' ||
      !Number.isSafeInteger(currentCents) || currentCents <= 0 || !(row.price.regularCents > 0)) return false;
  if (status === 'regular_only') return currentCents === row.price.regularCents && row.calculated === null &&
    !(row.price.promoCents > 0 && row.price.promoCents < row.price.regularCents);
  return currentCents === row.price.promoCents && currentCents < row.price.regularCents && row.calculated &&
    row.calculated.savingsCents === row.price.regularCents - currentCents &&
    Math.abs(row.calculated.percentOff - row.calculated.savingsCents / row.price.regularCents * 100) < 1e-8;
}
function validEstimate(value, input) {
  if (!['complete', 'partial', 'unavailable', 'permission_required'].includes(value.status) || !utc(value.evaluatedAt) ||
      !Array.isArray(value.lines) || value.lines.length !== input.items.length || value.coverage.completeCatalog !== false ||
      JSON.stringify(value.exclusions) !== JSON.stringify(['tax', 'fees', 'coupons', 'eligibility_verification', 'checkout_changes'])) return false;
  for (const [index, line] of value.lines.entries()) {
    const item = input.items[index];
    if (!line || ['topic', 'productId', 'itemId', 'quantity'].some(key => line[key] !== item[key]) ||
        !['estimated', 'unresolved'].includes(line.status) || !Array.isArray(line.qualificationGaps) ||
        !(line.snapshot === null || snapshotValid(line.snapshot))) return false;
    const product = line.product;
    if (product !== null && (!validPriceProduct(product, input.locationId, line.snapshot) || product.productId !== item.productId ||
        product.itemId !== item.itemId || line.observationId !== product.observationId || line.observedAt !== product.observedAt ||
        line.currency !== product.currency || JSON.stringify(line.qualificationGaps) !== JSON.stringify(product.qualificationGaps))) return false;
    if (product === null && (line.observationId !== null || line.observedAt !== null || line.currency !== null || line.qualificationGaps.length)) return false;
    if (line.status === 'estimated') {
      if (!product || product.pricing.status === 'unavailable' || typeof product.soldBy !== 'string' || product.soldBy.toLowerCase() !== 'unit' ||
          line.reason !== null || line.unitPriceCents !== product.pricing.currentCents || !Number.isSafeInteger(line.lineTotalCents) ||
          line.lineTotalCents <= 0 || line.lineTotalCents !== line.unitPriceCents * item.quantity ||
          line.snapshot.ageSeconds >= line.snapshot.maxAgeSeconds) return false;
    } else if (line.unitPriceCents !== null || line.lineTotalCents !== null ||
      ![...priceReasons, 'not_in_latest_sample', 'variable_or_unknown_quantity_basis', 'arithmetic_overflow', 'permission_required', 'no_data', 'stale'].includes(line.reason)) return false;
  }
  const totals = storedEstimateTotals(value.lines);
  if (!value.totals || Object.keys(totals).some(key => JSON.stringify(value.totals[key]) !== JSON.stringify(totals[key]))) return false;
  const status = value.lines.every(line => line.reason === 'permission_required') ? 'permission_required'
    : totals.unresolvedLineCount === 0 ? 'complete' : totals.estimatedLineCount > 0 ? 'partial' : 'unavailable';
  return value.status === status;
}
function validResponse(value, operation, input) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (operation === 'getComparisons') return ['available', 'permission_required'].includes(value.status) &&
    Array.isArray(value.histories) && value.histories.length === input.offers.length &&
    value.histories.every(row => row && typeof row.status === 'string');
  if (!value.coverage || value.coverage.type !== 'bounded_topic_sample') return false;
  if (operation === 'getStatus') return ['available', 'permission_required'].includes(value.status);
  if (value.locationId !== input.locationId) return false;
  if (operation === 'estimateBasket') return validEstimate(value, input);
  if (operation === 'searchPrices') {
    const page = value.page;
    return ['available', 'no_data', 'stale', 'permission_required'].includes(value.status) && value.topic === input.topic &&
      value.coverage.topic === input.topic && value.coverage.completeCatalog === false && Array.isArray(value.products) &&
      value.products.length <= (input.limit ?? 20) && (value.status === 'available' || value.products.length === 0) &&
      (['available', 'stale'].includes(value.status) ? snapshotValid(value.snapshot) &&
        (value.status === 'available' ? value.snapshot.ageSeconds < value.snapshot.maxAgeSeconds : value.snapshot.ageSeconds >= value.snapshot.maxAgeSeconds)
        : value.snapshot === null) && value.products.every(row => validPriceProduct(row, input.locationId, value.snapshot) &&
          (input.productId === undefined || row.productId === input.productId) && (input.itemId === undefined || row.itemId === input.itemId)) &&
      page && page.limit === (input.limit ?? 20) && page.returned === value.products.length && typeof page.truncated === 'boolean' &&
      (page.truncated ? typeof page.nextCursor === 'string' && page.nextCursor.length > 0 : page.nextCursor === null);
  }
  if (operation === 'getLatestDeals') {
    const utc = instant => typeof instant === 'string' && Number.isFinite(Date.parse(instant)) &&
      new Date(instant).toISOString() === instant;
    const snapshot = value.snapshot;
    const page = value.page;
    return ['available', 'no_data', 'stale', 'permission_required'].includes(value.status) && value.topic === input.topic &&
      value.coverage.topic === input.topic && value.coverage.completeCatalog === false &&
      Array.isArray(value.deals) && value.deals.length <= (input.limit ?? 20) &&
      (value.status === 'available' || value.deals.length === 0) &&
      (['available', 'stale'].includes(value.status) ? snapshot && typeof snapshot.snapshotId === 'string' &&
        utc(snapshot.observedAt) && utc(snapshot.completedAt) && snapshot.completedAt >= snapshot.observedAt &&
        Number.isInteger(snapshot.ageSeconds) && snapshot.ageSeconds >= 0 &&
        Number.isInteger(snapshot.maxAgeSeconds) && snapshot.maxAgeSeconds >= 1 && snapshot.maxAgeSeconds <= 604_800 &&
        (value.status === 'available' ? snapshot.ageSeconds < snapshot.maxAgeSeconds : snapshot.ageSeconds >= snapshot.maxAgeSeconds)
        : snapshot === null) &&
      (value.latestAttempt === null || value.latestAttempt && ['running', 'completed', 'failed', 'blocked'].includes(value.latestAttempt.status) &&
        utc(value.latestAttempt.startedAt) && (value.latestAttempt.finishedAt === null || utc(value.latestAttempt.finishedAt))) &&
      value.deals.every(row => row && row.locationId === input.locationId && typeof row.observationId === 'string' &&
        row.observedAt === snapshot.observedAt && row.priceQualification === 'qualified' &&
        row.dateQualification === 'qualified' && row.promotionStatus === 'reported_promotion' &&
        Number.isSafeInteger(row.price?.regularCents) && Number.isSafeInteger(row.price?.promoCents) &&
        row.price.promoCents > 0 && row.price.regularCents > row.price.promoCents && row.availability &&
        row.availability.inStore !== false && !['TEMPORARILY_OUT_OF_STOCK', 'OUT_OF_STOCK'].includes(row.availability.stockLevel) &&
        ['reported_in_stock', 'unreported'].includes(row.availability.status)) &&
      page && page.limit === (input.limit ?? 20) && page.returned === value.deals.length &&
      typeof page.truncated === 'boolean' &&
      (page.truncated ? typeof page.nextCursor === 'string' && page.nextCursor.length > 0 : page.nextCursor === null);
  }
  if (operation === 'searchPromotions') return ['available', 'permission_required'].includes(value.status) &&
    Array.isArray(value.observations) && value.observations.length <= (input.limit ?? 20) &&
    value.observations.every(row => row && row.locationId === input.locationId && typeof row.observationId === 'string') &&
    value.page && value.page.returned === value.observations.length && typeof value.page.truncated === 'boolean' &&
    (value.page.nextCursor === null || typeof value.page.nextCursor === 'string');
  return ['available', 'not_found', 'permission_required'].includes(value.status) &&
    (value.status === 'available' ? value.observation?.locationId === input.locationId &&
      value.observation.observationId === input.observationId : value.observation === null);
}

// No cache or automatic retry: permissions are rechecked by the database owner
// on each request, and a failed lookup must not look like an empty history.
export function createPromotionClient({ url, token, timeoutMs = 5000, maxResponseBytes = 2_097_152,
  fetchImpl = globalThis.fetch } = {}) {
  let base;
  try { base = new URL(url); } catch { configurationError(); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash ||
      base.pathname !== '/' || typeof token !== 'string' || !/^[\x21-\x7e]{32,512}$/u.test(token) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 30_000 ||
      !Number.isInteger(maxResponseBytes) || maxResponseBytes < 64 || maxResponseBytes > 2_097_152 ||
      typeof fetchImpl !== 'function') configurationError();

  async function call(path, operation, input) {
    const controller = new AbortController();
    let timer;
    let reader;
    const work = async () => {
      const response = await fetchImpl(new URL(path, base), {
        method: operation === 'getStatus' ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(operation === 'getStatus' ? {} : { 'Content-Type': 'application/json' }) },
        ...(operation === 'getStatus' ? {} : { body: JSON.stringify(input) }),
        signal: controller.signal, redirect: 'error',
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        throw new PromotionClientError('promotion_service_timeout');
      }
      if (response.status === 400 && operation !== 'getStatus') {
        await response.body?.cancel();
        throw new PromotionClientError('promotion_request_invalid');
      }
      if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
          Number(response.headers.get('content-length')) > maxResponseBytes || !response.body) {
        await response.body?.cancel();
        throw new PromotionClientError();
      }
      reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxResponseBytes) throw new PromotionClientError();
        chunks.push(Buffer.from(value));
      }
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!validResponse(result, operation, input)) throw new PromotionClientError();
      return result;
    };
    try {
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new PromotionClientError('promotion_service_timeout'));
        }, timeoutMs);
        timer.unref();
      })]);
    } catch (error) {
      if (error instanceof PromotionClientError) throw error;
      if (controller.signal.aborted) throw new PromotionClientError('promotion_service_timeout');
      throw new PromotionClientError();
    } finally {
      clearTimeout(timer);
      controller.abort();
      // Cancellation is best-effort cleanup and cannot extend the deadline.
      void reader?.cancel().catch(() => {});
    }
  }
  return {
    getStatus() { return call('/v1/status', 'getStatus'); },
    getLatestDeals(input) { return call('/v1/deals/search', 'getLatestDeals', input); },
    searchPrices(input) { return call('/v1/prices/search', 'searchPrices', input); },
    estimateBasket(input) { return call('/v1/basket/estimate', 'estimateBasket', input); },
    searchPromotions(input) { return call('/v1/promotions/search', 'searchPromotions', input); },
    retrievePromotion(input) { return call('/v1/promotions/retrieve', 'retrievePromotion', input); },
    getComparisons({ locationId, offers } = {}) { return call('/v1/history/compare', 'getComparisons', { locationId, offers }); },
  };
}
