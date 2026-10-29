import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createPublicMarketTickerRouter } from '../src/routes/publicMarketTicker.js';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const express = require('express');

async function setup(options) {
  const app = express();
  app.use('/api/public/market-ticker', createPublicMarketTickerRouter(options));
  const server = createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    url: `http://127.0.0.1:${server.address().port}/api/public/market-ticker`,
    close: () => new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())),
  };
}

test('ticker palauttaa hyväksytyt live-datan kentät ja välimuistiotsakkeen', async t => {
  let calls = 0;
  const symbols = ['NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'MSFT'];
  const s = await setup({
    getQuotes: async requested => {
      calls++;
      assert.deepEqual(requested, symbols);
      return requested.map(symbol => ({
        symbol, price: 123.45, changePct: null,
        timestamp: '2026-10-29T14:00:00.000Z',
        source: 'stockflow_tradier',
        internalField: 'must-not-leak',
      }));
    },
  });
  t.after(() => s.close());

  const response = await fetch(s.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=10');

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.map(q => q.symbol), symbols);
  assert.equal(body.data[0].price, 123.45);
  assert.equal(body.data[0].changePct, null);
  assert.equal('internalField' in body.data[0], false);
  assert.equal(calls, 1);
});

test('ticker käyttää välimuistia ja hakee uudelleen sen vanhennuttua', async t => {
  let time = 1000;
  let calls = 0;
  const s = await setup({
    now: () => time,
    cacheTtlMs: 15000,
    getQuotes: async symbols => {
      calls++;
      return symbols.map(symbol => ({
        symbol, price: calls * 10, changePct: null,
        timestamp: null, source: 'stockflow_tradier',
      }));
    },
  });
  t.after(() => s.close());

  const first = await (await fetch(s.url)).json();
  const second = await (await fetch(s.url)).json();
  assert.equal(calls, 1);
  assert.equal(second.data[0].price, first.data[0].price);

  time += 15001;
  const third = await (await fetch(s.url)).json();
  assert.equal(calls, 2);
  assert.equal(third.data[0].price, 20);
});

test('ticker palauttaa 503 eikä tekaistuja hintoja markkinavirheessä', async t => {
  const s = await setup({
    getQuotes: async () => { throw new Error('provider unavailable'); },
  });
  t.after(() => s.close());

  const response = await fetch(s.url);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Market quotes temporarily unavailable',
  });
});


test('ticker säilyttää hinnan ja merkitsee vanhan noteerauksen', async t => {
  const nowMs = Date.parse('2026-10-29T20:30:00.000Z');
  const s = await setup({
    now: () => nowMs,
    getQuotes: async symbols => symbols.map((symbol, i) => ({
      symbol,
      price: 123.45,
      changePct: 1,
      timestamp: i === 0
        ? '2026-10-29T20:00:00.000Z'
        : '2026-10-29T20:25:00.000Z',
      source: 'stockflow_tradier',
    })),
  });
  t.after(() => s.close());

  const response = await fetch(s.url);
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.data[0].price, 123.45);
  assert.equal(body.data[0].isStale, true);
  assert.equal(body.data[0].ageMs, 30 * 60 * 1000);
  assert.equal(body.data[1].isStale, false);
  assert.equal(body.data[1].ageMs, 5 * 60 * 1000);
});

test('ticker merkitsee puuttuvan aikaleiman vanhaksi', async t => {
  const s = await setup({
    getQuotes: async symbols => symbols.map(symbol => ({
      symbol, price: 123.45, changePct: null,
      timestamp: null, source: 'stockflow_tradier',
    })),
  });
  t.after(() => s.close());

  const body = await (await fetch(s.url)).json();
  assert.equal(body.data[0].price, 123.45);
  assert.equal(body.data[0].isStale, true);
  assert.equal(body.data[0].ageMs, null);
});
