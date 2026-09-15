"""Check the public package boundary with isolated synthetic source copies."""
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('release', REPO / 'scripts/package-plugin.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class Release(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name).resolve()
        self.root = self.directory / 'open-artifacts'
        shutil.copytree(release.ROOT, self.root)

    def test_only_listed_files_ship_with_fixed_metadata(self):
        for name in ['.env', 'private-notes.txt', 'draft.html.publish.json', 'data.sqlite']:
            (self.root / name).write_text('synthetic private value')
        data = release.archive(self.root)
        self.assertEqual(data, release.archive(self.root))
        with zipfile.ZipFile(io.BytesIO(data)) as bundle:
            self.assertEqual(set(bundle.namelist()), {'open-artifacts/' + f for f in release.FILES})
            self.assertEqual(bundle.comment, b'')
            for entry in bundle.infolist():
                self.assertEqual(entry.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(entry.external_attr >> 16, 0o100644)
                self.assertEqual(entry.extra, b'')
                self.assertEqual(entry.comment, b'')

    def test_configured_or_unknown_settings_cannot_ship(self):
        for filename, value in [
            ('settings.json', {'default_backend': 'sites', 'site_url': 'https://library.example.invalid', 'tailscale_url': ''}),
            ('settings.json', {'default_backend': None, 'site_url': '', 'tailscale_url': '', 'extra': 'private'}),
            ('.mcp.json', {'mcpServers': {'open_artifacts_tailscale': {'url': 'https://host.example.invalid/mcp'}}}),
        ]:
            with self.subTest(filename=filename):
                target = self.root / filename
                original = target.read_bytes()
                target.write_text(json.dumps(value))
                with self.assertRaisesRegex(ValueError, 'unconfigured'):
                    release.archive(self.root)
                target.write_bytes(original)

    def test_symlinked_inputs_cannot_ship(self):
        target = self.root / 'README.md'
        outside = self.directory / 'private.txt'
        outside.write_text('synthetic private value')
        target.unlink()
        target.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'symbolic'):
            release.archive(self.root)

    def test_missing_files_and_development_versions_cannot_ship(self):
        target = self.root / '.codex-plugin/plugin.json'
        manifest = json.loads(target.read_text())
        manifest['version'] = '1.0.0+local'
        target.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'release version'):
            release.archive(self.root)
        target.unlink()
        with self.assertRaises(OSError):
            release.archive(self.root)

    def test_command_preserves_existing_output_and_source(self):
        output = self.directory / 'release.zip'
        command = [sys.executable, str(REPO / 'scripts/package-plugin.py'), str(output)]
        before = {f: (release.ROOT / f).read_bytes() for f in release.FILES}
        first = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        original = output.read_bytes()
        second = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(second.returncode, 0)
        self.assertEqual(output.read_bytes(), original)
        self.assertEqual(before, {f: (release.ROOT / f).read_bytes() for f in release.FILES})

    def test_source_deployment_settings_have_no_private_association(self):
        self.assertEqual(json.loads((REPO / '.openai/hosting.json').read_text()), {'d1': 'DB', 'r2': 'FILES'})


if __name__ == '__main__':
    unittest.main()
