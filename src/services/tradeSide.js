export function inferTradeSide(tradePrice, bid, ask) {
  if (ask !== null && tradePrice >= ask) return 'buy';
  if (bid !== null && tradePrice <= bid) return 'sell';
  return null;
}
