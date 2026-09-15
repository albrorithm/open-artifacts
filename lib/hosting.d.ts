declare const __OPEN_ARTIFACTS_TARGET__: 'sites' | 'selfhost';

declare module '#artifact-storage' {
  export function storage(): import('./artifacts/storage-types').ArtifactStorage;
}
declare module '*.sql?raw' {
  const sql: string;
  export default sql;
}
