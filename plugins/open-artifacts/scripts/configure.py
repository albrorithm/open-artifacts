#!/usr/bin/env python3
"""Create a fresh configured plugin copy; private connection settings stay outside source."""
import argparse
import json
from pathlib import Path
import shutil
import sys
import tempfile

from route import ROOT, SERVER, library_url, read_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-url', help='Signed-in Sites library root URL.')
    connection = parser.add_mutually_exclusive_group()
    connection.add_argument('--tailscale-url', '--url', dest='tailscale_url', help='Private HTTPS MCP URL ending in /mcp.')
    connection.add_argument('--local-server', type=Path, help='Packaged server directory for local stdio.')
    parser.add_argument('--tailscale-library-url', help='Private library root URL; required for local stdio.')
    parser.add_argument('--node', help='Absolute Node executable for local stdio; defaults to Node on PATH.')
    parser.add_argument('--default', choices=('sites', 'tailscale'), dest='default_backend')
    parser.add_argument('--import-plugin', type=Path, action='append', default=[], help='Import settings from an existing unified or legacy plugin copy. Repeat to merge the two old packages.')
    parser.add_argument('--output', type=Path, required=True, help='Fresh destination outside the source package.')
    args = parser.parse_args()
    output = args.output.resolve()
    try:
        if output.exists() or output == ROOT or ROOT in output.parents:
            raise ValueError('Choose a fresh destination outside the source package; existing copies are never overwritten.')
        settings = {'default_backend': None, 'site_url': '', 'tailscale_url': ''}
        servers = {}
        for source in args.import_plugin:
            manifest = json.loads((source / '.codex-plugin/plugin.json').read_text())
            if manifest.get('name') not in ('open-artifacts', 'open-artifacts-tailscale'):
                raise ValueError('Import an Open Artifacts plugin copy.')
            if (source / 'settings.json').exists():
                values = json.loads((source / 'settings.json').read_text())
                if not isinstance(values, dict):
                    raise ValueError('Invalid imported settings.')
                for key in settings:
                    if values.get(key):
                        if settings[key] and settings[key] != values[key]:
                            raise ValueError('Imported settings conflict; import only one configuration for each host.')
                        settings[key] = values[key]
            if (source / '.mcp.json').exists():
                config = json.loads((source / '.mcp.json').read_text())
                connections = config.get('mcpServers') if isinstance(config, dict) else None
                if not isinstance(connections, dict):
                    raise ValueError('Invalid imported MCP configuration.')
                key = SERVER if SERVER in connections else 'open_artifacts'
                server = connections.get(key)
                if key in connections:
                    if SERVER in servers and servers[SERVER] != server:
                        raise ValueError('Imported Tailscale connections conflict.')
                    servers[SERVER] = server
        if args.site_url:
            settings['site_url'] = library_url(args.site_url)
        if args.tailscale_url:
            servers[SERVER] = {'type': 'http', 'url': args.tailscale_url}
        if args.tailscale_library_url:
            settings['tailscale_url'] = library_url(args.tailscale_library_url)
        if args.local_server:
            release = args.local_server.resolve()
            entry = release / 'dist/standalone/mcp/server.mjs'
            config = release / '.env.selfhost'
            node = args.node or shutil.which('node')
            if not entry.is_file() or not config.is_file():
                raise ValueError('The local server needs its built MCP entry and .env.selfhost settings.')
            if not node or not Path(node).is_absolute() or not Path(node).is_file():
                raise ValueError('Use an absolute Node executable path.')
            servers[SERVER] = {'type': 'stdio', 'command': node, 'args': [str(entry), '--config', str(config)]}
        if args.default_backend:
            settings['default_backend'] = args.default_backend
        with tempfile.TemporaryDirectory(prefix='open-artifacts-config-') as temp:
            stage = Path(temp) / 'open-artifacts'
            shutil.copytree(ROOT, stage, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
            def save():
                for name, value in [('settings.json', settings), ('.mcp.json', {'mcpServers': servers})]:
                    file = stage / name
                    file.write_text(json.dumps(value, indent=2) + '\n')
                    file.chmod(0o600)
            save()
            default, hosts = read_config(stage)
            if not default and len(hosts) == 1:
                settings['default_backend'] = next(iter(hosts))
            elif default not in hosts:
                raise ValueError('Choose a configured default host with --default sites or --default tailscale.')
            save()
            shutil.copytree(stage, output)
        print('Configured Open Artifacts. Default host: ' + settings['default_backend'])
        return 0
    except (OSError, ValueError, TypeError, AttributeError) as error:
        print('Configuration failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
