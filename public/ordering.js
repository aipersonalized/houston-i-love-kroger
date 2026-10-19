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

export function orderProducts(products, sort = 'savings') {
  const savings = product => product.calculated?.savingsCents ?? -1;
  const percent = product => product.calculated?.percentOff ?? -1;
  const price = product => product.pricing?.currentCents ?? Infinity;
  const byValue = {
    savings: (a, b) => savings(b) - savings(a),
    percent: (a, b) => percent(b) - percent(a),
    price: (a, b) => price(a) - price(b),
  };
  return [...products].sort((a, b) => (byValue[sort] || byValue.savings)(a, b) ||
    savings(b) - savings(a) || percent(b) - percent(a));
}
