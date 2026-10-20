export function currentCents(product) {
  const cents = product?.pricing?.currentCents;
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function filterProducts(products, { view = 'all', snap = 'all', declaration = '' } = {}) {
  return products.filter(product => {
    if (view === 'promotions' && product.pricing?.status !== 'promotion') return false;
    if (snap === 'yes' && product.source?.snapEligible !== true) return false;
    if (snap === 'no' && product.source?.snapEligible !== false) return false;
    if (snap === 'unknown' && typeof product.source?.snapEligible === 'boolean') return false;
    if (declaration && !productDeclarations(product).includes(declaration)) return false;
    return true;
  });
}

export function otherReportedSales(evidence, filters = {}) {
  // Ranking, price sorting and a sale-only view must not erase reported sale
  // facts. Apply the same source-label filters, preserving response order.
  return filterProducts(evidence?.records ?? [], { ...filters, view: 'all' })
    .filter(record => record.reportedPromotion && !record.includedInOffers);
}

const EVIDENCE_DISPOSITIONS = new Set(['missing_items', 'missing_description', 'not_in_store',
  'out_of_stock', 'missing_regular_price', 'unsupported_price', 'no_positive_promo',
  'not_discounted', 'unqualified_dates', 'duplicate', 'identity_conflict']);

const EVIDENCE_SOURCE_FIELDS = ['productId', 'itemId', 'description', 'brand', 'size', 'soldBy',
  'price', 'stockLevel', 'fulfillment', 'categories', 'snapEligible', 'manufacturerDeclarations',
  'organicClaimName', 'nonGmo', 'nonGmoClaimName'];

function evidenceSourceKey(source) {
  // Object property order is not source meaning. Array order, omitted fields
  // and explicit nulls remain distinct. Only the shared projection can match
  // an evidence row to the fuller offer source.
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(Object.fromEntries(EVIDENCE_SOURCE_FIELDS.map(key => [key, source[key]]))));
}

function evidenceCents(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const result = Math.round(value * 100);
  return Number.isSafeInteger(result) && Math.abs(result / 100 - value) <= 1e-8 ? result : null;
}

function evidenceDatesUnqualified(price, asOf) {
  for (const key of ['effectiveDate', 'expirationDate']) {
    if (!Object.hasOwn(price, key)) continue;
    const value = price[key]?.value;
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return true;
    const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    const instant = Date.parse(value);
    if (!Number.isFinite(calendar.valueOf()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10) ||
        !Number.isFinite(instant) || asOf !== null && (key === 'effectiveDate' ? instant > asOf : instant <= asOf)) return true;
  }
  return false;
}

export function validSourceEvidence(evidence, offers, retrievedAt) {
  if (!evidence || !Array.isArray(evidence.records) || evidence.records.length > 500 ||
      !evidence.summary || evidence.summary.records !== evidence.records.length ||
      !Array.isArray(offers) || offers.length > 500) return false;
  const nullableText = value => value === null || typeof value === 'string';
  const strings = value => Array.isArray(value) && value.every(entry => typeof entry === 'string');
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const asOf = retrievedAt === undefined ? null : Date.parse(retrievedAt);
  if (asOf !== null && !Number.isFinite(asOf)) return false;
  const groups = new Map();
  const productItems = new Map();
  if (!evidence.records.every((record, index) => {
    const source = record?.source;
    if (record?.recordIndex !== index || !Number.isInteger(record.productIndex) || record.productIndex < 0 ||
        record.productIndex >= 50 || !(record.itemIndex === null || Number.isInteger(record.itemIndex) && record.itemIndex >= 0 && record.itemIndex < 10) ||
        typeof record.savingsArithmeticAvailable !== 'boolean' || typeof record.includedInOffers !== 'boolean' || typeof record.reportedPromotion !== 'boolean' ||
        !Array.isArray(record.dispositions) || record.dispositions.some(value => !EVIDENCE_DISPOSITIONS.has(value)) ||
        new Set(record.dispositions).size !== record.dispositions.length ||
        !(record.duplicateOf === null || Number.isInteger(record.duplicateOf) && record.duplicateOf >= 0 && record.duplicateOf < index) ||
        !object(source) || !object(source.price)) return false;
    if (!['description', 'productId', 'itemId', 'brand', 'size', 'soldBy', 'stockLevel', 'organicClaimName', 'nonGmoClaimName']
      .every(key => nullableText(source[key])) || !strings(source.categories) || !strings(source.manufacturerDeclarations)) return false;
    if (!['snapEligible', 'nonGmo'].every(key => source[key] === null || typeof source[key] === 'boolean')) return false;
    if (!(source.fulfillment === null || object(source.fulfillment) && Object.entries(source.fulfillment).every(([key, value]) =>
      ['curbside', 'delivery', 'instore', 'shiptohome'].includes(key) && (value === null || typeof value === 'boolean')))) return false;
    for (const key of ['regular', 'promo', 'regularPerUnitEstimate', 'promoPerUnitEstimate']) {
      if (source.price[key] != null && !Number.isFinite(source.price[key])) return false;
    }
    for (const key of ['effectiveDate', 'expirationDate']) {
      const date = source.price[key];
      if (date != null && (typeof date !== 'object' || Array.isArray(date) ||
          (date.value !== undefined && !nullableText(date.value)) || (date.timezone !== undefined && !nullableText(date.timezone)))) return false;
    }
    const regular = evidenceCents(source.price.regular);
    const promo = evidenceCents(source.price.promo);
    const reported = typeof source.price.promo === 'number' && source.price.promo > 0;
    if (record.reportedPromotion !== reported ||
        record.savingsArithmeticAvailable !== (regular !== null && promo !== null && promo < regular)) return false;
    const has = code => record.dispositions.includes(code);
    for (const [code, applies] of [['missing_items', record.itemIndex === null],
      ['missing_description', !source.description], ['not_in_store', source.fulfillment?.instore === false],
      ['out_of_stock', source.stockLevel === 'TEMPORARILY_OUT_OF_STOCK'],
      ['missing_regular_price', source.price.regular == null], ['no_positive_promo', !reported],
      ['unsupported_price', source.price.regular != null && regular === null || reported && promo === null],
      ['not_discounted', reported && regular !== null && promo !== null && promo >= regular]]) {
      if (has(code) !== applies) return false;
    }
    if (asOf !== null || !Object.hasOwn(source.price, 'effectiveDate') && !Object.hasOwn(source.price, 'expirationDate') ||
        evidenceDatesUnqualified(source.price, null)) {
      if (has('unqualified_dates') !== evidenceDatesUnqualified(source.price, asOf)) return false;
    }
    if (record.includedInOffers && (!reported || !record.savingsArithmeticAvailable || record.dispositions.length)) return false;
    const previous = evidence.records[index - 1];
    if (record.productIndex !== (previous?.productIndex ?? 0) && record.productIndex !== previous?.productIndex + 1) return false;
    const itemPositions = productItems.get(record.productIndex) ?? [];
    if (itemPositions.includes(null) || record.itemIndex === null && itemPositions.length ||
        record.itemIndex !== null && record.itemIndex !== itemPositions.length) return false;
    itemPositions.push(record.itemIndex);
    productItems.set(record.productIndex, itemPositions);
    if (record.itemIndex === null && (source.itemId !== null || source.size !== null || source.soldBy !== null ||
        source.stockLevel !== null || source.fulfillment !== null || Object.keys(source.price).length || record.duplicateOf !== null)) return false;
    if (has('duplicate') !== (record.duplicateOf !== null)) return false;
    const knownIdentity = Boolean(source.productId && source.itemId && record.itemIndex !== null);
    if ((has('duplicate') || has('identity_conflict')) && !knownIdentity) return false;
    if (record.duplicateOf !== null) {
      const earlier = evidence.records[record.duplicateOf];
      if (earlier.itemIndex === null || earlier.duplicateOf !== null || source.productId !== earlier.source.productId ||
          source.itemId !== earlier.source.itemId || evidenceSourceKey(source) !== evidenceSourceKey(earlier.source)) return false;
    }
    if (knownIdentity) {
      const key = JSON.stringify([source.productId, source.itemId]);
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }
    return true;
  })) return false;
  for (const group of groups.values()) {
    const conflicts = group.filter(record => record.dispositions.includes('identity_conflict')).length;
    const variants = new Set(group.map(record => evidenceSourceKey(record.source))).size;
    // Full source metadata is larger than the shared projection, so two equal
    // projections may legitimately be flagged as differing full observations.
    if (conflicts && (group.length < 2 || conflicts !== group.length) || variants > 1 && conflicts !== group.length) return false;
    if (!conflicts && group.slice(1).some(record => record.duplicateOf === null)) return false;
  }
  const membership = new Map();
  for (const offer of offers) {
    if (!object(offer?.source) || offer.pricing?.status !== 'promotion') return false;
    const key = evidenceSourceKey(offer.source);
    membership.set(key, (membership.get(key) ?? 0) + 1);
  }
  for (const record of evidence.records) if (record.includedInOffers) {
    const key = evidenceSourceKey(record.source);
    const remaining = membership.get(key) ?? 0;
    if (!remaining) return false;
    membership.set(key, remaining - 1);
  }
  if ([...membership.values()].some(remaining => remaining !== 0)) return false;
  const { records, summary } = evidence;
  return summary.returnedProducts >= 0 && summary.returnedProducts <= 50 && Number.isInteger(summary.returnedProducts) &&
    productItems.size === summary.returnedProducts &&
    summary.returnedItems === records.filter(record => record.itemIndex !== null).length &&
    summary.missingItemLists === records.filter(record => record.itemIndex === null).length &&
    summary.reportedPromotions === records.filter(record => record.reportedPromotion).length &&
    summary.withoutSavingsArithmetic === records.filter(record => record.reportedPromotion && !record.savingsArithmeticAvailable).length &&
    summary.otherReportedPromotions === records.filter(record => record.reportedPromotion && !record.includedInOffers).length;
}

export function productDeclarations(product) {
  const source = product.source || {};
  const declarations = Array.isArray(source.manufacturerDeclarations) ? source.manufacturerDeclarations.filter(value => typeof value === 'string' && value) : [];
  return [...declarations,
    ...(source.organicClaimName ? [`Organic: ${source.organicClaimName}`] : []),
    ...(source.nonGmoClaimName ? [`Non-GMO: ${source.nonGmoClaimName}`] : []),
    ...(typeof source.nonGmo === 'boolean' ? [`Non-GMO: ${source.nonGmo ? 'yes' : 'no'}`] : [])];
}

export function declarationsFor(products) {
  return [...new Set(products.flatMap(productDeclarations))]
    .sort((a, b) => a.localeCompare(b));
}

export function validKrogerLink(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'www.kroger.com' && !url.username && !url.password &&
      !url.port && url.pathname.startsWith('/p/') ? url.href : null;
  } catch { return null; }
}

export function productImage(product) {
  const images = product?.source?.images;
  if (!Array.isArray(images)) return null;
  const ranked = [...images].sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)));
  for (const image of ranked) {
    if (!Array.isArray(image.sizes)) continue;
    const rank = size => ({ large: 0, medium: 1, small: 2, thumbnail: 3 }[size] ?? 99);
    const sizes = [...image.sizes].sort((a, b) => rank(a.size) - rank(b.size));
    for (const size of sizes) {
      try {
        if (typeof size.url !== 'string' || /[\p{Cc}\p{Cf}\\]/u.test(size.url)) continue;
        const url = new URL(size.url);
        if (url.protocol === 'https:' && url.hostname === 'www.kroger.com' && !url.username && !url.password && !url.port) return size.url;
      } catch { /* Missing or unsupported images use the text fallback. */ }
    }
  }
  return null;
}

export function exclusionText(summary = {}) {
  const reasons = [
    ['noReportedPromotion', 'had a regular price and no reported promotion'],
    ['missingRegularPrice', 'had no usable regular price'],
    ['unsupportedPrice', 'had an unsupported or unusable price'],
    ['notDiscounted', 'had no lower promotion price'],
    ['unqualifiedDates', 'had unqualified promotion dates'],
    ['outOfStock', 'were reported out of stock'],
    ['duplicateItems', 'were duplicate item observations'],
    ['conflictingItems', 'had conflicting item details'],
    ['incompleteProducts', 'lacked displayable product or item details'],
    ['notInStore', 'were explicitly unavailable in store'],
  ].filter(([key]) => Number.isInteger(summary[key]) && summary[key] > 0)
    .map(([key, label]) => `${summary[key]} ${label}`);
  return `${Number.isInteger(summary.products) ? `${summary.products} product records examined. ` : ''}${reasons.length ? `Result details: ${reasons.join('; ')}. Counts can overlap; regular-price products remain in the all-priced view.` : ''}`;
}

export function historicalPrice(value, currency) {
  if (!Number.isFinite(value) || value < 0) return 'Not supplied';
  if (typeof currency === 'string' && /^[A-Z]{3}$/u.test(currency)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  }
  return `${String(value)} (${typeof currency === 'string' && currency ? `reported currency: ${currency}` : 'currency not supplied'})`;
}

// Display supplied facts without interpreting dietary safety or inventing units.
export function reportedProductDetails(product) {
  const source = product?.source || {};
  const lines = [];
  const add = (label, value) => { if (typeof value === 'string' && value.trim()) lines.push(`${label}: ${value}`); };
  const measure = (value, unit) => Number.isFinite(value)
    ? `${String(value)}${unit ? ` ${unit}` : ' (unit not reported)'}` : null;
  const unit = value => value?.abbreviation || value?.name || value?.code;
  add('UPC', source.upc);
  if (source.categories?.length) add('Categories', source.categories.join('; '));
  add('Country of origin', source.countryOrigin);
  add('Temperature indicator', source.temperature?.indicator);
  if (typeof source.temperature?.heatSensitive === 'boolean') add('Heat sensitive', source.temperature.heatSensitive ? 'yes' : 'no');
  for (const [key, label] of Object.entries({ instore: 'In store', curbside: 'Curbside', delivery: 'Delivery', shiptohome: 'Ship to home' })) {
    if (typeof source.fulfillment?.[key] === 'boolean') add(`Fulfillment · ${label}`, source.fulfillment[key] ? 'reported available' : 'reported unavailable');
  }
  for (const allergen of source.allergens || []) {
    if (allergen.name) add('Allergen', `${allergen.name}${allergen.levelOfContainmentName ? ` · ${allergen.levelOfContainmentName}` : ' · containment level not reported'}`);
  }
  add('Allergen statement', source.allergensDescription);
  add('Warning', source.warnings);
  const reportedNutrition = source.nutritionInformation;
  const contexts = Array.isArray(reportedNutrition) ? reportedNutrition : reportedNutrition ? [reportedNutrition] : [];
  const preparationNames = contexts.map(nutrition => nutrition.preparationState?.name?.trim() || '');
  for (const [index, nutrition] of contexts.entries()) {
    const name = preparationNames[index];
    const uniqueName = name && preparationNames.filter(value => value === name).length === 1;
    const prefix = contexts.length > 1 ? uniqueName ? name : `Nutrition information ${index + 1} of ${contexts.length}` : '';
    const addNutrition = (label, value) => add(prefix ? `${prefix} · ${label}` : label, value);
    addNutrition('Ingredients', nutrition.ingredientStatement);
    addNutrition('Preparation state', nutrition.preparationState?.name || nutrition.preparationState?.code);
    addNutrition('Servings per package', nutrition.servingsPerPackage?.description ||
      (Number.isFinite(nutrition.servingsPerPackage?.value) ? String(nutrition.servingsPerPackage.value) : null));
    addNutrition('Serving size', nutrition.servingSize?.description || measure(nutrition.servingSize?.quantity, unit(nutrition.servingSize?.unitOfMeasure)));
    for (const nutrient of nutrition.nutrients || []) {
      const name = nutrient.displayName || nutrient.description || nutrient.code;
      if (!name) continue;
      const amount = measure(nutrient.quantity, unit(nutrient.unitOfMeasure));
      const percent = Number.isFinite(nutrient.percentDailyIntake) ? `${String(nutrient.percentDailyIntake)}% reported daily intake` : null;
      if (amount || percent) addNutrition(`Nutrient · ${name}`, [amount, percent].filter(Boolean).join(' · '));
    }
    addNutrition('Daily intake reference', nutrition.dailyValueIntakeReference);
    addNutrition('Nutritional rating', nutrition.nutritionalRating);
  }
  return lines;
}
