import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const argument = process.argv[2];
if (!argument || process.argv.length !== 3)
  throw new Error('Usage: package-selfhost.mjs OUTPUT_DIRECTORY');
const output = resolve(argument);
if (existsSync(output))
  throw new Error('Output already exists. Choose a fresh release directory.');
const source = join(root, 'dist/standalone');
if (
  JSON.parse(readFileSync(join(source, 'open-artifacts-target.json'), 'utf8'))
    .target !== 'selfhost'
)
  throw new Error('Build the self-hosted target first.');
if (!existsSync(join(source, 'mcp/server.mjs')))
  throw new Error(
    'The local MCP entry is missing. Rebuild the self-hosted target.',
  );
mkdirSync(output, { recursive: true });
cpSync(source, join(output, 'dist/standalone'), {
  recursive: true,
  filter: (path) =>
    !basename(path).startsWith('._') && basename(path) !== '.DS_Store',
});
mkdirSync(join(output, 'scripts'), { recursive: true });
mkdirSync(join(output, 'lib/auth'), { recursive: true });
cpSync(
  join(root, 'scripts/selfhost.mjs'),
  join(output, 'scripts/selfhost.mjs'),
);
cpSync(
  join(root, 'lib/auth/tailscale.ts'),
  join(output, 'lib/auth/tailscale.ts'),
);
writeFileSync(
  join(output, 'package.json'),
  JSON.stringify(
    {
      name: 'open-artifacts-selfhost',
      private: true,
      type: 'module',
      engines: { node: '>=22.13.0' },
      scripts: {
        start: 'node --experimental-strip-types scripts/selfhost.mjs start',
      },
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(output, 'START.md'),
  "# Open Artifacts self-hosted release\n\nSet OPEN_ARTIFACTS_OWNER_LOGIN, OPEN_ARTIFACTS_ORIGIN, OPEN_ARTIFACTS_DATA_DIR (an absolute private directory outside this release), and PORT. Run `npm start` from this directory. The runner binds only 127.0.0.1. Use private Tailscale Serve as the only network ingress. Node >=22.13 is required; dependencies and SQL migrations are already bundled. No Sites connection is used.\n\nRemote agents connect to the private HTTPS origin plus `/mcp`. Agents on this host may instead use stdio: `node dist/standalone/mcp/server.mjs --config /absolute/path/to/.env.selfhost`. Stdio uses the OS user's access to the explicit settings file and the same database; it opens no network listener.\n\nStop the server before making a filesystem backup of the data directory, including any SQLite WAL files. Restore the complete data directory while stopped.\n",
);
console.log('Packaged portable Node release without runtime settings or data.');
