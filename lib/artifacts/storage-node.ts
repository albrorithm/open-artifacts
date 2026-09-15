import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import initialSchema from '../../drizzle/0000_productive_penance.sql?raw';
import type {
  ArtifactStorage,
  SqlStatement,
  SqlValue,
  SqlResult,
} from './storage-types';

let current: ArtifactStorage | undefined;

export function storage(): ArtifactStorage {
  if (current) return current;
  const directory = process.env.OPEN_ARTIFACTS_DATA_DIR;
  if (!directory || !isAbsolute(directory))
    throw new Error(
      'Set OPEN_ARTIFACTS_DATA_DIR to an absolute private data directory.',
    );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'artifacts.sqlite');
  const database = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  try {
    database.exec(
      'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;',
    );
    database.exec(
      'CREATE TABLE IF NOT EXISTS oa_migrations (version TEXT PRIMARY KEY, hash TEXT NOT NULL)',
    );
    const hash = createHash('sha256').update(initialSchema).digest('hex');
    database.exec('BEGIN IMMEDIATE');
    try {
      const prior = database
        .prepare('SELECT hash FROM oa_migrations WHERE version=?')
        .get('0000');
      if (prior && prior.hash !== hash)
        throw new Error('Stored schema migration does not match this release.');
      if (!prior) {
        database.exec(initialSchema);
        database
          .prepare('INSERT INTO oa_migrations VALUES (?,?)')
          .run('0000', hash);
      }
      database.exec(
        'CREATE TABLE IF NOT EXISTS artifact_objects (key TEXT PRIMARY KEY, body TEXT NOT NULL)',
      );
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    database.close();
    throw error;
  }

  class Statement implements SqlStatement {
    constructor(
      private sql: string,
      private values: SqlValue[] = [],
    ) {}
    bind(...values: SqlValue[]) {
      return new Statement(this.sql, values);
    }
    execute<T>(): SqlResult<T> {
      const changes = () =>
        Number(
          database.prepare('SELECT total_changes() AS count').get()!.count,
        );
      const before = changes();
      const results = database.prepare(this.sql).all(...this.values) as T[];
      return { results, meta: { changes: changes() - before } };
    }
    async first<T>() {
      return this.execute<T>().results[0] ?? null;
    }
    async all<T>() {
      return this.execute<T>();
    }
    async run() {
      return this.execute<Record<string, unknown>>();
    }
  }
  current = {
    db: {
      prepare: (sql) => new Statement(sql),
      async batch(statements) {
        database.exec('BEGIN IMMEDIATE');
        try {
          const results = statements.map((statement) => {
            if (!(statement instanceof Statement))
              throw new Error('Invalid storage statement.');
            return statement.execute<Record<string, unknown>>();
          });
          database.exec('COMMIT');
          return results;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    },
    files: {
      async get(key) {
        const row = database
          .prepare('SELECT body FROM artifact_objects WHERE key=?')
          .get(key);
        return row ? { text: async () => String(row.body) } : null;
      },
      async put(key, body) {
        database
          .prepare('INSERT INTO artifact_objects (key,body) VALUES (?,?)')
          .run(key, body);
      },
      async delete(key) {
        database.prepare('DELETE FROM artifact_objects WHERE key=?').run(key);
      },
    },
  };
  return current;
}
