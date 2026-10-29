import test from 'node:test';
import assert from 'node:assert/strict';
import { isFreshMarketTimestamp, isFutureMarketTimestamp } from '../src/services/marketTimestamp.js';

test('hyväksyy nykyhetken ja tuoreen aikaleiman', () => {
  assert.equal(isFreshMarketTimestamp(100_000, 100_000), true);
  assert.equal(isFreshMarketTimestamp(40_000, 100_000), true);
  assert.equal(isFreshMarketTimestamp(100_001, 100_000), false);
});

test('hylkää yli 60 sekuntia vanhan aikaleiman', () => {
  assert.equal(isFreshMarketTimestamp(39_999, 100_000), false);
});

test('hylkää virheelliset aikaleimat', () => {
  assert.equal(isFreshMarketTimestamp(NaN, 100_000), false);
  assert.equal(isFreshMarketTimestamp(Infinity, 100_000), false);
  assert.equal(isFreshMarketTimestamp(100_000, NaN), false);
});

test('tulevaisuuden aikaleiman kahden sekunnin toleranssi', () => {
  const now = 1_800_000_000_000;
  assert.equal(isFutureMarketTimestamp(now, now), false);
  assert.equal(isFutureMarketTimestamp(now + 2000, now), false);
  assert.equal(isFutureMarketTimestamp(now + 2001, now), true);
  assert.equal(isFutureMarketTimestamp(NaN, now), true);
});
