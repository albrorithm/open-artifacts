#!/usr/bin/env python3
"""Select an artifact host from local settings, without connecting to either host."""
import argparse
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
SERVER = 'open_artifacts_tailscale'


def origin(value):
    if not isinstance(value, str):
        raise ValueError('Use an HTTPS library URL.')
    url = urlsplit(value)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.query or url.fragment or any(c.isspace() for c in value)):
        raise ValueError('Use an HTTPS library URL without credentials, query, or fragment.')
    port = url.port
    if port is not None and not 1 <= port <= 65535:
        raise ValueError('Use a valid HTTPS port.')
    host = url.hostname.lower()
    if ':' in host:
        host = '[' + host + ']'
    return 'https://' + host + (':' + str(port) if port and port != 443 else '')


def library_url(value):
    result = origin(value)
    if urlsplit(value).path not in ('', '/'):
        raise ValueError('Use the library root URL, without an artifact path or /mcp.')
    return result


def read_config(root=ROOT):
    settings = json.loads((root / 'settings.json').read_text())
    mcp = json.loads((root / '.mcp.json').read_text())
    if not isinstance(settings, dict) or not isinstance(mcp, dict):
        raise ValueError('Invalid plugin settings. Reconfigure the installed copy.')
    servers = mcp.get('mcpServers')
    if not isinstance(servers, dict):
        raise ValueError('Invalid MCP settings. Reconfigure the installed copy.')
    default = settings.get('default_backend')
    if default not in (None, 'sites', 'tailscale'):
        raise ValueError('The default host must be sites or tailscale.')
    hosts = {}
    if settings.get('site_url'):
        hosts['sites'] = library_url(settings['site_url'])
    server = servers.get(SERVER)
    if SERVER in servers:
        if not isinstance(server, dict):
            raise ValueError('Invalid Tailscale MCP connection.')
        if server.get('type', 'http') == 'http':
            url = server.get('url')
            base = origin(url)
            if urlsplit(url).path != '/mcp':
                raise ValueError('The Tailscale MCP URL must end in /mcp.')
            hosts['tailscale'] = base
        elif server.get('type') == 'stdio':
            if (not isinstance(server.get('command'), str)
                    or not Path(server['command']).is_absolute()
                    or not isinstance(server.get('args'), list)
                    or not all(isinstance(arg, str) for arg in server['args'])):
                raise ValueError('Local MCP requires an absolute command and string arguments.')
            hosts['tailscale'] = library_url(settings.get('tailscale_url', ''))
        else:
            raise ValueError('Unsupported Tailscale transport.')
    if len(set(hosts.values())) != len(hosts):
        raise ValueError('Sites and Tailscale must use different library origins.')
    return default, hosts


def select(root=ROOT, backend=None, artifact_url=None):
    default, hosts = read_config(root)
    ids = {}
    if artifact_url:
        base = origin(artifact_url)
        matching = [name for name, url in hosts.items() if url == base]
        if not matching:
            raise ValueError('This link belongs to an unconfigured host. Configure that host; do not copy it into the default library.')
        if backend and backend != matching[0]:
            raise ValueError('The requested host conflicts with the artifact link. Keep revisions on the original host.')
        backend = matching[0]
        path = urlsplit(artifact_url).path.rstrip('/')
        if path:
            uuid = r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'
            match = re.fullmatch(r'/a/(' + uuid + r')(?:/r/(' + uuid + r'))?', path)
            if not match:
                raise ValueError('Use a library or artifact/revision URL.')
            ids['artifact_id'] = match[1]
            if match[2]:
                ids['revision_id'] = match[2]
    backend = backend or default
    if not backend:
        raise ValueError('Choose Sites or Tailscale once during setup with configure.py --default.')
    if backend not in hosts:
        raise ValueError('The selected host is not configured. Configure it; no fallback to another host will occur.')
    return {'backend': backend, 'library_url': hosts[backend], **ids,
            'workflow': str(root / 'skills/open-artifacts/references' / (backend + '.md'))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=('sites', 'tailscale'))
    parser.add_argument('--artifact-url')
    args = parser.parse_args()
    try:
        print(json.dumps(select(backend=args.backend, artifact_url=args.artifact_url), indent=2))
    except (ValueError, OSError, TypeError) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
