import test from 'node:test';
import assert from 'node:assert/strict';
import { historyAvailability } from '../src/history.js';

test('absence of authorized history is explicit and cannot be mistaken for regular-price history', () => {
  const status = historyAvailability();
  assert.deepEqual(status, { status: 'unavailable', reason: 'no_authorized_source',
    message: 'No authorized historical promotion source is configured. Current regular prices are not price history.' });
  status.status = 'modified';
  assert.equal(historyAvailability().status, 'unavailable');
});
