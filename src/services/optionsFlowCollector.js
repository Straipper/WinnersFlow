import {
  getOptionsFlow,
  normalizeOptionsRows,
} from './optionWhales.js';

import {
  archiveOptionsFlowRows,
} from './optionsFlowArchive.js';

export const OPTIONS_FLOW_TICKERS = [
  'NVDA', 'AAPL', 'MSFT', 'AMD', 'TSLA', 'META',
];

const INTERVAL_MS = 15 * 60 * 1000;
const PAGE_LIMIT = 2000;
const MAX_PAGES_PER_TICKER = 3;

const MIN_PREMIUM = 100001;

function timestampMs(value) {
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

function sameCursor(a, b) {
  if (a === b) return true;
  const aMs = timestampMs(a);
  const bMs = timestampMs(b);
  return Number.isFinite(aMs) && Number.isFinite(bMs) && aMs === bMs;
}

export function createOptionsFlowCollector({
  fetchRows = getOptionsFlow,
  normalizeRows = normalizeOptionsRows,
  archiveRows = archiveOptionsFlowRows,
  tickers = OPTIONS_FLOW_TICKERS,
  intervalMs = INTERVAL_MS,
  pageLimit = PAGE_LIMIT,
  maxPages = MAX_PAGES_PER_TICKER,
  logger = console,
}) {
  let timer = null;
  let running = false;
  const cursors = new Map();

  async function runOnce() {
    if (running) {
      logger.info?.('[OptionsFlowCollector] Kierros jo käynnissä.');
      return { skipped: true, processed: 0 };
    }

    running = true;
    let processed = 0;

    try {
      for (const ticker of tickers) {
        let olderThan = cursors.get(ticker);

        for (let page = 0; page < maxPages; page += 1) {
          try {
            const payload = await fetchRows(ticker, {
              limit: pageLimit,
              olderThan,
              minPremium: MIN_PREMIUM,
            });

            const rows = normalizeRows(payload);
            if (Array.isArray(rows) && rows.length) {
              await archiveRows(rows);
              processed += rows.length;
            }

            // OptionWhales REST pagination uses older_than. When the
            // response has no explicit cursor, derive it from the oldest
            // valid normalized row timestamp.
            const timestamps = Array.isArray(rows)
              ? rows
                  .map(row => timestampMs(row?.timestamp))
                  .filter(Number.isFinite)
              : [];

            const oldestTimestampMs = timestamps.length
              ? Math.min(...timestamps)
              : null;

            const oldestTimestamp = oldestTimestampMs === null
              ? null
              : new Date(oldestTimestampMs).toISOString();

            const nextCursor = payload?.next_cursor || oldestTimestamp;

            if (!nextCursor) {
              cursors.delete(ticker);
              break;
            }

            if (olderThan && sameCursor(nextCursor, olderThan)) {
              logger.error?.(
                `[OptionsFlowCollector] ${ticker}: sivutuskursori ei edennyt.`
              );
              break;
            }

            olderThan = nextCursor;
            cursors.set(ticker, nextCursor);
          } catch (error) {
            logger.error?.(
              `[OptionsFlowCollector] ${ticker}, sivu ${page + 1}:`,
              error?.message || error
            );
            break;
          }
        }
      }

      logger.info?.(`[OptionsFlowCollector] Käsitelty ${processed} riviä.`);
      return { skipped: false, processed };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return false;
    timer = setInterval(() => { void runOnce(); }, intervalMs);
    timer.unref?.();
    void runOnce();
    logger.info?.('[OptionsFlowCollector] Käynnistetty, väli 15 min.');
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearInterval(timer);
    timer = null;
    return true;
  }

  return { start, stop, runOnce };
}

let defaultCollector;

export function startOptionsFlowCollector() {
  if (!process.env.OPTIONFLOW_API_KEY && !process.env.OPTIONWHALES_API_KEY) {
    console.warn('[OptionsFlowCollector] API-avain puuttuu; kerääjää ei käynnistetä.');
    return false;
  }

  if (!defaultCollector) defaultCollector = createOptionsFlowCollector();
  return defaultCollector.start();
}

export function stopOptionsFlowCollector() {
  return defaultCollector ? defaultCollector.stop() : false;
}
