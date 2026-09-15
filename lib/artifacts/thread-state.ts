import type { ReviewThread } from './contracts';

// Responses can arrive out of order while several comments save at once.
export function mergeReviewThreads(
  current: ReviewThread[],
  incoming: ReviewThread[],
): ReviewThread[] {
  const threads = new Map(current.map((thread) => [thread.id, thread]));
  for (const thread of incoming) {
    const saved = threads.get(thread.id);
    if (!saved || thread.version >= saved.version)
      threads.set(thread.id, thread);
  }
  return [...threads.values()].sort((a, b) => a.number - b.number);
}
