import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterDelayedRows,
  DEFAULT_DELAY_MS,
} from '../src/services/delayedFlow.js';

const now = Date.parse('2026-11-03T12:00:00.000Z');
const cutoff = now - DEFAULT_DELAY_MS;

test('hyväksyy täsmälleen 120 tuntia vanhan tapahtuman', () => {
  const rows = [{ id: 'boundary', timestamp: new Date(cutoff).toISOString() }];

  assert.deepEqual(
    filterDelayedRows(rows, { now }),
    rows
  );
});

test('hylkää tapahtuman, joka on sekunninkin liian tuore', () => {
  const rows = [
    { id: 'too-new', timestamp: new Date(cutoff + 1000).toISOString() },
  ];

  assert.deepEqual(filterDelayedRows(rows, { now }), []);
});

test('hylkää tulevaisuuden tapahtumat', () => {
  const rows = [
    { id: 'future', timestamp: new Date(now + 1000).toISOString() },
  ];

  assert.deepEqual(filterDelayedRows(rows, { now }), []);
});

test('hylkää puuttuvat ja virheelliset aikaleimat', () => {
  const rows = [
    { id: 'missing' },
    { id: 'null', timestamp: null },
    { id: 'invalid', timestamp: 'not-a-date' },
    { id: 'empty', timestamp: '' },
  ];

  assert.deepEqual(filterDelayedRows(rows, { now }), []);
});

test('käsittelee myös numeeriset millisekuntiaikaleimat', () => {
  const rows = [
    { id: 'old', timestamp: cutoff - 1000 },
    { id: 'new', timestamp: cutoff + 1000 },
  ];

  assert.deepEqual(
    filterDelayedRows(rows, { now }).map(row => row.id),
    ['old']
  );
});

test('palauttaa tyhjän taulukon, jos syöte ei ole taulukko', () => {
  assert.deepEqual(filterDelayedRows(null, { now }), []);
  assert.deepEqual(filterDelayedRows(undefined, { now }), []);
});

test('hylkää virheellisen aikakonfiguraation', () => {
  assert.throws(
    () => filterDelayedRows([], { now: NaN }),
    TypeError
  );

  assert.throws(
    () => filterDelayedRows([], { now, delayMs: -1 }),
    TypeError
  );
});
