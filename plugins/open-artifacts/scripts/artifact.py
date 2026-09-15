#!/usr/bin/env python3
"""Pack a self-contained artifact with the shared Geist foundation."""

import argparse
import base64
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
LIMIT = 512_000
SLOT = '<style id="oa-foundation"></style>'


class FoundationSlots(HTMLParser):
    """Locate real foundation style elements, excluding comments and scripts."""

    def __init__(self, content):
        super().__init__(convert_charrefs=False)
        self.content = content
        self.line_starts = [0]
        # HTMLParser advances its line counter only for LF characters.
        self.line_starts.extend(match.end() for match in re.finditer(r'\n', content))
        self.slots = []
        self.active = None
        self.malformed = False

    def char_offset(self):
        line, column = self.getpos()
        return self.line_starts[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag.lower() != 'style':
            return
        ids = [value for name, value in attrs if name.lower() == 'id']
        foundation_ids = [value for value in ids if value == 'oa-foundation']
        if not foundation_ids:
            return
        if self.active is not None:
            self.malformed = True
            return
        if len(ids) != 1 or len(foundation_ids) != 1:
            self.malformed = True
            return
        start = self.char_offset()
        start_tag = self.get_starttag_text() or ''
        start_tag_end = start + len(start_tag)
        if not start_tag:
            self.malformed = True
        else:
            self.active = (start, start_tag_end)

    def handle_startendtag(self, tag, attrs):
        if tag.lower() == 'style' and any(name.lower() == 'id' and value == 'oa-foundation' for name, value in attrs):
            self.malformed = True

    def handle_endtag(self, tag):
        if tag.lower() == 'style' and self.active is not None:
            start, body_start = self.active
            close_start = self.char_offset()
            end = self.content.find('>', close_start) + 1
            if end <= 0:
                self.malformed = True
            else:
                self.slots.append((start, end, body_start, close_start))
            self.active = None

    def finish(self):
        if self.active is not None:
            self.malformed = True
        return self.slots, self.malformed


def foundation_slots(content):
    parser = FoundationSlots(content)
    parser.feed(content)
    parser.close()
    return parser.finish()


class Inspection(HTMLParser):
    def __init__(self):
        super().__init__()
        self.anchors = set()
        self.state_keys = set()
        self.state_count = 0
        self.errors = []
        self.has_title = False
        self.has_viewport = False
        self.has_lang = False
        self.styles = []
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'html':
            self.has_lang = bool(attrs.get('lang'))
        if tag == 'title':
            self.has_title = True
        if tag == 'meta' and attrs.get('name', '').lower() == 'viewport':
            self.has_viewport = True
        if tag == 'style':
            self.in_style = True
        if attrs.get('style'):
            self.styles.append(attrs['style'])
        anchor = attrs.get('data-review-id')
        if anchor is not None:
            if not anchor or len(anchor) > 160 or anchor in self.anchors:
                self.errors.append('Review IDs must be nonempty, unique, and at most 160 characters.')
            self.anchors.add(anchor)
        state = attrs.get('data-review-state')
        if state is not None:
            self.state_count += 1
            if (not state or len(state) > 160 or state in self.state_keys
                    or state.startswith('__oa_') or tag not in {'input', 'select', 'textarea'}
                    or attrs.get('type', '').lower() == 'password'):
                self.errors.append('Review-state keys must be unique, nonempty, at most 160 characters, and on non-sensitive controls; __oa_ is reserved.')
            self.state_keys.add(state)
            if self.state_count > 19:
                self.errors.append('Capture at most 19 review-state controls.')
        if tag in {'iframe', 'object', 'embed', 'base'}:
            self.errors.append(f'Unsupported embedded/navigation element: {tag}.')
        if tag == 'script' and ('src' in attrs or attrs.get('type') == 'module'):
            self.errors.append('Use inline classic scripts, without module imports or external sources.')
        if tag == 'link':
            self.errors.append('Inline styles and fonts; do not use link resources.')
        if tag == 'meta' and attrs.get('http-equiv', '').lower() == 'refresh':
            self.errors.append('Automatic navigation is not supported.')
        for key in ('src', 'poster', 'href', 'action', 'formaction'):
            value = attrs.get(key)
            if value and not (key == 'href' and value.startswith('#')) and not (key in {'src', 'poster'} and value.startswith('data:')):
                self.errors.append(f'Non-inline {key} on {tag}.')
        if 'srcset' in attrs:
            self.errors.append('Use a single embedded image rather than srcset.')

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag == 'style':
            self.in_style = False

    def handle_data(self, data):
        if self.in_style:
            self.styles.append(data)


def inspect_html(content):
    parser = Inspection()
    parser.feed(content)
    errors = parser.errors
    size = len(content.encode('utf-8'))
    if size > LIMIT:
        errors.append(f'HTML is {size} bytes; the limit is {LIMIT}.')
    if not parser.has_title or not parser.has_viewport or not parser.has_lang:
        errors.append('Include a document title, viewport meta, and html lang.')
    if not parser.anchors:
        errors.append('Add stable data-review-id attributes to meaningful sections.')
    for css in parser.styles:
        if re.search(r'@import\b', css, re.I):
            errors.append('CSS imports are not self-contained.')
        for match in re.finditer(r'url\(\s*[\"\']?([^\"\')\s]+)', css, re.I):
            if not match.group(1).startswith(('data:', '#')):
                errors.append('CSS resources must use embedded data URLs.')
    return {'bytes': size, 'reviewAnchors': len(parser.anchors), 'errors': sorted(set(errors)),
            'scope': 'Structural checks only; verify behavior and layout in the artifact sandbox.'}


def pack(source, destination):
    if source.resolve() == destination.resolve():
        raise ValueError('Input and output must differ; preserve the editable source.')
    if destination.exists():
        raise ValueError('Output already exists; use a fresh publication filename.')
    raw = source.read_bytes()
    content = raw.decode('utf-8')
    slots, malformed = foundation_slots(content)
    if malformed or len(slots) != 1:
        raise ValueError('Include exactly one foundation <style id="oa-foundation"></style> slot.')
    start, end, body_start, body_end = slots[0]
    if content[body_start:body_end].strip():
        result = inspect_html(content)
        if result['errors']:
            raise ValueError('\n'.join(result['errors']))
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('xb') as output:
            output.write(raw)
        return result
    fonts = []
    for family, file in [('Geist', 'Geist-Variable.woff2'), ('Geist Mono', 'GeistMono-Variable.woff2')]:
        payload = base64.b64encode((ROOT / 'assets' / file).read_bytes()).decode('ascii')
        fonts.append("@font-face{font-family:'" + family + "';font-style:normal;font-weight:100 900;font-display:swap;src:url(data:font/woff2;base64," + payload + ") format('woff2')}")
    license_text = (ROOT / 'assets' / 'OFL.txt').read_text(encoding='utf-8').replace('--', '—')
    css = '\n'.join(fonts) + '\n' + (ROOT / 'assets' / 'geist-foundation.css').read_text(encoding='utf-8')
    replacement = '<!-- Geist fonts: SIL Open Font License\n' + license_text + '\n-->\n<style id="oa-foundation">' + css + '</style>'
    content = content[:start] + replacement + content[end:]
    result = inspect_html(content)
    if result['errors']:
        raise ValueError('\n'.join(result['errors']))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('xb') as output:
        output.write(content.encode('utf-8'))
    return result


def init(source, title):
    if source.exists():
        raise ValueError('Output already exists; choose a fresh starter filename.')
    safe_title = escape(title, quote=False)
    content = f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
  <style id="oa-foundation"></style>
  <style>
    :root {{ color-scheme: dark; }}
    body {{ background: var(--bg); }}
    .artifact {{ min-height: 100vh; }}
    header {{ display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-6); }}
    section {{ margin-top: var(--space-8); }}
    h1 {{ max-width: 18ch; }}
    p {{ color: var(--muted); }}
  </style>
</head>
<body>
  <main class="artifact" data-review-id="main">
    <header data-review-id="header">
      <h1>{safe_title}</h1>
    </header>
    <section data-review-id="content">
      <p>Content goes here.</p>
    </section>
  </main>
</body>
</html>
'''
    source.parent.mkdir(parents=True, exist_ok=True)
    with source.open('xb') as output:
        output.write(content.encode('utf-8'))
    return inspect_html(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('pack')
    build.add_argument('source', type=Path)
    build.add_argument('output', type=Path)
    check = commands.add_parser('check')
    check.add_argument('source', type=Path)
    starter = commands.add_parser('init')
    starter.add_argument('source', type=Path)
    starter.add_argument('--title', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'pack':
            result = pack(args.source, args.output)
        elif args.command == 'init':
            result = init(args.source, args.title)
        else:
            result = inspect_html(args.source.read_text(encoding='utf-8'))
        print(json.dumps(result, indent=2))
        return 1 if result['errors'] else 0
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
