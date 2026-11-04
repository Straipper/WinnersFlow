const DEFAULT_DELAY_MS = 5 * 24 * 60 * 60 * 1000;

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    return Date.parse(value);
  }

  return NaN;
}

export function filterDelayedRows(
  rows,
  { now = Date.now(), delayMs = DEFAULT_DELAY_MS } = {}
) {
  if (!Array.isArray(rows)) return [];

  if (!Number.isFinite(now) || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError('Invalid delayed-feed time configuration');
  }

  const cutoff = now - delayMs;

  return rows.filter(row => {
    const eventMs = timestampMs(row?.timestamp);

    return Number.isFinite(eventMs) &&
      eventMs <= cutoff &&
      eventMs <= now;
  });
}

export { DEFAULT_DELAY_MS };
