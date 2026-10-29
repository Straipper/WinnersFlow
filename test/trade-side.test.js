import test from 'node:test';
import assert from 'node:assert/strict';
import { inferTradeSide } from '../src/services/tradeSide.js';

test('kauppa ask-hinnassa tai sen yläpuolella tulkitaan ostoksi', () => {
  assert.equal(inferTradeSide(101, 99, 101), 'buy');
  assert.equal(inferTradeSide(102, 99, 101), 'buy');
});

test('kauppa bid-hinnassa tai sen alapuolella tulkitaan myynniksi', () => {
  assert.equal(inferTradeSide(99, 99, 101), 'sell');
  assert.equal(inferTradeSide(98, 99, 101), 'sell');
});

test('spreadin sisällä suuntaa ei päätellä', () => {
  assert.equal(inferTradeSide(100, 99, 101), null);
});

test('puuttuva bid tai ask ei aiheuta virhettä', () => {
  assert.equal(inferTradeSide(100, null, 101), null);
  assert.equal(inferTradeSide(99, 99, null), 'sell');
  assert.equal(inferTradeSide(100, null, null), null);
});
