import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = new URL(process.env.PROBE_BASE_URL ?? 'http://localhost:3002');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const login = await fetch(new URL('/signin-with-chatgpt?return_to=/', base), {
  redirect: 'manual',
});
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
async function request(command) {
  const response = await fetch(new URL('/api/commands', base), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: base.origin,
    },
    body: JSON.stringify(command),
  });
  return { status: response.status, data: await response.json() };
}
const published = await request({
  action: 'publish_artifact',
  requestId: randomUUID(),
  title: 'Point placement check',
  html: '<style>body{margin:0;font:18px/1.6 system-ui;min-height:2400px}h1,p{margin:32px}section{margin-top:1400px;padding:32px;background:#eef2ff}</style><h1>Point placement check</h1><p>Leave a comment in the empty space, then scroll.</p><section data-review-id="lower"><h2>A lower section</h2><p>This section checks anchored points while scrolling.</p></section>',
});
assert.equal(published.status, 200);
const { artifactId, revisionId } = published.data;
const point = {
  version: 1,
  x: 240,
  y: 1050,
  width: 1280,
  relativeX: 0,
  relativeY: 0,
  path: '',
};
const command = {
  action: 'add_comment',
  artifactId,
  revisionId,
  requestId: randomUUID(),
  body: 'Saved point in empty space.',
  target: {
    anchorId: null,
    excerpt: '',
    section: '',
    fingerprint: '',
    viewState: { __oa_point: JSON.stringify(point) },
  },
};
const saved = await request(command);
assert.equal(saved.status, 200);
assert.equal(
  saved.data.thread.view_state_json,
  JSON.stringify(command.target.viewState),
);
assert.equal((await request(command)).data.thread.id, saved.data.thread.id);
const changed = structuredClone(command);
changed.target.viewState.__oa_point = JSON.stringify({ ...point, y: 1051 });
assert.equal((await request(changed)).status, 409);
const invalid = structuredClone(command);
invalid.requestId = randomUUID();
invalid.target.viewState.__oa_point = JSON.stringify({
  ...point,
  relativeX: 2,
});
assert.equal((await request(invalid)).status, 400);
const loaded = await request({
  action: 'get_artifact',
  artifactId,
  revisionId,
});
assert.equal(loaded.status, 200);
assert.deepEqual(
  JSON.parse(JSON.parse(loaded.data.threads[0].view_state_json).__oa_point),
  point,
);
console.log(
  JSON.stringify({
    passed:
      'point persistence, identical retries, changed retry rejection, invalid point rejection, reload',
    artifactId,
    revisionId,
    commentId: saved.data.thread.id,
  }),
);
