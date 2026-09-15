import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const base = new URL(process.env.PROBE_BASE_URL ?? 'http://localhost:3002');
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname),
  'Use the local simulator only.',
);
const login = await fetch(new URL('/signin-with-chatgpt?return_to=/', base), {
  redirect: 'manual',
});
const cookie = login.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
async function request(command, headers = {}) {
  const response = await fetch(new URL('/api/commands', base), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: base.origin,
      ...headers,
    },
    body: JSON.stringify(command),
  });
  const body = await response.text();
  return {
    status: response.status,
    data: response.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(body)
      : body,
  };
}
async function ok(command) {
  const result = await request(command);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
assert.equal(
  (await request({ action: 'list_artifacts' }, { Cookie: '' })).status,
  401,
);
assert.equal(
  (
    await request(
      { action: 'list_artifacts' },
      {
        Cookie: '',
        'oai-authenticated-user-id': 'forged',
        'oai-authenticated-user-email': 'forged@example.invalid',
      },
    )
  ).status,
  401,
);
assert.equal(
  (await request({ action: 'list_artifacts' }, { Origin: 'null' })).status,
  403,
);
assert.equal(
  (await request({ action: 'list_artifacts' }, { Origin: '' })).status,
  403,
);
assert.equal(
  (
    await request(
      { action: 'list_artifacts' },
      { Origin: 'https://unrelated.example' },
    )
  ).status,
  403,
);
assert.equal(
  (await request({ action: 'get_artifact', artifactId: randomUUID() })).status,
  404,
);
assert.equal(
  (
    await request({
      action: 'publish_artifact',
      requestId: randomUUID(),
      title: 'Missing HTML',
    })
  ).status,
  400,
);
const html =
  '<h1 data-review-id="heading">A small idea</h1><p>Original content.</p>';
const publish = {
  action: 'publish_artifact',
  requestId: randomUUID(),
  title: 'Local acceptance check',
  note: '',
  html,
};
const a = await ok(publish);
assert.equal(a.number, 1);
assert.deepEqual(await ok(publish), a);
assert.equal((await request({ ...publish, html: 'different' })).status, 409);
assert.equal(
  (
    await request({
      ...publish,
      artifactId: a.artifactId,
      baseRevisionId: a.revisionId,
    })
  ).status,
  409,
  'A retry cannot add revision targeting arguments to an original publication.',
);
assert.equal(
  (
    await request({
      ...publish,
      artifactId: a.artifactId,
      baseRevisionId: randomUUID(),
    })
  ).status,
  409,
  'A retry with a different base revision must be rejected.',
);
assert.equal(
  (
    await request({
      ...publish,
      requestId: randomUUID(),
      baseRevisionId: a.revisionId,
    })
  ).status,
  400,
  'A new publication cannot supply a base revision without an artifact.',
);
const first = await ok({ action: 'get_artifact', artifactId: a.artifactId });
assert.equal(first.html, html);
assert.equal(
  first.revision.content_sha256,
  createHash('sha256').update(html).digest('hex'),
);
assert.ok(!JSON.stringify(first).includes('owner_id'));
const comment = {
  action: 'add_comment',
  artifactId: a.artifactId,
  revisionId: a.revisionId,
  requestId: randomUUID(),
  body: 'Make the heading more specific.',
  target: {
    anchorId: 'heading',
    excerpt: 'A small idea',
    section: 'A small idea',
    fingerprint: createHash('sha256').update('A small idea').digest('hex'),
    viewState: { scenario: 'baseline' },
  },
};
const concurrentComments = await Promise.all([
  request(comment),
  request(comment),
]);
concurrentComments.forEach((result) =>
  assert.equal(result.status, 200, JSON.stringify(result.data)),
);
assert.equal(
  concurrentComments[0].data.thread.id,
  concurrentComments[1].data.thread.id,
);
const thread = concurrentComments[0].data.thread;
const batch = await ok({
  action: 'create_review_batch',
  artifactId: a.artifactId,
});
const b = await ok({
  ...publish,
  requestId: randomUUID(),
  artifactId: a.artifactId,
  baseRevisionId: a.revisionId,
  html: '<h1 data-review-id="heading">A specific idea</h1>',
});
assert.equal(b.number, 2);
assert.equal(
  (
    await request({
      ...publish,
      requestId: randomUUID(),
      artifactId: a.artifactId,
      baseRevisionId: a.revisionId,
    })
  ).status,
  409,
);
assert.equal(
  (
    await ok({
      action: 'get_artifact',
      artifactId: a.artifactId,
      revisionId: a.revisionId,
    })
  ).html,
  html,
);
const addressed = {
  action: 'mark_addressed',
  threadId: thread.id,
  revisionId: b.revisionId,
  batchId: batch.batchId,
  requestId: randomUUID(),
  body: 'Made the heading specific.',
};
const addressedResults = await Promise.all([
  request(addressed),
  request(addressed),
]);
addressedResults.forEach((result) =>
  assert.equal(result.status, 200, JSON.stringify(result.data)),
);
assert.equal(
  addressedResults[0].data.event.id,
  addressedResults[1].data.event.id,
);
assert.equal(
  (await request({ ...addressed, batchId: randomUUID() })).status,
  409,
);
let context = await ok({
  action: 'get_review_context',
  artifactId: a.artifactId,
});
assert.equal(context.threads.length, 1);
assert.equal(context.events.length, 1);
assert.equal(context.threads[0].status, 'open');
assert.equal(context.threads[0].revision_id, a.revisionId);
assert.equal(context.threads[0].excerpt, comment.target.excerpt);
assert.equal(
  (await request({ ...addressed, requestId: randomUUID() })).status,
  409,
  'Stale batch must reject changed comments.',
);
const reply = {
  action: 'reply_to_comment',
  threadId: thread.id,
  requestId: randomUUID(),
  body: 'Ready for another look.',
};
const replies = await Promise.all([request(reply), request(reply)]);
replies.forEach((result) =>
  assert.equal(result.status, 200, JSON.stringify(result.data)),
);
assert.equal(replies[0].data.event.id, replies[1].data.event.id);
context = await ok({ action: 'get_review_context', artifactId: a.artifactId });
const resolved = await ok({
  action: 'set_thread_status',
  threadId: thread.id,
  version: context.threads[0].version,
  status: 'resolved',
});
assert.equal(resolved.thread.status, 'resolved');
assert.equal(
  (
    await request({
      action: 'set_thread_status',
      threadId: thread.id,
      version: thread.version,
      status: 'open',
    })
  ).status,
  409,
);
const publications = await Promise.all(
  [1, 2].map((n) =>
    request({
      ...publish,
      requestId: randomUUID(),
      artifactId: a.artifactId,
      baseRevisionId: b.revisionId,
      html: `<h1>Competing ${n}</h1>`,
    }),
  ),
);
assert.deepEqual(
  publications.map((r) => r.status).sort((a, b) => a - b),
  [200, 409],
);
assert.ok(
  (await ok({ action: 'list_artifacts' })).artifacts.some(
    (item) => item.id === a.artifactId,
  ),
);
console.log(
  'PASS: auth and origin rejection, validation, exact HTML, immutable history, durable comments, concurrent retries, batches, addressed vs resolved, and competing publications.',
);
