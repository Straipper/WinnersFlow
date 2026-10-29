import test from 'node:test';
import assert from 'node:assert/strict';
import { createReconnectScheduler } from '../src/services/upstreamReconnect.js';

function fakeTimers() {
  let id = 0;
  const jobs = new Map();
  return {
    jobs,
    setTimer(fn, delay) {
      const key = id++;
      jobs.set(key, { fn, delay });
      return key;
    },
    clearTimer(key) {
      jobs.delete(key);
    },
    fire(key) {
      const job = jobs.get(key);
      assert.ok(job);
      jobs.delete(key);
      job.fn();
    },
  };
}

test('estää päällekkäiset ajastukset', () => {
  const clock = fakeTimers();
  let calls = 0;
  const scheduler = createReconnectScheduler(
    () => calls++,
    clock.setTimer.bind(clock),
    clock.clearTimer.bind(clock),
  );
  assert.equal(scheduler.schedule(3000), true);
  assert.equal(scheduler.schedule(5000), false);
  assert.equal(clock.jobs.size, 1);
  assert.equal(clock.jobs.get(0).delay, 3000);
  assert.equal(calls, 0);
});

test('vapauttaa ajastimen ennen yhteysyritystä', () => {
  const clock = fakeTimers();
  let scheduler;
  let calls = 0;
  scheduler = createReconnectScheduler(() => {
    calls++;
    assert.equal(scheduler.pending, false);
  }, clock.setTimer.bind(clock), clock.clearTimer.bind(clock));

  scheduler.schedule(3000);
  clock.fire(0);
  assert.equal(calls, 1);
  assert.equal(scheduler.schedule(5000), true);
  assert.equal(clock.jobs.get(1).delay, 5000);
});

test('peruu odottavan ajastimen', () => {
  const clock = fakeTimers();
  let calls = 0;
  const scheduler = createReconnectScheduler(
    () => calls++,
    clock.setTimer.bind(clock),
    clock.clearTimer.bind(clock),
  );
  scheduler.schedule(3000);
  assert.equal(scheduler.cancel(), true);
  assert.equal(scheduler.cancel(), false);
  assert.equal(scheduler.pending, false);
  assert.equal(clock.jobs.size, 0);
  assert.equal(calls, 0);
});
