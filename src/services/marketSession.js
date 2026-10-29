const TZ = 'America/New_York';

function parts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { weekday: p.weekday, hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second) };
}

export function getMarketSession(date = new Date()) {
  const p = parts(date);
  const minutes = p.hour * 60 + p.minute;
  const weekday = !['Sat', 'Sun'].includes(p.weekday);
  if (!weekday) return { session: 'CLOSED', label: 'Market Closed', isRegularHours: false, isExtendedHours: false, timezone: TZ };
  if (minutes >= 570 && minutes < 960) return { session: 'REGULAR', label: 'Regular Trading Hours', isRegularHours: true, isExtendedHours: false, timezone: TZ };
  if (minutes >= 240 && minutes < 570) return { session: 'PRE_MARKET', label: 'Pre-Market', isRegularHours: false, isExtendedHours: true, timezone: TZ };
  if (minutes >= 960 && minutes < 1200) return { session: 'AFTER_HOURS', label: 'After Hours', isRegularHours: false, isExtendedHours: true, timezone: TZ };
  return { session: 'CLOSED', label: 'Market Closed', isRegularHours: false, isExtendedHours: false, timezone: TZ };
}

export function decorateQuote(quote, now = new Date()) {
  const market = getMarketSession(now);
  const extendedPrice = quote.extendedPrice != null && quote.extendedPrice !== '' && Number.isFinite(Number(quote.extendedPrice)) ? Number(quote.extendedPrice) : null;
  const displayPrice = market.isExtendedHours && extendedPrice !== null ? extendedPrice : quote.price;
  return {
    ...quote,
    marketSession: market.session,
    marketSessionLabel: market.label,
    isRegularHours: market.isRegularHours,
    isExtendedHours: market.isExtendedHours,
    extendedPrice,
    displayPrice,
    priceType: market.isRegularHours ? 'REGULAR' : market.isExtendedHours ? 'EXTENDED' : 'LAST',
  };
}
