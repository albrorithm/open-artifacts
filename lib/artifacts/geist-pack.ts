export type GeistAssets = {
  sans: string;
  mono: string;
  css: string;
  license: string;
};

type Slot = { start: number; end: number; bodyStart: number; bodyEnd: number };

function tagEnd(source: string, start: number) {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index + 1;
  }
  return -1;
}

function closeTag(source: string, name: string, start: number) {
  const match = new RegExp(`</${name}\\s*>`, 'i').exec(source.slice(start));
  return match
    ? { start: start + match.index, end: start + match.index + match[0].length }
    : null;
}

function attrs(startTag: string) {
  const values: { name: string; value: string }[] = [];
  const pattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(startTag.slice(1, -1))))
    values.push({
      name: match[1].toLowerCase(),
      value: match[2] ?? match[3] ?? match[4] ?? '',
    });
  return values;
}

export function foundationSlot(source: string): Slot {
  const slots = scanFoundationSlots(source);
  if (slots.length !== 1)
    throw new Error(
      'Include exactly one empty <style id="oa-foundation"></style> slot.',
    );
  if (source.slice(slots[0].bodyStart, slots[0].bodyEnd).trim())
    throw new Error('The foundation slot is already populated.');
  return slots[0];
}

function scanFoundationSlots(source: string) {
  const slots: Slot[] = [];
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf('<', index);
    if (start < 0) break;
    if (source.startsWith('<!--', start)) {
      const commentEnd = source.indexOf('-->', start + 4);
      if (commentEnd < 0)
        throw new Error('The HTML contains an unclosed comment.');
      index = commentEnd + 3;
      continue;
    }
    const end = tagEnd(source, start);
    if (end < 0) throw new Error('The HTML contains an incomplete tag.');
    index = end;
    const raw = source.slice(start, end);
    const name = /^<\s*([\w:-]+)/.exec(raw)?.[1]?.toLowerCase();
    if (!name) continue;
    if (name === 'script') {
      const close = closeTag(source, 'script', end);
      if (!close) throw new Error('The HTML contains an unclosed script.');
      index = close.end;
      continue;
    }
    if (name === 'textarea' || name === 'title' || name === 'noscript') {
      const close = closeTag(source, name, end);
      if (!close) throw new Error(`The HTML contains an unclosed ${name}.`);
      index = close.end;
      continue;
    }
    if (name !== 'style') {
      index = end;
      continue;
    }
    const values = attrs(raw);
    const ids = values.filter((attribute) => attribute.name === 'id');
    if (
      ids.some((attribute) => attribute.value === 'oa-foundation') &&
      ids.length !== 1
    )
      throw new Error(
        'The foundation style must have exactly one id attribute.',
      );
    if (ids.length !== 1 || ids[0].value !== 'oa-foundation') {
      const close = closeTag(source, 'style', end);
      if (!close) throw new Error('The HTML contains an unclosed style.');
      index = close.end;
      continue;
    }
    if (/\/\s*>$/.test(raw))
      throw new Error('The foundation slot must have a closing tag.');
    const close = closeTag(source, 'style', end);
    if (!close) throw new Error('The foundation slot is unclosed.');
    slots.push({ start, end: close.end, bodyStart: end, bodyEnd: close.start });
    index = close.end;
  }
  return slots;
}

function foundationMarkup(assets: GeistAssets) {
  const license = assets.license.replaceAll('--', '—');
  return `<!-- Geist fonts: SIL Open Font License\n${license}\n-->\n<style id="oa-foundation">@font-face{font-family:'Geist';font-style:normal;font-weight:100 900;font-display:swap;src:url(${assets.sans}) format('woff2')}\n@font-face{font-family:'Geist Mono';font-style:normal;font-weight:100 900;font-display:swap;src:url(${assets.mono}) format('woff2')}\n${assets.css}</style>`;
}

export function packGeistSource(source: string, assets: GeistAssets) {
  const slot = foundationSlot(source);
  const foundation = foundationMarkup(assets);
  return source.slice(0, slot.start) + foundation + source.slice(slot.end);
}

export function prepareGeistPublication(source: string, assets: GeistAssets) {
  const slots = scanFoundationSlots(source);
  if (slots.length === 0) return source;
  if (slots.length !== 1)
    throw new Error(
      'Include at most one foundation <style id="oa-foundation"></style> slot.',
    );
  const slot = slots[0];
  if (!source.slice(slot.bodyStart, slot.bodyEnd).trim())
    return packGeistSource(source, assets);
  return source;
}

export function unpackGeistArtifact(source: string, assets: GeistAssets) {
  const slots = scanFoundationSlots(source);
  if (slots.length !== 1)
    throw new Error('Expected exactly one bundled Geist foundation.');
  const slot = slots[0];
  const expected = foundationMarkup(assets);
  const commentStart = source.lastIndexOf(
    '<!-- Geist fonts: SIL Open Font License',
    slot.start,
  );
  if (commentStart < 0 || source.slice(commentStart, slot.end) !== expected)
    throw new Error(
      'The artifact uses an unknown or custom foundation; source was preserved.',
    );
  return (
    source.slice(0, commentStart) +
    '<style id="oa-foundation"></style>' +
    source.slice(slot.end)
  );
}
