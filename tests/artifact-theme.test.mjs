import assert from 'node:assert/strict';
import test from 'node:test';
import { readFrameTheme } from '../lib/artifacts/theme.ts';

test('artifact backgrounds select readable browser color schemes', () => {
  assert.deepEqual(readFrameTheme('#0A0A0A'), {
    color: '#0a0a0a',
    scheme: 'dark',
  });
  assert.deepEqual(readFrameTheme('#ffffff'), {
    color: '#ffffff',
    scheme: 'light',
  });
  assert.equal(readFrameTheme('#0000ff').scheme, 'dark');
  assert.equal(readFrameTheme('#ffff00').scheme, 'light');
});

test('sandbox theme reports cannot inject CSS, URLs, or translucent colors', () => {
  for (const value of [
    null,
    {},
    ['#ffffff'],
    '#fff',
    '#ffffff00',
    'red',
    'url(https://example.com)',
    '#ffffff;display:none',
    '#ffffff\n',
    'x'.repeat(10000),
  ]) {
    assert.equal(readFrameTheme(value), null);
  }
});
