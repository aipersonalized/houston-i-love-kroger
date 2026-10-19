import { createHash, randomUUID } from 'node:crypto';
import { HistoryError } from './history-store.js';

export const DEFAULT_COLLECTION_PLAN = Object.freeze({ version: 1, sourceId: 'kroger-public', enabled: false,
  intervalMinutes: 1440, maxRuns: 1, limit: 20, targets: [] });

function invalid() {
  throw new HistoryError('collection_plan_invalid', 'The collection plan is invalid. Use the documented bounded plan format.');
}
export function validateCollectionPlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['version', 'sourceId', 'enabled', 'intervalMinutes', 'maxRuns', 'limit', 'targets'].includes(key))) invalid();
  const p = { ...DEFAULT_COLLECTION_PLAN, ...input };
  if (p.version !== 1 || typeof p.sourceId !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/u.test(p.sourceId) ||
      typeof p.enabled !== 'boolean' || !Number.isInteger(p.intervalMinutes) || p.intervalMinutes < 60 || p.intervalMinutes > 10080 ||
      !Number.isInteger(p.maxRuns) || p.maxRuns < 1 || p.maxRuns > 100 ||
      !Number.isInteger(p.limit) || p.limit < 1 || p.limit > 50 || !Array.isArray(p.targets) || p.targets.length > 10) invalid();
  const seen = new Set();
  p.targets = p.targets.map(target => {
    if (!target || typeof target !== 'object' || Array.isArray(target) ||
        Object.keys(target).some(key => !['locationId', 'term', 'fulfillment'].includes(key)) ||
        typeof target.locationId !== 'string' || !/^[a-zA-Z0-9]{8}$/u.test(target.locationId) ||
        typeof target.term !== 'string' || target.term.trim() !== target.term ||
        target.term.length < 3 || target.term.length > 80 || target.term.split(/\s+/u).length > 8 ||
        /[\p{Cc}\p{Cf}]/u.test(target.term) || (target.fulfillment ?? 'IN_STORE') !== 'IN_STORE') invalid();
    const key = JSON.stringify([target.locationId, target.term]);
    if (seen.has(key)) invalid();
    seen.add(key);
    return { locationId: target.locationId, term: target.term, fulfillment: 'IN_STORE' };
  });
  return p;
}

function timeValue(now) {
  const value = now();
  const iso = typeof value === 'number' ? new Date(value).toISOString() : value;
  if (typeof iso !== 'string' || !Number.isFinite(Date.parse(iso))) invalid();
  return new Date(iso).toISOString();
}
function jobKey(plan, target, startedAt) {
  const interval = plan.intervalMinutes * 60_000;
  const bucket = Math.floor(Date.parse(startedAt) / interval);
  return createHash('sha256').update(JSON.stringify([plan.sourceId, target.locationId, target.term,
    target.fulfillment, plan.limit, bucket])).digest('hex');
}

// Operator-selected topics are separate from shopper requests. This adapter keeps
// only the item/price facts needed for history, never a raw API response or query.
function observationsFromProducts(products, target, limit) {
  if (!Array.isArray(products) || products.length > limit) throw new HistoryError('unsupported_response', 'The source returned an unsupported collection response.');
  const offers = [];
  const identities = new Map();
  for (const product of products) {
    if (!product || typeof product !== 'object' || Array.isArray(product) || typeof product.productId !== 'string' ||
        !Array.isArray(product.items) || product.items.length > 10) throw new HistoryError('unsupported_response', 'The source returned an unsupported collection response.');
    for (const item of product.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.itemId !== 'string') {
        throw new HistoryError('unsupported_response', 'The source returned an unsupported collection response.');
      }
      if ((item.fulfillment != null && (typeof item.fulfillment !== 'object' || Array.isArray(item.fulfillment))) ||
          (item.inventory != null && (typeof item.inventory !== 'object' || Array.isArray(item.inventory)))) {
        throw new HistoryError('unsupported_response', 'The source returned unsupported item availability.');
      }
      const offer = { productId: product.productId, itemId: item.itemId,
        description: product.description ?? null, brand: product.brand ?? null,
        size: item.size ?? null, soldBy: item.soldBy ?? null, price: item.price ?? {},
        // Retain explicit unavailability as a replacement fact. Dropping these
        // items would let an older collected promotion reappear as a deal.
        inStore: item.fulfillment?.instore ?? null, stockLevel: item.inventory?.stockLevel ?? null,
        // Kroger's public product schema does not state currency, a unit-price
        // measure, or the full eligibility/price basis. Keep those unreported.
        currency: null, unitBasis: null, eligibilityKey: null, priceBasis: null, modality: null };
      const key = JSON.stringify([offer.productId, offer.itemId]);
      const signature = JSON.stringify(offer);
      if (identities.has(key)) {
        if (identities.get(key) !== signature) throw new HistoryError('unsupported_response', 'The source returned conflicting item observations.');
        continue;
      }
      identities.set(key, signature);
      offers.push(offer);
    }
  }
  return offers;
}

const BLOCKERS = {
  permission_required: 'Reviewed source permission for historical collection, human display, and agent access is missing, expired, revoked, or outside scope.',
  configuration_required: 'Configure the source API credentials locally before collecting.',
  targets_required: 'Choose a finite list of exact stores and topics in the operator collection plan.',
  collection_disabled: 'Enable the operator collection plan only after source permission and configuration are ready.',
  plan_required: 'Create the operator collection plan from the documented example.',
  plan_invalid: 'Fix the collection plan using the documented fields and bounds.',
};

export async function runCollection({ store, client, plan = DEFAULT_COLLECTION_PLAN, planProvided = true,
  configured = client?.configured === true, now = () => new Date().toISOString(), runId = randomUUID(),
  dryRun = false, signal } = {}) {
  const startedAt = timeValue(now);
  let accepted;
  let planInvalid = false;
  try { accepted = validateCollectionPlan(plan); } catch { accepted = { ...DEFAULT_COLLECTION_PLAN, targets: [] }; planInvalid = true; }
  const access = store?.getSourcePermission(accepted.sourceId, startedAt, accepted.targets) ?? { status: 'permission_required' };
  const codes = [];
  if (access.status !== 'permitted') codes.push('permission_required');
  if (!configured || typeof client?.searchProducts !== 'function') codes.push('configuration_required');
  if (accepted.targets.length === 0) codes.push('targets_required');
  if (!accepted.enabled) codes.push('collection_disabled');
  if (!planProvided) codes.push('plan_required');
  if (planInvalid) codes.push('plan_invalid');
  const blockers = codes.map(code => ({ code, message: BLOCKERS[code] }));
  const coverage = { type: 'bounded_topic_sample', targetCount: accepted.targets.length, limitPerTarget: accepted.limit,
    pagesPerTarget: 1, completeCatalog: false };
  if (dryRun || blockers.length) return { status: dryRun ? 'dry_run' : 'blocked', blockers, requests: 0, observationsWritten: 0, coverage };
  if (signal?.aborted) return { status: 'cancelled', requests: 0, observationsWritten: 0, coverage };
  let requests = 0;
  let skippedJobs = 0;
  let runStarted = false;
  try {
    const pending = accepted.targets.map(target => ({ target, key: jobKey(accepted, target, startedAt) }))
      .filter(({ key }) => {
        if (store.hasCompletedJob(accepted.sourceId, key)) { skippedJobs++; return false; }
        return true;
      });
    if (!pending.length) return { status: 'already_collected', requests: 0, observationsWritten: 0, skippedJobs, coverage };
    store.startRun({ runId, sourceId: accepted.sourceId, startedAt, targetCount: pending.length, limit: accepted.limit,
      targets: pending.map(({ target }) => target) });
    runStarted = true;
    const jobs = [];
    for (const { target, key } of pending) {
      if (signal?.aborted) throw new HistoryError('cancelled', 'Collection was cancelled.');
      const currentAccess = store.getSourcePermission(accepted.sourceId, timeValue(now), [target]);
      if (currentAccess.status !== 'permitted') throw new HistoryError('source_permission_required', 'Source permission is no longer valid.');
      requests++;
      const products = await client.searchProducts(target.locationId, target.term, { signal, limit: accepted.limit });
      const observedAt = timeValue(now);
      jobs.push({ jobKey: key, locationId: target.locationId, term: target.term, observedAt, rightsId: currentAccess.rightsId,
        returnedProductCount: products.length, offers: observationsFromProducts(products, target, accepted.limit) });
    }
    // All network work finishes before one synchronous SQLite transaction. A
    // failed target never turns an incomplete run into apparently valid history.
    const finishedAt = timeValue(now);
    const written = store.completeRun({ runId, sourceId: accepted.sourceId, finishedAt, jobs });
    return { status: 'completed', requests, observationsWritten: written.observationCount, completedJobs: written.completedJobs,
      skippedJobs, observedAt: finishedAt, coverage };
  } catch (error) {
    const category = signal?.aborted || error.code === 'cancelled' ? 'cancelled' :
      error.code === 'source_permission_required' ? 'source_permission_required' :
        ['unsupported_response', 'history_input_invalid'].includes(error.code) ? 'unsupported_response' :
          error instanceof HistoryError || String(error.code).startsWith('SQLITE_') ? 'storage_failed' : 'upstream_failed';
    if (runStarted) {
      try { store.failRun({ runId, finishedAt: timeValue(now), category }); }
      catch { return { status: 'failed', category: 'storage_failed', requests, observationsWritten: 0, coverage,
        message: 'Collection failed and the run status could not be updated. No completed history was reported.' }; }
    }
    return { status: category === 'cancelled' ? 'cancelled' : 'failed', category, requests, observationsWritten: 0, coverage,
      message: 'Collection did not complete. No observations from this run were saved; check the fixed failure category before retrying.' };
  }
}
