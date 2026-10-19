// Synthetic public-shaped examples. No real shopper, credential or price data.
export const STORE_ID = '01400001';
export const NOW = Date.parse('2026-10-19T18:00:00Z');

export function product({ productId = '0000000000001', itemId = productId,
  description = 'Example milk', regular = 4, promo = 3,
  price = {}, item = {}, ...rest } = {}) {
  return { productId, description, brand: 'Example brand', ...rest,
    items: [{ itemId, size: '1 gal', soldBy: 'unit',
      price: { regular, promo, ...price }, ...item }] };
}

export function store() {
  return { locationId: STORE_ID, name: 'Example store',
    address: { addressLine1: '1 Example Street', city: 'Example city', state: 'TX', zipCode: '77001' } };
}

export function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json', ...headers } });
}

export function tokenResponse(extra = {}) {
  return jsonResponse({ access_token: 'fixture-token', expires_in: 1800, token_type: 'bearer', ...extra });
}
