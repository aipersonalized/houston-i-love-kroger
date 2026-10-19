// Shared by the web interface and HTTP API so both rank the same offers.
export function orderOffers(offers, sort = 'savings') {
  const byValue = {
    savings: (a, b) => b.calculated.savingsCents - a.calculated.savingsCents,
    percent: (a, b) => b.calculated.percentOff - a.calculated.percentOff,
    price: (a, b) => a.source.price.promo - b.source.price.promo,
  };
  const compare = byValue[sort] || byValue.savings;
  return [...offers].sort((a, b) => compare(a, b) ||
    b.calculated.savingsCents - a.calculated.savingsCents ||
    b.calculated.percentOff - a.calculated.percentOff);
}
