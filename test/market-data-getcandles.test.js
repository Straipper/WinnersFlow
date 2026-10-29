import test from 'node:test';
import assert from 'node:assert/strict';
import { getCandles } from '../src/services/marketData.js';

test('getCandles hylkää tulevaisuuden historiapäivän ja säilyttää kelvollisen päivän', async () => {
  const oldProvider = process.env.MARKET_DATA_PROVIDER;
  const oldKey = process.env.STOCKFLOW_API_KEY;
  const oldFetch = globalThis.fetch;

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const row = date => ({
    date, open: 100, high: 110, low: 90, close: 105, volume: 1000
  });

  try {
    process.env.MARKET_DATA_PROVIDER = 'stockflow';
    process.env.STOCKFLOW_API_KEY = 'test-only-not-a-real-key';

    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        history: { day: [row(today), row(tomorrow)] }
      })
    });

    const candles = await getCandles('SPY', '1day', 10);

    assert.equal(candles.length, 1);
    assert.equal(candles[0].datetime, `${today}T00:00:00.000Z`);
    assert.equal(candles[0].close, 105);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldProvider === undefined) delete process.env.MARKET_DATA_PROVIDER;
    else process.env.MARKET_DATA_PROVIDER = oldProvider;
    if (oldKey === undefined) delete process.env.STOCKFLOW_API_KEY;
    else process.env.STOCKFLOW_API_KEY = oldKey;
  }
});


test('getCandles hylkää virheellisen intraday-volyymin', async () => {
  const oldProvider = process.env.MARKET_DATA_PROVIDER;
  const oldKey = process.env.STOCKFLOW_API_KEY;
  const oldFetch = globalThis.fetch;
  try {
    process.env.MARKET_DATA_PROVIDER = 'stockflow';
    process.env.STOCKFLOW_API_KEY = 'test-only-not-a-real-key';
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        series: { data: [{
          datetime: '2026-10-23 14:00',
          open: 100, high: 110, low: 90, close: 105,
          volume: Infinity
        }] }
      })
    });
    const candles = await getCandles('SPY', '5min', 10);
    assert.deepEqual(candles, []);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldProvider === undefined) delete process.env.MARKET_DATA_PROVIDER;
    else process.env.MARKET_DATA_PROVIDER = oldProvider;
    if (oldKey === undefined) delete process.env.STOCKFLOW_API_KEY;
    else process.env.STOCKFLOW_API_KEY = oldKey;
  }
});


test('getCandles hylkää negatiivisen ja virheellisen intraday-volyymin', async () => {
  const oldProvider = process.env.MARKET_DATA_PROVIDER;
  const oldKey = process.env.STOCKFLOW_API_KEY;
  const oldFetch = globalThis.fetch;
  try {
    process.env.MARKET_DATA_PROVIDER = 'stockflow';
    process.env.STOCKFLOW_API_KEY = 'test-only-not-a-real-key';

    for (const invalidVolume of [-1, 'not-a-number']) {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          series: { data: [{
            datetime: '2026-10-23 14:00',
            open: 100, high: 110, low: 90, close: 105,
            volume: invalidVolume
          }] }
        })
      });

      const candles = await getCandles('SPY', '5min', 10);
      assert.deepEqual(candles, [], `Volyymi ${String(invalidVolume)} pitäisi hylätä`);
    }
  } finally {
    globalThis.fetch = oldFetch;
    if (oldProvider === undefined) delete process.env.MARKET_DATA_PROVIDER;
    else process.env.MARKET_DATA_PROVIDER = oldProvider;
    if (oldKey === undefined) delete process.env.STOCKFLOW_API_KEY;
    else process.env.STOCKFLOW_API_KEY = oldKey;
  }
});
