import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeReviewThreads } from '../lib/artifacts/thread-state.ts';

const thread = (id, number, version, status = 'open') => ({
  id,
  number,
  version,
  status,
});

test('independent saves can finish in reverse order without losing either change', () => {
  const a = thread('a', 1, 1);
  const b = thread('b', 2, 1);
  const bSaved = thread('b', 2, 2, 'resolved');
  const aSaved = thread('a', 1, 2, 'resolved');
  const result = mergeReviewThreads(mergeReviewThreads([a, b], [bSaved]), [
    aSaved,
  ]);
  assert.deepEqual(result, [aSaved, bSaved]);
  assert.equal(a.status, 'open');
  assert.equal(b.status, 'open');
});

test('late reads and older save responses cannot undo a newer reopen', () => {
  const reopened = thread('a', 1, 3);
  const added = thread('b', 2, 1);
  assert.deepEqual(
    mergeReviewThreads([reopened, added], [thread('a', 1, 2, 'resolved')]),
    [reopened, added],
  );
});

test('a refresh retains fresh evidence and includes newly received comments in order', () => {
  const current = thread('a', 1, 2, 'resolved');
  const refreshed = { ...current, is_from_earlier_revision: true };
  const added = thread('b', 2, 1);
  assert.deepEqual(mergeReviewThreads([current], [added, refreshed]), [
    refreshed,
    added,
  ]);
});
