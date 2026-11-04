import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptionsRows } from '../src/services/optionWhales.js';

test('OptionWhales-rivin kentät normalisoituvat', () => {
  const [row] = normalizeOptionsRows({
    data: {
      rows: [{
        event_id: 'fixture-event-1',
        ticker: 'SPY',
        timestamp: '2026-08-10T20:14:52.183Z',
        option_ticker: 'O:SPY260810C00721000',
        option_type: 'Call',
        strike: 721,
        expiration: '2026-08-10',
        total_contracts: 301,
        premium: 37625,
        total_notional: 21716330,
        direction: 'buy',
        direction_confidence: 0.94,
        order_type: 'sweep',
        spot_price: 721.4,
        implied_volatility: 0.196,
        delta: 0.329,
        trade_count: 9
      }]
    }
  });

  assert.ok(row, 'rivi löytyi');
  assert.equal(row.ticker, 'SPY');
  assert.equal(row.contract, 'O:SPY260810C00721000');
  assert.equal(row.optionType, 'CALL');
  assert.equal(row.strike, 721);
  assert.equal(row.contracts, 301);
  assert.equal(row.premium, 37625);
  assert.equal(row.notional, 21716330);
  assert.equal(row.directionConfidence, 0.94);
  assert.equal(row.spot, 721.4);
  assert.equal(row.impliedVolatility, 0.196);
  assert.equal(row.delta, 0.329);
  assert.equal(row.tradeCount, 9);
});

test('OCC-symbolista johdetaan ticker ilman erillistä ticker-kenttää', () => {
  const [row] = normalizeOptionsRows({
    rows: [{
      id: 'fixture-event-2',
      timestamp: '2026-08-10T20:14:52.183Z',
      option_ticker: 'O:NVDA260810P00180000',
      total_contracts: 150,
      premium: 125000,
      total_notional: 2500000,
      direction: 'buy'
    }]
  });

  assert.ok(row, 'rivi löytyi');
  assert.equal(row.ticker, 'NVDA');
  assert.equal(row.optionType, 'PUT');
  assert.equal(row.strike, 180);
});

test('premium ja total_notional säilyvät erillisinä', () => {
  const [row] = normalizeOptionsRows({
    rows: [{
      ticker: 'AAPL',
      id: 'fixture-event-3',
      timestamp: '2026-08-10T20:14:52.183Z',
      option_ticker: 'O:AAPL260810C00200000',
      total_contracts: 200,
      premium: 95000,
      total_notional: 9500000,
      direction: 'buy'
    }]
  });

  assert.equal(row.premium, 95000);
  assert.equal(row.notional, 9500000);
  assert.notEqual(row.premium, row.notional);
});
