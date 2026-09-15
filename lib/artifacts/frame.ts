import type { FramePin, PinPosition } from './point';
import type { ReviewTarget, TargetResolutionStatus } from './review-target';
import { reviewSelection } from './selection';

export function reviewStateValue(input: {
  type: string;
  value: string;
  checked: boolean;
}) {
  if (input.type === 'password') return null;
  if (input.type === 'checkbox' || input.type === 'radio') return input.checked;
  return input.value.replace(/\s+/g, ' ').trim().slice(0, 300);
}

// Runs inside an opaque-origin iframe. Its reports are untrusted review context.
function bridge(
  token: string,
  readState: typeof reviewStateValue,
  createSelection: typeof reviewSelection,
) {
  const selection = createSelection();
  let port: MessagePort | undefined;
  let commenting = false;
  let areaMode = false;
  let pins: FramePin[] = [];
  let generation = 0;
  let revisionId = '';
  let highlightedPin: string | null = null;
  let scheduled = false;
  const clean = (value: string | null | undefined, max: number) =>
    (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const send = (value: unknown) => port?.postMessage(value);
  let lastTheme = '';
  const themeCanvas = document.createElement('canvas');
  themeCanvas.width = themeCanvas.height = 1;
  const themeContext = themeCanvas.getContext('2d', {
    willReadFrequently: true,
  });
  const theme = () => {
    if (!port || !document.body || !themeContext) return;
    // Composite transparent backgrounds over the iframe's white canvas.
    // Sampling solid CSS colors also normalizes modern color spaces to sRGB.
    themeContext.fillStyle = '#ffffff';
    themeContext.fillRect(0, 0, 1, 1);
    for (const node of [document.documentElement, document.body]) {
      themeContext.fillStyle = getComputedStyle(node).backgroundColor;
      themeContext.fillRect(0, 0, 1, 1);
    }
    const color =
      '#' +
      [...themeContext.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('');
    if (color === lastTheme) return;
    lastTheme = color;
    send({ type: 'theme', color });
  };
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const pathFor = (node: Element) => {
    const path: number[] = [];
    if (node === document.body || node === document.documentElement) return '';
    while (node.parentElement && node !== document.documentElement) {
      path.unshift([...node.parentElement.children].indexOf(node));
      node = node.parentElement;
    }
    const value = path.join('.');
    return value.length <= 120 ? value : '';
  };
  const legacyNodeFor = (pin: FramePin): Element | null => {
    if (pin.anchorId) {
      const matches = [...document.querySelectorAll('[data-review-id]')].filter(
        (node) => node.getAttribute('data-review-id') === pin.anchorId,
      );
      // Do not guess when a declared anchor has gone missing or is ambiguous.
      return matches.length === 1 &&
        selection.describe(matches[0]).text === pin.context
        ? matches[0]
        : null;
    }
    if (!pin.point?.path) return null;
    let node: Element = document.documentElement;
    for (const index of pin.point.path.split('.').map(Number)) {
      if (!node.children[index]) return null;
      node = node.children[index];
    }
    return clean(node.textContent, 1200) === pin.context ? node : null;
  };
  const endRect = (range: Range) =>
    [...range.getClientRects()]
      .filter((rect) => rect.width && rect.height)
      .at(-1) ?? range.getBoundingClientRect();
  const resolvePin = (pin: FramePin) => {
    if (pin.target?.element)
      return selection.resolveTarget(pin.target, pin.crossRevision === true);
    const result = {
      status: 'not_checked' as TargetResolutionStatus,
      node: null as Element | null,
      range: null as Range | null,
      rect: null as {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null,
    };
    if (pin.crossRevision) return result;
    if (pin.target && pin.target.kind !== 'point') return result;
    const node = legacyNodeFor(pin);
    if (node) return { ...result, status: 'matching' as const, node };
    if (pin.anchorId || pin.point?.path)
      return { ...result, status: 'missing' as const };
    if (pin.point)
      return {
        ...result,
        status:
          Math.abs(pin.point.width - innerWidth) <= 1
            ? ('matching' as const)
            : ('changed' as const),
      };
    return result;
  };
  const positionFor = (
    pin: FramePin,
    resolved: ReturnType<typeof resolvePin>,
  ): PinPosition | null => {
    if (resolved.status !== 'matching' || pin.showPin === false) return null;
    const { node, range } = resolved;
    if (resolved.rect) {
      const rect = resolved.rect;
      const edge = rect.x + rect.width;
      return {
        id: pin.id,
        x: edge === innerWidth ? edge - 1 : edge,
        y: rect.y,
      };
    }
    if (node) {
      const rect = range ? endRect(range) : node.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      if (range) return { id: pin.id, x: rect.right, y: rect.bottom };
      if (pin.crossRevision && pin.target?.kind === 'element')
        return { id: pin.id, x: rect.right, y: rect.top };
      return {
        id: pin.id,
        x: rect.left + rect.width * (pin.point?.relativeX ?? 1),
        y: rect.top + rect.height * (pin.point?.relativeY ?? 0),
      };
    }
    if (pin.anchorId || !pin.point || pin.point.path) return null;
    return {
      id: pin.id,
      x: pin.point.x - scrollX,
      y: pin.point.y - scrollY,
    };
  };
  const positions = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const resolved = pins.map((pin) => ({ pin, target: resolvePin(pin) }));
      send({
        type: 'resolutions',
        generation,
        revisionId,
        resolutions: resolved.map(({ pin, target }) => ({
          id: pin.id,
          status: target.status,
        })),
      });
      send({
        type: 'positions',
        generation,
        revisionId,
        positions: resolved
          .map(({ pin, target }) => positionFor(pin, target))
          .filter(Boolean),
      });
      if (highlightedPin) {
        const active = resolved.find(({ pin }) => pin.id === highlightedPin);
        if (!active || active.target.status !== 'matching') clearHighlight();
        else if (active.pin.target?.kind === 'area' && active.target.rect)
          drawArea(active.target.rect);
      }
    });
  };
  const inventory = () => {
    theme();
    send({
      type: 'inventory',
      anchors: [...document.querySelectorAll('[data-review-id]')]
        .slice(0, 500)
        .map((node) => ({
          id: clean(node.getAttribute('data-review-id'), 160),
          text: clean(node.textContent, 1200),
        })),
    });
    positions();
  };
  const style = document.createElement('style');
  style.textContent =
    '[data-oa-selected]{outline:2px solid #7694ff!important;outline-offset:3px!important}html[data-oa-commenting] *{cursor:crosshair!important}html[data-oa-commenting] ::selection{background:#7694ff66!important}html[data-oa-area],html[data-oa-area] *{touch-action:none!important;user-select:none!important;-webkit-user-select:none!important}';
  document.head.appendChild(style);
  const hover = document.createElement('div');
  hover.setAttribute('data-oa-ui', '');
  hover.setAttribute('aria-hidden', 'true');
  hover.style.cssText =
    'position:fixed!important;z-index:2147483647!important;pointer-events:none!important;border:2px solid #7694ff!important;background:#7694ff18!important;box-sizing:border-box!important;display:none;';
  const areaOutline = document.createElement('div');
  areaOutline.setAttribute('data-oa-ui', '');
  areaOutline.setAttribute('aria-hidden', 'true');
  areaOutline.style.cssText =
    'position:fixed!important;z-index:2147483647!important;pointer-events:none!important;border:2px dashed #7694ff!important;background:#7694ff18!important;box-sizing:border-box!important;display:none;';
  const drawArea = (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => {
    if (!areaOutline.isConnected)
      document.documentElement.appendChild(areaOutline);
    Object.assign(areaOutline.style, {
      display: 'block',
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${Math.max(2, rect.width)}px`,
      height: `${Math.max(2, rect.height)}px`,
    });
  };
  const isPageTarget = (node: Element) => {
    if (node === document.body || node === document.documentElement)
      return true;
    if (!node.matches('main,article,section,div,[role="main"]')) return false;
    // A sole content wrapper is the page too, even when nested or scrollable.
    let current = node;
    while (current.parentElement) {
      const parent = current.parentElement;
      if (
        [...parent.childNodes].some((sibling) => {
          if (sibling === current) return false;
          if (sibling.nodeType === Node.TEXT_NODE)
            return !!sibling.textContent?.trim();
          return (
            sibling instanceof Element &&
            !sibling.matches('script,style,noscript,template,[data-oa-ui]') &&
            sibling.getClientRects().length > 0
          );
        })
      )
        return false;
      if (parent === document.body) return true;
      current = parent;
    }
    return false;
  };
  let hovered: Element | null = null;
  const hideHover = () => {
    hover.style.display = 'none';
    hovered = null;
  };
  const showHover = (node: Element) => {
    if (isPageTarget(node) || node.hasAttribute('data-oa-ui')) {
      hideHover();
      return;
    }
    hovered = node;
    const rect = node.getBoundingClientRect();
    Object.assign(hover.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  };
  const clearHighlight = () => {
    highlightedPin = null;
    areaOutline.style.display = 'none';
    document
      .querySelectorAll('[data-oa-selected]')
      .forEach((node) => node.removeAttribute('data-oa-selected'));
  };
  window.addEventListener('message', function receive(event) {
    if (
      event.source !== parent ||
      event.data?.type !== 'oa-connect' ||
      event.data.token !== token ||
      !event.ports[0] ||
      port
    )
      return;
    port = event.ports[0];
    window.removeEventListener('message', receive);
    port.onmessage = (event) => {
      if (event.data?.type === 'mode') {
        const nextArea =
          event.data.commenting === true && event.data.areaMode === true;
        if (areaMode !== nextArea || !event.data.commenting) resetArea(false);
        commenting = event.data.commenting === true;
        areaMode = nextArea;
        document.documentElement.toggleAttribute('data-oa-area', areaMode);
        document.documentElement.toggleAttribute(
          'data-oa-commenting',
          commenting,
        );
        if (commenting) {
          document.documentElement.appendChild(hover);
        } else {
          hover.remove();
          hideHover();
        }
        document
          .querySelectorAll(
            '[data-review-id],h1,h2,h3,h4,h5,h6,p,li,figcaption,blockquote,img,svg,canvas',
          )
          .forEach((node) => {
            if (
              commenting &&
              !isPageTarget(node) &&
              !node.hasAttribute('tabindex')
            ) {
              node.setAttribute('tabindex', '0');
              node.setAttribute('data-oa-tab', '');
            }
            if (!commenting && node.hasAttribute('data-oa-tab')) {
              node.removeAttribute('tabindex');
              node.removeAttribute('data-oa-tab');
            }
          });
        if (!commenting) {
          clearHighlight();
          getSelection()?.removeAllRanges();
        } else if (areaMode) {
          getSelection()?.removeAllRanges();
          keyboardPoint = {
            x: Math.round(innerWidth / 2),
            y: Math.round(innerHeight / 2),
          };
          drawArea({ ...keyboardPoint, width: 2, height: 2 });
        }
      }
      if (event.data?.type === 'pins' && Array.isArray(event.data.pins)) {
        pins = event.data.pins.slice(0, 500);
        generation = event.data.generation;
        revisionId = event.data.revisionId;
        positions();
      }
      if (event.data?.type === 'locate' && typeof event.data.id === 'string') {
        const pin = pins.find((pin) => pin.id === event.data.id);
        if (!pin) return;
        const resolved = resolvePin(pin);
        if (resolved.status !== 'matching') {
          clearHighlight();
          positions();
          return;
        }
        const node = resolved.node;
        clearHighlight();
        highlightedPin = pin.id;
        if (resolved.rect) {
          window.scrollBy(
            0,
            resolved.rect.y + resolved.rect.height / 2 - innerHeight / 2,
          );
          const updated = resolvePin(pin);
          if (updated.rect) drawArea(updated.rect);
          positions();
          return;
        }
        if (node) {
          node.scrollIntoView({ block: 'center', inline: 'nearest' });
          const range = resolved.range;
          if (range) {
            getSelection()?.removeAllRanges();
            getSelection()?.addRange(range);
            const rect = range.getBoundingClientRect();
            window.scrollBy(0, rect.top - innerHeight / 2);
          } else node.setAttribute('data-oa-selected', '');
        } else if (
          !pin.crossRevision &&
          !pin.target &&
          !pin.anchorId &&
          pin.point &&
          !pin.point.path
        ) {
          window.scrollTo({
            top: Math.max(0, pin.point.y - innerHeight / 2),
            left: 0,
          });
        } else if (
          !pin.crossRevision &&
          pin.target?.kind === 'point' &&
          !pin.target.element &&
          pin.point
        ) {
          window.scrollTo({
            top: Math.max(0, pin.point.y - innerHeight / 2),
            left: 0,
          });
        }
        positions();
      }
    };
    inventory();
  });
  function select(
    node: Element,
    x: number,
    y: number,
    selectedText?: ReviewTarget,
  ) {
    hideHover();
    clearHighlight();
    if (!selectedText && isPageTarget(node)) return;
    const element = selection.describe(node);
    const isDocument =
      node === document.body || node === document.documentElement;
    let reviewTarget: ReviewTarget =
      selectedText ??
      (isDocument
        ? { version: 1, kind: 'point' }
        : { version: 1, kind: 'element', element });
    if (element.path.length > 120 || element.cssPath.length > 2000)
      reviewTarget = { version: 1, kind: 'point' };
    if (reviewTarget.kind === 'element')
      node.setAttribute('data-oa-selected', '');
    const rect = node.getBoundingClientRect();
    const isPage = node === document.body || node === document.documentElement;
    const state: Record<string, string | boolean> = {};
    [...document.querySelectorAll('[data-review-state]')]
      .slice(0, 19)
      .forEach((node) => {
        const input = node as HTMLInputElement;
        const key = input.getAttribute('data-review-state');
        if (
          !key ||
          key.startsWith('__oa_') ||
          key.length > 160 ||
          input.type === 'password' ||
          !('value' in input)
        )
          return;
        const value = readState(input);
        if (value !== null) state[key] = value;
      });
    state.__oa_point = JSON.stringify({
      version: 1,
      x: round(Math.max(0, x + scrollX)),
      y: round(Math.max(0, y + scrollY)),
      width: innerWidth,
      relativeX: round(
        Math.max(0, Math.min(1, (x - rect.left) / (rect.width || 1))),
      ),
      relativeY: round(
        Math.max(0, Math.min(1, (y - rect.top) / (rect.height || 1))),
      ),
      path: reviewTarget.kind === 'point' ? '' : pathFor(node),
    });
    state.__oa_target = JSON.stringify(reviewTarget);
    send({
      type: 'target',
      anchorId: reviewTarget.kind === 'point' ? null : element.reviewId,
      excerpt:
        reviewTarget.kind === 'text'
          ? reviewTarget.text.exact.slice(0, 1200)
          : reviewTarget.kind === 'area'
            ? clean(
                reviewTarget.area.members
                  .map((member) => member.element.text || member.element.label)
                  .filter(Boolean)
                  .join(' · '),
                1200,
              )
            : isPage
              ? ''
              : element.text || element.label,
      section: isPage
        ? ''
        : clean(
            node.closest('section,article,main')?.querySelector('h1,h2,h3')
              ?.textContent,
            200,
          ),
      viewState: state,
      position: { x, y },
    });
  }
  const target = (event: Event) =>
    event.target instanceof Element ? selection.targetFor(event.target) : null;
  let pointerDown = false;
  let selectionHandled = false;
  type AreaPoint = { x: number; y: number };
  let areaDrag: {
    start: AreaPoint;
    end: AreaPoint;
    pointerId: number;
    hit: Element;
    explicit: boolean;
  } | null = null;
  let canceledPointer: number | null = null;
  let keyboardPoint: AreaPoint | null = null;
  let keyboardStart: AreaPoint | null = null;
  const clampPoint = (x: number, y: number): AreaPoint => ({
    x: Math.max(0, Math.min(innerWidth, x)),
    y: Math.max(0, Math.min(innerHeight, y)),
  });
  const areaRect = (start: AreaPoint, end: AreaPoint) => ({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x),
    height: Math.abs(start.y - end.y),
  });
  function resetArea(notify: boolean) {
    if (areaDrag) {
      canceledPointer = areaDrag.pointerId;
      try {
        document.documentElement.releasePointerCapture(areaDrag.pointerId);
      } catch {
        /* Pointer already released. */
      }
    }
    if (areaDrag || keyboardPoint) areaOutline.style.display = 'none';
    areaDrag = null;
    keyboardPoint = null;
    keyboardStart = null;
    pointerDown = false;
    if (notify && areaMode) {
      areaMode = false;
      document.documentElement.removeAttribute('data-oa-area');
      send({ type: 'area-mode-end' });
    }
  }
  const commitArea = (rect: ReturnType<typeof areaRect>) => {
    if (rect.width < 6 || rect.height < 6) {
      send({
        type: 'selection-error',
        message: 'Select an area at least 6 by 6 pixels.',
      });
      return false;
    }
    const captured = selection.captureArea(rect);
    if (!captured || captured.kind !== 'area') {
      send({
        type: 'selection-error',
        message:
          'This area cannot be attached. Try a smaller area within the artifact.',
      });
      return false;
    }
    const resolved = selection.resolveTarget(captured);
    if (!resolved.node) return false;
    resetArea(true);
    select(
      resolved.node,
      Math.min(innerWidth - 1, rect.x + rect.width),
      rect.y,
      captured,
    );
    drawArea(rect);
    highlightedPin = 'draft';
    return true;
  };
  const sendSelection = () => {
    const current = getSelection();
    if (!current || current.isCollapsed || !current.rangeCount) return false;
    const range = current.getRangeAt(0);
    const captured = selection.capture(range, current.toString());
    if (!captured) {
      send({
        type: 'selection-error',
        message:
          Math.max(range.toString().length, current.toString().length) > 8000
            ? 'Select up to 8,000 characters for one comment.'
            : 'This selection cannot be attached. Select text within the artifact or click an element.',
      });
      return true;
    }
    const common = range.commonAncestorContainer;
    const node = common instanceof Element ? common : common.parentElement!;
    const rect = endRect(range);
    select(
      node,
      Math.max(0, Math.min(innerWidth, rect.right)),
      Math.max(0, Math.min(innerHeight, rect.bottom)),
      captured,
    );
    return true;
  };
  document.addEventListener(
    'pointermove',
    (event) => {
      if (commenting && areaDrag && event.pointerId === areaDrag.pointerId) {
        areaDrag.end = clampPoint(event.clientX, event.clientY);
        const rect = areaRect(areaDrag.start, areaDrag.end);
        if (rect.width >= 6 || rect.height >= 6 || areaDrag.explicit)
          drawArea(rect);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!commenting || pointerDown) {
        hideHover();
        return;
      }
      const node = target(event);
      if (node && !areaMode) showHover(node);
      event.stopImmediatePropagation();
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!commenting || event.button !== 0) return;
      if (areaDrag) {
        resetArea(true);
        selectionHandled = true;
        return;
      }
      canceledPointer = null;
      pointerDown = true;
      selectionHandled = false;
      hideHover();
      clearHighlight();
      const hit = target(event);
      const start = clampPoint(event.clientX, event.clientY);
      if (
        hit &&
        (areaMode ||
          (event.pointerType !== 'touch' &&
            !selection.hitIsTextOrControl(start.x, start.y, hit)))
      ) {
        keyboardPoint = null;
        keyboardStart = null;
        getSelection()?.removeAllRanges();
        areaDrag = {
          start,
          end: start,
          pointerId: event.pointerId,
          hit,
          explicit: areaMode,
        };
        try {
          document.documentElement.setPointerCapture(event.pointerId);
        } catch {
          /* Capture is optional outside the viewport. */
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // Preserve native text dragging while preventing artifact controls from changing.
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
        )
      ) {
        getSelection()?.removeAllRanges();
        event.preventDefault();
      }
      event.stopImmediatePropagation();
    },
    true,
  );
  document.addEventListener(
    'pointerup',
    (event) => {
      if (!commenting) return;
      if (canceledPointer === event.pointerId) {
        canceledPointer = null;
        selectionHandled = true;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (areaDrag && event.pointerId === areaDrag.pointerId) {
        const drag = areaDrag;
        const end = clampPoint(event.clientX, event.clientY);
        const rect = areaRect(drag.start, end);
        selectionHandled = true;
        resetArea(false);
        if (!drag.explicit && rect.width < 6 && rect.height < 6)
          select(drag.hit, end.x, end.y);
        else commitArea(rect);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      pointerDown = false;
      selectionHandled = sendSelection();
      event.stopImmediatePropagation();
    },
    true,
  );
  document.addEventListener(
    'pointercancel',
    () => {
      selectionHandled = true;
      resetArea(true);
    },
    true,
  );
  // Artifact mouse handlers must not run while the reviewer selects text.
  for (const name of ['mousedown', 'mouseup', 'dblclick', 'dragstart'])
    document.addEventListener(
      name,
      (event) => {
        if (!commenting) return;
        event.stopImmediatePropagation();
        if (name === 'dragstart') event.preventDefault();
      },
      true,
    );
  document.addEventListener(
    'click',
    (event) => {
      if (!commenting) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (selectionHandled) {
        selectionHandled = false;
        return;
      }
      if (sendSelection()) return;
      const node = target(event);
      if (node) select(node, event.clientX, event.clientY);
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (!commenting) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (areaDrag || areaMode) {
          selectionHandled = true;
          resetArea(true);
          return;
        }
        getSelection()?.removeAllRanges();
        hideHover();
        send({ type: 'cancel' });
        return;
      }
      if (
        areaMode &&
        (event.key.startsWith('Arrow') ||
          event.key === 'Enter' ||
          event.key === ' ')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        keyboardPoint ??= {
          x: Math.round(innerWidth / 2),
          y: Math.round(innerHeight / 2),
        };
        if (event.key.startsWith('Arrow')) {
          const step = event.shiftKey ? 32 : 8;
          keyboardPoint = clampPoint(
            keyboardPoint.x +
              (event.key === 'ArrowRight'
                ? step
                : event.key === 'ArrowLeft'
                  ? -step
                  : 0),
            keyboardPoint.y +
              (event.key === 'ArrowDown'
                ? step
                : event.key === 'ArrowUp'
                  ? -step
                  : 0),
          );
          drawArea(
            keyboardStart
              ? areaRect(keyboardStart, keyboardPoint)
              : { ...keyboardPoint, width: 2, height: 2 },
          );
        } else if (!keyboardStart) keyboardStart = { ...keyboardPoint };
        else commitArea(areaRect(keyboardStart, keyboardPoint));
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const node = target(event);
      if (!node) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (sendSelection()) return;
      const rect = node.getBoundingClientRect();
      select(node, rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    true,
  );
  window.addEventListener('blur', () => {
    if (areaDrag || keyboardPoint) resetArea(true);
    hideHover();
  });
  window.addEventListener(
    'scroll',
    () => {
      if (areaDrag || keyboardStart) {
        selectionHandled = true;
        resetArea(true);
      }
      if (hovered) showHover(hovered);
    },
    true,
  );
  window.addEventListener('scroll', positions, true);
  window.addEventListener('resize', positions);
  window.addEventListener('resize', () => resetArea(true));
  window.addEventListener('resize', theme);
  document.addEventListener('load', positions, true);
  document.fonts?.addEventListener('loadingdone', positions);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme);
  window.addEventListener('DOMContentLoaded', () => {
    inventory();
    let timer: ReturnType<typeof setTimeout>;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(inventory, 200);
    }).observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-review-id',
        'aria-label',
        'aria-labelledby',
        'id',
        'alt',
        'title',
        'class',
        'style',
        'hidden',
      ],
    });
    new ResizeObserver(positions).observe(document.body);
    const themeObserver = new MutationObserver(() => {
      theme();
      positions();
    });
    for (const node of [document.documentElement, document.body])
      themeObserver.observe(node, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    themeObserver.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  parent.postMessage({ type: 'oa-ready', token }, '*');
}

export function frameDocument(html: string, token: string) {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><script>((${bridge.toString()})(${JSON.stringify(token)},${reviewStateValue.toString()},${reviewSelection.toString()}))</script></head><body>${html}</body></html>`;
}
