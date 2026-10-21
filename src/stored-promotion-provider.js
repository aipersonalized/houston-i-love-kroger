import { DEFAULT_PROMOTION_MAX_AGE_SECONDS } from './history-store.js';
import { DIRECTORY_SOURCE } from './store-directory.js';

// Adapter inside the storage-owning service. Every call rechecks the store's
// source permissions; this never collects data or widens the caller's scope.
export function createStoredPromotionProvider({ store, sourceId = 'kroger-public', directorySourceId = DIRECTORY_SOURCE,
  maxAgeSeconds = DEFAULT_PROMOTION_MAX_AGE_SECONDS, now = () => new Date().toISOString() }) {
  const call = async (operation, input = {}) => {
    try { return await store[operation]({ ...input, sourceId: operation === 'getStoredStores' ? directorySourceId : sourceId,
      asOf: now(), ...(['getLatestDeals', 'searchPrices', 'estimateBasket', 'getStoredStores', 'getStoreTopics'].includes(operation) ? { maxAgeSeconds } : {}) }); }
    catch (error) {
      if (error?.code === 'history_input_invalid') {
        const invalid = new Error('Check the stored search fields and cursor.');
        invalid.code = 'promotion_request_invalid'; throw invalid;
      }
      throw error;
    }
  };
  return {
    getStatus: () => call('getPromotionStatus'),
    getStoredStores: input => call('getStoredStores', input),
    getStoreTopics: input => call('getStoreTopics', input),
    getLatestDeals: input => call('getLatestDeals', input),
    searchPrices: input => call('searchPrices', input),
    estimateBasket: input => call('estimateBasket', input),
    searchPromotions: input => call('searchPromotions', input),
    retrievePromotion: input => call('retrievePromotion', input),
    getComparisons: input => call('getComparisons', input),
  };
}
