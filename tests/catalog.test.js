import test from 'node:test';
import assert from 'node:assert/strict';
import { imageUrl, productUrl, normalizeStore } from '../src/catalog.js';
import { compareOffers } from '../src/deals.js';
import { NOW, product, store } from './fixtures.js';

test('rich product metadata is preserved without changing source values or inferring labels', () => {
  const input = product({ upc: '0000000000001', productPageURI: '/p/example/0000000000001?cid=fixture',
    snapEligible: false, manufacturerDeclarations: ['Kosher'], categories: ['Dairy'],
    aisleLocations: [{ number: '01', side: 'L', description: 'Dairy Wall' }],
    images: [{ perspective: 'front', default: true, sizes: [{ size: 'large', url: 'https://www.kroger.com/product/images/large/front/0000000000001' }] }],
    temperature: { indicator: 'Refrigerated', heatSensitive: true },
    nutritionInformation: { ingredientStatement: 'Milk'.repeat(500), nutrients: [] } });
  const original = structuredClone(input);
  const result = compareOffers([input], { now: NOW }).products[0];
  assert.deepEqual(input, original);
  assert.deepEqual(result.source.images, input.images);
  assert.deepEqual(result.source.aisleLocations, input.aisleLocations);
  assert.equal(result.source.snapEligible, false);
  assert.equal(result.source.nonGmo, null);
  assert.deepEqual(result.source.manufacturerDeclarations, ['Kosher']);
  assert.deepEqual(result.source.nutritionInformation.nutrients, []);
  assert.equal(result.source.productUrl, `https://www.kroger.com${input.productPageURI}`);
});

test('image and product links cannot target arbitrary HTTPS hosts or protocols', () => {
  for (const url of ['http://www.kroger.com/image', 'https://www.kroger.com.attacker.example/image',
    'https://attacker.example/image', 'data:image/png;base64,fixture', 'https://user:pass@www.kroger.com/image',
    'https://www.kroger.com:8443/image', 'https://www.kroger.com\\@attacker.example/image']) assert.equal(imageUrl(url), null);
  for (const url of ['//attacker.example/p/example', 'https://www.kroger.com/p/example', '/not-product', '/p/evil\n']) assert.equal(productUrl(url), null);
  const input = product({ images: [{ sizes: [{ url: 'https://attacker.example/image' }] }], productPageURI: '//attacker.example/product' });
  const source = compareOffers([input], { now: NOW }).products[0].source;
  assert.deepEqual(source.images, [{ sizes: [] }]);
  assert.equal(source.productUrl, null);
});

test('store metadata retains its reported timezone, daily hours, departments and coordinates', () => {
  const input = { ...store(), chain: 'KROGER', phone: '5551234567', storeNumber: '00001', divisionNumber: '014',
    hours: { timezone: 'America/Chicago', gmtOffset: '(UTC-06:00)', Open24: false,
      monday: { open: '06:00', close: '23:00', open24: false } },
    departments: [{ departmentId: '01', name: 'Pharmacy', phone: '5551234568', hours: { monday: { open: '09:00', close: '17:00' } } }],
    geolocation: { latitude: 29.5, longitude: -95.5, latLng: '29.5,-95.5' } };
  assert.deepEqual(normalizeStore(input), input);
  assert.throws(() => normalizeStore({ ...input, departments: Array(101).fill({}) }), { code: 'upstream_format' });
  assert.throws(() => normalizeStore({ ...input, hours: { monday: { open24: 'yes' } } }), { code: 'upstream_format' });
});

test('source arrays and nested text remain bounded', () => {
  for (const input of [product({ categories: Array(51).fill('Dairy') }), product({ images: Array(21).fill({}) }),
    product({ manufacturerDeclarations: ['x'.repeat(201)] }), product({ snapEligible: 'yes' }),
    product({ nutritionInformation: { nutrients: Array(101).fill({}) } })]) assert.throws(() => compareOffers([input]), { code: 'upstream_format' });
});
