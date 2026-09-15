#!/usr/bin/env python3
"""Run focused plugin checks for the unified plugin."""

from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent


def main():
    for test in ('tests/plugin-artifact.test.py', 'tests/plugin-mcp-client.test.py', 'tests/plugin-routing.test.py'):
        subprocess.run([sys.executable, str(ROOT / test)], cwd=ROOT, check=True)
    subprocess.run(['node', '--experimental-strip-types', '--test',
                    'tests/geist-pack.test.mjs'], cwd=ROOT, check=True)
    print('Unified plugin tests passed.')


if __name__ == '__main__':
    main()
