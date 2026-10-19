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
  const nutrition = source.nutritionInformation;
  if (nutrition) {
    add('Ingredients', nutrition.ingredientStatement);
    add('Preparation state', nutrition.preparationState?.name || nutrition.preparationState?.code);
    add('Servings per package', nutrition.servingsPerPackage?.description ||
      (Number.isFinite(nutrition.servingsPerPackage?.value) ? String(nutrition.servingsPerPackage.value) : null));
    add('Serving size', nutrition.servingSize?.description || measure(nutrition.servingSize?.quantity, unit(nutrition.servingSize?.unitOfMeasure)));
    for (const nutrient of nutrition.nutrients || []) {
      const name = nutrient.displayName || nutrient.description || nutrient.code;
      if (!name) continue;
      const amount = measure(nutrient.quantity, unit(nutrient.unitOfMeasure));
      const percent = Number.isFinite(nutrient.percentDailyIntake) ? `${String(nutrient.percentDailyIntake)}% reported daily intake` : null;
      if (amount || percent) add(`Nutrient · ${name}`, [amount, percent].filter(Boolean).join(' · '));
    }
    add('Daily intake reference', nutrition.dailyValueIntakeReference);
    add('Nutritional rating', nutrition.nutritionalRating);
  }
  return lines;
}
