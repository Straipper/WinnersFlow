import test from 'node:test';
import assert from 'node:assert/strict';
import { processFlowTick, getFlow, resetFlow } from '../src/services/flowEngine.js';

const source = 'stockflow_tradier_timesale';

function trade(overrides = {}) {
  return {
    symbol: 'WFTEST',
    price: 100,
    dayVolume: 1000,
    tradeSize: 100,
    tradeId: `trade-${Date.now()}`,
    exchange: 'TEST',
    tradeSide: 'buy',
    timestamp: Date.now(),
    source,
    ...overrides,
  };
}

test('tuore, tunnistettu Tradier-kauppa lisätään flow’hun', () => {
  resetFlow();
  const result = processFlowTick(trade({ tradeId: 'fresh-1' }));

  assert.equal(result.eventCount, 1);
  assert.equal(result.buyVolume, 100);
  assert.equal(result.latestEvents[0].tradeId, 'fresh-1');
  assert.equal(result.source, 'live_trade_tape');
});

test('sama kauppatunniste ei kasvata volyymia kahdesti', () => {
  resetFlow();
  processFlowTick(trade({ tradeId: 'duplicate-1', timestamp: Date.now() }));
  const result = processFlowTick(
    trade({ tradeId: 'duplicate-1', timestamp: Date.now() })
  );

  assert.equal(result.eventCount, 1);
  assert.equal(result.buyVolume, 100);
});

test('vanha, tulevaisuuteen ajoitettu tai väärän lähteen kauppa hylätään', () => {
  const cases = [
    ['vanha', { timestamp: Date.now() - 61_000 }],
    ['tulevaisuus', { timestamp: Date.now() + 2_000 }],
    ['väärä lähde', { source: 'stockflow_tradier_quote' }],
    ['puuttuva tunniste', { tradeId: '' }],
    ['nollakoko', { tradeSize: 0 }],
  ];

  for (const [name, overrides] of cases) {
    resetFlow();
    processFlowTick(trade({ tradeId: `invalid-${name}`, ...overrides }));
    assert.equal(getFlow('WFTEST').eventCount, 0, name);
  }
});

test('epäkelpo hinta tai ääretön kauppakoko ei luo flow-tapahtumaa', () => {
  for (const [name, overrides] of [
    ['nollahinta', { price: 0 }],
    ['negatiivinen hinta', { price: -1 }],
    ['ääretön hinta', { price: Infinity }],
    ['ääretön kauppakoko', { tradeSize: Infinity }],
  ]) {
    resetFlow();
    const result = processFlowTick(
      trade({ tradeId: `invalid-number-${name}`, ...overrides })
    );
    if (Object.hasOwn(overrides, 'price')) {
      assert.equal(result, null, name);
    } else {
      assert.equal(result.eventCount, 0, name);
    }
  }
});

test('vanha tai tuleva quote ei muuta vertailuhintaa', () => {
  resetFlow();

  processFlowTick({
    symbol: 'WFTEST',
    price: 100,
    dayVolume: 1000,
    tradeSize: 0,
    timestamp: Date.now(),
    source: 'stockflow_tradier_quote',
  });

  for (const timestamp of [Date.now() - 61_000, Date.now() + 2_000]) {
    const result = processFlowTick({
      symbol: 'WFTEST',
      price: 50,
      dayVolume: 2000,
      tradeSize: 0,
      timestamp,
      source: 'stockflow_tradier_quote',
    });
    assert.equal(result, null);
    assert.equal(getFlow('WFTEST').price, 100);
  }

  const result = processFlowTick(
    trade({ tradeId: 'after-invalid-quotes', price: 101, tradeSide: null })
  );
  assert.equal(result.eventCount, 1);
  assert.equal(result.latestEvents[0].side, 'buy');
});

test('quote-volyymin muutokset eivät luo kauppatapahtumia', () => {
  resetFlow();

  processFlowTick({
    symbol: 'WFTEST',
    price: 100,
    dayVolume: 1000,
    tradeSize: 0,
    timestamp: Date.now(),
    source: 'stockflow_tradier_quote',
  });

  const result = processFlowTick({
    symbol: 'WFTEST',
    price: 101,
    dayVolume: 2000,
    tradeSize: 0,
    timestamp: Date.now(),
    source: 'stockflow_tradier_quote',
  });

  assert.equal(result.eventCount, 0);
  assert.equal(result.source, 'no_verified_trades');
});

test('myyntisuunta kirjataan myyntivolyymiksi', () => {
  resetFlow();
  const result = processFlowTick(
    trade({ tradeId: 'sell-1', tradeSide: 'sell' })
  );

  assert.equal(result.eventCount, 1);
  assert.equal(result.sellVolume, 100);
  assert.equal(result.buyVolume, 0);
});

test('resetFlow tyhjentää tapahtumat', () => {
  resetFlow();
  processFlowTick(trade({ tradeId: 'reset-1' }));
  resetFlow();

  assert.equal(getFlow('WFTEST').eventCount, 0);
});
