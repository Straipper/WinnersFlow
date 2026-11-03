import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOptionsFlowCollector,
} from '../src/services/optionsFlowCollector.js';

function quietLogger() {
  return { info() {}, error() {} };
}

test('sivutus jatkuu seuraavalla kierroksella tallennetusta kursorista', async () => {
  const calls = [];
  const collector = createOptionsFlowCollector({
    tickers: ['NVDA'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      return { rows: [], next_cursor: calls.length === 1 ? 'cursor-1' : 'cursor-2' };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();
  await collector.runOnce();

  assert.deepEqual(calls, [undefined, 'cursor-1']);
});

test('sivutus aloitetaan alusta kun API ilmoittaa ettei seuraavaa sivua ole', async () => {
  const calls = [];
  let request = 0;

  const collector = createOptionsFlowCollector({
    tickers: ['AAPL'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      request += 1;
      return {
        rows: [],
        next_cursor: request === 1 ? 'cursor-end' : null,
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();
  await collector.runOnce();
  await collector.runOnce();

  assert.deepEqual(calls, [undefined, 'cursor-end', undefined]);
});

test('API-virhe ei siirrä sivutuskursoria eteenpäin', async () => {
  const calls = [];
  let fail = true;

  const collector = createOptionsFlowCollector({
    tickers: ['MSFT'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      if (fail) {
        fail = false;
        throw new Error('temporary failure');
      }
      return { rows: [], next_cursor: 'cursor-ok' };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();
  await collector.runOnce();

  assert.deepEqual(calls, [undefined, undefined]);
});

test('arkistointi saa normalisoidut rivit ja keruu laskee käsitellyt rivit', async () => {
  const archived = [];

  const collector = createOptionsFlowCollector({
    tickers: ['TSLA'],
    maxPages: 1,
    fetchRows: async () => ({
      rows: [{ id: 'one' }, { id: 'two' }],
      next_cursor: null,
    }),
    normalizeRows: payload => payload.rows,
    archiveRows: async rows => archived.push(...rows),
    logger: quietLogger(),
  });

  const result = await collector.runOnce();

  assert.equal(result.processed, 2);
  assert.deepEqual(archived, [{ id: 'one' }, { id: 'two' }]);
});

test('päällekkäinen keruukierros estetään', async () => {
  let release;
  let calls = 0;

  const gate = new Promise(resolve => { release = resolve; });

  const collector = createOptionsFlowCollector({
    tickers: ['AMD'],
    maxPages: 1,
    fetchRows: async () => {
      calls += 1;
      await gate;
      return { rows: [], next_cursor: null };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  const first = collector.runOnce();
  const second = await collector.runOnce();

  assert.equal(second.skipped, true);
  release();
  await first;
  assert.equal(calls, 1);
});


test('DB-virhe säilyttää Options Flow -sivutuskursorin', async () => {
  const calls = [];
  let failArchive = true;

  const collector = createOptionsFlowCollector({
    tickers: ['NVDA'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      return {
        rows: [{ id: 'event-1' }],
        next_cursor: 'cursor-page-2',
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {
      if (failArchive) throw new Error('database write failed');
      return 1;
    },
    logger: quietLogger(),
  });

  await collector.runOnce();
  failArchive = false;
  await collector.runOnce();

  assert.deepEqual(calls, [undefined, undefined]);
});

test('REST-sivutus johtaa seuraavan olderThan-kursorin vanhimmasta rivistä', async () => {
  const calls = [];
  let request = 0;

  const collector = createOptionsFlowCollector({
    tickers: ['NVDA'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      request += 1;
      return {
        rows: request === 1
          ? [
              { timestamp: '2026-08-10T20:10:00.000Z' },
              { timestamp: '2026-08-10T20:05:00.000Z' },
              { timestamp: '2026-08-10T20:08:00.000Z' },
            ]
          : [],
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();
  await collector.runOnce();

  assert.deepEqual(calls, [
    undefined,
    '2026-08-10T20:05:00.000Z',
  ]);
});

test('tyhjä sivu ei luo tekaistua sivutuskursoria', async () => {
  const calls = [];

  const collector = createOptionsFlowCollector({
    tickers: ['AAPL'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      return { rows: [] };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();
  await collector.runOnce();

  assert.deepEqual(calls, [undefined, undefined]);
});

test('virheellinen aikaleima ei siirrä sivutuskursoria', async () => {
  const calls = [];

  const collector = createOptionsFlowCollector({
    tickers: ['MSFT'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      return {
        rows: [{ timestamp: 'not-a-date' }],
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();
  await collector.runOnce();

  assert.deepEqual(calls, [undefined, undefined]);
});

test('Unix-sekuntiaikaleimat muunnetaan ISO-kursoriksi', async () => {
  const calls = [];
  const collector = createOptionsFlowCollector({
    tickers: ['NVDA'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      return {
        rows: calls.length === 1
          ? [{ timestamp: 1791057900 }, { timestamp: 1791057600 }]
          : [],
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();
  await collector.runOnce();

  assert.deepEqual(calls, [
    undefined,
    new Date(1791057600 * 1000).toISOString(),
  ]);
});

test('Unix-millisekuntiaikaleimat muunnetaan ISO-kursoriksi', async () => {
  const calls = [];
  const collector = createOptionsFlowCollector({
    tickers: ['AAPL'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      return {
        rows: calls.length === 1
          ? [{ timestamp: 1791057900000 }, { timestamp: 1791057600000 }]
          : [],
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();
  await collector.runOnce();

  assert.deepEqual(calls, [
    undefined,
    new Date(1791057600000).toISOString(),
  ]);
});

test('ISO-aikaleimoista valitaan vanhin todellinen hetki', async () => {
  const calls = [];
  const collector = createOptionsFlowCollector({
    tickers: ['MSFT'],
    maxPages: 1,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      return {
        rows: calls.length === 1
          ? [
              { timestamp: '2026-10-03T12:10:00.000Z' },
              { timestamp: '2026-10-03T12:05:00.000Z' },
            ]
          : [],
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();
  await collector.runOnce();

  assert.deepEqual(calls, [
    undefined,
    '2026-10-03T12:05:00.000Z',
  ]);
});

test('sama kursoriaikaleima eri esitysmuodossa ei etene uudelleen', async () => {
  const calls = [];
  const cursorIso = new Date(1791057600 * 1000).toISOString();

  const collector = createOptionsFlowCollector({
    tickers: ['AMD'],
    maxPages: 2,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      return {
        rows: [],
        next_cursor: calls.length === 1 ? cursorIso : 1791057600,
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();

  assert.deepEqual(calls, [undefined, cursorIso]);
});

test('toistuva API-kursori pysäyttää keruun eikä aiheuta ikuista sivutusta', async () => {
  const calls = [];
  const repeatedCursor = '2026-11-01T12:00:00.000Z';

  const collector = createOptionsFlowCollector({
    tickers: ['NVDA'],
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      return { rows: [], next_cursor: repeatedCursor };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();

  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [undefined, repeatedCursor]);
});

test('kerääjä ei ylitä kolmea sivua tickeriä kohden yhdellä kierroksella', async () => {
  const calls = [];
  const collector = createOptionsFlowCollector({
    tickers: ['AAPL'],
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      const timestamp = new Date(
        Date.UTC(2026, 10, 1, 12, 0, 0) - calls.length * 60_000
      ).toISOString();

      return {
        rows: [{ timestamp }],
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();

  assert.equal(calls.length, 3);
  assert.equal(calls[0], undefined);
  assert.ok(calls[1]);
  assert.ok(calls[2]);
});

test('sivutus jatkuu seuraavalle sivulle, kun kursori etenee', async () => {
  const calls = [];
  const collector = createOptionsFlowCollector({
    tickers: ['MSFT'],
    maxPages: 3,
    fetchRows: async (_ticker, options) => {
      calls.push(options.olderThan);
      const timestamp = new Date(
        Date.UTC(2026, 10, 2, 12, 0, 0) - calls.length * 60_000
      ).toISOString();

      return {
        rows: [{ timestamp }],
      };
    },
    normalizeRows: payload => payload.rows,
    archiveRows: async () => {},
    logger: quietLogger(),
  });

  await collector.runOnce();

  assert.equal(calls.length, 3);
  assert.equal(calls[0], undefined);
  assert.notEqual(calls[1], calls[2]);
  assert.ok(calls[1]);
  assert.ok(calls[2]);
});
