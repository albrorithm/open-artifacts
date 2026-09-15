import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve, join } from 'node:path';
import ts from 'typescript';

const outputDirectory = process.argv[2];
if (!outputDirectory)
  throw new Error(
    'Usage: node tests/review-area-bridge.browser.mjs /path/to/private-output',
  );

const artifactRoot = new URL('../lib/artifacts/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(artifactRoot) &&
      /^\.\.?\//.test(specifier) &&
      !/\.[^/]+$/.test(specifier)
    )
      return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
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
const { frameDocument } = await import('../lib/artifacts/frame.ts');
hooks.deregister();

// Fixture-owned controls communicate through a separate test-only message.
// They dispatch synthetic events; the bridge itself is the production bridge.
function fixtureControls() {
  const settle = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  window.addEventListener('message', async (event) => {
    if (event.source !== parent || event.data?.type !== 'fixture-command')
      return;
    const { id, operation } = event.data;
    let value;
    try {
      if (operation.type === 'pointer') {
        // A captured pointer may report the viewport boundary after leaving
        // the hit element. Keep that coordinate while finding its event target.
        const hit = document.elementFromPoint(
          Math.max(0, Math.min(innerWidth - 1, operation.x)),
          Math.max(0, Math.min(innerHeight - 1, operation.y)),
        );
        if (!hit) throw new Error('No fixture element at pointer coordinates');
        const dispatched = new PointerEvent(operation.name, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: operation.pointerType ?? 'mouse',
          isPrimary: true,
          button: 0,
          buttons: operation.name === 'pointerup' ? 0 : 1,
          clientX: operation.x,
          clientY: operation.y,
        });
        hit.dispatchEvent(dispatched);
        value = {
          defaultPrevented: dispatched.defaultPrevented,
          hit: hit.id || hit.tagName.toLowerCase(),
        };
      } else if (operation.type === 'click') {
        document.elementFromPoint(operation.x, operation.y).dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: operation.x,
            clientY: operation.y,
          }),
        );
      } else if (operation.type === 'key') {
        (document.getElementById(operation.target) ?? document).dispatchEvent(
          new KeyboardEvent('keydown', {
            key: operation.key,
            shiftKey: operation.shiftKey === true,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else if (operation.type === 'blur') {
        window.dispatchEvent(new Event('blur'));
      } else if (operation.type === 'wrap-page') {
        const page = document.querySelector('main');
        const outer = document.createElement('div');
        const inner = document.createElement('article');
        outer.id = 'outer-page';
        inner.id = 'inner-page';
        outer.setAttribute('data-review-id', 'outer-page');
        inner.setAttribute('data-review-id', 'inner-page');
        page.before(outer);
        outer.append(inner);
        inner.append(page);
      } else if (operation.type === 'selection') {
        const text = document.getElementById('subject').firstChild;
        const range = document.createRange();
        range.setStart(text, operation.start);
        range.setEnd(text, operation.end);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        value = getSelection().toString();
      } else if (operation.type === 'mutate') {
        const node = document.getElementById(operation.id);
        if (operation.remove) node.remove();
        else if ('text' in operation) node.textContent = operation.text;
        else if ('hidden' in operation) node.hidden = operation.hidden;
        else if ('height' in operation)
          node.style.height = `${operation.height}px`;
      } else if (operation.type !== 'inspect')
        throw new Error('Unknown fixture operation');
      await settle();
      parent.postMessage(
        {
          type: 'fixture-result',
          id,
          value,
          state: {
            areaMode: document.documentElement.hasAttribute('data-oa-area'),
            touchAction: getComputedStyle(document.documentElement).touchAction,
            selection: getSelection().toString(),
            selectedElements:
              document.querySelectorAll('[data-oa-selected]').length,
            pageTabStops: document.querySelectorAll(
              'main[data-oa-tab],#outer-page[data-oa-tab],#inner-page[data-oa-tab]',
            ).length,
            pageButtons: [...document.querySelectorAll('[data-oa-ui]')].filter(
              (node) => node.textContent === 'Comment on this page',
            ).length,
            hoverOutlines: [
              ...document.querySelectorAll('[data-oa-ui]'),
            ].filter(
              (node) =>
                node.style.borderStyle === 'solid' &&
                getComputedStyle(node).display !== 'none',
            ).length,
            areaOutlines: [...document.querySelectorAll('[data-oa-ui]')].filter(
              (node) =>
                node.style.borderStyle === 'dashed' &&
                getComputedStyle(node).display !== 'none',
            ).length,
          },
        },
        '*',
      );
    } catch (error) {
      parent.postMessage(
        { type: 'fixture-result', id, error: String(error) },
        '*',
      );
    }
  });
}

const fixture = `<style>html,body{margin:0;background:#fff;color:#111;font:16px/20px sans-serif}main{position:relative;margin:20px;width:760px;height:540px}#subject{position:absolute;left:24px;top:24px;width:640px;height:80px;margin:0}#control{position:absolute;left:24px;top:150px;width:100px;height:30px}#graphic{position:absolute;left:160px;top:150px;width:100px;height:40px}#blank{position:absolute;left:24px;top:240px;width:640px;height:240px}</style><main data-review-id="fixture"><p id="subject" data-review-id="subject">Bridge target text.</p><button id="control">Fixture button</button><canvas id="graphic" aria-label="Synthetic graphic"></canvas><div id="blank" data-review-id="blank"></div></main><script>(${fixtureControls.toString()})()</script>`;
const token = 'synthetic-area-bridge-fixture';
const frame = frameDocument(fixture, token);

async function runBridgeChecks(frameHtml, frameToken) {
  const results = [];
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const equal = (actual, expected, message = 'Values differ') => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = async (name, run) => {
    const reports = [];
    const operations = [];
    const iframe = document.createElement('iframe');
    iframe.title = 'Synthetic bridge fixture';
    iframe.sandbox = 'allow-scripts';
    iframe.style.cssText = 'display:block;width:800px;height:600px;border:0';
    const channel = new MessageChannel();
    const pending = new Map();
    const result = { name, passed: false, operations, reports };
    let serial = 0;
    const receive = (event) => {
      if (
        event.source !== iframe.contentWindow ||
        event.data?.type !== 'fixture-result'
      )
        return;
      const job = pending.get(event.data.id);
      if (!job) return;
      clearTimeout(job.timeout);
      pending.delete(event.data.id);
      if (event.data.error) job.reject(new Error(event.data.error));
      else job.resolve(event.data);
    };
    window.addEventListener('message', receive);
    channel.port1.onmessage = (event) => reports.push(event.data);
    const waitFor = async (predicate, message) => {
      for (let count = 0; count < 100; count++) {
        const found = reports.find(predicate);
        if (found) return found;
        await pause(20);
      }
      throw new Error(message);
    };
    const command = (operation) => {
      operations.push(operation);
      return new Promise((resolve, reject) => {
        const id = ++serial;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Fixture command timed out: ${operation.type}`));
        }, 2000);
        pending.set(id, { resolve, reject, timeout });
        iframe.contentWindow.postMessage(
          { type: 'fixture-command', id, operation },
          '*',
        );
      });
    };
    const send = (message) => {
      operations.push({ host: message });
      channel.port1.postMessage(message);
    };
    const mode = async (areaMode = false, commenting = true) => {
      send({ type: 'mode', commenting, areaMode });
      return command({ type: 'inspect' });
    };
    const pointer = (name, x, y, pointerType = 'mouse') =>
      command({ type: 'pointer', name, x, y, pointerType });
    const drag = async (start, end, pointerType = 'mouse', click = true) => {
      await pointer('pointerdown', ...start, pointerType);
      await pointer('pointermove', ...end, pointerType);
      await pointer('pointerup', ...end, pointerType);
      if (click) await command({ type: 'click', x: end[0], y: end[1] });
    };
    const targets = () => reports.filter((report) => report.type === 'target');
    const captured = () =>
      JSON.parse(targets().at(-1)?.viewState.__oa_target ?? 'null');
    const pin = (id = 'fixture-pin', overrides = {}) => {
      const report = targets().at(-1);
      return {
        id,
        anchorId: report.anchorId,
        point: JSON.parse(report.viewState.__oa_point),
        context: report.excerpt,
        target: captured(),
        ...overrides,
      };
    };
    const placements = async (
      pins,
      generation = 1,
      revisionId = 'revision-a',
    ) => {
      send({ type: 'pins', pins, generation, revisionId });
      const resolutions = await waitFor(
        (report) =>
          report.type === 'resolutions' && report.generation === generation,
        'No resolution report',
      );
      const positions = await waitFor(
        (report) =>
          report.type === 'positions' && report.generation === generation,
        'No position report',
      );
      return { resolutions, positions };
    };
    try {
      const loaded = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Fixture did not load')),
          3000,
        );
        iframe.addEventListener(
          'load',
          () => {
            clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });
      iframe.srcdoc = frameHtml;
      document.getElementById('fixture').appendChild(iframe);
      await loaded;
      iframe.contentWindow.postMessage(
        { type: 'oa-connect', token: frameToken },
        '*',
        [channel.port2],
      );
      await waitFor(
        (report) => report.type === 'inventory',
        'Bridge did not connect',
      );
      await mode();
      result.observed = await run({
        reports,
        command,
        send,
        mode,
        pointer,
        drag,
        targets,
        captured,
        pin,
        placements,
        waitFor,
      });
      result.passed = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      for (const job of pending.values()) clearTimeout(job.timeout);
      window.removeEventListener('message', receive);
      channel.port1.close();
      channel.port2.close();
      iframe.remove();
      results.push(result);
      document.getElementById('summary').textContent =
        `${results.length} checks completed…`;
    }
  };

  await check(
    'Page backgrounds and the main wrapper do not highlight or create click drafts',
    async (h) => {
      for (const point of [
        [2, 2],
        [30, 30],
      ]) {
        const hover = await h.pointer('pointermove', ...point);
        equal(hover.state.hoverOutlines, 0);
        equal(hover.state.pageTabStops, 0);
        equal(hover.state.pageButtons, 0);
        await h.drag(point, [point[0] + 2, point[1] + 2]);
        await h.command({ type: 'click', x: point[0], y: point[1] });
        equal(h.targets().length, 0);
      }
      const hover = await h.pointer('pointermove', 48, 50);
      equal(hover.state.hoverOutlines, 1, 'Content must still highlight');
      await h.command({ type: 'click', x: 48, y: 50 });
      equal(h.targets().length, 1);
      equal(h.captured().element.reviewId, 'subject');
      return h.captured();
    },
  );
  await check(
    'Nested whole-page wrappers are excluded from keyboard comment targets',
    async (h) => {
      await h.mode(false, false);
      await h.command({ type: 'wrap-page' });
      const state = await h.mode();
      equal(state.state.pageTabStops, 0);
      for (const target of ['outer-page', 'inner-page'])
        await h.command({ type: 'key', key: 'Enter', target });
      equal(h.targets().length, 0);
      await h.command({ type: 'key', key: 'Enter', target: 'subject' });
      equal(h.targets().length, 1);
      equal(h.captured().element.reviewId, 'subject');
      return h.captured();
    },
  );
  await check(
    'Dragging from a suppressed page background still creates an area',
    async (h) => {
      await h.drag([2, 2], [16, 16]);
      equal(h.targets().length, 1);
      equal(h.captured().kind, 'area');
      equal(h.captured().area.members.length, 0);
      await h.drag([30, 30], [200, 140]);
      equal(h.targets().length, 2);
      equal(h.captured().kind, 'area');
      assert(h.captured().area.members.length > 0, 'Expected covered content');
      return h.captured();
    },
  );
  await check(
    'Blank part of a paragraph starts one area draft, including the following click',
    async (h) => {
      await h.drag([450, 70], [620, 110]);
      equal(h.targets().length, 1, 'Duplicate or absent draft');
      equal(h.captured().kind, 'area');
      equal(h.captured().area.rect.width, 170);
      equal(h.captured().area.rect.height, 40);
      return h.captured();
    },
  );
  await check(
    'Reverse-direction drag preserves positive dimensions',
    async (h) => {
      await h.drag([650, 460], [470, 340]);
      equal(h.targets().length, 1);
      equal(h.captured().kind, 'area');
      equal(h.captured().area.rect.width, 180);
      equal(h.captured().area.rect.height, 120);
      return h.captured();
    },
  );
  await check(
    'Explicit areas reject a narrow side and accept exactly six by six',
    async (h) => {
      await h.mode(true);
      await h.drag([480, 330], [485, 342]);
      equal(h.targets().length, 0);
      assert(
        h.reports.some(
          (report) =>
            report.type === 'selection-error' && /6 by 6/.test(report.message),
        ),
        'Missing minimum-size error',
      );
      await h.drag([480, 330], [486, 336]);
      equal(h.targets().length, 1);
      equal(
        [h.captured().area.rect.width, h.captured().area.rect.height],
        [6, 6],
      );
    },
  );
  await check(
    'Mouse jitter remains a single element or point click',
    async (h) => {
      await h.drag([480, 330], [483, 333]);
      equal(h.targets().length, 1);
      assert(
        ['element', 'point'].includes(h.captured().kind),
        'Jitter became an area',
      );
      return h.captured();
    },
  );
  await check(
    'Pointer cancellation, Escape and leaving comment mode abandon drafts',
    async (h) => {
      for (const cancellation of ['pointercancel', 'Escape', 'mode']) {
        await h.mode(true);
        await h.pointer('pointerdown', 480, 330);
        await h.pointer('pointermove', 600, 420);
        if (cancellation === 'pointercancel')
          await h.pointer('pointercancel', 600, 420);
        else if (cancellation === 'Escape')
          await h.command({ type: 'key', key: 'Escape' });
        else await h.mode(false, false);
        equal(h.targets().length, 0);
        const inspected = await h.command({ type: 'inspect' });
        equal(inspected.state.areaOutlines, 0);
        equal(inspected.state.areaMode, false);
      }
      assert(
        h.reports.some((report) => report.type === 'area-mode-end'),
        'Area cancellation did not notify host',
      );
    },
  );
  await check(
    'Escape consumes the canceled drag release and following click',
    async (h) => {
      for (const explicit of [false, true]) {
        await h.mode(explicit);
        await h.pointer('pointerdown', 480, 330);
        await h.pointer('pointermove', 600, 420);
        await h.command({ type: 'key', key: 'Escape' });
        await h.pointer('pointerup', 600, 420);
        const released = await h.command({ type: 'click', x: 600, y: 420 });
        equal(h.targets().length, 0, 'Canceled drag opened a draft on release');
        equal(released.state.areaOutlines, 0);
        equal(released.state.areaMode, false);
      }
    },
  );
  await check(
    'Blur consumes the canceled drag release and following click',
    async (h) => {
      for (const explicit of [false, true]) {
        await h.mode(explicit);
        await h.pointer('pointerdown', 480, 330);
        await h.pointer('pointermove', 600, 420);
        await h.command({ type: 'blur' });
        await h.pointer('pointerup', 600, 420);
        const released = await h.command({ type: 'click', x: 600, y: 420 });
        equal(h.targets().length, 0, 'Blurred drag opened a draft on release');
        equal(released.state.areaOutlines, 0);
        equal(released.state.areaMode, false);
      }
    },
  );
  await check(
    'An area ending at the viewport edge keeps its draft pin inside',
    async (h) => {
      await h.mode(true);
      await h.drag([640, 330], [800, 420], 'mouse', false);
      equal(h.targets().length, 1);
      const captured = h.captured();
      equal(captured.kind, 'area');
      equal(captured.area.rect.width, 160);
      const position = h.targets()[0].position;
      equal(position.x, captured.area.viewport.width - 1);
      assert(position.x >= 0, 'Draft pin is outside the left edge');
      assert(
        position.y >= 0 && position.y < captured.area.viewport.height,
        'Draft pin is outside the vertical viewport',
      );
      return { captured, position };
    },
  );
  await check(
    'Touch keeps scrolling available until explicit area mode',
    async (h) => {
      const ordinary = await h.pointer('pointerdown', 480, 330, 'touch');
      equal(ordinary.value.defaultPrevented, false);
      equal(ordinary.state.touchAction, 'auto');
      await h.pointer('pointercancel', 480, 330, 'touch');
      const explicit = await h.mode(true);
      equal(explicit.state.touchAction, 'none');
      const start = await h.pointer('pointerdown', 480, 330, 'touch');
      equal(start.value.defaultPrevented, true);
      await h.pointer('pointermove', 600, 420, 'touch');
      await h.pointer('pointerup', 600, 420, 'touch');
      equal(h.captured().kind, 'area');
      const ended = await h.command({ type: 'inspect' });
      equal(ended.state.touchAction, 'auto');
      equal(ended.state.areaMode, false);
      return {
        ordinary: ordinary.state,
        explicit: explicit.state,
        ended: ended.state,
      };
    },
  );
  await check(
    'Keyboard Enter fixes each corner and arrows size the area',
    async (h) => {
      await h.mode(true);
      for (const key of [
        'Enter',
        'ArrowRight',
        'ArrowRight',
        'ArrowRight',
        'ArrowDown',
        'ArrowDown',
        'Enter',
      ])
        await h.command({ type: 'key', key });
      equal(h.targets().length, 1);
      equal(h.captured().kind, 'area');
      equal(
        [h.captured().area.rect.width, h.captured().area.rect.height],
        [24, 16],
      );
      return h.captured();
    },
  );
  await check(
    'A browser Range survives the synthetic text drag path without becoming an area',
    async (h) => {
      await h.pointer('pointerdown', 48, 50);
      const range = await h.command({ type: 'selection', start: 2, end: 12 });
      await h.pointer('pointerup', 130, 50);
      await h.command({ type: 'click', x: 130, y: 50 });
      equal(h.targets().length, 1);
      equal(h.captured().kind, 'text');
      equal(h.captured().text.exact, range.value);
      return h.captured();
    },
  );
  await check(
    'Pin results echo their request generation and revision; hidden pins still resolve',
    async (h) => {
      await h.drag([480, 330], [600, 420]);
      const saved = h.pin();
      const first = await h.placements([saved], 11, 'revision-first');
      equal(first.resolutions.revisionId, 'revision-first');
      equal(first.positions.revisionId, 'revision-first');
      equal(first.resolutions.resolutions[0].status, 'matching');
      equal(first.positions.positions.length, 1);
      h.send({
        type: 'pins',
        pins: [saved],
        generation: 12,
        revisionId: 'revision-stale',
      });
      const latest = await h.placements(
        [{ ...saved, showPin: false }],
        13,
        'revision-current',
      );
      equal(latest.resolutions.revisionId, 'revision-current');
      equal(latest.positions.revisionId, 'revision-current');
      equal(latest.resolutions.resolutions[0].status, 'matching');
      equal(latest.positions.positions, []);
      return { first, latest };
    },
  );
  await check(
    'Hidden, rewritten and deleted element targets never produce pin positions',
    async (h) => {
      await h.command({ type: 'click', x: 48, y: 50 });
      const saved = h.pin('subject', { crossRevision: true });
      equal(saved.target.kind, 'element');
      const initial = await h.placements([saved], 20);
      equal(initial.resolutions.resolutions[0].status, 'matching');
      await h.command({ type: 'mutate', id: 'subject', hidden: true });
      const hidden = await h.placements([saved], 21);
      assert(
        hidden.resolutions.resolutions[0].status !== 'matching',
        'Hidden element still matched',
      );
      equal(hidden.positions.positions, []);
      await h.command({ type: 'mutate', id: 'subject', hidden: false });
      await h.command({
        type: 'mutate',
        id: 'subject',
        text: 'Changed subject.',
      });
      const changed = await h.placements([saved], 22);
      equal(changed.resolutions.resolutions[0].status, 'changed');
      equal(changed.positions.positions, []);
      await h.command({ type: 'mutate', id: 'subject', remove: true });
      const missing = await h.placements([saved], 23);
      equal(missing.resolutions.resolutions[0].status, 'missing');
      equal(missing.positions.positions, []);
      return { hidden, changed, missing };
    },
  );
  await check(
    'A raw page point from an earlier revision stays not checked',
    async (h) => {
      const report = await h.placements(
        [
          {
            id: 'old-page-point',
            anchorId: null,
            context: '',
            crossRevision: true,
            target: { version: 1, kind: 'point' },
            point: {
              version: 1,
              x: 80,
              y: 90,
              width: 800,
              relativeX: 0,
              relativeY: 0,
              path: '',
            },
          },
        ],
        30,
        'revision-next',
      );
      equal(report.resolutions.resolutions[0].status, 'not_checked');
      equal(report.positions.positions, []);
      return report;
    },
  );
  await check(
    'Changed area geometry removes placement and Locate does not redraw it',
    async (h) => {
      await h.drag([480, 330], [600, 420]);
      const saved = h.pin('area', { crossRevision: true });
      await h.mode(false, false);
      const initial = await h.placements([saved], 40);
      equal(initial.resolutions.resolutions[0].status, 'matching');
      await h.command({ type: 'mutate', id: 'blank', height: 200 });
      const changed = await h.placements([saved], 41);
      equal(changed.resolutions.resolutions[0].status, 'changed');
      equal(changed.positions.positions, []);
      h.send({ type: 'locate', id: saved.id });
      const inspected = await h.command({ type: 'inspect' });
      equal(inspected.state.areaOutlines, 0);
      return changed;
    },
  );

  const summary = {
    method:
      'Synthetic event dispatch inside a real sandboxed browser iframe running the production frameDocument bridge. Browser Range and CSS are real; this does not prove native pointer, touch scrolling, or OS keyboard behavior.',
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    total: results.length,
    results,
  };
  window.oaAreaBridgeResults = summary;
  const status = document.getElementById('summary');
  status.textContent = `${summary.passed} / ${summary.total} passed; ${summary.failed} failed`;
  status.dataset.status = summary.failed ? 'failed' : 'passed';
  for (const result of results) {
    const item = document.createElement('li');
    item.dataset.status = result.passed ? 'passed' : 'failed';
    item.textContent = `${result.passed ? 'PASS' : 'FAIL'} — ${result.name}${result.error ? `: ${result.error}` : ''}`;
    document.getElementById('results').appendChild(item);
  }
  document.getElementById('raw-results').textContent = JSON.stringify(
    summary,
    null,
    2,
  );
}

const script =
  `(${runBridgeChecks.toString()})(${JSON.stringify(frame)},${JSON.stringify(token)});`.replace(
    /<\/script/gi,
    '<\\/script',
  );
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Area bridge regressions</title><style>body{margin:0;background:#111;color:#eee;font:16px/1.5 system-ui,sans-serif}main{max-width:1000px;margin:32px auto;padding:24px}h1{font-size:28px}[data-status="passed"]{color:#9ce3b2}[data-status="failed"]{color:#ffab9e}li{margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}#fixture{overflow:auto}</style></head><body><main><h1>Area bridge regressions</h1><p>Synthetic gesture dispatch through the real sandboxed iframe bridge. Native pointer, touch and keyboard acceptance is separate.</p><p id="summary">Running…</p><ol id="results"></ol><details><summary>Raw operations and bridge reports</summary><pre id="raw-results"></pre></details><section id="fixture" aria-label="Temporary fixture"></section></main><script>${script}</script></body></html>`;
const directory = resolve(outputDirectory);
mkdirSync(directory, { recursive: true });
const filename = join(directory, 'area-bridge-regressions.html');
writeFileSync(filename, html, { flag: 'wx' });
process.stdout.write(`${filename}\n`);
