import { env } from 'cloudflare:workers';
import type { ArtifactStorage } from './storage-types';

export function storage(): ArtifactStorage {
  const bindings = env as unknown as { DB?: D1Database; FILES?: R2Bucket };
  if (!bindings.DB || !bindings.FILES)
    throw new Error('Artifact storage is unavailable.');
  return { db: bindings.DB, files: bindings.FILES };
}
