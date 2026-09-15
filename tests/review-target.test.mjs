import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import {
  parseReviewTarget,
  readReviewTarget,
  threadReviewTarget,
  targetKey,
} from '../lib/artifacts/review-target.ts';

// Exercise the real service and SQLite provider without starting a web server.
const artifactRoot = new URL('../lib/artifacts/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '#artifact-storage')
      return {
        url: new URL('../lib/artifacts/storage-node.ts', import.meta.url).href,
        shortCircuit: true,
      };
    if (
      context.parentURL?.startsWith(artifactRoot) &&
      /^\.\.?\//.test(specifier) &&
      !/\.[^/]+$/.test(specifier)
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.sql?raw'))
      return {
        format: 'module',
        source: `export default ${JSON.stringify(readFileSync(new URL(url.split('?')[0]), 'utf8'))}`,
        shortCircuit: true,
      };
    if (url.startsWith(artifactRoot) && url.endsWith('.ts'))
      return {
        format: 'module',
        source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});
const { commandSchema, targetSchema, emptyTarget } =
  await import('../lib/artifacts/contracts.ts');
const { executeCommand } = await import('../lib/artifacts/service.ts');
const { registerArtifactTools } = await import('../lib/artifacts/mcp.ts');
hooks.deregister();

const element = {
  tag: 'p',
  path: '1.0.2',
  cssPath:
    'html > body:nth-of-type(1) > main:nth-of-type(1) > p:nth-of-type(2)',
  reviewId: 'summary',
  text: 'First phrase. None of the next sentence.',
  label: '',
};
const textTarget = {
  version: 1,
  kind: 'text',
  element,
  text: {
    exact: ' phrase. None of',
    prefix: 'First',
    suffix: ' the next sentence.',
    startOffset: 5,
    endOffset: 21,
  },
};
const point = {
  version: 1,
  x: 10,
  y: 200,
  width: 800,
  relativeX: 0.2,
  relativeY: 0.5,
  path: '1.0.2',
};
const target = (reviewTarget, values = {}) => ({
  ...emptyTarget,
  viewState: { ...values, [targetKey]: JSON.stringify(reviewTarget) },
});

test('element, text, and point evidence round-trips without changing the exact quote', () => {
  for (const value of [
    textTarget,
    { version: 1, kind: 'element', element },
    { version: 1, kind: 'point', element },
    { version: 1, kind: 'point' },
    {
      version: 1,
      kind: 'element',
      element: {
        ...element,
        tag: 'html',
        path: '',
        cssPath: 'html',
        reviewId: null,
      },
    },
  ]) {
    assert.deepEqual(parseReviewTarget(value), value);
    assert.deepEqual(readReviewTarget(JSON.stringify(value)), value);
    assert.deepEqual(
      threadReviewTarget(JSON.stringify(target(value).viewState)),
      value,
    );
    assert.equal(targetSchema.safeParse(target(value)).success, true);
  }
  const spanning = {
    ...textTarget,
    text: {
      exact: ' \nA\tB\nC ',
      prefix: ' ',
      suffix: '\n',
      startOffset: 10,
      endOffset: 18,
    },
  };
  assert.deepEqual(readReviewTarget(JSON.stringify(spanning)), spanning);
  const utf16 = {
    ...textTarget,
    text: {
      exact: 'a\u{1d11e}b',
      prefix: '',
      suffix: '',
      startOffset: 0,
      endOffset: 4,
    },
  };
  assert.deepEqual(parseReviewTarget(utf16), utf16);
  assert.equal(
    parseReviewTarget({ ...utf16, text: { ...utf16.text, endOffset: 3 } }),
    null,
  );
});

test('legacy, malformed, and incompatible target state remains safely readable', () => {
  for (const state of [
    '{}',
    '{"tab":"details"}',
    'null',
    'invalid',
    '{"__oa_target":{}}',
    '{"__oa_target":null}',
  ])
    assert.equal(threadReviewTarget(state), null);
  for (const value of [
    null,
    {},
    '',
    'null',
    '{',
    JSON.stringify({ ...textTarget, version: 2 }),
  ])
    assert.equal(readReviewTarget(value), null);
  for (const value of [
    { ...textTarget, version: 2 },
    { ...textTarget, kind: 'unknown' },
    { ...textTarget, element: undefined },
    { ...textTarget, text: undefined },
    { ...textTarget, kind: 'element' },
    { ...textTarget, kind: 'point' },
    { ...textTarget, extra: true },
    { version: 1, kind: 'element' },
  ]) {
    assert.equal(parseReviewTarget(value), null);
    assert.equal(targetSchema.safeParse(target(value)).success, false);
  }
});

test('visible paragraph breaks survive while optional DOM text matches source offsets', () => {
  const visible = {
    ...textTarget,
    text: {
      exact: 'line.\n\nSecond',
      domExact: 'line.Second',
      prefix: 'First ',
      suffix: ' line.',
      startOffset: 6,
      endOffset: 17,
    },
  };
  assert.deepEqual(parseReviewTarget(visible), visible);
  assert.deepEqual(readReviewTarget(JSON.stringify(visible)), visible);
  assert.deepEqual(
    threadReviewTarget(JSON.stringify(target(visible).viewState)),
    visible,
  );
  assert.equal(targetSchema.safeParse(target(visible)).success, true);
  for (const change of [
    { domExact: '' },
    { domExact: 'x'.repeat(8001), startOffset: 0, endOffset: 8001 },
    { domExact: null },
    { domExact: 11 },
    { endOffset: 19 },
    { exact: '' },
    { exact: 'x'.repeat(8001) },
  ]) {
    assert.equal(
      parseReviewTarget({ ...visible, text: { ...visible.text, ...change } }),
      null,
    );
  }
  const { domExact: _domExact, ...legacyText } = visible.text;
  assert.equal(parseReviewTarget({ ...visible, text: legacyText }), null);
  assert.deepEqual(parseReviewTarget(textTarget), textTarget);
});

test('target metadata validates every bounded field and UTF-16 range', () => {
  for (const change of [
    { tag: '' },
    { tag: '<p>' },
    { tag: 'p'.repeat(65) },
    { path: 'body > p' },
    { path: '1.'.repeat(61) },
    { cssPath: '' },
    { cssPath: 'x'.repeat(2001) },
    { reviewId: '' },
    { reviewId: 'x'.repeat(161) },
    { text: 'x'.repeat(1201) },
    { text: ' untrimmed ' },
    { text: 'two\nlines' },
    { label: 'x'.repeat(301) },
    { extra: true },
  ])
    assert.equal(
      parseReviewTarget({ ...textTarget, element: { ...element, ...change } }),
      null,
    );
  for (const change of [
    { exact: '' },
    { exact: 'x'.repeat(8001), endOffset: 8006 },
    { prefix: 'x'.repeat(201) },
    { suffix: 'x'.repeat(201) },
    { startOffset: -1 },
    { startOffset: 1.5 },
    { startOffset: NaN },
    { endOffset: 5 },
    { endOffset: Infinity },
    { endOffset: 10_000_001 },
    { extra: true },
  ])
    assert.equal(
      parseReviewTarget({
        ...textTarget,
        text: { ...textTarget.text, ...change },
      }),
      null,
    );
  const escaped = {
    ...textTarget,
    text: {
      ...textTarget.text,
      exact: '\u0000'.repeat(4000),
      startOffset: 0,
      endOffset: 4000,
    },
  };
  assert.equal(parseReviewTarget(escaped), null);
  assert.equal(readReviewTarget(JSON.stringify(escaped)), null);
  assert.equal(readReviewTarget(' '.repeat(20_001)), null);
});

test('reserved target evidence fits alongside nineteen controls and point placement', () => {
  const controls = Object.fromEntries(
    Array.from({ length: 19 }, (_, index) => [`control-${index}`, index]),
  );
  const full = target(textTarget, {
    ...controls,
    __oa_point: JSON.stringify(point),
  });
  assert.equal(targetSchema.safeParse(full).success, true);
  assert.equal(
    targetSchema.safeParse({
      ...full,
      viewState: { ...full.viewState, extra: true },
    }).success,
    false,
  );
  assert.equal(
    targetSchema.safeParse(target(textTarget, { control: 'x'.repeat(300) }))
      .success,
    true,
  );
  assert.equal(
    targetSchema.safeParse(target(textTarget, { control: 'x'.repeat(301) }))
      .success,
    false,
  );
  assert.equal(
    targetSchema.safeParse({
      ...emptyTarget,
      viewState: { [targetKey]: textTarget },
    }).success,
    false,
  );
  assert.equal(
    targetSchema.safeParse(target(textTarget, { __oa_point: 'invalid' }))
      .success,
    false,
  );
  const legacy = { ...emptyTarget, viewState: { ...controls, extra: true } };
  assert.equal(targetSchema.safeParse(legacy).success, true);
  assert.equal(threadReviewTarget(JSON.stringify(legacy.viewState)), null);
});

test('service and MCP expose decoded immutable targets, including idempotent and legacy reads', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'open-artifacts-target-test-'));
  const previousDirectory = process.env.OPEN_ARTIFACTS_DATA_DIR;
  process.env.OPEN_ARTIFACTS_DATA_DIR = directory;
  t.after(() => {
    if (previousDirectory === undefined)
      delete process.env.OPEN_ARTIFACTS_DATA_DIR;
    else process.env.OPEN_ARTIFACTS_DATA_DIR = previousDirectory;
    rmSync(directory, { recursive: true, force: true });
  });
  const owner = 'owner@example.invalid';
  const run = (command) => executeCommand(owner, commandSchema.parse(command));
  const published = await run({
    action: 'publish_artifact',
    requestId: crypto.randomUUID(),
    title: 'Synthetic selection fixture',
    html: '<main><p>First phrase. None of the next sentence.</p></main>',
  });
  const command = {
    action: 'add_comment',
    artifactId: published.artifactId,
    revisionId: published.revisionId,
    requestId: crypto.randomUUID(),
    body: 'Inspect this exact phrase.',
    target: target(textTarget, {
      speed: 42,
      __oa_point: JSON.stringify(point),
    }),
  };
  const added = await run(command);
  assert.deepEqual(added.thread.review_target, textTarget);
  assert.equal(added.thread.is_from_earlier_revision, false);
  assert.equal(
    added.thread.view_state_json,
    JSON.stringify(command.target.viewState),
  );
  assert.deepEqual(await run(command), added);
  await assert.rejects(
    run({
      ...command,
      target: target({
        ...textTarget,
        text: { ...textTarget.text, prefix: 'Changed' },
      }),
    }),
    /Request ID already used/,
  );
  const legacy = await run({
    ...command,
    requestId: crypto.randomUUID(),
    target: emptyTarget,
  });
  assert.equal(legacy.thread.review_target, null);

  const tools = new Map();
  registerArtifactTools(
    {
      registerTool(name, definition, callback) {
        tools.set(name, { definition, callback });
      },
    },
    owner,
    'https://artifacts.example.invalid',
  );
  for (const action of ['get_artifact', 'get_review_context']) {
    const definition = tools.get(action);
    assert.match(definition.definition.description, /review_target/);
    const result = await definition.callback({
      artifactId: published.artifactId,
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(
      result.structuredContent.threads[0].review_target,
      textTarget,
    );
    assert.equal(result.structuredContent.threads[1].review_target, null);
    assert.equal(
      result.structuredContent.threads[0].revision_id,
      published.revisionId,
    );
    assert.equal(
      result.structuredContent.threads[0].is_from_earlier_revision,
      false,
    );
    assert.equal(
      result.structuredContent.threads[0].view_state_json,
      added.thread.view_state_json,
    );
    assert.equal(
      result.content[0].text,
      JSON.stringify(result.structuredContent),
    );
    assert.equal(result.structuredContent.html, undefined);
  }

  const revised = await run({
    action: 'publish_artifact',
    requestId: crypto.randomUUID(),
    artifactId: published.artifactId,
    baseRevisionId: published.revisionId,
    title: 'Synthetic selection fixture revised',
    html: '<article><h1>A different layout</h1></article>',
  });
  for (const action of ['get_artifact', 'get_review_context']) {
    const result = await tools.get(action).callback({
      artifactId: published.artifactId,
      ...(action === 'get_artifact'
        ? { revisionId: published.revisionId }
        : {}),
    });
    assert.equal(
      result.structuredContent.artifact.current_revision_id,
      revised.revisionId,
    );
    for (const original of [added.thread, legacy.thread]) {
      const returned = result.structuredContent.threads.find(
        (thread) => thread.id === original.id,
      );
      assert.deepEqual(returned, {
        ...original,
        is_from_earlier_revision: true,
      });
    }
    if (action === 'get_artifact')
      assert.equal(result.structuredContent.revision.id, published.revisionId);
  }
  const retried = await run(command);
  assert.deepEqual(retried.thread, {
    ...added.thread,
    is_from_earlier_revision: true,
  });
  const resolved = await run({
    action: 'set_thread_status',
    threadId: added.thread.id,
    version: added.thread.version,
    status: 'resolved',
  });
  assert.equal(resolved.thread.is_from_earlier_revision, true);
  assert.equal(resolved.thread.revision_id, published.revisionId);
  assert.equal(resolved.thread.view_state_json, added.thread.view_state_json);
  assert.deepEqual(resolved.thread.review_target, textTarget);
  const current = await run({
    ...command,
    requestId: crypto.randomUUID(),
    revisionId: revised.revisionId,
    target: emptyTarget,
  });
  assert.equal(current.thread.is_from_earlier_revision, false);
});

test('area evidence and optional point geometry round-trip under the metadata budget', () => {
  const area = {
    version: 1,
    kind: 'area',
    element: { ...element, tag: 'section' },
    area: {
      rect: { x: 10, y: 20, width: 140, height: 70 },
      viewport: { width: 390, height: 844 },
      container: { width: 360, height: 400 },
      layout: { fingerprint: 'v1:0123456789abcdef', truncated: false },
      members: [
        {
          element,
          rect: { x: -10, y: 10, width: 200, height: 60 },
          coverage: 'partial',
        },
      ],
      truncated: false,
    },
  };
  for (const captured of [
    area,
    { ...area, area: { ...area.area, members: [] } },
    { ...area, area: { ...area.area, members: [], truncated: true } },
    {
      version: 1,
      kind: 'point',
      element,
      geometry: { width: 100, height: 40 },
    },
  ]) {
    assert.deepEqual(parseReviewTarget(captured), captured);
    assert.equal(targetSchema.safeParse(target(captured)).success, true);
    assert.deepEqual(
      threadReviewTarget(JSON.stringify(target(captured).viewState)),
      captured,
    );
  }
  for (const change of [
    { rect: { ...area.area.rect, x: -1 } },
    { rect: { ...area.area.rect, width: 5 } },
    { rect: { ...area.area.rect, height: 5 } },
    { rect: { ...area.area.rect, width: 1000 } },
    { rect: { ...area.area.rect, y: Infinity } },
    { viewport: { width: 0, height: 844 } },
    { container: { width: 360, height: -1 } },
    { layout: { fingerprint: 'invalid', truncated: false } },
    { layout: { fingerprint: 'v1:0123456789abcdef', truncated: 'no' } },
    {
      layout: {
        fingerprint: 'v1:0123456789abcdef',
        truncated: false,
        extra: true,
      },
    },
    { members: Array(9).fill(area.area.members[0]) },
    { members: [{ ...area.area.members[0], coverage: 'unknown' }] },
    { members: [{ ...area.area.members[0], extra: true }] },
    { truncated: undefined },
    { extra: true },
  ])
    assert.equal(
      parseReviewTarget({ ...area, area: { ...area.area, ...change } }),
      null,
    );
  assert.equal(parseReviewTarget({ ...area, area: undefined }), null);
  assert.equal(parseReviewTarget({ ...area, element: undefined }), null);
  assert.equal(
    parseReviewTarget({
      version: 1,
      kind: 'point',
      element,
      geometry: { width: 0, height: 10 },
    }),
    null,
  );
  const oversized = {
    ...area,
    area: {
      ...area.area,
      members: Array(8).fill({
        ...area.area.members[0],
        element: {
          ...element,
          text: 'x'.repeat(1200),
          cssPath: 'p'.repeat(2000),
        },
      }),
    },
  };
  assert.equal(parseReviewTarget(oversized), null);
});
