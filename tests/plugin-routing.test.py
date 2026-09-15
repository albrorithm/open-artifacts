"""Exercise destination selection and migration with isolated synthetic plugin copies."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent / 'plugins/open-artifacts'
spec = importlib.util.spec_from_file_location('route', ROOT / 'scripts/route.py')
route = importlib.util.module_from_spec(spec)
spec.loader.exec_module(route)
SITE = 'https://library.example.invalid'
TAIL = 'https://host.example.invalid:8444'
ARTIFACT = '/a/e590c675-0579-4602-a9f1-602455e94866'
REVISION = '/r/e0817e5c-fc75-4070-bbbc-908d74b4a95a'


class Routing(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config()

    def config(self, default='tailscale', site=SITE, server=None):
        self.settings = {'default_backend': default, 'site_url': site, 'tailscale_url': TAIL}
        self.mcp = {'mcpServers': {route.SERVER: server or {'type': 'http', 'url': TAIL + '/mcp'}}}
        self.save()

    def save(self):
        (self.root / 'settings.json').write_text(json.dumps(self.settings))
        (self.root / '.mcp.json').write_text(json.dumps(self.mcp))

    def test_default_and_explicit_override_leave_settings_unchanged(self):
        before = (self.root / 'settings.json').read_bytes()
        self.assertEqual(route.select(self.root)['backend'], 'tailscale')
        self.assertEqual(route.select(self.root, 'sites')['library_url'], SITE)
        self.assertEqual((self.root / 'settings.json').read_bytes(), before)

    def test_existing_link_overrides_default_and_preserves_exact_revision(self):
        found = route.select(self.root, artifact_url=SITE + ARTIFACT + REVISION)
        self.assertEqual(found['backend'], 'sites')
        self.assertEqual(found['artifact_id'], ARTIFACT[3:])
        self.assertEqual(found['revision_id'], REVISION[3:])
        self.assertEqual(route.select(self.root, artifact_url=SITE.upper() + ARTIFACT)['backend'], 'sites')

    def test_conflicting_host_and_unknown_links_never_use_default(self):
        with self.assertRaisesRegex(ValueError, 'conflicts'):
            route.select(self.root, 'tailscale', SITE + ARTIFACT)
        for link in ['https://unknown.example.invalid' + ARTIFACT, SITE + '/api/commands', SITE + ARTIFACT + '?other=1']:
            with self.subTest(link=link), self.assertRaises(ValueError):
                route.select(self.root, artifact_url=link)

    def test_unset_or_missing_default_does_not_fall_back(self):
        self.settings['default_backend'] = None
        self.save()
        with self.assertRaisesRegex(ValueError, 'Choose'):
            route.select(self.root)
        self.settings['default_backend'] = 'tailscale'
        self.mcp['mcpServers'] = {}
        self.save()
        with self.assertRaisesRegex(ValueError, 'no fallback'):
            route.select(self.root)
        self.assertEqual(route.select(self.root, 'sites')['backend'], 'sites')

    def test_stdio_uses_configured_public_origin_without_starting_process(self):
        self.config(server={'type': 'stdio', 'command': '/path/to/node', 'args': ['server.mjs']})
        self.assertEqual(route.select(self.root, artifact_url=TAIL + ARTIFACT)['backend'], 'tailscale')
        release = (self.root / 'server').resolve()
        (release / 'dist/standalone/mcp').mkdir(parents=True)
        (release / 'dist/standalone/mcp/server.mjs').write_text('not executed')
        (release / '.env.selfhost').write_text('synthetic settings')
        out = self.root / 'stdio-plugin'
        result = self.configure('--local-server', release, '--node', sys.executable,
                                '--tailscale-library-url', TAIL, '--output', out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(route.select(out, artifact_url=TAIL + ARTIFACT)['backend'], 'tailscale')
        configured = json.loads((out / '.mcp.json').read_text())['mcpServers'][route.SERVER]
        self.assertEqual(configured['args'], [str(release / 'dist/standalone/mcp/server.mjs'), '--config', str(release / '.env.selfhost')])

    def test_rejects_unsafe_and_ambiguous_configuration(self):
        for url in ['http://host.invalid', 'https://user:pass@host.invalid', 'https://host.invalid/?x=1', 'https://host.invalid:0', 'https://bad host.invalid']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                route.library_url(url)
        self.config(site=TAIL)
        with self.assertRaisesRegex(ValueError, 'different'):
            route.select(self.root)
        self.config()
        for invalid in [None, [], False, {}]:
            self.mcp['mcpServers'][route.SERVER] = invalid
            self.save()
            with self.subTest(server=invalid), self.assertRaises(ValueError):
                route.select(self.root)

    def configure(self, *args):
        return subprocess.run([sys.executable, str(ROOT / 'scripts/configure.py'), *map(str, args)], capture_output=True, text=True)

    def test_sites_only_setup_needs_no_mcp_and_sets_default_once(self):
        out = self.root / 'new'
        result = self.configure('--site-url', SITE, '--output', out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(route.select(out)['backend'], 'sites')
        self.assertEqual(json.loads((out / '.mcp.json').read_text()), {'mcpServers': {}})
        for name in ['settings.json', '.mcp.json']:
            self.assertEqual((out / name).stat().st_mode & 0o777, 0o600)
        second = self.configure('--tailscale-url', TAIL + '/mcp', '--output', out)
        self.assertNotEqual(second.returncode, 0)
        self.assertEqual(route.select(out)['backend'], 'sites')

    def test_tailscale_only_setup_and_both_host_default_choice(self):
        out = self.root / 'native'
        result = self.configure('--tailscale-url', TAIL + '/mcp', '--output', out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(route.select(out)['backend'], 'tailscale')
        both = self.root / 'both'
        result = self.configure('--tailscale-url', TAIL + '/mcp', '--site-url', SITE, '--output', both)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(both.exists())

    def test_migration_retains_both_connections_and_leaves_originals(self):
        old_site = self.root / 'old-site'
        old_tail = self.root / 'old-tail'
        for path, name in [(old_site, 'open-artifacts'), (old_tail, 'open-artifacts-tailscale')]:
            (path / '.codex-plugin').mkdir(parents=True)
            (path / '.codex-plugin/plugin.json').write_text(json.dumps({'name': name}))
        (old_site / 'settings.json').write_text(json.dumps({'site_url': SITE}))
        legacy = {'mcpServers': {'open_artifacts': {'type': 'http', 'url': TAIL + '/mcp'}}}
        (old_tail / '.mcp.json').write_text(json.dumps(legacy))
        before = (old_tail / '.mcp.json').read_bytes()
        out = self.root / 'combined'
        result = self.configure('--import-plugin', old_site, '--import-plugin', old_tail, '--default', 'tailscale', '--output', out)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(route.select(out)['backend'], 'tailscale')
        self.assertEqual(route.select(out, artifact_url=SITE + ARTIFACT)['backend'], 'sites')
        self.assertEqual((old_tail / '.mcp.json').read_bytes(), before)

    def test_bad_connection_leaves_no_partial_output(self):
        out = self.root / 'bad'
        result = self.configure('--tailscale-url', SITE + '/wrong', '--output', out)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(out.exists())


if __name__ == '__main__':
    unittest.main()
