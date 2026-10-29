export function isFreshMarketTimestamp(timestampMs, now = Date.now()) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(now)) return false;
  const ageMs = now - timestampMs;
  return ageMs >= 0 && ageMs <= 60_000;
}


export function isFutureMarketTimestamp(timestampMs, now = Date.now(), toleranceMs = 2000) {
  if (!Number.isFinite(timestampMs) || !Number.isFinite(now)) return true;
  return timestampMs > now + toleranceMs;
}
