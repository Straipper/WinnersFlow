import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCandles } from '../src/services/marketData.js';

const trade = (datetime, price, volume = 1) => ({
  datetime, _time: Date.parse(datetime), _ohlc: false,
  price, close: price, volume
});

const bar = (datetime, open, high, low, close, volume) => ({
  datetime, _time: Date.parse(datetime), _ohlc: true,
  open, high, low, close, volume
});

test('45 minuutin kynttilät kohdistuvat pörssin avauksesta', () => {
  const result = aggregateCandles([
    trade('2026-10-23T13:30:00.000Z', 100, 2),
    trade('2026-10-23T14:00:00.000Z', 103, 3),
    trade('2026-10-23T14:15:00.000Z', 101, 4)
  ], '45min', '15min', 'TEST');

  assert.equal(result.length, 2);
  assert.equal(result[0].datetime, '2026-10-23T13:30:00.000Z');
  assert.deepEqual(
    [result[0].open, result[0].high, result[0].low, result[0].close, result[0].volume],
    [100, 103, 100, 103, 5]
  );
  assert.equal(result[1].datetime, '2026-10-23T14:15:00.000Z');
});

test('tunnin kynttilät kohdistuvat pörssin avaukseen', () => {
  const result = aggregateCandles([
    trade('2026-10-23T13:30:00.000Z', 100),
    trade('2026-10-23T14:29:00.000Z', 105),
    trade('2026-10-23T14:30:00.000Z', 102)
  ], '1h', '15min', 'TEST');

  assert.equal(result.length, 2);
  assert.equal(result[0].datetime, '2026-10-23T13:30:00.000Z');
  assert.deepEqual([result[0].open, result[0].high, result[0].close], [100, 105, 105]);
  assert.equal(result[1].datetime, '2026-10-23T14:30:00.000Z');
});

test('jälkimarkkinan tunnin kynttilät ankkuroidaan kello 16 ET', () => {
  const result = aggregateCandles([
    trade('2026-10-23T20:00:00.000Z', 100),
    trade('2026-10-23T20:30:00.000Z', 104),
    trade('2026-10-23T21:00:00.000Z', 102)
  ], '1h', '15min', 'TEST');

  assert.equal(result.length, 2);
  assert.equal(result[0].datetime, '2026-10-23T20:00:00.000Z');
  assert.equal(result[0].high, 104);
  assert.equal(result[1].datetime, '2026-10-23T21:00:00.000Z');
});

test('yhdistää OHLC-hinnat ja summaa volyymin', () => {
  const result = aggregateCandles([
    bar('2026-10-23T13:30:00.000Z', 100, 105, 99, 103, 10),
    bar('2026-10-23T13:45:00.000Z', 103, 108, 101, 106, 20)
  ], '30min', '15min', 'TEST');

  assert.equal(result.length, 1);
  assert.deepEqual(
    [result[0].open, result[0].high, result[0].low, result[0].close, result[0].volume],
    [100, 108, 99, 106, 30]
  );
});

test('säilyttää eri päivien kynttilät erillisinä', () => {
  const result = aggregateCandles([
    trade('2026-10-22T13:30:00.000Z', 100),
    trade('2026-10-23T13:30:00.000Z', 110)
  ], '1h', '15min', 'TEST');

  assert.equal(result.length, 2);
});

test('45 minuutin kynttilä vaihtuu täsmälleen aikavälin rajalla', () => {
  const result = aggregateCandles([
    trade('2026-10-23T13:30:00.000Z', 100),
    trade('2026-10-23T14:14:59.000Z', 105),
    trade('2026-10-23T14:15:00.000Z', 102)
  ], '45min', '15min', 'TEST');

  assert.equal(result.length, 2);
  assert.equal(result[0].datetime, '2026-10-23T13:30:00.000Z');
  assert.equal(result[0].close, 105);
  assert.equal(result[1].datetime, '2026-10-23T14:15:00.000Z');
});

test('tunnin kynttilät kohdistuvat oikein kesä- ja talviajalla', () => {
  const summer = aggregateCandles([
    trade('2026-07-15T13:30:00.000Z', 100),
    trade('2026-07-15T14:30:00.000Z', 101)
  ], '1h', '15min', 'TEST');

  const winter = aggregateCandles([
    trade('2026-12-15T14:30:00.000Z', 100),
    trade('2026-12-15T15:30:00.000Z', 101)
  ], '1h', '15min', 'TEST');

  assert.deepEqual(
    summer.map(c => c.datetime),
    ['2026-07-15T13:30:00.000Z', '2026-07-15T14:30:00.000Z']
  );
  assert.deepEqual(
    winter.map(c => c.datetime),
    ['2026-12-15T14:30:00.000Z', '2026-12-15T15:30:00.000Z']
  );
});

test('hylkää OHLC-rivin, jolta puuttuu aikaleima', () => {
  assert.throws(
    () => aggregateCandles([
      { datetime: '2026-10-23T13:30:00.000Z', _ohlc: true, open: 100, high: 105, low: 99, close: 103, volume: 10 }
    ], '30min', '15min', 'TEST'),
    /incomplete OHLC data/
  );
});

test('hylkää tuntemattoman aikavälin kauppadatalla', () => {
  assert.throws(
    () => aggregateCandles([
      trade('2026-10-23T13:30:00.000Z', 100)
    ], 'invalid', '15min', 'TEST'),
    /incomplete OHLC data/
  );
});

test('säilyttää valmiit kuukausi-OHLC-kynttilät muuttamatta arvoja', () => {
  const monthly = [{
    datetime: '2026-09-01T00:00:00.000Z',
    open: 100,
    high: 120,
    low: 95,
    close: 115,
    volume: 123456
  }];

  const result = aggregateCandles(
    monthly.map(row => ({ ...row, _time: Date.parse(row.datetime), _ohlc: true })),
    '1month',
    '1month',
    'TEST'
  );

  assert.deepEqual(result, monthly);
});
