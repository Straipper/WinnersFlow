import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serverPath = new URL('../src/server.js', import.meta.url);
const routePath = new URL('../src/routes/publicFlowFeed.js', import.meta.url);
const collectorPath = new URL('../src/services/optionsFlowCollector.js', import.meta.url);

test('server tuo Options Flow -kerääjän ES-moduulina', async () => {
  const source = await readFile(serverPath, 'utf8');
  assert.match(source, /import\s*\{\s*startOptionsFlowCollector\s*,\s*stopOptionsFlowCollector\s*\}\s*from\s*['"]\.\/services\/optionsFlowCollector\.js['"]/);
});

test('kerääjä käynnistyy live-marketin käynnistyksen jälkeen', async () => {
  const source = await readFile(serverPath, 'utf8');
  const live = source.indexOf('attachLiveMarket(server)');
  const start = source.indexOf('startOptionsFlowCollector()');
  assert.notEqual(live, -1, 'attachLiveMarket puuttuu');
  assert.notEqual(start, -1, 'kerääjän käynnistys puuttuu');
  assert.ok(start > live, 'kerääjä käynnistyy ennen live-marketia');
});

test('kerääjä pysäytetään palvelimen sammutuksessa', async () => {
  const source = await readFile(serverPath, 'utf8');
  const stop = source.indexOf('stopOptionsFlowCollector()');
  const close = source.indexOf('closeLiveMarket()');
  assert.notEqual(stop, -1, 'kerääjän pysäytys puuttuu');
  assert.notEqual(close, -1, 'live-marketin pysäytys puuttuu');
  assert.ok(stop > 0 && stop < close, 'kerääjä pitää pysäyttää ennen live-marketia');
});

test('julkinen flow-feed reitti sisältää Options Flow -endpointin', async () => {
  const source = await readFile(routePath, 'utf8');
  assert.match(source, /options-flow/);
  assert.match(source, /getDelayedOptionsFlow/);
});

test('serveri rekisteröi julkisen flow-feed routerin', async () => {
  const source = await readFile(serverPath, 'utf8');
  assert.match(source, /createPublicFlowFeedRouter/);
  assert.match(source, /\/api\/public\/flow-feed/);
});

test('kerääjä käyttää vain hyväksyttyä ticker-listaa ja premium-rajaa', async () => {
  const source = await readFile(collectorPath, 'utf8');
  for (const ticker of ['NVDA', 'AAPL', 'MSFT', 'AMD', 'TSLA', 'META']) {
    assert.ok(source.includes(ticker), `Ticker puuttuu: ${ticker}`);
  }
  assert.match(source, /MIN_PREMIUM\s*=\s*100001/);
  assert.match(source, /MAX_PAGES_PER_TICKER\s*=\s*3/);
});
