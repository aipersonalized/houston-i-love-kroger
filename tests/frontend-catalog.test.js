import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts, declarationsFor, validKrogerLink, productImage, exclusionText, historicalPrice, reportedProductDetails } from '../public/catalog.js';
import { orderProducts } from '../public/ordering.js';

const products = [
  { source: { description: 'Synthetic regular product', snapEligible: null, manufacturerDeclarations: [] }, pricing: { status: 'regular_only', currentCents: 150 } },
  { source: { description: 'Synthetic promotion', snapEligible: true, manufacturerDeclarations: ['Organic'] }, pricing: { status: 'promotion', currentCents: 200 }, calculated: { savingsCents: 100, percentOff: 33.3 } },
  { source: { description: 'Synthetic other product', snapEligible: false, manufacturerDeclarations: ['Gluten free', 'Organic'] }, pricing: { status: 'regular_only', currentCents: 300 } },
];

test('all-priced and promotions views preserve regular-priced products and apply local source filters', () => {
  assert.equal(filterProducts(products).length, 3);
  assert.deepEqual(filterProducts(products, { view: 'promotions' }), [products[1]]);
  assert.deepEqual(filterProducts(products, { snap: 'unknown' }), [products[0]]);
  assert.deepEqual(filterProducts(products, { snap: 'no' }), [products[2]]);
  assert.deepEqual(filterProducts(products, { declaration: 'Organic', snap: 'yes' }), [products[1]]);
  assert.deepEqual(declarationsFor(products), ['Gluten free', 'Organic']);
});

test('price ordering includes regular prices and savings ordering does not invent regular-product savings', () => {
  assert.deepEqual(orderProducts(products, 'price'), products);
  assert.deepEqual(orderProducts(products, 'savings'), [products[1], products[0], products[2]]);
  assert.equal(products[0].calculated, undefined);
});

test('only a returned HTTPS Kroger product destination is accepted', () => {
  assert.equal(validKrogerLink('https://www.kroger.com/p/synthetic-product/0000000000001'), 'https://www.kroger.com/p/synthetic-product/0000000000001');
  for (const value of ['javascript:alert(1)', 'https://www.kroger.com.evil.example/p/a', 'https://user:secret@www.kroger.com/p/a', 'http://www.kroger.com/p/a', 'https://www.kroger.com/cart', 'https://www.kroger.com:444/p/a']) assert.equal(validKrogerLink(value), null);
});

test('product images use a reported Kroger original and unavailable images stay absent', () => {
  const product = { source: { images: [{ default: true, sizes: [
    { size: 'small', url: 'https://www.kroger.com/product/images/small/a.jpg' },
    { size: 'large', url: 'https://www.kroger.com/product/images/large/a.jpg' },
  ] }] } };
  assert.equal(productImage(product), 'https://www.kroger.com/product/images/large/a.jpg');
  assert.equal(productImage({ source: { images: [{ sizes: [{ url: 'https://unreviewed.example/image.png' }] }] } }), null);
  assert.equal(productImage({ source: {} }), null);
  assert.equal(productImage({ source: { images: [{ sizes: [{ url: 'https://images.kroger.com/undocumented.jpg' }] }] } }), null);
});

test('optional reported details preserve units, zero and explicit false without inventing dietary safety', () => {
  assert.deepEqual(reportedProductDetails({ source: { nutritionInformation: { nutrients: [] } } }), []);
  const lines = reportedProductDetails({ source: { categories: ['Synthetic dairy'],
    fulfillment: { delivery: false }, allergens: [{ name: 'Milk', levelOfContainmentName: 'Contains' }],
    nutritionInformation: { ingredientStatement: '<synthetic ingredients>',
      nutrients: [{ displayName: 'Sodium', quantity: 0 }, { displayName: 'Unknown nutrient' }] } } });
  assert.ok(lines.includes('Nutrient · Sodium: 0 (unit not reported)'));
  assert.ok(lines.includes('Fulfillment · Delivery: reported unavailable'));
  assert.ok(lines.includes('Ingredients: <synthetic ingredients>'));
  assert.ok(lines.includes('Allergen: Milk · Contains'));
  assert.ok(!lines.some(line => /safe|Unknown nutrient/u.test(line)));
});

test('qualification wording distinguishes regular prices, conflicting details and incomplete products', () => {
  const text = exclusionText({ products: 45, noReportedPromotion: 35, conflictingItems: 1, incompleteProducts: 2 });
  assert.match(text, /35 had a regular price and no reported promotion/u);
  assert.match(text, /conflicting item details/u);
  assert.match(text, /lacked displayable product or item details/u);
  assert.doesNotMatch(text, /missing usable prices|conflicting prices/u);
});

test('reported dietary flags stay separate from unknown data and historical currency is never assumed', () => {
  const unknown = { source: {} };
  const no = { source: { nonGmo: false } };
  const yes = { source: { nonGmo: true, organicClaimName: 'Reported organic claim' } };
  assert.deepEqual(filterProducts([unknown, no, yes], { declaration: 'Non-GMO: no' }), [no]);
  assert.deepEqual(filterProducts([unknown, no, yes], { declaration: 'Organic: Reported organic claim' }), [yes]);
  assert.equal(historicalPrice(2.5, null), '2.5 (currency not supplied)');
  assert.equal(historicalPrice(2.5, 'USD'), '$2.50');
  assert.equal(historicalPrice(0, null), '0 (currency not supplied)');
  assert.equal(historicalPrice(null, 'USD'), 'Not supplied');
});
