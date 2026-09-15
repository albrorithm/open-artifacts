import assert from 'node:assert/strict';

const base = new URL(process.env.PROBE_BASE_URL ?? 'http://localhost:3000');
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname),
  'This check only uses the local Sites authentication simulator.',
);

async function rpc(method, params, extraHeaders = {}) {
  const response = await fetch(new URL('/mcp', base), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await response.text();
  const body = response.headers
    .get('content-type')
    ?.includes('application/json')
    ? JSON.parse(text)
    : text;
  return { status: response.status, body };
}

const initialize = {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'local-probe-check', version: '1' },
};
assert.equal((await rpc('initialize', initialize)).status, 401);
assert.equal(
  (
    await rpc('initialize', initialize, {
      Authorization: 'Bearer invalid-probe-token',
    })
  ).status,
  401,
);
assert.equal(
  (
    await rpc('initialize', initialize, {
      'oai-authenticated-user-id': 'forged-user',
      'oai-authenticated-user-email': 'forged@example.invalid',
    })
  ).status,
  401,
);

const signIn = await fetch(new URL('/signin-with-chatgpt?return_to=/', base), {
  redirect: 'manual',
});
assert.equal(signIn.status, 302);
const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'Local simulator must issue its own test cookie.');
const headers = { Cookie: cookie };

const initialized = await rpc('initialize', initialize, headers);
assert.equal(initialized.status, 200);
assert.equal(initialized.body.result.serverInfo.name, 'open-artifacts-probe');
const listed = await rpc('tools/list', {}, headers);
assert.equal(listed.body.result.tools[0].name, 'probe_identity');
const identity = await rpc(
  'tools/call',
  { name: 'probe_identity', arguments: {} },
  headers,
);
const fingerprint = identity.body.result.structuredContent.identity_fingerprint;
assert.match(fingerprint, /^[a-f0-9]{64}$/);
const page = await fetch(new URL('/connection', base), { headers });
assert.equal(page.status, 200);
assert.ok(
  (await page.text()).includes(fingerprint),
  'Browser and MCP must use the same simulated identity.',
);
assert.equal(
  (
    await rpc('initialize', initialize, {
      ...headers,
      Origin: 'https://unrelated.example',
    })
  ).status,
  403,
);
assert.equal((await fetch(new URL('/mcp', base))).status, 405);
console.log(
  'PASS: anonymous, invalid bearer, and forged headers rejected; local sign-in, MCP initialize/list/call, browser identity match, and origin checks passed.',
);
console.log('Local simulator checks do not prove production OAuth.');
