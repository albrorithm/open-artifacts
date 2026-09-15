"""Verify publication packaging boundaries without requiring a browser."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('artifact', ROOT / 'plugins/open-artifacts/scripts/artifact.py')
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)
DOCUMENT = '<!doctype html><html lang="en"><head><title>Example</title><meta name="viewport" content="width=device-width,initial-scale=1"><style id="oa-foundation"></style></head><body><main data-review-id="main">Example</main></body></html>'


class ArtifactPackaging(unittest.TestCase):
    def test_pack_embeds_fonts_and_license_without_touching_source(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'source.html', Path(directory) / 'artifact.html'
            source.write_text(DOCUMENT)
            result = artifact.pack(source, output)
            self.assertEqual(source.read_text(), DOCUMENT)
            self.assertFalse(result['errors'])
            self.assertLess(result['bytes'], artifact.LIMIT)
            self.assertEqual(output.read_text().count('data:font/woff2;base64,'), 2)
            self.assertIn('OPEN FONT LICENSE', output.read_text())
            with self.assertRaises(ValueError):
                artifact.pack(source, output)

    def test_preserves_input_and_rejects_bad_slot(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.html'
            source.write_text(DOCUMENT.replace(artifact.SLOT, ''))
            with self.assertRaises(ValueError):
                artifact.pack(source, source)
            with self.assertRaises(ValueError):
                artifact.pack(source, Path(directory) / 'output.html')

    def test_init_writes_editable_dark_starter_without_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'starter.html'
            result = artifact.init(source, 'Review & Notes')
            content = source.read_text()
            self.assertFalse(result['errors'])
            self.assertIn('color-scheme: dark', content)
            self.assertIn('<title>Review &amp; Notes</title>', content)
            self.assertIn('data-review-id="header"', content)
            self.assertIn(artifact.SLOT, content)
            self.assertIn('var(--bg)', content)
            self.assertNotIn('Review anchor:', content)
            with self.assertRaises(ValueError):
                artifact.init(source, 'Another title')

    def test_repack_preserves_existing_foundation_and_license(self):
        with tempfile.TemporaryDirectory() as directory:
            source, first, second = (Path(directory) / name for name in ('source.html', 'first.html', 'second.html'))
            source.write_text(DOCUMENT)
            artifact.pack(source, first)
            packed = first.read_text()
            custom = packed.replace('font-display:swap', 'font-display:block')
            first.write_text(custom)
            artifact.pack(first, second)
            self.assertEqual(second.read_text(), custom)

    def test_slot_whitespace_quotes_and_duplicates(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'source.html', Path(directory) / 'output.html'
            flexible = DOCUMENT.replace(artifact.SLOT, '<style  id = \'oa-foundation\' >\n  </style>')
            source.write_text(flexible)
            artifact.pack(source, output)
            self.assertEqual(output.read_text().count('data:font/woff2;base64,'), 2)
            duplicate = DOCUMENT.replace(artifact.SLOT, '<style id="oa-foundation"></style><style id="oa-foundation"> </style>')
            source.write_text(duplicate)
            with self.assertRaisesRegex(ValueError, 'exactly one foundation'):
                artifact.pack(source, output.with_name('duplicate.html'))

    def test_ignores_fake_slots_in_attributes_and_comments(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.html'
            source.write_text(DOCUMENT.replace(artifact.SLOT, '<!-- <style id="oa-foundation"></style> --><div data-id="oa-foundation"></div><script>"<style id=\'oa-foundation\'></style>"</script>'))
            with self.assertRaisesRegex(ValueError, 'exactly one foundation'):
                artifact.pack(source, Path(directory) / 'output.html')

    def test_rejects_unclosed_foundation_slot_and_preserves_crlf_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'source.html', Path(directory) / 'output.html'
            packed = DOCUMENT.replace(artifact.SLOT, '<style id="oa-foundation">:root{--bg:#000}</style>').replace('\n', '\r\n').encode()
            source.write_bytes(packed)
            artifact.pack(source, output)
            self.assertEqual(output.read_bytes(), packed)
            source.write_text(DOCUMENT.replace(artifact.SLOT, '<style id="oa-foundation">'))
            with self.assertRaisesRegex(ValueError, 'exactly one foundation'):
                artifact.pack(source, Path(directory) / 'unclosed.html')

    def test_slot_offsets_follow_htmlparser_newlines_and_tag_length(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / 'source.html', Path(directory) / 'output.html'
            content = DOCUMENT.replace(artifact.SLOT, '<style data-note=">" id = \'oa-foundation\'>\r\n</style>')
            content = content.replace('<head>', '<head>\r\n')
            source.write_bytes(content.encode())
            artifact.pack(source, output)
            self.assertEqual(output.read_bytes().count(b'data:font/woff2;base64,'), 2)

    def test_rejects_conflicting_duplicate_foundation_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.html'
            source.write_text(DOCUMENT.replace(artifact.SLOT, '<style id="oa-foundation" id="custom"></style>'))
            with self.assertRaisesRegex(ValueError, 'exactly one foundation'):
                artifact.pack(source, Path(directory) / 'output.html')

    def test_utf8_byte_limit(self):
        self.assertTrue(artifact.inspect_html(DOCUMENT.replace('Example</main>', '漢' * 180_000 + '</main>'))['errors'])

    def test_external_resources_and_duplicate_anchors(self):
        content = DOCUMENT.replace('</main>', '<img src="https://example.com/image"><a href="javascript:alert(1)">Link</a><section data-review-id="main"></section></main>')
        self.assertGreaterEqual(len(artifact.inspect_html(content)['errors']), 3)

    def test_inline_chart_and_safe_review_state(self):
        content = DOCUMENT.replace('</main>', '<input data-review-state="mode"><svg><use href="#shape"></use></svg></main>')
        self.assertFalse(artifact.inspect_html(content)['errors'])

    def test_password_and_css_import_rejected(self):
        content = DOCUMENT.replace('</main>', '<input type="password" data-review-state="secret"></main>').replace(artifact.SLOT, '<style>@import "https://example.com/style.css";</style>')
        self.assertEqual(len(artifact.inspect_html(content)['errors']), 2)

    def test_review_state_preserves_distinct_controls(self):
        controls = '<input data-review-state="duration"><select data-review-state="breakLength"></select>'
        self.assertFalse(artifact.inspect_html(DOCUMENT.replace('</main>', controls + '</main>'))['errors'])
        for invalid in [
            controls.replace('breakLength', 'duration'),
            '<input data-review-state="' + 'x' * 161 + '">',
            '<input data-review-state="__oa_point">',
            '<input type="PASSWORD" data-review-state="secret">',
            '<div data-review-state="duration"></div>',
            ''.join(f'<input data-review-state="control{i}">' for i in range(20)),
        ]:
            with self.subTest(invalid=invalid):
                self.assertTrue(artifact.inspect_html(DOCUMENT.replace('</main>', invalid + '</main>'))['errors'])
        controls = ''.join(f'<input data-review-state="control{i}">' for i in range(19))
        self.assertFalse(artifact.inspect_html(DOCUMENT.replace('</main>', controls + '</main>'))['errors'])


if __name__ == '__main__':
    unittest.main()
