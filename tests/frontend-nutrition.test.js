import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as basket from '../public/basket.js';
import * as catalog from '../public/catalog.js';
import * as ordering from '../public/ordering.js';
import { compareOffers } from '../src/deals.js';
import { product, NOW } from './fixtures.js';

function context(name, quantity = 0) {
  return { ingredientStatement: '<synthetic ingredients>', preparationState: { name },
    servingsPerPackage: { description: '', value: 0 },
    servingSize: { description: `${quantity} synthetic servings`, quantity },
    nutrients: [{ displayName: 'Sodium', quantity, percentDailyIntake: 0, unitOfMeasure: { abbreviation: 'mg' } }],
  };
}

test('one nutrition context keeps existing human labels and empty arrays add no diagnostics', () => {
  const nutrition = context('Unprepared');
  const objectLines = catalog.reportedProductDetails({ source: { nutritionInformation: nutrition } });
  const arrayLines = catalog.reportedProductDetails({ source: { nutritionInformation: [nutrition] } });
  assert.deepEqual(arrayLines, objectLines);
  assert.ok(arrayLines.includes('Servings per package: 0'));
  assert.ok(arrayLines.includes('Serving size: 0 synthetic servings'));
  assert.ok(arrayLines.includes('Nutrient · Sodium: 0 mg · 0% reported daily intake'));
  assert.ok(arrayLines.includes('Ingredients: <synthetic ingredients>'));
  assert.ok(!arrayLines.some(line => line.includes('Nutrition information')));
  for (const information of [null, [], { nutrients: [] }, [{ nutrients: [] }]]) {
    assert.deepEqual(catalog.reportedProductDetails({ source: { nutritionInformation: information } }), []);
  }
});

test('every multi-context nutrition fact retains its own preparation and serving-size clues', () => {
  const lines = catalog.reportedProductDetails({ source: { nutritionInformation: [context('Unprepared'), context('Prepared', 12)] } });
  assert.ok(lines.includes('Unprepared · Preparation state: Unprepared'));
  assert.ok(lines.includes('Prepared · Preparation state: Prepared'));
  assert.ok(lines.includes('Unprepared · Serving size: 0 synthetic servings'));
  assert.ok(lines.includes('Prepared · Serving size: 12 synthetic servings'));
  assert.ok(lines.includes('Unprepared · Nutrient · Sodium: 0 mg · 0% reported daily intake'));
  assert.ok(lines.includes('Prepared · Nutrient · Sodium: 12 mg · 0% reported daily intake'));
  assert.ok(!lines.some(line => line.startsWith('Nutrient ·')));
  assert.ok(!lines.some(line => line.includes('Nutrition information')));
});

test('missing or repeated preparation names use numbered contexts instead of merging facts', () => {
  const information = [context('Prepared', 1), context('Prepared', 2), context('', 3), context('Unprepared', 4)];
  const lines = catalog.reportedProductDetails({ source: { nutritionInformation: information } });
  for (const number of [1, 2, 3]) {
    assert.ok(lines.includes(`Nutrition information ${number} of 4 · Serving size: ${number} synthetic servings`));
    assert.ok(lines.includes(`Nutrition information ${number} of 4 · Nutrient · Sodium: ${number} mg · 0% reported daily intake`));
  }
  assert.ok(lines.includes('Nutrition information 1 of 4 · Preparation state: Prepared'));
  assert.ok(lines.includes('Nutrition information 2 of 4 · Preparation state: Prepared'));
  assert.ok(lines.includes('Unprepared · Serving size: 4 synthetic servings'));
});

// Exercise the actual page renderer with a substituted DOM. No browser,
// startup/event wiring, network, private source data or account state is used.
class TextNode {
  constructor(tag = '') { this.tagName = tag; this.children = []; this.dataset = {}; this.ownText = ''; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  addEventListener() {}
}

function renderedProduct(information) {
  const normalized = compareOffers([product({ nutritionInformation: information })], { now: NOW }).products[0];
  const environment = vm.createContext({ ...basket, ...catalog, ...ordering, Intl, URL, normalized,
    document: { getElementById: () => new TextNode(), createElement: tag => new TextNode(tag) } });
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const wiring = source.indexOf("ui['store-form'].addEventListener");
  assert.ok(wiring > 0, 'The renderer harness must not execute page startup.');
  vm.runInContext(source.slice(0, wiring).replace(/^import .*$/gm, '') + '\nglobalThis.view = renderOffer(normalized, 0);',
    environment, { filename: 'public/app.js' });
  return environment.view.textContent;
}

test('actual product card renders object, one-array and every distinct multi-context fact', () => {
  const single = context('Unprepared');
  assert.equal(renderedProduct(single), renderedProduct([single]));
  const view = renderedProduct([single, context('Prepared', 12)]);
  for (const line of ['Unprepared · Serving size: 0 synthetic servings', 'Prepared · Serving size: 12 synthetic servings',
    'Unprepared · Nutrient · Sodium: 0 mg', 'Prepared · Nutrient · Sodium: 12 mg',
    'Unprepared · Ingredients: <synthetic ingredients>', 'Prepared · Ingredients: <synthetic ingredients>']) {
    assert.ok(view.includes(line), `The product card must render ${line}.`);
  }
  assert.doesNotMatch(view, /Nutrition information|undefined|\[object Object\]/u);
  assert.doesNotMatch(renderedProduct([]), /More about this product|Nutrition information/u);
});
