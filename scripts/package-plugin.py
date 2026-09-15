#!/usr/bin/env python3
"""Package only the unconfigured public plugin; never read installed copies."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent / 'plugins/open-artifacts'
FILES = (
    '.codex-plugin/plugin.json', '.mcp.json', 'README.md', 'settings.json',
    'assets/Geist-Variable.woff2', 'assets/GeistMono-Variable.woff2',
    'assets/OFL.txt', 'assets/geist-foundation.css',
    'scripts/artifact.py', 'scripts/client.py', 'scripts/configure.py',
    'scripts/route.py', 'skills/open-artifacts/SKILL.md',
    'skills/open-artifacts/references/browser-workflow.md',
    'skills/open-artifacts/references/geist.md',
    'skills/open-artifacts/references/review-targets.md',
    'skills/open-artifacts/references/sites.md',
    'skills/open-artifacts/references/tailscale.md',
)


def archive(root=ROOT):
    content = {}
    for name in FILES:
        path = root / name
        if any(parent.is_symlink() for parent in (path, *path.parents)):
            raise ValueError('Release inputs must not use symbolic links.')
        content[name] = path.read_bytes()
    if json.loads(content['settings.json']) != {
        'default_backend': None, 'site_url': '', 'tailscale_url': '',
    } or json.loads(content['.mcp.json']) != {'mcpServers': {}}:
        raise ValueError('Release settings must be unconfigured. Do not package an installed copy.')
    manifest = json.loads(content['.codex-plugin/plugin.json'])
    if (manifest.get('name') != 'open-artifacts'
            or not re.fullmatch(r'\d+\.\d+\.\d+', manifest.get('version', ''))):
        raise ValueError('Use the public plugin name and a plain release version.')
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(content):
            info = zipfile.ZipInfo('open-artifacts/' + name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(info, content[name])
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='Fresh ZIP path, outside the plugin source.')
    args = parser.parse_args()
    try:
        output = args.output.resolve()
        if output.suffix != '.zip' or output == ROOT or ROOT in output.parents:
            raise ValueError('Choose a .zip destination outside the plugin source.')
        data = archive()
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('xb') as file:
            file.write(data)
        print(json.dumps({'file': str(output), 'files': len(FILES),
                          'sha256': hashlib.sha256(data).hexdigest()}, indent=2))
    except (OSError, ValueError, TypeError) as error:
        print('Release failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
