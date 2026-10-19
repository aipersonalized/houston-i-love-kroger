import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { openHistoryStore } from '../src/history-store.js';

export const SOURCE = 'fixture-source';
export const FIRST = '2026-01-02T12:00:00.000Z';
export const SECOND = '2026-01-03T12:00:00.000Z';
export const AS_OF = '2026-01-04T12:00:00.000Z';
export const TOKEN = 'synthetic-service-token-for-local-tests-only';
export function policy(extra = {}) {
  return { sourceId: SOURCE, sourceLabel: 'Synthetic source', status: 'verified',
    evidenceReference: 'synthetic-permission', reviewReference: 'synthetic-review',
    verifiedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z', retentionDays: 30,
    allowedPurposes: ['historical-price-collection', 'historical-price-display', 'historical-agent-access'],
    allowedLocationIds: ['TEST0001', 'TEST0002'], allowedTopics: ['milk', 'bread'], ...extra };
}
export function offer(extra = {}) {
  return { productId: 'synthetic-product', itemId: 'synthetic-item', description: 'Synthetic whole milk', brand: 'Example dairy',
    size: '12 oz', soldBy: 'unit', currency: 'USD', priceBasis: 'one-package', modality: 'IN_STORE',
    eligibilityKey: 'all-shoppers', unitBasis: 'oz',
    price: { regular: 5, promo: 3, regularPerUnitEstimate: 0.41666667, promoPerUnitEstimate: 0.25 }, ...extra };
}
export function setup(t, { approved = true } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'kroger-promotion-test-'));
  const filename = join(folder, 'history.sqlite');
  const store = openHistoryStore({ filename });
  const stores = [store];
  t.after(() => {
    for (const opened of stores) opened.close();
    assert.ok(resolve(folder).startsWith(resolve(tmpdir()) + sep));
    rmSync(folder, { recursive: true, force: true });
  });
  if (approved) store.recordSourcePolicy(policy(), { now: FIRST });
  return { folder, filename, store, reopen() { const opened = openHistoryStore({ filename }); stores.push(opened); return opened; } };
}
export function save(store, { id = 'first', observedAt = FIRST, offers = [offer()], locationId = 'TEST0001', term = 'milk' } = {}) {
  store.startRun({ runId: id, sourceId: SOURCE, startedAt: observedAt, targetCount: 1, limit: 50 });
  return store.completeRun({ runId: id, sourceId: SOURCE, finishedAt: observedAt,
    jobs: [{ jobKey: id, locationId, term, observedAt, returnedProductCount: offers.length, offers }] });
}
export function search(store, input = {}) {
  return store.searchPromotions({ locationId: 'TEST0001', sourceId: SOURCE, asOf: AS_OF, ...input });
}
export function retrieve(store, id, input = {}) {
  return store.retrievePromotion({ locationId: 'TEST0001', observationId: id, sourceId: SOURCE, asOf: AS_OF, ...input });
}
