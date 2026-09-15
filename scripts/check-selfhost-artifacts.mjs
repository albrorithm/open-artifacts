import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = mkdtempSync(join(tmpdir(), 'open-artifacts-storage-'));
const origin = 'https://artifacts.example.invalid';
const owner = 'owner@example.invalid';
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
let child;
let client;
let localClient;
let login;
const proxyHeaders = () => ({
  'Tailscale-User-Login': login,
  'X-Forwarded-Host': new URL(origin).host,
  'X-Forwarded-Proto': 'https',
});
async function start(identity = owner) {
  login = identity;
  child = spawn(
    process.execPath,
    ['--experimental-strip-types', 'scripts/selfhost.mjs', 'start'],
    {
      env: {
        ...process.env,
        PORT: String(port),
        OPEN_ARTIFACTS_OWNER_LOGIN: login,
        OPEN_ARTIFACTS_ORIGIN: origin,
        OPEN_ARTIFACTS_DATA_DIR: directory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error('Local server did not start.')),
      15000,
    );
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Local server exited.'));
    });
    child.once('error', reject);
    const read = (data) => {
      output = (output + data).slice(-16000);
      if (output.includes('Production server running')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
  });
  client = new Client({ name: 'portable-mcp-storage-check', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', base), {
      requestInit: { headers: proxyHeaders() },
    }),
  );
}
async function stop() {
  await client?.close();
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
  }
}
async function tool(name, arguments_, status = 200) {
  const result = await client.callTool({ name, arguments: arguments_ });
  assert.equal(result.isError ?? false, status !== 200, JSON.stringify(result));
  if (status !== 200) assert.equal(result.structuredContent.status, status);
  return result.structuredContent;
}
async function human(command) {
  const response = await fetch(base + '/api/commands', {
    method: 'POST',
    headers: {
      ...proxyHeaders(),
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  assert.equal(response.status, 200);
  return response.json();
}
try {
  await start();
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  assert.equal(names.length, 8);
  assert.ok(
    !names.includes('set_thread_status') && !names.includes('add_comment'),
  );
  const html =
    '<h1 data-review-id="heading">A small idea</h1><p>Original content.</p>';
  const publication = {
    requestId: randomUUID(),
    title: 'Portable MCP check',
    html,
  };
  const first = await tool('publish_artifact', publication);
  assert.equal(first.number, 1);
  assert.ok(first.url.startsWith(origin + '/a/'));
  assert.deepEqual(await tool('publish_artifact', publication), first);
  await tool(
    'publish_artifact',
    { ...publication, html: 'Changed payload' },
    409,
  );
  const metadata = await tool('get_artifact', { artifactId: first.artifactId });
  assert.ok(!('html' in metadata));
  assert.ok(!JSON.stringify(metadata).includes('owner_id'));
  const downloaded = await tool('get_artifact', {
    artifactId: first.artifactId,
    includeHtml: true,
  });
  assert.equal(downloaded.html, html);
  assert.equal(
    downloaded.revision.content_sha256,
    createHash('sha256').update(html).digest('hex'),
  );
  const note = {
    action: 'add_comment',
    artifactId: first.artifactId,
    revisionId: first.revisionId,
    requestId: randomUUID(),
    body: 'Make the heading specific.',
    target: {
      anchorId: 'heading',
      excerpt: 'A small idea',
      section: 'Heading',
      fingerprint: createHash('sha256').update('A small idea').digest('hex'),
      viewState: { duration: '60', breakLength: '5' },
    },
  };
  const comments = await Promise.all([human(note), human(note)]);
  assert.equal(comments[0].thread.id, comments[1].thread.id);
  const thread = comments[0].thread;
  const batch = await tool('create_review_batch', {
    artifactId: first.artifactId,
  });
  const revisionRequestId = randomUUID();
  const revisionHtml = '<h1 data-review-id="heading">Specific idea 1</h1>';
  const competingRequestId = randomUUID();
  const competingHtml = '<h1 data-review-id="heading">Specific idea 2</h1>';
  const revisions = await Promise.all(
    [1, 2].map((n) =>
      client.callTool({
        name: 'publish_artifact',
        arguments: {
          requestId: n === 1 ? revisionRequestId : competingRequestId,
          title: publication.title,
          html: n === 1 ? revisionHtml : competingHtml,
          artifactId: first.artifactId,
          baseRevisionId: first.revisionId,
        },
      }),
    ),
  );
  assert.deepEqual(
    revisions
      .map((r) => Boolean(r.isError))
      .sort((a, b) => Number(a) - Number(b)),
    [false, true],
  );
  const revisionIndex = revisions.findIndex((r) => !r.isError);
  const revision = revisions[revisionIndex].structuredContent;
  const revisionRequest =
    revisionIndex === 0
      ? { requestId: revisionRequestId, html: revisionHtml }
      : { requestId: competingRequestId, html: competingHtml };
  assert.deepEqual(
    await tool('publish_artifact', {
      requestId: revisionRequest.requestId,
      title: publication.title,
      html: revisionRequest.html,
      artifactId: first.artifactId,
      baseRevisionId: first.revisionId,
    }),
    revision,
    'Identical retries of a revision must return the durable result.',
  );
  await tool(
    'publish_artifact',
    {
      requestId: revisionRequest.requestId,
      title: publication.title,
      html: revisionRequest.html,
      artifactId: first.artifactId,
      baseRevisionId: revision.revisionId,
    },
    409,
  );
  await tool(
    'publish_artifact',
    {
      requestId: revisionRequest.requestId,
      title: publication.title,
      html: revisionRequest.html,
    },
    409,
  );
  const addressed = {
    requestId: randomUUID(),
    threadId: thread.id,
    revisionId: revision.revisionId,
    batchId: batch.batchId,
    body: 'Made the heading more specific.',
  };
  const events = await Promise.all([
    tool('mark_addressed', addressed),
    tool('mark_addressed', addressed),
  ]);
  assert.equal(events[0].event.id, events[1].event.id);
  await tool('mark_addressed', { ...addressed, requestId: randomUUID() }, 409);
  const beforeRestart = await tool('get_review_context', {
    artifactId: first.artifactId,
  });
  assert.equal(beforeRestart.threads[0].status, 'open');
  assert.equal(beforeRestart.threads[0].revision_id, first.revisionId);
  assert.deepEqual(
    JSON.parse(beforeRestart.threads[0].view_state_json),
    note.target.viewState,
  );
  assert.equal(beforeRestart.events.length, 1);
  const settingsFile = join(directory, 'test.env');
  writeFileSync(
    settingsFile,
    `OPEN_ARTIFACTS_OWNER_LOGIN=${owner}\nOPEN_ARTIFACTS_ORIGIN=${origin}\nOPEN_ARTIFACTS_DATA_DIR=${directory}\n`,
    { mode: 0o600 },
  );
  const stdioEntry = resolve('dist/standalone/mcp/server.mjs');
  localClient = new Client({ name: 'local-stdio-check', version: '1' });
  await localClient.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [stdioEntry, '--config', settingsFile],
      env: {
        OPEN_ARTIFACTS_OWNER_LOGIN: 'ignored@example.invalid',
        OPEN_ARTIFACTS_DATA_DIR: join(directory, 'ignored'),
      },
      stderr: 'pipe',
    }),
  );
  const localProbe = (
    await localClient.callTool({ name: 'probe_identity', arguments: {} })
  ).structuredContent;
  assert.equal(localProbe.connection, 'local-stdio');
  assert.equal(
    localProbe.identity_fingerprint,
    (await tool('probe_identity', {})).identity_fingerprint,
  );
  assert.deepEqual(
    (
      await localClient.callTool({
        name: 'get_review_context',
        arguments: { artifactId: first.artifactId },
      })
    ).structuredContent,
    beforeRestart,
  );
  assert.equal((await localClient.listTools()).tools.length, 8);
  const fileCheck = spawnSync(
    'python3',
    [
      '-c',
      `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('client', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
client = module.StdioClient({'command': sys.argv[2], 'args': [sys.argv[3], '--config', sys.argv[4]]})
try:
    html = '<h1>File transfer</h1>' + ' ' * 220000 + '<p>Exact end.</p>'
    result = client.call('publish_artifact', {'requestId': sys.argv[5], 'title': 'Large file client check', 'html': html})
    downloaded = client.call('get_artifact', {'artifactId': result['artifactId'], 'includeHtml': True})
    assert downloaded['html'] == html
finally:
    client.close()
`,
      resolve('plugins/open-artifacts/scripts/client.py'),
      process.execPath,
      stdioEntry,
      settingsFile,
      randomUUID(),
    ],
    { encoding: 'utf8', timeout: 20000 },
  );
  assert.equal(fileCheck.status, 0, fileCheck.stderr);
  assert.equal((await tool('list_artifacts', {})).artifacts.length, 2);
  await localClient.close();
  localClient = undefined;
  await stop();
  await start();
  assert.deepEqual(
    await tool('get_review_context', { artifactId: first.artifactId }),
    beforeRestart,
  );
  assert.equal(
    (
      await tool('get_artifact', {
        artifactId: first.artifactId,
        revisionId: first.revisionId,
        includeHtml: true,
      })
    ).html,
    html,
  );
  await stop();
  await start('other@example.invalid');
  assert.deepEqual((await tool('list_artifacts', {})).artifacts, []);
  await tool('get_artifact', { artifactId: first.artifactId }, 404);
  await tool('get_review_context', { artifactId: first.artifactId }, 404);
  console.log(
    'PASS: standard HTTP and stdio MCP SDK clients share identity and storage; Python large-file transfer, browser-free publication/review, concurrent retries, revision conflicts, human status, restart persistence, and owner isolation.',
  );
} finally {
  await localClient?.close();
  await stop();
  rmSync(directory, { recursive: true, force: true });
}
