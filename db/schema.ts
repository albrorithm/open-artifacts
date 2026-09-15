import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text().primaryKey(),
    owner_id: text().notNull(),
    title: text().notNull(),
    current_revision_id: text().notNull(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [index('artifacts_owner_updated').on(t.owner_id, t.updated_at)],
);

export const revisions = sqliteTable(
  'revisions',
  {
    id: text().primaryKey(),
    artifact_id: text()
      .notNull()
      .references(() => artifacts.id),
    owner_id: text().notNull(),
    number: integer().notNull(),
    title: text().notNull(),
    note: text().notNull(),
    object_key: text().notNull(),
    content_sha256: text().notNull(),
    request_id: text().notNull(),
    created_at: text().notNull(),
  },
  (t) => [
    uniqueIndex('revisions_artifact_number').on(t.artifact_id, t.number),
    uniqueIndex('revisions_owner_request').on(t.owner_id, t.request_id),
  ],
);

export const reviewThreads = sqliteTable(
  'review_threads',
  {
    id: text().primaryKey(),
    artifact_id: text()
      .notNull()
      .references(() => artifacts.id),
    revision_id: text()
      .notNull()
      .references(() => revisions.id),
    owner_id: text().notNull(),
    number: integer().notNull(),
    anchor_id: text(),
    excerpt: text().notNull(),
    section: text().notNull(),
    context_fingerprint: text().notNull(),
    view_state_json: text().notNull(),
    body: text().notNull(),
    status: text().notNull().default('open'),
    version: integer().notNull().default(1),
    request_id: text().notNull(),
    created_at: text().notNull(),
    updated_at: text().notNull(),
  },
  (t) => [
    uniqueIndex('threads_artifact_number').on(t.artifact_id, t.number),
    uniqueIndex('threads_owner_request').on(t.owner_id, t.request_id),
  ],
);

export const reviewBatches = sqliteTable('review_batches', {
  id: text().primaryKey(),
  artifact_id: text()
    .notNull()
    .references(() => artifacts.id),
  owner_id: text().notNull(),
  revision_id: text().notNull(),
  snapshot_json: text().notNull(),
  created_at: text().notNull(),
});

export const threadEvents = sqliteTable(
  'thread_events',
  {
    id: text().primaryKey(),
    thread_id: text()
      .notNull()
      .references(() => reviewThreads.id),
    artifact_id: text().notNull(),
    owner_id: text().notNull(),
    kind: text().notNull(),
    actor: text().notNull(),
    body: text().notNull(),
    revision_id: text(),
    batch_id: text(),
    request_id: text().notNull(),
    created_at: text().notNull(),
  },
  (t) => [
    index('events_artifact_created').on(t.artifact_id, t.created_at),
    uniqueIndex('events_owner_request').on(t.owner_id, t.request_id),
  ],
);
