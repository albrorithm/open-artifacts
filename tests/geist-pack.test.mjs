import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  packGeistSource,
  prepareGeistPublication,
  unpackGeistArtifact,
} from '../lib/artifacts/geist-pack.ts';

const assets = {
  sans: 'data:font/woff2;base64,sans',
  mono: 'data:font/woff2;base64,mono',
  css: ':root{--font-sans:Geist}',
  license: 'SIL Open Font License',
};
const source =
  '<!doctype html>\n<style id="oa-foundation"></style>\n<main>source</main>';

test('prepares only an empty foundation and preserves other source byte exact', () => {
  assert.equal(
    prepareGeistPublication(source, assets),
    packGeistSource(source, assets),
  );
  const packed = packGeistSource(source, assets);
  assert.equal(prepareGeistPublication(packed, assets), packed);
  const custom = source.replace(
    '<style id="oa-foundation"></style>',
    '<style id="oa-foundation">custom</style>',
  );
  assert.equal(prepareGeistPublication(custom, assets), custom);
  const noSlot = '<main data-review-id="main">plain</main>';
  assert.equal(prepareGeistPublication(noSlot, assets), noSlot);
});

test('packs and restores the exact editable foundation slot', () => {
  const packed = packGeistSource(source, assets);
  assert.match(packed, /data:font\/woff2;base64,sans/);
  assert.equal(unpackGeistArtifact(packed, assets), source);
});

test('ignores fake slots in comments and scripts', () => {
  const authored =
    '<!-- <style id="oa-foundation"></style> --><script>const x = "<style id=\\"oa-foundation\\"></style>";</script>' +
    source;
  assert.equal(
    unpackGeistArtifact(packGeistSource(authored, assets), assets),
    authored,
  );
});

test('rejects duplicate, nonempty, malformed, and already-custom foundations', () => {
  for (const value of [
    source + '<style id="oa-foundation"></style>',
    source.replace('</style>', 'custom</style>'),
    source.replace(
      '<style id="oa-foundation"></style>',
      '<style id="oa-foundation">',
    ),
  ]) {
    assert.throws(() => packGeistSource(value, assets));
  }
  const custom = source.replace(
    '<style id="oa-foundation"></style>',
    '<style id="oa-foundation">custom</style>',
  );
  assert.throws(
    () => unpackGeistArtifact(custom, assets),
    /unknown or custom foundation/,
  );
});

test('rejects fake slots in quoted attributes, raw text, and whitespace comments', () => {
  const fake = ` <div data-value="<style id='oa-foundation'></style>"></div>
<!-- <style id="oa-foundation"></style> -->
<textarea><style id="oa-foundation"></style></textarea>
<title><style id="oa-foundation"></style></title>
<style id="oa-foundation"></style>`;
  assert.equal(
    unpackGeistArtifact(packGeistSource(fake, assets), assets),
    fake,
  );
  assert.throws(
    () =>
      packGeistSource(
        '<style id="oa-foundation" data-x="1" id="other"></style>',
        assets,
      ),
    /exactly one id/,
  );
});

test('matches the Python packer byte for byte and restores its output', () => {
  const root = resolve(new URL('..', import.meta.url).pathname);
  const directory = mkdtempSync(join(tmpdir(), 'open-artifacts-geist-'));
  const input = join(directory, 'source.html');
  const output = join(directory, 'packed.html');
  const pythonSource =
    '<!doctype html>\n<html lang="en"><head><meta name="viewport" content="width=device-width"><title>Compat</title><style id="oa-foundation"></style></head><body><main data-review-id="main">Source</main></body></html>';
  writeFileSync(input, pythonSource);
  const python = spawnSync(
    'python3',
    [
      join(root, 'plugins/open-artifacts/scripts/artifact.py'),
      'pack',
      input,
      output,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(python.status, 0, python.stderr);
  const packed = readFileSync(output, 'utf8');
  const actualAssets = {
    sans: `data:font/woff2;base64,${readFileSync(join(root, 'plugins/open-artifacts/assets/Geist-Variable.woff2')).toString('base64')}`,
    mono: `data:font/woff2;base64,${readFileSync(join(root, 'plugins/open-artifacts/assets/GeistMono-Variable.woff2')).toString('base64')}`,
    css: readFileSync(
      join(root, 'plugins/open-artifacts/assets/geist-foundation.css'),
      'utf8',
    ),
    license: readFileSync(
      join(root, 'plugins/open-artifacts/assets/OFL.txt'),
      'utf8',
    ),
  };
  assert.equal(packGeistSource(pythonSource, actualAssets), packed);
  assert.equal(unpackGeistArtifact(packed, actualAssets), pythonSource);
  rmSync(directory, { recursive: true, force: true });
});
