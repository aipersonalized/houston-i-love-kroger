// A shopping list is visit-only state. This module performs no storage or I/O.
export const MAX_QUANTITY = 99;
export const MAX_LINES = 100;

export function productKey(product) {
  const source = product?.source;
  if (!source) return null;
  if (source.productId && source.itemId) return JSON.stringify([source.productId, source.itemId]);
  if (source.upc) return JSON.stringify(['upc', source.upc]);
  return null;
}

export function addBasketItem(entries, product, locationId, retrievedAt) {
  const key = productKey(product);
  if (!key || !locationId) throw new Error('missing_identity');
  if (entries.some(entry => entry.locationId !== locationId)) throw new Error('different_store');
  const found = entries.find(entry => entry.key === key);
  if (found?.quantity >= MAX_QUANTITY) throw new Error('quantity_limit');
  if (!found && entries.length >= MAX_LINES) throw new Error('line_limit');
  const next = { key, product, locationId, retrievedAt, quantity: (found?.quantity || 0) + 1 };
  return found ? entries.map(entry => entry.key === key ? next : entry) : [...entries, next];
}

export function setBasketQuantity(entries, key, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) throw new Error('invalid_quantity');
  return entries.map(entry => entry.key === key ? { ...entry, quantity } : entry);
}

export function reportedAisles(product) {
  const locations = product?.source?.aisleLocations;
  if (!Array.isArray(locations)) return [];
  return [...new Set(locations.map(location => {
    if (typeof location === 'string') return location.trim();
    if (!location || typeof location !== 'object') return '';
    const number = location.number;
    const description = location.description;
    return [typeof description === 'string' ? description.trim() : '',
      typeof number === 'string' && number.trim() ? `Aisle ${number.trim()}` : ''].filter(Boolean).join(' · ');
  }).filter(Boolean))];
}

export function estimateBasket(entries, locationId) {
  let knownSubtotalCents = 0;
  const lines = entries.map(entry => {
    const cents = entry.product?.pricing?.currentCents;
    const soldBy = entry.product?.source?.soldBy;
    let reason = null;
    if (entry.locationId !== locationId) reason = 'different_store';
    else if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > MAX_QUANTITY) reason = 'invalid_quantity';
    else if (typeof soldBy !== 'string' || soldBy.toLowerCase() !== 'unit') reason = soldBy ? 'variable_measure' : 'unknown_measure';
    else if (!Number.isSafeInteger(cents) || cents <= 0) reason = 'unknown_price';
    const estimateCents = reason ? null : cents * entry.quantity;
    if (estimateCents !== null) knownSubtotalCents += estimateCents;
    return { ...entry, estimateCents, reason, aisles: reportedAisles(entry.product) };
  });
  const unresolvedCount = lines.filter(line => line.reason).length;
  return { lines, knownSubtotalCents, unresolvedCount, complete: unresolvedCount === 0 };
}

export function groupBasketByAisle(lines) {
  const groups = new Map();
  for (const line of lines) {
    // Multiple reported positions stay visible on the line; grouping uses the
    // first supplied position, without inventing a route through the store.
    const aisle = line.aisles?.[0] || null;
    if (!groups.has(aisle)) groups.set(aisle, []);
    groups.get(aisle).push(line);
  }
  return [...groups].sort(([a], [b]) => a === null ? 1 : b === null ? -1 :
    a.localeCompare(b, 'en', { numeric: true })).map(([aisle, entries]) => ({ aisle, entries }));
}

export function cartItems(entries, locationId) {
  const lines = estimateBasket(entries, locationId).lines;
  const byUpc = new Map();
  let excludedCount = 0;
  for (const line of lines) {
    const upc = line.product.source.upc;
    if (line.reason || !/^\d{13}$/u.test(upc || '')) { excludedCount++; continue; }
    const combined = byUpc.get(upc) || { upc, quantity: 0, lineCount: 0 };
    combined.quantity += line.quantity;
    combined.lineCount++;
    byUpc.set(upc, combined);
  }
  const items = [];
  for (const combined of byUpc.values()) {
    if (combined.quantity > MAX_QUANTITY) excludedCount += combined.lineCount;
    else items.push({ upc: combined.upc, quantity: combined.quantity });
  }
  return { items, excludedCount };
}
