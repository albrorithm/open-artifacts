import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readPoint, threadPoint } from '../lib/artifacts/point.ts';
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './selection' && context.parentURL?.endsWith('/frame.ts'))
      return nextResolve('./selection.ts', context);
    return nextResolve(specifier, context);
  },
});
const { reviewStateValue } = await import('../lib/artifacts/frame.ts');
hooks.deregister();

const point = {
  version: 1,
  x: 0,
  y: 2400,
  width: 390,
  relativeX: 0,
  relativeY: 1,
  path: '1.0.2',
};

test('blank-space and edge points survive immutable view-state storage', () => {
  assert.deepEqual(
    threadPoint(JSON.stringify({ __oa_point: JSON.stringify(point) })),
    point,
  );
});

test('legacy and malformed review state does not create phantom pins', () => {
  for (const state of [
    '{}',
    '{"tab":"details"}',
    'null',
    'invalid',
    '{"__oa_point":{}}',
  ]) {
    assert.equal(threadPoint(state), null);
  }
});

test('untrusted placement metadata stays bounded and versioned', () => {
  for (const change of [
    { version: 2 },
    { x: -1 },
    { y: 10_000_001 },
    { width: 0 },
    { relativeX: 1.1 },
    { relativeY: -0.1 },
    { path: 'body > script' },
    { path: '1.'.repeat(100) },
    { extra: true },
  ]) {
    assert.equal(readPoint(JSON.stringify({ ...point, ...change })), null);
  }
  assert.equal(readPoint('x'.repeat(301)), null);
});

test('review state keeps radio selection and excludes passwords', () => {
  assert.equal(
    reviewStateValue({ type: 'radio', value: 'duration', checked: true }),
    true,
  );
  assert.equal(
    reviewStateValue({ type: 'radio', value: 'duration', checked: false }),
    false,
  );
  assert.equal(
    reviewStateValue({ type: 'checkbox', value: 'on', checked: true }),
    true,
  );
  assert.equal(
    reviewStateValue({ type: 'text', value: '  note  ', checked: false }),
    'note',
  );
  assert.equal(
    reviewStateValue({ type: 'password', value: 'secret', checked: false }),
    null,
  );
});
