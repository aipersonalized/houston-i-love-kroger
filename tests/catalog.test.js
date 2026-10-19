import test from 'node:test';
import assert from 'node:assert/strict';
import { imageUrl, productUrl, normalizeStore, productDetails } from '../src/catalog.js';
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

function nutritionContext(name = 'Unprepared') {
  return {
    ingredientStatement: '', dailyValueIntakeReference: '', nutritionalRating: '0',
    preparationState: { code: 'UNPREPARED', name },
    servingsPerPackage: { description: '', value: 0 },
    servingSize: { description: '', quantity: 0, unitOfMeasure: { abbreviation: '', code: '', name: '' } },
    nutrients: [{ code: 'NA', description: '', displayName: 'Sodium', percentDailyIntake: 0, quantity: 0,
      precision: { code: '', name: '' }, unitOfMeasure: { abbreviation: 'mg', code: 'MGM', name: 'Milligram' } }],
  };
}

test('nutrition preserves object and array shapes, all contexts, zero quantities and empty supplied fields', () => {
  const context = nutritionContext();
  const second = { ...nutritionContext('Prepared'), ingredientStatement: 'Synthetic ingredients',
    servingSize: { description: '1 synthetic cup', quantity: 240, unitOfMeasure: { abbreviation: 'ml', code: 'MLT', name: 'Millilitre' } } };
  for (const information of [context, [context], [context, second]]) {
    const input = product({ nutritionInformation: information });
    const original = structuredClone(input);
    const normalized = compareOffers([input], { now: NOW }).products[0].source.nutritionInformation;
    assert.deepEqual(normalized, information);
    assert.equal(Array.isArray(normalized), Array.isArray(information));
    assert.deepEqual(input, original, 'Normalization must not mutate source metadata.');
  }
});

test('absent/null nutrition remains unknown and an explicit empty context array stays empty', () => {
  assert.equal(productDetails({}).nutritionInformation, null);
  assert.equal(productDetails({ nutritionInformation: null }).nutritionInformation, null);
  assert.deepEqual(productDetails({ nutritionInformation: [] }).nutritionInformation, []);
});

test('a full bounded search accepts mixed null and array nutrition without losing products or contexts', () => {
  const inputs = Array.from({ length: 50 }, (_, index) => product({
    productId: String(index + 1).padStart(13, '0'),
    nutritionInformation: index < 36 ? null : [nutritionContext(), nutritionContext('Prepared')],
  }));
  const result = compareOffers(inputs, { now: NOW });
  assert.equal(result.summary.products, 50);
  assert.equal(result.products.length, 50);
  assert.equal(result.products.filter(value => value.source.nutritionInformation === null).length, 36);
  const withNutrition = result.products.filter(value => Array.isArray(value.source.nutritionInformation));
  assert.equal(withNutrition.length, 14);
  assert.ok(withNutrition.every(value => value.source.nutritionInformation.length === 2));
});

test('nutrition context count is capped at 20 and malformed entries cannot be skipped', () => {
  assert.equal(productDetails({ nutritionInformation: Array.from({ length: 20 }, () => nutritionContext()) }).nutritionInformation.length, 20);
  for (const information of [Array(21).fill({}), true, false, 0, '', 'unsupported', [null], [false], ['unsupported'], [[]], [[{}]],
    [nutritionContext(), null], [nutritionContext(), { nutrients: [null] }]]) {
    assert.throws(() => productDetails({ nutritionInformation: information }), { code: 'upstream_format' });
  }
});

test('every nutrition array entry receives the existing object field and nested bounds validation', () => {
  const invalidContexts = [
    { ingredientStatement: 'x'.repeat(8001) },
    { nutrients: Array(101).fill({}) },
    { nutrients: [{ quantity: '0' }] },
    { nutrients: [{ unitOfMeasure: [] }] },
    { nutrients: [{ percentDailyIntake: Number.NaN }] },
    { preparationState: { name: 'x'.repeat(513) } },
    { servingsPerPackage: { value: Number.POSITIVE_INFINITY } },
    { servingSize: { quantity: '0' } },
    { servingSize: { unitOfMeasure: [[]] } },
  ];
  for (const context of invalidContexts) {
    for (const information of [context, [context], [nutritionContext(), context]]) {
      assert.throws(() => productDetails({ nutritionInformation: information }), { code: 'upstream_format' });
    }
  }
});
