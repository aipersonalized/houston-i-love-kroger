// The public API has no qualified historical promotion operation. This module
// does not collect snapshots, read operator datasets or manufacture a baseline.
export function historyAvailability() {
  return {
    status: 'unavailable', reason: 'no_authorized_source',
    message: 'No authorized historical promotion source is configured. Current regular prices are not price history.',
  };
}
