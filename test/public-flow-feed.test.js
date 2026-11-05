import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createPublicFlowFeedRouter } from '../src/routes/publicFlowFeed.js';

const require = createRequire(new URL('../package.json', import.meta.url));
const express = require('express');

async function setup(options) {
  const app = express();
  app.use('/api/public/flow-feed', createPublicFlowFeedRouter(options));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/api/public/flow-feed/stock-prints`,
    optionsUrl: `http://127.0.0.1:${server.address().port}/api/public/flow-feed/options-flow`,
    close: () => new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())),
  };
}

test('Stock Prints palauttaa vain julkiset sallitut kentät', async t => {
  const s = await setup({
    getStockPrints: async ({ limit }) => {
      assert.equal(limit, 40);
      return [{
        symbol: 'NVDA',
        trade_timestamp: new Date(Date.now() - 6 * 86400000).toISOString(),
        price: '200.50',
        size: '6000',
        notional: '1203000',
        exchange: 'Q',
        trade_side: 'buy',
        internal_secret: 'must-not-leak',
      }];
    },
  });
  t.after(() => s.close());

  const response = await fetch(s.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=30');

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'DELAYED_DATA_AVAILABLE');
  assert.equal(body.delayHours, 120);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].price, 200.5);
  assert.equal(body.data[0].size, 6000);
  assert.equal('internal_secret' in body.data[0], false);
});

test('tyhjä arkisto palauttaa odotustilan ilman tekaistuja rivejä', async t => {
  const s = await setup({ getStockPrints: async () => [] });
  t.after(() => s.close());

  const body = await (await fetch(s.url)).json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'WAITING_FOR_5_DAY_ARCHIVE');
  assert.deepEqual(body.data, []);
});

test('arkistovirhe palauttaa 503 eikä demo-dataa', async t => {
  const s = await setup({
    getStockPrints: async () => { throw new Error('database unavailable'); },
  });
  t.after(() => s.close());

  const response = await fetch(s.url);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, 'FEED_UNAVAILABLE');
  assert.deepEqual(Object.keys(body).sort(), ['error', 'ok', 'status']);
});

test('reitillä ei voi valita symboleita tai kasvattaa palautusmäärää', async t => {
  let received;
  const s = await setup({
    getStockPrints: async options => {
      received = options;
      return [];
    },
  });
  t.after(() => s.close());

  await fetch(`${s.url}?symbol=HACK&limit=9999`);
  assert.deepEqual(received, { limit: 40 });
});


test('julkinen reitti hylkää myynnit, epäselvät suunnat ja alle miljoonan kaupat', async t => {
  const old = new Date(Date.now() - 6 * 86400000).toISOString();
  const s = await setup({
    getStockPrints: async () => [
      { symbol: 'NVDA', trade_timestamp: old, price: 200, size: 6000,
        notional: 1200000, trade_side: 'buy' },
      { symbol: 'AAPL', trade_timestamp: old, price: 200, size: 6000,
        notional: 1200000, trade_side: 'sell' },
      { symbol: 'MSFT', trade_timestamp: old, price: 200, size: 6000,
        notional: 1200000, trade_side: null },
      { symbol: 'AMD', trade_timestamp: old, price: 200, size: 5000,
        notional: 1000000, trade_side: 'buy' },
      { symbol: 'TSLA', trade_timestamp: old, price: 200, size: 6000,
        notional: 1200000, trade_side: 'BUY' },
      { symbol: 'META', trade_timestamp: new Date(Date.now() - 119 * 3600000).toISOString(),
        price: 200, size: 6000, notional: 1200000, trade_side: 'buy' },
    ],
  });
  t.after(() => s.close());

  const body = await (await fetch(s.url)).json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].symbol, 'NVDA');
  assert.equal(body.data[0].tradeSide, 'buy');
  assert.ok(body.data[0].notional > 1000000);
});


function oldOptionsRow(overrides = {}) {
  return {
    ticker: 'NVDA',
    event_id: 'event-1416',
    event_timestamp: new Date(Date.now() - 6 * 86400000).toISOString(),
    contract: 'NVDA 2027-01-15 200C',
    option_type: 'CALL',
    strike: '200',
    expiration: '2027-01-15',
    contracts: 500,
    premium: '150000',
    direction: 'BUY',
    direction_confidence: '0.95',
    order_type: 'SWEEP',
    internal_secret: 'must-not-leak',
    notional: '99999999',
    ...overrides,
  };
}

test('Options Flow palauttaa vain sallitut BUY-tapahtuman kentät', async t => {
  let received;
  const s = await setup({
    getOptionsFlow: async options => {
      received = options;
      return [oldOptionsRow()];
    },
  });
  t.after(() => s.close());

  const response = await fetch(s.optionsUrl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=30');
  assert.deepEqual(received, { limit: 40 });

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'DELAYED_DATA_AVAILABLE');
  assert.equal(body.delayHours, 120);
  assert.equal(body.data.length, 1);

  const row = body.data[0];
  assert.equal(row.ticker, 'NVDA');
  assert.equal(row.contract, 'NVDA 2027-01-15 200C');
  assert.equal(row.premium, 150000);
  assert.equal(row.contracts, 500);
  assert.equal(row.direction, 'BUY');
  assert.equal(row.directionConfidence, 0.95);
  assert.equal(row.orderType, 'SWEEP');
  assert.equal('internal_secret' in row, false);
  assert.equal('notional' in row, false);
  assert.equal('event_id' in row, false);
});

test('Options Flow hylkää SELL-, neutral- ja epäselvät suunnat', async t => {
  const old = new Date(Date.now() - 6 * 86400000).toISOString();
  const s = await setup({
    getOptionsFlow: async () => [
      oldOptionsRow({ event_timestamp: old, direction: 'BUY' }),
      oldOptionsRow({ event_id: 'sell', event_timestamp: old, direction: 'SELL' }),
      oldOptionsRow({ event_id: 'neutral', event_timestamp: old, direction: 'NEUTRAL' }),
      oldOptionsRow({ event_id: 'missing', event_timestamp: old, direction: null }),
      oldOptionsRow({ event_id: 'lowercase', event_timestamp: old, direction: 'buy' }),
    ],
  });
  t.after(() => s.close());

  const body = await (await fetch(s.optionsUrl)).json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].direction, 'BUY');
});

test('Options Flow vaatii premiumin olevan aidosti yli 100000 dollaria', async t => {
  const old = new Date(Date.now() - 6 * 86400000).toISOString();
  const s = await setup({
    getOptionsFlow: async () => [
      oldOptionsRow({ event_timestamp: old, premium: 100001 }),
      oldOptionsRow({ event_id: 'exact', event_timestamp: old, premium: 100000 }),
      oldOptionsRow({ event_id: 'below', event_timestamp: old, premium: 99999 }),
      oldOptionsRow({ event_id: 'invalid', event_timestamp: old, premium: 'invalid' }),
    ],
  });
  t.after(() => s.close());

  const body = await (await fetch(s.optionsUrl)).json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].premium, 100001);
});

test('Options Flow hylkää alle 120 tuntia vanhat ja tulevaisuuden tapahtumat', async t => {
  const s = await setup({
    getOptionsFlow: async () => [
      oldOptionsRow({
        event_id: 'fresh',
        event_timestamp: new Date(Date.now() - 119 * 3600000).toISOString(),
      }),
      oldOptionsRow({
        event_id: 'future',
        event_timestamp: new Date(Date.now() + 60000).toISOString(),
      }),
      oldOptionsRow({
        event_id: 'old',
        event_timestamp: new Date(Date.now() - 121 * 3600000).toISOString(),
      }),
    ],
  });
  t.after(() => s.close());

  const body = await (await fetch(s.optionsUrl)).json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].ticker, 'NVDA');
});

test('Options Flow hylkää virheelliset sopimusmäärät ja confidence-arvot', async t => {
  const old = new Date(Date.now() - 6 * 86400000).toISOString();
  const s = await setup({
    getOptionsFlow: async () => [
      oldOptionsRow({ event_timestamp: old, contracts: 0 }),
      oldOptionsRow({ event_id: 'fraction', event_timestamp: old, contracts: 1.5 }),
      oldOptionsRow({ event_id: 'unsafe', event_timestamp: old, contracts: Number.MAX_SAFE_INTEGER + 1 }),
      oldOptionsRow({ event_id: 'confidence-high', event_timestamp: old, direction_confidence: 1.1 }),
      oldOptionsRow({ event_id: 'confidence-low', event_timestamp: old, direction_confidence: -0.1 }),
      oldOptionsRow({ event_id: 'valid-null', event_timestamp: old, direction_confidence: null }),
    ],
  });
  t.after(() => s.close());

  const body = await (await fetch(s.optionsUrl)).json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].directionConfidence, null);
});

test('Options Flow palauttaa 503 tietokantavirheessä ilman varadataa', async t => {
  const s = await setup({
    getOptionsFlow: async () => {
      throw new Error('database unavailable');
    },
  });
  t.after(() => s.close());

  const response = await fetch(s.optionsUrl);
  assert.equal(response.status, 503);

  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, 'FEED_UNAVAILABLE');
  assert.deepEqual(Object.keys(body).sort(), ['error', 'ok', 'status']);
});

test('Options Flow ei anna URL-parametrien muuttaa hakurajaa', async t => {
  let received;
  const s = await setup({
    getOptionsFlow: async options => {
      received = options;
      return [];
    },
  });
  t.after(() => s.close());

  await fetch(`${s.optionsUrl}?ticker=HACK&limit=9999&premium=1`);
  assert.deepEqual(received, { limit: 40 });
});


test('Options Flow hylkää tickerit sallitun listan ulkopuolelta', async t => {
  const old = new Date(Date.now() - 6 * 86400000).toISOString();
  const s = await setup({
    getOptionsFlow: async () => [
      oldOptionsRow({ event_timestamp: old, ticker: 'NVDA' }),
      oldOptionsRow({
        event_id: 'unknown',
        event_timestamp: old,
        ticker: 'HACK',
      }),
    ],
  });
  t.after(() => s.close());

  const body = await (await fetch(s.optionsUrl)).json();
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].ticker, 'NVDA');
});
