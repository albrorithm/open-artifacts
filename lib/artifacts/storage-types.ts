export type SqlValue = string | number | null;
export type SqlResult<T = Record<string, unknown>> = {
  results: T[];
  meta: { changes: number };
};
export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<SqlResult<T>>;
  run(): Promise<SqlResult>;
}
export interface ArtifactStorage {
  db: {
    prepare(sql: string): SqlStatement;
    batch(statements: SqlStatement[]): Promise<SqlResult[]>;
  };
  files: {
    get(key: string): Promise<{ text(): Promise<string> } | null>;
    put(
      key: string,
      body: string,
      options?: { httpMetadata: { contentType: string } },
    ): Promise<unknown>;
    delete(key: string): Promise<unknown>;
  };
}
