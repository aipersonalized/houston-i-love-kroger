import { AppError } from './errors.js';

// Products 1.3.0 documents this exact original-image origin. A different CDN
// needs a reviewed source observation before it can expand this allowlist/CSP.
export const IMAGE_HOSTS = Object.freeze(['www.kroger.com']);
export const PRODUCT_HOSTS = Object.freeze(['www.kroger.com', 'kroger.com']);

export function invalidCatalog() {
  return new AppError('upstream_format', 'Kroger returned an unsupported result. Try a more specific search or try again later.', 502);
}
export function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function sourceText(value, maximum = 200) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > maximum) throw invalidCatalog();
  return value;
}
function bool(value) {
  if (value == null) return null;
  if (typeof value !== 'boolean') throw invalidCatalog();
  return value;
}
function number(value) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidCatalog();
  return value;
}
function list(value, limit, map) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > limit) throw invalidCatalog();
  return value.map(map);
}
function strings(value, limit = 50, maximum = 200) {
  return list(value, limit, entry => { if (entry == null) throw invalidCatalog(); return sourceText(entry, maximum); });
}
function fields(value, text = [], booleans = [], numbers = []) {
  if (value == null) return null;
  if (!object(value)) throw invalidCatalog();
  const result = {};
  for (const name of text) if (Object.hasOwn(value, name)) result[name] = sourceText(value[name], 512);
  for (const name of booleans) if (Object.hasOwn(value, name)) result[name] = bool(value[name]);
  for (const name of numbers) if (Object.hasOwn(value, name)) result[name] = number(value[name]);
  return result;
}

// Exact allowlists, HTTPS, no credentials/ports and no relative external hosts.
// Return the original source URL; unsafe destinations are relevant omissions.
export function imageUrl(value) {
  sourceText(value, 2048);
  if (!value || /[\p{Cc}\p{Cf}\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && IMAGE_HOSTS.includes(url.hostname) && !url.username && !url.password && !url.port
      ? value : null;
  } catch { return null; }
}
export function productUrl(value) {
  sourceText(value, 2048);
  if (!value || /[\p{Cc}\p{Cf}\\]/u.test(value) || !value.startsWith('/p/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, 'https://www.kroger.com');
    return url.protocol === 'https:' && PRODUCT_HOSTS.includes(url.hostname) && url.pathname.startsWith('/p/') && !url.username && !url.password && !url.port
      ? url.href : null;
  } catch { return null; }
}

const MAX_NUTRITION_CONTEXTS = 20;

function nutritionContext(value) {
  if (!object(value)) throw invalidCatalog();
  const result = fields(value, ['dailyValueIntakeReference', 'nutritionalRating']);
  if (value.ingredientStatement != null) result.ingredientStatement = sourceText(value.ingredientStatement, 8000);
  result.preparationState = fields(value.preparationState, ['code', 'name']);
  result.servingsPerPackage = fields(value.servingsPerPackage, ['description'], [], ['value']);
  result.servingSize = fields(value.servingSize, ['description'], [], ['quantity']);
  if (result.servingSize) result.servingSize.unitOfMeasure = fields(value.servingSize.unitOfMeasure, ['abbreviation', 'code', 'name']);
  result.nutrients = list(value.nutrients, 100, entry => {
    const nutrient = fields(entry, ['code', 'description', 'displayName'], [], ['percentDailyIntake', 'quantity']);
    if (!nutrient) throw invalidCatalog();
    nutrient.precision = fields(entry.precision, ['code', 'name']);
    nutrient.unitOfMeasure = fields(entry.unitOfMeasure, ['abbreviation', 'code', 'name']);
    return nutrient;
  });
  return result;
}

function nutrition(value) {
  if (value == null) return null;
  // The mirrored Products 1.3.0 schema defines an object; qualified API
  // responses also supply an array of preparation contexts. Preserve both
  // shapes and apply the same field validation to every context.
  return Array.isArray(value) ? list(value, MAX_NUTRITION_CONTEXTS, nutritionContext) : nutritionContext(value);
}

export function productDetails(product) {
  if (!object(product)) throw invalidCatalog();
  return {
    upc: sourceText(product.upc, 64), productPageURI: sourceText(product.productPageURI, 2048),
    productUrl: productUrl(product.productPageURI),
    categories: strings(product.categories), aliasProductIds: strings(product.aliasProductIds, 50, 64),
    aisleLocations: list(product.aisleLocations, 30, value => {
      const result = fields(value, ['bayNumber', 'description', 'number', 'numberOfFacings', 'sequenceNumber', 'side', 'shelfNumber', 'shelfPositionInBay']);
      if (!result) throw invalidCatalog();
      return result;
    }),
    images: list(product.images, 20, value => {
      const result = fields(value, ['id', 'perspective'], ['default']);
      if (!result) throw invalidCatalog();
      result.sizes = list(value.sizes, 10, size => {
        const item = fields(size, ['id', 'size']);
        if (!item) throw invalidCatalog();
        const url = imageUrl(size.url);
        return url ? { ...item, url } : null;
      }).filter(Boolean);
      return result;
    }),
    temperature: fields(product.temperature, ['indicator'], ['heatSensitive']),
    snapEligible: bool(product.snapEligible), countryOrigin: sourceText(product.countryOrigin),
    manufacturerDeclarations: strings(product.manufacturerDeclarations),
    allergens: list(product.allergens, 50, value => {
      const result = fields(value, ['levelOfContainmentName', 'name']);
      if (!result) throw invalidCatalog();
      return result;
    }),
    allergensDescription: sourceText(product.allergensDescription, 4000),
    warnings: sourceText(product.warnings, 4000),
    nonGmo: bool(product.nonGmo), nonGmoClaimName: sourceText(product.nonGmoClaimName, 512),
    organicClaimName: sourceText(product.organicClaimName, 512),
    nutritionInformation: nutrition(product.nutritionInformation),
  };
}

export function fulfillment(value) {
  return fields(value, [], ['curbside', 'delivery', 'instore', 'shiptohome']);
}

function hours(value) {
  const result = fields(value, ['gmtOffset', 'timezone'], ['Open24']);
  if (!result) return null;
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    if (value[day] == null) continue;
    result[day] = fields(value[day], ['open', 'close'], ['open24']);
  }
  return result;
}

export function normalizeStore(store) {
  if (!object(store) || typeof store.locationId !== 'string' || !/^[a-zA-Z0-9]{8}$/.test(store.locationId) ||
      typeof store.name !== 'string' || !store.name || store.name.length > 200 || !object(store.address)) throw invalidCatalog();
  const result = { locationId: store.locationId, name: store.name,
    address: fields(store.address, ['addressLine1', 'addressLine2', 'city', 'county', 'state', 'zipCode']) };
  for (const key of ['chain', 'phone', 'storeNumber', 'divisionNumber']) {
    if (Object.hasOwn(store, key)) result[key] = sourceText(store[key]);
  }
  if (Object.hasOwn(store, 'hours')) result.hours = hours(store.hours);
  if (Object.hasOwn(store, 'departments')) result.departments = list(store.departments, 100, value => {
    const department = fields(value, ['departmentId', 'name', 'phone']);
    if (!department) throw invalidCatalog();
    if (Object.hasOwn(value, 'hours')) department.hours = hours(value.hours);
    return department;
  });
  if (Object.hasOwn(store, 'geolocation')) {
    result.geolocation = fields(store.geolocation, ['latLng'], [], ['latitude', 'longitude']);
    if (result.geolocation && (Math.abs(result.geolocation.latitude ?? 0) > 90 || Math.abs(result.geolocation.longitude ?? 0) > 180)) throw invalidCatalog();
  }
  return result;
}
