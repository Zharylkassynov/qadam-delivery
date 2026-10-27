import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startWorker } from '../backend/worker';

async function until(condition: () => boolean) {
  for (let i = 0; i < 200; i++) { if (condition()) return; await delay(5); }
  assert.fail('Worker did not make progress');
}

test('persistent worker never overlaps batches and stop waits for the active batch', async () => {
  let calls = 0, release!: () => void, stopped = false;
  const stop = startWorker(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); }, 5);
  await until(() => calls === 1);
  await delay(25);
  assert.equal(calls, 1);
  const stopping = stop().then(() => { stopped = true; });
  await delay(10); assert.equal(stopped, false);
  release(); await stopping;
  await delay(20); assert.equal(calls, 1);
});

test('persistent worker retries failures without exposing errors and resumes queued work after restart', async () => {
  let attempts = 0, errors = 0;
  const pending = ['first', 'second'];
  const sent: string[] = [];
  const run = async () => {
    attempts++;
    if (attempts === 1) throw new Error('synthetic private transport details');
    const message = pending.shift(); if (message) sent.push(message);
  };
  const stop = startWorker(run, 5, () => { errors++; });
  await until(() => sent.length === 2);
  await stop();
  assert.equal(errors, 1);
  pending.push('after-restart');
  const stopRestarted = startWorker(run, 5);
  await until(() => sent.length === 3);
  await stopRestarted();
  assert.deepEqual(sent, ['first', 'second', 'after-restart']);
});
