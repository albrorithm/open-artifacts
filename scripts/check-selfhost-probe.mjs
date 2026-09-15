import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const runner = fileURLToPath(new URL('scripts/selfhost.mjs', root));
const owner = 'owner@example.invalid';
const publicOrigin = 'https://artifacts.example.invalid';
const dataDirectory = mkdtempSync(join(tmpdir(), 'open-artifacts-probe-'));
const fixtureEnv = {
  ...process.env,
  OPEN_ARTIFACTS_DATA_DIR: dataDirectory,
  OPEN_ARTIFACTS_OWNER_LOGIN: owner,
  OPEN_ARTIFACTS_ORIGIN: publicOrigin,
  // Deliberately unsafe ambient values: the supported runner must override them.
  OPEN_ARTIFACTS_TARGET: 'sites',
  HOST: '0.0.0.0',
};

function checkClientAssets(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      checkClientAssets(path);
    } else if (entry.isFile()) {
      const contents = readFileSync(path);
      for (const sentinel of [owner, publicOrigin]) {
        assert.ok(
          !contents.includes(Buffer.from(sentinel)),
          'Private synthetic settings must not appear in emitted client assets.',
        );
      }
    }
  }
}
checkClientAssets(fileURLToPath(new URL('dist/standalone/dist/client', root)));

async function rejectedStartup(overrides, extraArgs = []) {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', runner, 'start', ...extraArgs],
    {
      cwd: fileURLToPath(root),
      env: { ...fixtureEnv, ...overrides },
      stdio: 'pipe',
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(
      code,
      1,
      'Invalid startup configuration must fail before listening.',
    );
    assert.ok(!output.includes('Production server running'));
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

await Promise.all([
  rejectedStartup({ OPEN_ARTIFACTS_OWNER_LOGIN: '' }),
  rejectedStartup({ OPEN_ARTIFACTS_ORIGIN: '' }),
  rejectedStartup({
    OPEN_ARTIFACTS_ORIGIN: 'http://artifacts.example.invalid',
  }),
  rejectedStartup({ PORT: '0' }),
  rejectedStartup({ OPEN_ARTIFACTS_DATA_DIR: '' }),
  rejectedStartup({}, ['--hostname', '0.0.0.0']),
]);

const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const { port } = reservation.address();
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
const base = new URL(`http://127.0.0.1:${port}`);
const child = spawn(
  process.execPath,
  ['--experimental-strip-types', runner, 'start'],
  {
    cwd: fileURLToPath(root),
    env: { ...fixtureEnv, PORT: String(port) },
    stdio: 'pipe',
  },
);
const exited = once(child, 'exit');
let serverOutput = '';
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error('Self-hosted test server did not become ready.')),
    15_000,
  );
  const inspectOutput = (chunk) => {
    serverOutput = (serverOutput + chunk).slice(-65_536);
    if (
      serverOutput.includes(
        `Production server running at http://127.0.0.1:${port}`,
      )
    ) {
      clearTimeout(timeout);
      resolve();
    }
  };
  child.stdout.on('data', inspectOutput);
  child.stderr.on('data', inspectOutput);
  child.once('error', () => {
    clearTimeout(timeout);
    reject(new Error('Could not launch the self-hosted test server.'));
  });
  child.once('exit', () => {
    clearTimeout(timeout);
    reject(new Error('Self-hosted test server exited before becoming ready.'));
  });
});

// These synthetic headers emulate the trusted local proxy boundary only.
// They do not verify that a real Tailscale Serve deployment strips forgeries.
const proxyHeaders = {
  Host: new URL(publicOrigin).host,
  'X-Forwarded-Host': new URL(publicOrigin).host,
  'X-Forwarded-Proto': 'https',
};
const ownerHeaders = { ...proxyHeaders, 'Tailscale-User-Login': owner };
async function rpc(method, params, extraHeaders = {}) {
  const response = await fetch(new URL('/mcp', base), {
    method: 'POST',
    headers: {
      ...proxyHeaders,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  const body = response.headers
    .get('content-type')
    ?.includes('application/json')
    ? JSON.parse(text)
    : text;
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  return { status: response.status, headers: response.headers, body };
}
const initialize = {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'selfhost-probe-check', version: '1' },
};

try {
  await ready;
  const anonymous = await rpc('initialize', initialize);
  assert.equal(anonymous.status, 401);
  assert.equal(
    anonymous.headers.get('www-authenticate'),
    null,
    'Tailscale network identity must not claim Bearer/OAuth support.',
  );
  for (const forgedHeaders of [
    { Authorization: 'Bearer invalid-probe-token' },
    {
      'oai-authenticated-user-id': 'forged-user',
      'oai-authenticated-user-email': owner,
    },
    { 'Tailscale-User-Login': 'other@example.invalid' },
    { 'Tailscale-User-Name': owner },
    { 'Tailscale-App-Capabilities': '{"example.invalid/artifacts":["owner"]}' },
    { 'Tailscale-User-Login': `${owner}, ${owner}` },
  ]) {
    assert.equal(
      (await rpc('initialize', initialize, forgedHeaders)).status,
      401,
    );
  }
  const initialized = await rpc('initialize', initialize, ownerHeaders);
  assert.equal(initialized.status, 200);
  assert.equal(initialized.body.result.serverInfo.name, 'open-artifacts');
  const listed = await rpc('tools/list', {}, ownerHeaders);
  assert.equal(listed.status, 200);
  assert.deepEqual(
    listed.body.result.tools.map((tool) => tool.name),
    [
      'probe_identity',
      'list_artifacts',
      'get_artifact',
      'publish_artifact',
      'get_review_context',
      'reply_to_comment',
      'create_review_batch',
      'mark_addressed',
    ],
  );
  const identity = await rpc(
    'tools/call',
    { name: 'probe_identity', arguments: {} },
    ownerHeaders,
  );
  assert.equal(identity.status, 200);
  const fingerprint =
    identity.body.result.structuredContent.identity_fingerprint;
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  const page = await fetch(new URL('/connection', base), {
    headers: ownerHeaders,
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get('cache-control') ?? '',
    /no-store/,
    'Owner browser responses must not be stored in shared or browser caches.',
  );
  const html = await page.text();
  assert.ok(
    html.includes(fingerprint),
    'Browser and MCP must share the owner identity.',
  );
  assert.ok(html.includes('Tailscale connection.'));
  assert.ok(!html.includes(owner), 'Never render the owner login or profile.');
  assert.ok(!html.includes('/signin-with-chatgpt'));
  const privatePage = await fetch(base, {
    headers: proxyHeaders,
    signal: AbortSignal.timeout(10_000),
  });
  assert.ok(
    !(await privatePage.text()).includes(fingerprint),
    'Owner output must not leak to the next unauthenticated request.',
  );
  const afterOwner = await rpc('tools/call', {
    name: 'probe_identity',
    arguments: {},
  });
  assert.equal(
    afterOwner.status,
    401,
    'MCP must not retain a previous request identity.',
  );
  const concurrent = await Promise.all([
    rpc('tools/call', { name: 'probe_identity', arguments: {} }, ownerHeaders),
    rpc(
      'tools/call',
      { name: 'probe_identity', arguments: {} },
      { 'Tailscale-User-Login': 'other@example.invalid' },
    ),
  ]);
  assert.deepEqual(
    concurrent.map((result) => result.status),
    [200, 401],
  );
  assert.equal(
    (
      await rpc('initialize', initialize, {
        ...ownerHeaders,
        Origin: publicOrigin,
      })
    ).status,
    200,
  );
  for (const Origin of ['https://unrelated.example.invalid', 'null', '']) {
    assert.equal(
      (await rpc('initialize', initialize, { ...ownerHeaders, Origin })).status,
      403,
    );
  }
  assert.equal(
    (
      await rpc('initialize', initialize, {
        ...ownerHeaders,
        Origin: 'https://unrelated.example.invalid',
        Host: 'unrelated.example.invalid',
        'X-Forwarded-Host': 'unrelated.example.invalid',
      })
    ).status,
    403,
    'Caller-selected Host must not set the allowed browser origin.',
  );
  for (const method of ['GET', 'DELETE']) {
    const response = await fetch(new URL('/mcp', base), {
      method,
      headers: ownerHeaders,
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  }
  console.log(
    'PASS: standalone startup guards, owner-only MCP, browser identity match, request isolation, origin and method checks.',
  );
  console.log(
    'Synthetic loopback proxy checks do not prove Tailscale ingress authentication. Run the real-device checklist before storing data.',
  );
} finally {
  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
    rmSync(dataDirectory, { recursive: true, force: true });
  }
}
