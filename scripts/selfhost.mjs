import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { readTailscaleConfig } from '../lib/auth/tailscale.ts';

const root = new URL('../', import.meta.url);
const command = process.argv[2];
if (!['dev', 'build', 'start'].includes(command) || process.argv.length !== 3) {
  console.error('Usage: selfhost.mjs dev|build|start (no extra arguments).');
  process.exit(1);
}

// Runtime settings are optional in a file; service environment takes precedence.
// The build does not need the private owner login or origin from this file.
const envFile = new URL('.env.selfhost', root);
if (command !== 'build' && existsSync(envFile)) {
  loadEnvFile(fileURLToPath(envFile));
}
const env = { ...process.env, OPEN_ARTIFACTS_TARGET: 'selfhost' };
const marker = new URL('dist/standalone/open-artifacts-target.json', root);
const server = new URL('dist/standalone/server.js', root);

if (command !== 'build') {
  if (
    !env.OPEN_ARTIFACTS_DATA_DIR ||
    !isAbsolute(env.OPEN_ARTIFACTS_DATA_DIR)
  ) {
    console.error(
      'Set OPEN_ARTIFACTS_DATA_DIR to an absolute private data directory.',
    );
    process.exit(1);
  }
  process.umask(0o077);
  let config;
  try {
    config = readTailscaleConfig(env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const port = env.PORT ?? '3000';
  if (!/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65535) {
    console.error('PORT must be an integer from 1 through 65535.');
    process.exit(1);
  }
  // Do not permit ambient HOST or CLI arguments to expose a trusted-header
  // backend. Only Serve and trusted local processes may reach this listener.
  env.HOST = '127.0.0.1';
  env.PORT = port;
  env.VINEXT_TRUST_PROXY = '1';
  env.VINEXT_TRUSTED_HOSTS = new URL(config.origin).host;
}

if (command === 'start') {
  let correctTarget = false;
  try {
    correctTarget =
      JSON.parse(readFileSync(marker, 'utf8')).target === 'selfhost';
  } catch {
    /* Fail closed for missing or invalid build markers. */
  }
  if (!correctTarget || !existsSync(server)) {
    console.error(
      'Run npm run build:selfhost before starting the self-hosted server.',
    );
    process.exit(1);
  }
}

const args =
  command === 'start'
    ? [fileURLToPath(server)]
    : [
        fileURLToPath(new URL('node_modules/vinext/dist/cli.js', root)),
        command,
        ...(command === 'dev'
          ? ['--hostname', '127.0.0.1', '--port', env.PORT]
          : []),
      ];
const child = spawn(process.execPath, args, {
  cwd: fileURLToPath(root),
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', () => {
  console.error(
    'Could not start the self-hosted command. Check the local installation.',
  );
  process.exitCode = 1;
});
child.on('exit', async (code) => {
  if (command === 'build' && code === 0) {
    if (!existsSync(server)) {
      console.error(
        'Build did not produce the expected Node standalone entry.',
      );
      process.exitCode = 1;
      return;
    }
    try {
      await import('./build-selfhost-mcp.mjs');
      writeFileSync(marker, JSON.stringify({ target: 'selfhost' }) + '\n');
    } catch {
      console.error(
        'Could not build the local MCP entry. Rebuild before packaging.',
      );
      process.exitCode = 1;
      return;
    }
  }
  process.exitCode = code ?? 1;
});
