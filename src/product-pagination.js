// Products1.3.0 leaves meta untyped. Preserve only observed numeric pagination
// facts; a request default or the number returned is not a reported total/start.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function extractProductPagination(meta) {
  const pagination = object(meta) && object(meta.pagination) ? meta.pagination : null;
  return Object.fromEntries(['start', 'limit', 'total'].map(key =>
    [key, pagination && integer(pagination[key]) ? pagination[key] : null]));
}

// This offers a bounded next request, never an automatic fetch or a statement
// that fuzzy ordering is stable, every match was visited, or promotions are complete.
// A response start of0 is an observed fact; explicit requests still require1..250.
export function productPageContinuation(pagination, returnedCount) {
  const result = (status, nextStart = null) => ({ status, nextStart });
  if (!object(pagination) || !integer(returnedCount) || returnedCount > 50) return result('unknown');
  const { start, limit = null, total = null } = pagination;
  if (!integer(start) || limit !== null && (!integer(limit) || limit < 1 || limit > 50 || returnedCount > limit) ||
      total !== null && !integer(total)) return result('unknown');
  const next = start + returnedCount;
  if (!Number.isSafeInteger(next) || returnedCount > 0 && total !== null && next > total) return result('unknown');
  if (total !== null && next >= total) return result('reported_end');
  // An unexplained empty page is not evidence of exhaustion or useful progress.
  if (returnedCount === 0) return result('unknown');
  if (next > 250) return result('source_limit');
  return result('available', next);
}
