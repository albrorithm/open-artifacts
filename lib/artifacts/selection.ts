import type { ReviewTarget, TargetResolutionStatus } from './review-target';

// This factory is serialized into the opaque artifact frame. Keep it self-contained.
export function reviewSelection() {
  const clean = (value: string | null | undefined, max: number) =>
    (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  const excluded =
    'script,style,noscript,template,input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-oa-ui],[hidden],[data-oa-private],[data-review-private]';
  const safeText = (node: Element) => {
    if (node.closest(excluded)) return '';
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text = '';
    let child: Node | null;
    while ((child = walker.nextNode())) {
      if (!child.parentElement?.closest(excluded))
        text += child.textContent ?? '';
    }
    return text;
  };
  const pathFor = (node: Element) => {
    const indexes: number[] = [];
    while (node.parentElement) {
      indexes.unshift([...node.parentElement.children].indexOf(node));
      node = node.parentElement;
    }
    return indexes.join('.');
  };
  const cssPathFor = (node: Element) => {
    const parts: string[] = [];
    while (node !== document.documentElement && node.parentElement) {
      const tag = node.localName;
      const peers = [...node.parentElement.children].filter(
        (peer) => peer.localName === tag,
      );
      parts.unshift(`${tag}:nth-of-type(${peers.indexOf(node) + 1})`);
      node = node.parentElement;
    }
    return parts.join(' > ') || 'html:nth-of-type(1)';
  };
  const labelFor = (node: Element) => {
    const labels =
      'labels' in node
        ? [...((node as HTMLInputElement).labels ?? [])]
            .map((label) => safeText(label))
            .join(' ')
        : '';
    const labelledBy = (node.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const label = document.getElementById(id);
        return label ? safeText(label) : '';
      })
      .join(' ');
    return clean(
      node.getAttribute('aria-label') ||
        labelledBy ||
        labels ||
        node.getAttribute('alt') ||
        node.getAttribute('title'),
      300,
    );
  };
  const describe = (node: Element): NonNullable<ReviewTarget['element']> => ({
    tag: node.localName,
    path: pathFor(node),
    cssPath: cssPathFor(node),
    reviewId:
      (node.getAttribute('data-review-id')?.length ?? 0) <= 160
        ? node.getAttribute('data-review-id') || null
        : null,
    text: clean(safeText(node), 1200),
    label: labelFor(node),
  });
  const targetFor = (hit: Element) => {
    // Controls use their own labels; inline decoration belongs to its control.
    const control = hit.closest(
      'button,a,input,textarea,select,[role="button"],[role="slider"]',
    );
    if (control) return control;
    if (hit.closest('[contenteditable]:not([contenteditable="false"])'))
      return hit.closest('[contenteditable]:not([contenteditable="false"])')!;
    return hit.closest('svg') ?? hit;
  };
  const capture = (
    range: Range,
    selectedText?: string,
  ): ReviewTarget | null => {
    if (range.collapsed) return null;
    const domExact = range.toString();
    const exact = selectedText ?? domExact;
    if (!exact || exact.length > 8000 || domExact.length > 8000) return null;
    const common = range.commonAncestorContainer;
    const node = common instanceof Element ? common : common.parentElement;
    if (!node || node.closest(excluded)) return null;
    // Do not capture editable text or script/style contents as review quotes.
    for (const child of node.querySelectorAll(excluded))
      if (range.intersectsNode(child)) return null;
    const before = document.createRange();
    before.selectNodeContents(node);
    before.setEnd(range.startContainer, range.startOffset);
    const startOffset = before.toString().length;
    const endOffset = startOffset + domExact.length;
    const content = node.textContent ?? '';
    if (content.slice(startOffset, endOffset) !== domExact) return null;
    let prefixStart = Math.max(0, startOffset - 120);
    let suffixEnd = endOffset + 120;
    for (const child of node.querySelectorAll(excluded)) {
      const contextRange = document.createRange();
      contextRange.selectNodeContents(node);
      contextRange.setEndBefore(child);
      const excludedStart = contextRange.toString().length;
      const excludedEnd = excludedStart + (child.textContent?.length ?? 0);
      if (excludedEnd <= startOffset)
        prefixStart = Math.max(prefixStart, excludedEnd);
      if (excludedStart >= endOffset)
        suffixEnd = Math.min(suffixEnd, excludedStart);
    }
    const element = describe(node);
    if (element.path.length > 120 || element.cssPath.length > 2000) return null;
    const captured: ReviewTarget = {
      version: 1,
      kind: 'text',
      element,
      text: {
        exact,
        ...(exact !== domExact ? { domExact } : {}),
        prefix: content.slice(prefixStart, startOffset),
        suffix: content.slice(endOffset, suffixEnd),
        startOffset,
        endOffset,
      },
    };
    return JSON.stringify(captured).length <= 20000 ? captured : null;
  };
  const resolve = (target: ReviewTarget): Element | null => {
    const original = target.element;
    if (!original) return null;
    let node: Element | undefined = document.documentElement;
    if (original.reviewId) {
      const matches = [...document.querySelectorAll('[data-review-id]')].filter(
        (candidate) =>
          candidate.getAttribute('data-review-id') === original.reviewId,
      );
      if (matches.length !== 1) return null;
      node = matches[0];
    } else if (original.path) {
      for (const index of original.path.split('.').map(Number))
        node = node?.children[index];
    }
    if (!node || node.localName !== original.tag) return null;
    const current = describe(node);
    // Never let a positional path silently attach to different content.
    if (
      target.kind !== 'text' &&
      (current.text !== original.text || current.label !== original.label)
    )
      return null;
    if (target.kind === 'text') {
      const quote = target.text!;
      const content = node.textContent ?? '';
      if (
        content.slice(quote.startOffset, quote.endOffset) !==
          (quote.domExact ?? quote.exact) ||
        content.slice(
          Math.max(0, quote.startOffset - quote.prefix.length),
          quote.startOffset,
        ) !== quote.prefix ||
        content.slice(
          quote.endOffset,
          quote.endOffset + quote.suffix.length,
        ) !== quote.suffix
      )
        return null;
    }
    return node;
  };
  const rangeFor = (target: ReviewTarget, node: Element): Range | null => {
    if (target.kind !== 'text' || !target.text) return null;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0;
    let started = false;
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const end = offset + (textNode.textContent?.length ?? 0);
      if (!started && target.text.startOffset <= end) {
        range.setStart(textNode, target.text.startOffset - offset);
        started = true;
      }
      if (started && target.text.endOffset <= end) {
        range.setEnd(textNode, target.text.endOffset - offset);
        return range.toString() === (target.text.domExact ?? target.text.exact)
          ? range
          : null;
      }
      offset = end;
    }
    return null;
  };
  type Rectangle = { x: number; y: number; width: number; height: number };
  type AreaTarget = Extract<ReviewTarget, { kind: 'area' }>;
  const scanLimit = 2000;
  const atomic =
    'button,a,input,textarea,select,[role="button"],[role="slider"],img,svg,canvas,video,audio,iframe,[role="img"]';
  const blocks =
    'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figcaption,dt,dd,td,th,caption,label,legend,summary';
  const privateContent =
    'script,style,noscript,template,[contenteditable]:not([contenteditable="false"]),[data-oa-ui],[hidden],[data-oa-private],[data-review-private]';
  const rectangle = (rect: DOMRect): Rectangle => ({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
  const inside = (outer: Rectangle, inner: Rectangle, tolerance = 0) =>
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance;
  const intersects = (a: Rectangle, b: Rectangle) =>
    Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
    Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
  const relativeRect = (rect: Rectangle, origin: Rectangle): Rectangle => ({
    x: rect.x - origin.x,
    y: rect.y - origin.y,
    width: rect.width,
    height: rect.height,
  });
  const sameRect = (a: Rectangle, b: Rectangle) =>
    Math.abs(a.x - b.x) <= 1 &&
    Math.abs(a.y - b.y) <= 1 &&
    Math.abs(a.width - b.width) <= 1 &&
    Math.abs(a.height - b.height) <= 1;
  const sameSize = (
    a: { width: number; height: number },
    b: { width: number; height: number },
  ) => Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
  const descriptionFits = (value: NonNullable<ReviewTarget['element']>) =>
    value.path.length <= 120 && value.cssPath.length <= 2000;
  const visible = (node: Element) => {
    if (node.closest(privateContent)) return false;
    const style = getComputedStyle(node);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse'
    );
  };
  const sameEvidence = (
    a: NonNullable<ReviewTarget['element']>,
    b: NonNullable<ReviewTarget['element']>,
  ) => a.tag === b.tag && a.text === b.text && a.label === b.label;
  const boundedElements = (root: Element) => {
    const nodes: Element[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let child: Node | null = root;
    while (child && nodes.length < scanLimit) {
      nodes.push(child as Element);
      child = walker.nextNode();
    }
    return { nodes, truncated: child !== null };
  };

  const hitIsTextOrControl = (x: number, y: number, hit: Element) => {
    if (hit.closest(privateContent)) return true;
    const control =
      hit.closest(
        'button,a,input,textarea,select,[role="button"],[role="slider"]',
      ) ?? hit.closest(atomic);
    if (
      control &&
      inside(rectangle(control.getBoundingClientRect()), {
        x,
        y,
        width: 0,
        height: 0,
      })
    )
      return true;
    const caretDocument = document as {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const caret = caretDocument.caretPositionFromPoint?.(x, y);
    const caretRange = caret ? null : caretDocument.caretRangeFromPoint?.(x, y);
    const node = caret?.offsetNode ?? caretRange?.startContainer;
    const offset = caret?.offset ?? caretRange?.startOffset;
    if (
      !node ||
      node.nodeType !== Node.TEXT_NODE ||
      offset === undefined ||
      !node.parentElement ||
      node.parentElement.closest(excluded)
    )
      return false;
    // A caret API also returns the nearest text for empty paragraph space. Check
    // a real character box before choosing native text selection.
    for (const index of [offset - 1, offset]) {
      if (index < 0 || index >= (node.textContent?.length ?? 0)) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      if (
        [...range.getClientRects()].some(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            inside(rectangle(rect), { x, y, width: 0, height: 0 }),
        )
      )
        return true;
    }
    return false;
  };

  const collectAreaMembers = (
    container: Element,
    selected: Rectangle,
    limit = 8,
  ) => {
    const result: AreaTarget['area']['members'] = [];
    const origin = rectangle(container.getBoundingClientRect());
    let truncated = false;
    let inspected = 0;
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          return (node as Element).matches(privateContent)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    let node: Element | null = container;
    let acceptedAncestor: Element | null = null;
    while (node) {
      if (++inspected > scanLimit) {
        truncated = true;
        break;
      }
      if (
        (!acceptedAncestor || !acceptedAncestor.contains(node)) &&
        visible(node)
      ) {
        const rect = rectangle(node.getBoundingClientRect());
        if (rect.width > 0 && rect.height > 0 && intersects(rect, selected)) {
          const isAtomic = node.matches(atomic);
          const isBlock = node.matches(blocks);
          const hasOwnText = [...node.childNodes].some(
            (child) =>
              child.nodeType === Node.TEXT_NODE && clean(child.textContent, 1),
          );
          // Inline decoration stays with its readable block. Generic layout
          // wrappers are skipped unless they directly contain readable text.
          const meaningful =
            isAtomic ||
            isBlock ||
            (hasOwnText && !node.querySelector(`${blocks},${atomic}`));
          const element = meaningful ? describe(node) : null;
          if (element && (isAtomic || element.text || element.label)) {
            acceptedAncestor = node;
            if (!descriptionFits(element)) truncated = true;
            else if (result.length === limit) {
              truncated = true;
              break;
            } else
              result.push({
                element,
                rect: relativeRect(rect, origin),
                coverage: inside(selected, rect, 0.01) ? 'full' : 'partial',
              });
          }
        }
      }
      node = walker.nextNode() as Element | null;
    }
    return { members: result, truncated };
  };

  const layoutFingerprint = (container: Element) => {
    const origin = rectangle(container.getBoundingClientRect());
    let hashA = 2166136261;
    let hashB = 2246822507;
    let inspected = 0;
    let boxes = 0;
    let truncated = false;
    const add = (value: string) => {
      for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        hashA = Math.imul(hashA ^ code, 16777619) >>> 0;
        hashB = Math.imul(hashB ^ code, 3266489909) >>> 0;
      }
    };
    const addRect = (tag: string, bounds: DOMRect) => {
      if (bounds.width <= 0 || bounds.height <= 0) return;
      if (++boxes > 4000) {
        truncated = true;
        return;
      }
      const relative = relativeRect(rectangle(bounds), origin);
      // Layout evidence contains geometry, not editable values or rendered
      // pixels. Sixteenth-pixel rounding removes arithmetic noise after a move.
      add(
        `${tag}:${[relative.x, relative.y, relative.width, relative.height]
          .map((value) => Math.round(value * 16))
          .join(',')};`,
      );
    };
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return node instanceof Element && node.matches(privateContent)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    let node: Node | null = container;
    while (node) {
      if (++inspected > scanLimit || truncated) {
        truncated = true;
        break;
      }
      if (node instanceof Element) {
        if (visible(node))
          addRect(node.localName, node.getBoundingClientRect());
      } else if (
        node.parentElement &&
        !node.parentElement.closest(excluded) &&
        visible(node.parentElement) &&
        clean(node.textContent, 1)
      ) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const bounds of range.getClientRects()) {
          addRect('text', bounds);
          if (truncated) break;
        }
      }
      node = walker.nextNode();
    }
    return {
      fingerprint: `v1:${hashA.toString(16).padStart(8, '0')}${hashB.toString(16).padStart(8, '0')}`,
      truncated,
    };
  };

  const captureArea = (selected: Rectangle): ReviewTarget | null => {
    if (
      !Object.values(selected).every(Number.isFinite) ||
      selected.width < 6 ||
      selected.height < 6
    )
      return null;
    const center = document.elementFromPoint(
      selected.x + selected.width / 2,
      selected.y + selected.height / 2,
    );
    let container: Element | null = center;
    while (
      container &&
      (!inside(rectangle(container.getBoundingClientRect()), selected) ||
        container.closest(privateContent) ||
        container.matches(atomic))
    )
      container = container.parentElement;
    if (!container) return null;
    const origin = rectangle(container.getBoundingClientRect());
    const element = describe(container);
    if (!descriptionFits(element) || !origin.width || !origin.height)
      return null;
    const covered = collectAreaMembers(container, selected);
    const target: AreaTarget = {
      version: 1,
      kind: 'area',
      element,
      area: {
        rect: relativeRect(selected, origin),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        container: { width: origin.width, height: origin.height },
        layout: layoutFingerprint(container),
        ...covered,
      },
    };
    // Preserve complete descriptions and disclose omitted coverage rather than
    // silently clipping an excerpt into an apparent exact content signature.
    while (
      JSON.stringify(target).length > 20000 &&
      target.area.members.length
    ) {
      target.area.members.pop();
      target.area.truncated = true;
    }
    return JSON.stringify(target).length <= 20000 ? target : null;
  };

  const capturePointGeometry = (
    node: Element,
  ): NonNullable<
    Extract<ReviewTarget, { kind: 'point' }>['geometry']
  > | null => {
    const bounds = rectangle(node.getBoundingClientRect());
    if (bounds.width <= 0 || bounds.height <= 0 || !visible(node)) return null;
    const members = collectAreaMembers(node, bounds);
    const layout = layoutFingerprint(node);
    const geometry = {
      width: bounds.width,
      height: bounds.height,
      layout: {
        ...members,
        fingerprint: layout.fingerprint,
        truncated: members.truncated || layout.truncated,
      },
    };
    const target = {
      version: 1,
      kind: 'point',
      element: describe(node),
      geometry,
    };
    while (
      JSON.stringify(target).length > 20000 &&
      geometry.layout.members.length
    ) {
      geometry.layout.members.pop();
      geometry.layout.truncated = true;
    }
    return JSON.stringify(target).length <= 20000 ? geometry : null;
  };
  const sameMembers = (
    a: AreaTarget['area']['members'],
    b: AreaTarget['area']['members'],
  ) =>
    a.length === b.length &&
    a.every((member, index) => {
      const previous = b[index];
      return (
        sameEvidence(member.element, previous.element) &&
        member.element.reviewId === previous.element.reviewId &&
        member.coverage === previous.coverage &&
        sameRect(member.rect, previous.rect)
      );
    });

  const rangeAt = (
    node: Element,
    startOffset: number,
    endOffset: number,
  ): Range | null => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0;
    let started = false;
    let textNode: Node | null;
    while ((textNode = walker.nextNode())) {
      const end = offset + (textNode.textContent?.length ?? 0);
      if (!started && startOffset <= end) {
        range.setStart(textNode, startOffset - offset);
        started = true;
      }
      if (started && endOffset <= end) {
        range.setEnd(textNode, endOffset - offset);
        return range;
      }
      offset = end;
    }
    return null;
  };
  const quoteRanges = (
    target: Extract<ReviewTarget, { kind: 'text' }>,
    node: Element,
  ) => {
    const quote = target.text;
    const exact = quote.domExact ?? quote.exact;
    const content = node.textContent ?? '';
    const matches: Range[] = [];
    let start = content.indexOf(exact);
    let checked = 0;
    while (start !== -1 && checked++ < scanLimit) {
      const end = start + exact.length;
      if (
        content.slice(Math.max(0, start - quote.prefix.length), start) ===
          quote.prefix &&
        content.slice(end, end + quote.suffix.length) === quote.suffix
      ) {
        const range = rangeAt(node, start, end);
        if (
          range &&
          !node.closest(excluded) &&
          ![...node.querySelectorAll(excluded)].some((child) =>
            range.intersectsNode(child),
          )
        ) {
          matches.push(range);
          if (matches.length > 1) break;
        }
      }
      start = content.indexOf(exact, start + 1);
    }
    return { matches, truncated: checked >= scanLimit && start !== -1 };
  };
  const resolveTarget = (
    target: ReviewTarget,
    crossRevision = false,
  ): {
    status: TargetResolutionStatus;
    node: Element | null;
    range: Range | null;
    rect: Rectangle | null;
  } => {
    const failed = (status: TargetResolutionStatus) => ({
      status,
      node: null,
      range: null,
      rect: null,
    });
    const original = target.element;
    if (!original) return failed(crossRevision ? 'not_checked' : 'missing');
    if (
      crossRevision &&
      ((target.kind === 'point' &&
        (!target.geometry?.layout?.fingerprint ||
          target.geometry.layout.truncated)) ||
        (target.kind === 'area' &&
          (target.area.truncated ||
            !target.area.layout ||
            target.area.layout.truncated)))
    )
      return failed('not_checked');
    let node: Element | null = null;
    let range: Range | null = null;
    if (original.reviewId) {
      const scan = boundedElements(document.documentElement);
      if (scan.truncated) return failed('not_checked');
      const matches = scan.nodes.filter(
        (candidate) =>
          candidate.getAttribute('data-review-id') === original.reviewId,
      );
      if (matches.length > 1) return failed('ambiguous');
      if (matches.length === 1) node = matches[0];
      else if (!crossRevision) return failed('missing');
    }
    if (!node && !crossRevision) {
      node = document.documentElement;
      for (const index of original.path.split('.').filter(Boolean).map(Number))
        node = node?.children[index] ?? null;
      if (!node) return failed('missing');
    }
    if (!node && crossRevision) {
      const scan = boundedElements(document.documentElement);
      if (scan.truncated) return failed('not_checked');
      const candidates = scan.nodes.filter(
        (candidate) =>
          candidate.localName === original.tag && visible(candidate),
      );
      if (target.kind === 'text') {
        const matches: { node: Element; range: Range }[] = [];
        for (const candidate of candidates) {
          const quotes = quoteRanges(target, candidate);
          if (quotes.truncated) return failed('not_checked');
          for (const quote of quotes.matches)
            matches.push({ node: candidate, range: quote });
          if (matches.length > 1) return failed('ambiguous');
        }
        if (!matches.length) return failed('missing');
        node = matches[0].node;
        range = matches[0].range;
      } else {
        // An empty or clipped excerpt cannot establish unique content identity.
        if ((!original.text && !original.label) || original.text.length >= 1200)
          return failed('not_checked');
        const matches = candidates.filter((candidate) =>
          sameEvidence(describe(candidate), original),
        );
        if (matches.length > 1) return failed('ambiguous');
        if (!matches.length) return failed('missing');
        node = matches[0];
      }
    }
    if (!node || node.localName !== original.tag || !visible(node))
      return failed('changed');
    if (target.kind === 'text') {
      if (crossRevision) {
        if (!range) {
          const quotes = quoteRanges(target, node);
          if (quotes.truncated) return failed('not_checked');
          if (quotes.matches.length > 1) return failed('ambiguous');
          if (!quotes.matches.length) return failed('changed');
          range = quotes.matches[0];
        }
      } else {
        if (resolve(target) !== node) return failed('changed');
        range = rangeFor(target, node);
        if (!range) return failed('changed');
      }
      return { status: 'matching', node, range, rect: null };
    }
    if (!sameEvidence(describe(node), original)) return failed('changed');
    const bounds = rectangle(node.getBoundingClientRect());
    if (
      target.kind === 'point' &&
      target.geometry &&
      !sameSize(bounds, target.geometry)
    )
      return failed('changed');
    if (target.kind === 'point' && target.geometry?.layout) {
      const previous = target.geometry.layout;
      if (previous.fingerprint) {
        const layout = layoutFingerprint(node);
        if (layout.truncated) return failed('not_checked');
        if (previous.fingerprint !== layout.fingerprint)
          return failed('changed');
      }
      const current = collectAreaMembers(
        node,
        bounds,
        previous.truncated ? previous.members.length : 8,
      );
      if (
        current.truncated !== previous.truncated ||
        !sameMembers(current.members, previous.members)
      )
        return failed('changed');
    }
    if (target.kind === 'area') {
      if (target.area.layout) {
        const layout = layoutFingerprint(node);
        if (target.area.layout.truncated || layout.truncated)
          return failed('not_checked');
        if (target.area.layout.fingerprint !== layout.fingerprint)
          return failed('changed');
      }
      if (!sameSize(bounds, target.area.container)) return failed('changed');
      const rect = {
        x: bounds.x + target.area.rect.x,
        y: bounds.y + target.area.rect.y,
        width: target.area.rect.width,
        height: target.area.rect.height,
      };
      const current = collectAreaMembers(
        node,
        rect,
        target.area.truncated ? target.area.members.length : 8,
      );
      if (
        current.truncated !== target.area.truncated ||
        current.members.length !== target.area.members.length
      )
        return failed('changed');
      if (!sameMembers(current.members, target.area.members))
        return failed('changed');
      return { status: 'matching', node, range: null, rect };
    }
    return { status: 'matching', node, range: null, rect: null };
  };
  return {
    describe,
    targetFor,
    capture,
    resolve,
    rangeFor,
    captureArea,
    capturePointGeometry,
    hitIsTextOrControl,
    resolveTarget,
  };
}
