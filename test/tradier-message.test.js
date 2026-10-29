import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTradierMessage } from '../src/services/tradierMessage.js';

const now = Date.parse('2026-10-23T12:00:00.000Z');

function timesale(overrides = {}) {
  return {
    type: 'timesale',
    symbol: 'nvda',
    date: new Date(now - 1000).toISOString(),
    last: 180,
    size: 100,
    seq: 12345,
    exch: 'Q',
    ...overrides,
  };
}

test('kelvollinen timesale normalisoidaan flow-käsittelyä varten', () => {
  const [event] = normalizeTradierMessage(JSON.stringify(timesale()), now);

  assert.equal(event.symbol, 'NVDA');
  assert.equal(event.last, 180);
  assert.equal(event.size, 100);
  assert.equal(event.seq, 12345);
  assert.equal(event.timestampMs, now - 1000);
  assert.equal(event.timestamp, new Date(now - 1000).toISOString());
});

test('JSON-taulukon kelvolliset tapahtumat käsitellään', () => {
  const events = normalizeTradierMessage(JSON.stringify([
    timesale(),
    { type: 'status', status: 'ok' },
    timesale({ symbol: 'aapl', seq: 2 }),
  ]), now);

  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.symbol), ['NVDA', 'AAPL']);
});

test('virheellinen JSON, tuntematon tyyppi ja puuttuva symboli hylätään', () => {
  assert.deepEqual(normalizeTradierMessage('{bad json', now), []);
  assert.deepEqual(normalizeTradierMessage(JSON.stringify({
    type: 'status',
    status: 'ok',
    symbol: 'NVDA',
    date: new Date(now).toISOString(),
  }), now), []);
  assert.deepEqual(normalizeTradierMessage(JSON.stringify(
    timesale({ symbol: '' })
  ), now), []);
});

test('virheellinen tai puuttuva aikaleima hylätään', () => {
  for (const date of ['not-a-date', undefined, '']) {
    assert.deepEqual(normalizeTradierMessage(JSON.stringify(
      timesale({ date })
    ), now), []);
  }
});

test('peruutetut ja korjatut kaupat hylätään', () => {
  for (const field of ['cancel', 'correction']) {
    for (const value of [true, 1, 'true']) {
      assert.deepEqual(normalizeTradierMessage(JSON.stringify(
        timesale({ [field]: value })
      ), now), []);
    }
  }
});

test('liian tulevaisuuteen ajoitettu kauppa hylätään', () => {
  assert.deepEqual(normalizeTradierMessage(JSON.stringify(
    timesale({ date: new Date(now + 2001).toISOString() })
  ), now), []);
});

test('enintään kahden sekunnin kellopoikkeama rajataan nykyhetkeen', () => {
  const [event] = normalizeTradierMessage(JSON.stringify(
    timesale({ date: new Date(now + 1000).toISOString() })
  ), now);

  assert.equal(event.timestampMs, now);
});

test('quote säilyttää erilliset bid- ja ask-aikaleimat virheellisellä vastapuolella', () => {
  const result = normalizeTradierMessage(JSON.stringify({
    type: 'quote',
    symbol: 'AAPL',
    date: '2026-10-23T10:00:00Z',
    biddate: '2026-10-23T10:00:02Z',
    askdate: 'not-a-date',
    bid: 250,
    ask: 250.1,
    last: 250.05
  }));

  assert.equal(result.length, 1);
  assert.equal(result[0].bidTimestampMs, Date.parse('2026-10-23T10:00:02Z'));
  assert.equal(Number.isNaN(result[0].askTimestampMs), true);
});

test('quote hyväksyy hintapuolen aikaleiman, vaikka date puuttuu', () => {
  const result = normalizeTradierMessage(JSON.stringify({
    type: 'quote',
    symbol: 'AAPL',
    biddate: '2026-10-23T10:00:02Z',
    askdate: '2026-10-23T10:00:01Z',
    bid: 250,
    ask: 250.1,
    last: 250.05
  }));

  assert.equal(result.length, 1);
  assert.equal(result[0].timestampMs, Date.parse('2026-10-23T10:00:02Z'));
});

test('quote hylätään, jos hintapuolen aikaleima on yli kaksi sekuntia tulevaisuudessa', () => {
  const future = now + 5000;
  const result = normalizeTradierMessage(JSON.stringify({
    type: 'quote',
    symbol: 'AAPL',
    date: new Date(now).toISOString(),
    biddate: new Date(future).toISOString(),
    askdate: new Date(now).toISOString(),
    bid: 250,
    ask: 250.1,
    last: 250.05
  }), now);

  assert.equal(result.length, 0);
});

test('quote käyttää uusinta kelvollista aikaleimaa date-, biddate- ja askdate-kentistä', () => {
  const result = normalizeTradierMessage(JSON.stringify({
    type: 'quote',
    symbol: 'AAPL',
    date: '2026-10-23T10:00:00Z',
    biddate: '2026-10-23T10:00:02Z',
    askdate: '2026-10-23T10:00:01Z',
    bid: 250,
    ask: 250.1,
    last: 250.05
  }));
  assert.equal(result.length, 1);
  assert.equal(result[0].timestamp, '2026-10-23T10:00:02.000Z');
  assert.equal(result[0].bidTimestampMs, Date.parse('2026-10-23T10:00:02Z'));
  assert.equal(result[0].askTimestampMs, Date.parse('2026-10-23T10:00:01Z'));
});
