import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { reviewSelection } from '../lib/artifacts/selection.ts';

const outputDirectory = process.argv[2];
if (!outputDirectory) {
  throw new Error(
    'Usage: node tests/review-selection.browser.mjs /path/to/private-output',
  );
}

function runRegressions(selection) {
  const fixture = document.getElementById('fixture');
  const results = [];
  const equal = (actual, expected, message = 'Values differ') => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
  };
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const select = (startNode, startOffset, endNode, endOffset) => {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  };
  const textRange = (node, start, end) =>
    select(node.firstChild, start, node.firstChild, end);
  const elementTarget = (node) => ({
    version: 1,
    kind: 'element',
    element: selection.describe(node),
  });
  const check = (name, html, run) => {
    fixture.innerHTML = html;
    const result = { name, fixture: html, passed: false };
    try {
      result.observed = run();
      result.passed = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    results.push(result);
  };

  check(
    'Partial text preserves whitespace and UTF-16 offsets',
    '<p>  alpha 𝄞 beta.  </p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const target = selection.capture(textRange(paragraph, 1, 11));
      assert(target?.kind === 'text', 'Text target was not captured');
      equal(target.text, {
        exact: ' alpha 𝄞 ',
        prefix: ' ',
        suffix: 'beta.  ',
        startOffset: 1,
        endOffset: 11,
      });
      equal(target.element.text, 'alpha 𝄞 beta.');
      equal(
        selection.rangeFor(target, selection.resolve(target)).toString(),
        target.text.exact,
      );
      return target;
    },
  );

  check(
    'Cross-inline selection retains a single exact range',
    '<p>A <em>brave</em> new <strong>world</strong>.</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const range = select(
        paragraph.querySelector('em').firstChild,
        2,
        paragraph.querySelector('strong').firstChild,
        3,
      );
      const target = selection.capture(range);
      assert(target?.kind === 'text', 'Cross-inline range was not captured');
      equal(target.text.exact, 'ave new wor');
      equal([target.text.startOffset, target.text.endOffset], [4, 15]);
      equal(target.element.tag, 'p');
      assert(
        selection.resolve(target) === paragraph,
        'Containing paragraph did not resolve',
      );
      equal(selection.rangeFor(target, paragraph).toString(), 'ave new wor');
      return target;
    },
  );

  check(
    'Cross-paragraph selection keeps both paragraph boundaries',
    '<section><p>First line.</p><p>Second line.</p></section>',
    () => {
      const section = fixture.firstElementChild;
      const paragraphs = section.querySelectorAll('p');
      const range = select(
        paragraphs[0].firstChild,
        6,
        paragraphs[1].firstChild,
        6,
      );
      const target = selection.capture(range);
      assert(target?.kind === 'text', 'Cross-paragraph range was not captured');
      equal(target.text.exact, 'line.Second');
      equal([target.text.startOffset, target.text.endOffset], [6, 17]);
      equal(target.element.tag, 'section');
      const restored = selection.rangeFor(target, selection.resolve(target));
      assert(
        restored.startContainer === paragraphs[0].firstChild,
        'Start paragraph changed',
      );
      assert(
        restored.endContainer === paragraphs[1].firstChild,
        'End paragraph changed',
      );
      equal(restored.toString(), range.toString());
      return target;
    },
  );

  check(
    'Native selection preserves visible paragraph breaks alongside DOM text',
    '<section><p>First line.</p><p>Second line.</p></section>',
    () => {
      const section = fixture.firstElementChild;
      const paragraphs = section.querySelectorAll('p');
      const range = select(
        paragraphs[0].firstChild,
        6,
        paragraphs[1].firstChild,
        6,
      );
      const nativeSelection = window.getSelection();
      assert(nativeSelection, 'Native browser selection is unavailable');
      nativeSelection.removeAllRanges();
      nativeSelection.addRange(range);
      try {
        const visible = nativeSelection.toString();
        assert(
          visible.includes('\n'),
          'Native paragraph selection did not contain a visible line break',
        );
        const target = selection.capture(range, visible);
        assert(
          target?.kind === 'text',
          'Visible paragraph range was not captured',
        );
        equal(target.text.exact, visible);
        equal(target.text.domExact, 'line.Second');
        equal([target.text.startOffset, target.text.endOffset], [6, 17]);
        const restored = selection.rangeFor(target, selection.resolve(target));
        equal(restored.toString(), target.text.domExact);
        nativeSelection.removeAllRanges();
        nativeSelection.addRange(restored);
        equal(nativeSelection.toString(), visible);
        return target;
      } finally {
        nativeSelection.removeAllRanges();
      }
    },
  );

  check(
    'Document root descriptions retain valid locator bounds',
    '<p>Root specimen.</p>',
    () => {
      const description = selection.describe(document.documentElement);
      equal(description.tag, 'html');
      equal(description.path, '');
      equal(
        document.querySelector(description.cssPath),
        document.documentElement,
      );
      assert(description.text.length <= 1200, 'Root text exceeded its bound');
      equal(description.text, description.text.replace(/\s+/g, ' ').trim());
      assert(
        selection.resolve({
          version: 1,
          kind: 'element',
          element: description,
        }) === document.documentElement,
        'Root target did not resolve',
      );
      return description;
    },
  );

  check(
    'Empty review IDs normalize to null',
    '<p data-review-id="">Empty ID specimen.</p>',
    () => {
      const description = selection.describe(fixture.firstElementChild);
      equal(description.reviewId, null);
      assert(
        description.cssPath.length > 0 && description.cssPath.length <= 2000,
        'CSS path failed its bounds',
      );
      return description;
    },
  );

  check(
    'Overlong review IDs normalize to null',
    `<p data-review-id="${'x'.repeat(161)}">Long ID specimen.</p>`,
    () => {
      const description = selection.describe(fixture.firstElementChild);
      equal(description.reviewId, null);
      assert(description.path.length <= 120, 'DOM path exceeded its bound');
      return description;
    },
  );

  check(
    'Repeated quotes restore the selected occurrence using offsets',
    '<p>echo / echo / echo</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const target = selection.capture(textRange(paragraph, 7, 11));
      assert(target?.kind === 'text', 'Duplicate quote was not captured');
      equal(target.text.exact, 'echo');
      const restored = selection.rangeFor(target, selection.resolve(target));
      equal([restored.startOffset, restored.endOffset], [7, 11]);
      return target;
    },
  );

  check('Changed element text fails closed', '<p>Original text.</p>', () => {
    const paragraph = fixture.firstElementChild;
    const target = elementTarget(paragraph);
    paragraph.textContent = 'Different text.';
    equal(selection.resolve(target), null);
    return target;
  });

  check(
    'A shifted positional path cannot attach to other text',
    '<section><p>Original text.</p></section>',
    () => {
      const section = fixture.firstElementChild;
      const target = elementTarget(section.firstElementChild);
      const inserted = document.createElement('p');
      inserted.textContent = 'New first paragraph.';
      section.prepend(inserted);
      equal(selection.resolve(target), null);
      return target;
    },
  );

  check(
    'Changed quote text fails closed',
    '<p>Before chosen after.</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const target = selection.capture(textRange(paragraph, 7, 13));
      paragraph.textContent = 'Before edited after.';
      equal(selection.resolve(target), null);
      return target;
    },
  );

  check(
    'Changed quote context fails closed even when the quote remains',
    '<p>Before chosen after.</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const target = selection.capture(textRange(paragraph, 7, 13));
      paragraph.textContent = 'Alter! chosen after.';
      equal(selection.resolve(target), null);
      return target;
    },
  );

  check(
    'Missing review IDs do not fall back to positional paths',
    '<p data-review-id="detail">Original text.</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const target = elementTarget(paragraph);
      paragraph.removeAttribute('data-review-id');
      equal(selection.resolve(target), null);
      return target;
    },
  );

  check(
    'Duplicate review IDs remain ambiguous',
    '<p data-review-id="detail">Original text.</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const target = elementTarget(paragraph);
      fixture.append(paragraph.cloneNode(true));
      equal(selection.resolve(target), null);
      return target;
    },
  );

  check(
    'A unique review ID survives a changed positional path',
    '<section><p data-review-id="detail">Original text.</p></section>',
    () => {
      const section = fixture.firstElementChild;
      const paragraph = section.firstElementChild;
      const target = elementTarget(paragraph);
      const inserted = document.createElement('p');
      inserted.textContent = 'New first paragraph.';
      section.prepend(inserted);
      assert(
        selection.resolve(target) === paragraph,
        'Stable review ID failed to resolve',
      );
      return target;
    },
  );

  check(
    'Icon button decoration selects its labeled control',
    '<button aria-label="Play sample"><svg viewBox="0 0 10 10"><path d="M1 1L9 5L1 9Z"></path></svg></button>',
    () => {
      const button = fixture.firstElementChild;
      const hit = fixture.querySelector('path');
      assert(
        selection.targetFor(hit) === button,
        'Icon did not target its button',
      );
      equal(selection.describe(selection.targetFor(hit)).label, 'Play sample');
      return selection.describe(button);
    },
  );

  check(
    'Native and role sliders include associated labels',
    '<label for="test-gain">Gain level</label><input id="test-gain" type="range" value="25"><span id="test-speed-label">Playback speed</span><div role="slider" aria-labelledby="test-speed-label"><span>2</span></div>',
    () => {
      const native = selection.describe(fixture.querySelector('input'));
      const roleNode = fixture.querySelector('[role="slider"]');
      const role = selection.describe(
        selection.targetFor(roleNode.firstElementChild),
      );
      equal(native.label, 'Gain level');
      equal(role.label, 'Playback speed');
      return { native, role };
    },
  );

  check(
    'Changed accessible labels fail closed',
    '<button aria-label="Play sample"></button>',
    () => {
      const button = fixture.firstElementChild;
      const target = elementTarget(button);
      button.setAttribute('aria-label', 'Stop sample');
      equal(selection.resolve(target), null);
      return target;
    },
  );

  check(
    'Selections longer than 8000 UTF-16 units are rejected',
    `<p>${'x'.repeat(8001)}</p>`,
    () => {
      const paragraph = fixture.firstElementChild;
      equal(selection.capture(textRange(paragraph, 0, 8001)), null);
      const boundary = selection.capture(textRange(paragraph, 0, 8000));
      assert(
        boundary?.kind === 'text',
        '8000-unit boundary should remain valid',
      );
      equal(boundary.text.exact.length, 8000);
      return {
        rejectedLength: 8001,
        acceptedLength: boundary.text.exact.length,
      };
    },
  );

  check(
    'Element text normalizes whitespace after the 1200-unit cut',
    `<p> \n${'x'.repeat(1199)}   tail \t</p>`,
    () => {
      const description = selection.describe(fixture.firstElementChild);
      equal(description.text, 'x'.repeat(1199));
      assert(
        description.text.length <= 1200,
        'Element text exceeded its bound',
      );
      return description;
    },
  );

  check(
    'Element context excludes scripts, styles, and editable descendants',
    '<section>Visible <script>HIDDEN_SCRIPT</script><style>/* HIDDEN_STYLE */</style><span contenteditable="true">HIDDEN_EDITABLE</span><textarea>HIDDEN_AREA</textarea><select><option>HIDDEN_OPTION</option></select><span> caption</span></section>',
    () => {
      const description = selection.describe(fixture.firstElementChild);
      equal(description.text, 'Visible caption');
      return description;
    },
  );

  check(
    'Quote prefix and suffix stop before excluded descendants',
    '<p><script>HIDDEN_SCRIPT</script><span contenteditable="true">HIDDEN_BEFORE</span>pre <em>chosen</em> text post<textarea>HIDDEN_AFTER</textarea><style>/* HIDDEN_STYLE */</style></p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const inline = paragraph.querySelector('em');
      const range = select(inline.previousSibling, 2, inline.nextSibling, 5);
      const target = selection.capture(range);
      assert(
        target?.kind === 'text',
        'Safe range beside excluded content was not captured',
      );
      equal(target.text.exact, 'e chosen text');
      equal(target.text.prefix, 'pr');
      equal(target.text.suffix, ' post');
      equal(target.element.text, 'pre chosen text post');
      assert(
        !JSON.stringify(target).includes('HIDDEN'),
        'Excluded content leaked into target evidence',
      );
      assert(
        selection.resolve(target) === paragraph,
        'Safe range no longer resolves',
      );
      equal(selection.rangeFor(target, paragraph).toString(), 'e chosen text');
      return target;
    },
  );

  check(
    'Ranges overlapping editable content are rejected',
    '<p>Before <span contenteditable="true">EDITABLE</span> after.</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const range = select(paragraph.firstChild, 0, paragraph.lastChild, 7);
      equal(selection.capture(range), null);
      return { overlapRejected: true };
    },
  );

  check(
    'Ranges overlapping script content are rejected',
    '<p>Before <script>SCRIPT_TEXT</script> after.</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const range = select(paragraph.firstChild, 0, paragraph.lastChild, 7);
      equal(selection.capture(range), null);
      return { overlapRejected: true };
    },
  );

  check(
    'Collapsed ranges do not become text comments',
    '<p>Plain text.</p>',
    () => {
      equal(
        selection.capture(textRange(fixture.firstElementChild, 3, 3)),
        null,
      );
      return { collapsedRejected: true };
    },
  );

  const areaFixture =
    '<section data-review-id="region" style="position:relative;width:300px;height:220px"><p style="position:absolute;margin:0;left:20px;top:20px;width:160px;height:40px">Alpha <strong>words</strong>.</p><p style="position:absolute;margin:0;left:20px;top:80px;width:160px;height:60px">Beta words.</p></section>';
  const region = (node, x, y, width, height) => {
    const bounds = node.getBoundingClientRect();
    return { x: bounds.x + x, y: bounds.y + y, width, height };
  };
  check(
    'Area capture preserves partial coverage without duplicate inline wrappers',
    areaFixture,
    () => {
      const node = fixture.firstElementChild;
      const target = selection.captureArea(region(node, 5, 5, 180, 100));
      assert(target?.kind === 'area', 'Area target was not captured');
      equal(target.area.rect, { x: 5, y: 5, width: 180, height: 100 });
      equal(
        target.area.members.map((member) => [
          member.element.tag,
          member.element.text,
          member.coverage,
        ]),
        [
          ['p', 'Alpha words.', 'full'],
          ['p', 'Beta words.', 'partial'],
        ],
      );
      equal(selection.resolveTarget(target).status, 'matching');
      const before = JSON.stringify(target);
      node.style.left = '11px';
      const moved = selection.resolveTarget(target, true);
      equal(moved.status, 'matching');
      equal(moved.rect.x, node.getBoundingClientRect().x + 5);
      equal(
        JSON.stringify(target),
        before,
        'Matching mutated the original evidence',
      );
      return target;
    },
  );
  check('Area capture keeps empty regions valid', areaFixture, () => {
    const node = fixture.firstElementChild;
    const target = selection.captureArea(region(node, 220, 150, 60, 50));
    assert(target?.kind === 'area', 'Empty area was rejected');
    equal(target.area.members, []);
    equal(target.area.truncated, false);
    equal(selection.resolveTarget(target, true).status, 'matching');
    return target;
  });
  check(
    'Area capture excludes editable, private, hidden, script, and UI content',
    '<section data-review-id="private-test" style="position:relative;width:300px;height:220px"><div contenteditable="true">EDITABLE_SECRET</div><div data-oa-private>PRIVATE_SECRET</div><p hidden>HIDDEN_SECRET</p><script>SCRIPT_SECRET</script><div data-oa-ui>UI_SECRET</div><input aria-label="Password field" value="INPUT_SECRET"><p>Visible specimen.</p></section>',
    () => {
      const node = fixture.firstElementChild;
      const target = selection.captureArea(region(node, 1, 1, 290, 210));
      assert(target?.kind === 'area', 'Safe area was rejected');
      assert(
        !JSON.stringify(target).includes('_SECRET'),
        'Excluded contents leaked',
      );
      assert(
        target.area.members.some(
          (member) => member.element.label === 'Password field',
        ),
        'Control label was lost',
      );
      equal(selection.resolveTarget(target).status, 'matching');
      return target;
    },
  );
  check(
    'Unlabeled graphics are described by their real tag',
    '<section data-review-id="graphics" style="position:relative;width:300px;height:160px"><canvas style="position:absolute;left:10px;top:10px;width:80px;height:80px"></canvas><svg aria-label="Example chart" style="position:absolute;left:110px;top:10px;width:80px;height:80px"><rect width="50" height="40"></rect></svg></section>',
    () => {
      const node = fixture.firstElementChild;
      const target = selection.captureArea(region(node, 1, 1, 220, 100));
      assert(target?.kind === 'area', 'Graphic area was rejected');
      equal(
        target.area.members.map((member) => [
          member.element.tag,
          member.element.label,
        ]),
        [
          ['canvas', ''],
          ['svg', 'Example chart'],
        ],
      );
      return target;
    },
  );
  check(
    'Area members are bounded and truncated coverage is explicit',
    '<section data-review-id="many" style="position:relative;width:300px;height:300px">' +
      Array.from(
        { length: 10 },
        (_, index) =>
          `<p style="position:absolute;left:10px;top:${index * 20}px;margin:0;height:18px">Item ${index}</p>`,
      ).join('') +
      '</section>',
    () => {
      const node = fixture.firstElementChild;
      const target = selection.captureArea(region(node, 1, 1, 290, 230));
      assert(target?.kind === 'area', 'Long area was rejected');
      equal(target.area.members.length, 8);
      equal(target.area.truncated, true);
      assert(
        JSON.stringify(target).length <= 20000,
        'Metadata exceeds its limit',
      );
      equal(selection.resolveTarget(target).status, 'matching');
      equal(selection.resolveTarget(target, true).status, 'not_checked');
      return target;
    },
  );
  check(
    'Area capture rejects undersized and invalid rectangles',
    areaFixture,
    () => {
      const node = fixture.firstElementChild;
      for (const size of [
        [5, 20],
        [20, 5],
        [0, 0],
        [-20, 30],
        [Infinity, 30],
      ])
        equal(selection.captureArea(region(node, 20, 20, ...size)), null);
      assert(
        selection.captureArea(region(node, 220, 150, 6, 6)),
        'Minimum rectangle was rejected',
      );
      return { minimum: 6 };
    },
  );
  check(
    'Area placement rejects changed dimensions and internal movement',
    areaFixture,
    () => {
      const node = fixture.firstElementChild;
      const target = selection.captureArea(region(node, 5, 5, 180, 100));
      assert(target?.kind === 'area', 'Area target missing');
      node.style.width = '310px';
      equal(selection.resolveTarget(target, true).status, 'changed');
      node.style.width = '300px';
      node.firstElementChild.style.left = '25px';
      equal(selection.resolveTarget(target, true).status, 'changed');
      node.firstElementChild.style.left = '20px';
      equal(selection.resolveTarget(target, true).status, 'matching');
      return target;
    },
  );
  check(
    'Empty areas cannot attach to newly inserted content',
    areaFixture,
    () => {
      const node = fixture.firstElementChild;
      const target = selection.captureArea(region(node, 220, 150, 60, 50));
      const image = document.createElement('canvas');
      image.style.cssText =
        'position:absolute;left:230px;top:160px;width:30px;height:30px';
      node.append(image);
      equal(selection.resolveTarget(target, true).status, 'changed');
      return target;
    },
  );
  check(
    'Actual glyph detection distinguishes paragraph whitespace and controls',
    '<div style="position:relative;width:300px;height:150px"><p style="margin:0;width:280px;height:60px">Short.</p><button style="width:80px;height:40px"><svg width="10" height="10"><path d="M0 0h10v10"></path></svg></button></div>',
    () => {
      const paragraph = fixture.querySelector('p');
      const glyph = textRange(paragraph, 0, 1).getBoundingClientRect();
      assert(
        selection.hitIsTextOrControl(
          glyph.x + glyph.width / 2,
          glyph.y + glyph.height / 2,
          paragraph,
        ),
        'Actual text was classified as whitespace',
      );
      const blank = region(paragraph, 240, 20, 0, 0);
      equal(selection.hitIsTextOrControl(blank.x, blank.y, paragraph), false);
      const button = fixture.querySelector('button');
      const bounds = button.getBoundingClientRect();
      assert(
        selection.hitIsTextOrControl(
          bounds.x + 5,
          bounds.y + 5,
          button.querySelector('path'),
        ),
        'Decorated control was not recognized',
      );
      return { textHit: true, paragraphBlankHit: false, controlHit: true };
    },
  );
  check(
    'Cross-revision element matching follows unique content rather than reused position',
    '<section><p>Original target.</p></section>',
    () => {
      const section = fixture.firstElementChild;
      const paragraph = section.firstElementChild;
      const target = elementTarget(paragraph);
      section.insertAdjacentHTML(
        'afterbegin',
        '<p>Replacement at the old path.</p>',
      );
      equal(selection.resolveTarget(target).status, 'changed');
      equal(selection.resolveTarget(target, true).status, 'matching');
      assert(
        selection.resolveTarget(target, true).node === paragraph,
        'Unique content attached to the wrong paragraph',
      );
      section.insertAdjacentHTML('beforeend', '<p>Original target.</p>');
      equal(selection.resolveTarget(target, true).status, 'ambiguous');
      return target;
    },
  );
  check(
    'Stable IDs reject rewritten content and duplicate identity',
    '<section><p data-review-id="stable">Original target.</p></section>',
    () => {
      const paragraph = fixture.querySelector('p');
      const target = elementTarget(paragraph);
      paragraph.textContent = 'Rewritten target.';
      equal(selection.resolveTarget(target, true).status, 'changed');
      paragraph.insertAdjacentHTML(
        'afterend',
        '<p data-review-id="stable">Original target.</p>',
      );
      equal(selection.resolveTarget(target, true).status, 'ambiguous');
      return target;
    },
  );
  check(
    'Cross-revision text matching relocates UTF-16 offsets without mutating capture',
    `<p data-review-id="long-text">${'a'.repeat(150)} chosen ${'z'.repeat(150)}</p>`,
    () => {
      const paragraph = fixture.firstElementChild;
      const target = selection.capture(textRange(paragraph, 151, 157));
      const original = JSON.stringify(target);
      paragraph.prepend(document.createTextNode('Added introduction. '));
      equal(selection.resolveTarget(target).status, 'changed');
      const result = selection.resolveTarget(target, true);
      equal(result.status, 'matching');
      equal(result.range.toString(), 'chosen');
      equal(JSON.stringify(target), original);
      return target;
    },
  );
  check(
    'Cross-revision quote matching preserves surrounding context',
    '<p data-review-id="quote">Before chosen after.</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const target = selection.capture(textRange(paragraph, 7, 13));
      paragraph.textContent = 'Changed chosen after.';
      equal(selection.resolveTarget(target, true).status, 'changed');
      paragraph.remove();
      equal(selection.resolveTarget(target, true).status, 'missing');
      return target;
    },
  );
  check(
    'Cross-revision duplicate quote and context remain ambiguous',
    '<p>Before chosen after.</p>',
    () => {
      const paragraph = fixture.firstElementChild;
      const target = selection.capture(textRange(paragraph, 7, 13));
      paragraph.insertAdjacentHTML('afterend', '<p>Before chosen after.</p>');
      equal(selection.resolveTarget(target, true).status, 'ambiguous');
      return target;
    },
  );
  check(
    'Point placement checks geometry and old points cannot cross revisions',
    '<button data-review-id="point" style="width:100px;height:40px">Point specimen</button>',
    () => {
      const button = fixture.firstElementChild;
      const target = {
        version: 1,
        kind: 'point',
        element: selection.describe(button),
        geometry: selection.capturePointGeometry(button),
      };
      equal(selection.resolveTarget(target, true).status, 'matching');
      button.style.width = '130px';
      equal(selection.resolveTarget(target, true).status, 'changed');
      const { geometry: _geometry, ...legacy } = target;
      equal(selection.resolveTarget(legacy, true).status, 'not_checked');
      equal(
        selection.resolveTarget({ version: 1, kind: 'point' }, true).status,
        'not_checked',
      );
      return target;
    },
  );
  check(
    'Point layout snapshots reject movement inside an unchanged container',
    areaFixture,
    () => {
      const node = fixture.firstElementChild;
      const target = {
        version: 1,
        kind: 'point',
        element: selection.describe(node),
        geometry: selection.capturePointGeometry(node),
      };
      equal(selection.resolveTarget(target, true).status, 'matching');
      node.firstElementChild.style.left = '25px';
      equal(selection.resolveTarget(target, true).status, 'changed');
      return target;
    },
  );
  check(
    'Area and point layout fingerprints reject fixed-box text reflow',
    '<section data-review-id="reflow" style="position:relative;width:300px;height:180px"><p style="position:absolute;left:10px;top:10px;margin:0;box-sizing:border-box;width:260px;height:150px">Several words keep their paragraph box unchanged while padding changes where each rendered line begins and how the words wrap.</p></section>',
    () => {
      const node = fixture.firstElementChild;
      const paragraph = node.firstElementChild;
      const area = selection.captureArea(region(node, 1, 1, 290, 170));
      const point = {
        version: 1,
        kind: 'point',
        element: selection.describe(paragraph),
        geometry: selection.capturePointGeometry(paragraph),
      };
      assert(
        area?.kind === 'area' && area.area.layout?.fingerprint,
        'Area layout evidence is missing',
      );
      equal(selection.resolveTarget(area, true).status, 'matching');
      equal(selection.resolveTarget(point, true).status, 'matching');
      const before = paragraph.getBoundingClientRect().toJSON();
      paragraph.style.paddingLeft = '45px';
      equal(
        paragraph.getBoundingClientRect().toJSON(),
        before,
        'Fixture changed the paragraph box',
      );
      for (const target of [area, point]) {
        equal(selection.resolveTarget(target).status, 'changed');
        equal(selection.resolveTarget(target, true).status, 'changed');
      }
      return { area, point };
    },
  );
  check(
    'Area and point layout fingerprints reject inline motion inside a fixed paragraph',
    '<section data-review-id="inline-motion" style="position:relative;width:300px;height:150px"><p style="position:absolute;left:10px;top:10px;margin:0;width:260px;height:120px">A <strong style="position:relative">selected phrase</strong> can move without changing its surrounding paragraph.</p></section>',
    () => {
      const node = fixture.firstElementChild;
      const paragraph = node.firstElementChild;
      const area = selection.captureArea(region(node, 1, 1, 290, 140));
      const point = {
        version: 1,
        kind: 'point',
        element: selection.describe(paragraph),
        geometry: selection.capturePointGeometry(paragraph),
      };
      const before = paragraph.getBoundingClientRect().toJSON();
      paragraph.querySelector('strong').style.left = '14px';
      equal(
        paragraph.getBoundingClientRect().toJSON(),
        before,
        'Fixture changed the paragraph box',
      );
      for (const target of [area, point]) {
        equal(selection.resolveTarget(target).status, 'changed');
        equal(selection.resolveTarget(target, true).status, 'changed');
      }
      return { area, point };
    },
  );
  check(
    'Legacy area and point snapshots without fingerprints cannot cross revisions',
    areaFixture,
    () => {
      const node = fixture.firstElementChild;
      const area = selection.captureArea(region(node, 5, 5, 180, 100));
      const { layout: _layout, ...oldArea } = area.area;
      const legacyArea = { ...area, area: oldArea };
      equal(selection.resolveTarget(legacyArea).status, 'matching');
      equal(selection.resolveTarget(legacyArea, true).status, 'not_checked');
      const geometry = selection.capturePointGeometry(node);
      const { fingerprint: _fingerprint, ...oldLayout } = geometry.layout;
      const legacyPoint = {
        version: 1,
        kind: 'point',
        element: selection.describe(node),
        geometry: { ...geometry, layout: oldLayout },
      };
      equal(selection.resolveTarget(legacyPoint).status, 'matching');
      equal(selection.resolveTarget(legacyPoint, true).status, 'not_checked');
      return { legacyArea, legacyPoint };
    },
  );
  check(
    'Layout fingerprints exclude private text and host controls',
    '<section data-review-id="private-layout" style="position:relative;width:300px;height:220px"><p style="position:absolute;left:10px;top:10px;margin:0">Public text.</p><div data-oa-private style="position:absolute;left:10px;top:60px">PRIVATE</div><div data-oa-ui style="position:absolute;left:10px;top:100px">HOST</div></section>',
    () => {
      const node = fixture.firstElementChild;
      const area = selection.captureArea(region(node, 1, 1, 290, 210));
      const fingerprint = area.area.layout.fingerprint;
      node.querySelector('[data-oa-private]').textContent = 'CHANGED_PRIVATE';
      node.querySelector('[data-oa-ui]').style.left = '80px';
      equal(
        selection.captureArea(region(node, 1, 1, 290, 210)).area.layout
          .fingerprint,
        fingerprint,
      );
      equal(selection.resolveTarget(area, true).status, 'matching');
      return area;
    },
  );
  check(
    'A full restructure preserves evidence and cannot reuse positional anchors',
    areaFixture,
    () => {
      const target = selection.captureArea(
        region(fixture.firstElementChild, 5, 5, 180, 100),
      );
      const before = JSON.stringify(target);
      fixture.innerHTML =
        '<article><h2>Entirely new structure</h2><p>Different content.</p></article>';
      equal(selection.resolveTarget(target, true).status, 'missing');
      equal(JSON.stringify(target), before);
      return target;
    },
  );

  fixture.replaceChildren();
  const summary = {
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    total: results.length,
    results,
  };
  window.oaSelectionResults = summary;
  document.getElementById('summary').textContent =
    `${summary.passed} / ${summary.total} passed; ${summary.failed} failed`;
  document.getElementById('summary').dataset.status = summary.failed
    ? 'failed'
    : 'passed';
  const list = document.getElementById('results');
  for (const result of results) {
    const item = document.createElement('li');
    item.dataset.status = result.passed ? 'passed' : 'failed';
    item.textContent = `${result.passed ? 'PASS' : 'FAIL'} — ${result.name}${result.error ? `: ${result.error}` : ''}`;
    list.append(item);
  }
  document.getElementById('raw-results').textContent = JSON.stringify(
    summary,
    null,
    2,
  );
}

const script =
  `(${runRegressions.toString()})((${reviewSelection.toString()})());`.replace(
    /<\/script/gi,
    '<\\/script',
  );
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Selection DOM regressions</title>
<style>body{margin:0;background:#111;color:#eee;font:16px/1.5 system-ui,sans-serif}main{max-width:1000px;margin:48px auto;padding:24px}h1{font-size:28px}#summary{font-size:20px}[data-status="passed"]{color:#9ce3b2}[data-status="failed"]{color:#ffab9e}li{margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}#fixture{contain:content}summary{cursor:pointer}</style></head>
<body><main><h1>Selection DOM regressions</h1><p>Native browser Range checks against synthetic content.</p><p id="summary">Running…</p><ol id="results"></ol><details><summary>Raw results and fixture inputs</summary><pre id="raw-results"></pre></details><section id="fixture" aria-label="Temporary test fixture"></section></main>
<script>${script}</script></body></html>`;

const directory = resolve(outputDirectory);
mkdirSync(directory, { recursive: true });
const filename = join(directory, 'selection-regressions.html');
writeFileSync(filename, html, { flag: 'wx' });
process.stdout.write(`${filename}\n`);
