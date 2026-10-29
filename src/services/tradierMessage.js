function parseTimestampMs(value) {
  if (value === undefined || value === null || value === '') return NaN;

  if (
    typeof value === 'number' ||
    (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()))
  ) {
    const n = Number(value);
    if (!Number.isFinite(n)) return NaN;
    return Math.abs(n) < 1e12 ? n * 1000 : n;
  }

  return Date.parse(value);
}

export function normalizeTradierMessage(raw, now = Date.now()) {
  let events;

  try {
    const text = typeof raw === 'string' ? raw : raw.toString();
    events = JSON.parse(text);
  } catch {
    return [];
  }

  if (!Array.isArray(events)) events = [events];

  const normalized = [];

  for (const data of events) {
    if (!data?.symbol) continue;
    if (data.type !== 'quote' && data.type !== 'timesale') continue;

    if (
      data.type === 'timesale' &&
      [true, 1, 'true'].includes(data.cancel)
    ) continue;

    if (
      data.type === 'timesale' &&
      [true, 1, 'true'].includes(data.correction)
    ) continue;

    const bidTimestampMs = data.type === 'quote'
      ? parseTimestampMs(data.biddate ?? data.date)
      : NaN;
    const askTimestampMs = data.type === 'quote'
      ? parseTimestampMs(data.askdate ?? data.date)
      : NaN;
    const timestampValues = data.type === 'quote'
      ? [data.date, data.biddate, data.askdate]
      : [data.date ?? data.biddate ?? data.askdate];
    const validTimestamps = timestampValues
      .map(parseTimestampMs)
      .filter(Number.isFinite);
    let timestampMs = validTimestamps.length
      ? Math.max(...validTimestamps)
      : NaN;
    if (data.type === 'quote') {
      const quoteTimestampValues = [
        Number.isFinite(bidTimestampMs) ? bidTimestampMs : NaN,
        Number.isFinite(askTimestampMs) ? askTimestampMs : NaN,
        parseTimestampMs(data.date),
      ].filter(Number.isFinite);
      timestampMs = quoteTimestampValues.length
        ? Math.max(...quoteTimestampValues)
        : NaN;
    }

    if (!Number.isFinite(timestampMs)) continue;

    if (data.type === 'quote') {
      const quoteTimestamps = [
        bidTimestampMs,
        askTimestampMs,
        parseTimestampMs(data.date),
      ].filter(Number.isFinite);

      if (quoteTimestamps.some(value => value - now > 2000)) continue;

      const clampFuture = value =>
        Number.isFinite(value) && value > now ? now : value;

      timestampMs = clampFuture(timestampMs);
    } else {
      const clockSkewMs = timestampMs - now;
      if (clockSkewMs > 2000) continue;
      if (clockSkewMs > 0) timestampMs = now;
    }

    normalized.push({
      ...data,
      symbol: String(data.symbol).toUpperCase(),
      timestampMs,
      bidTimestampMs: data.type === 'quote'
        ? (Number.isFinite(bidTimestampMs) && bidTimestampMs > now ? now : bidTimestampMs)
        : bidTimestampMs,
      askTimestampMs: data.type === 'quote'
        ? (Number.isFinite(askTimestampMs) && askTimestampMs > now ? now : askTimestampMs)
        : askTimestampMs,
      timestamp: new Date(timestampMs).toISOString(),
    });
  }

  return normalized;
}
