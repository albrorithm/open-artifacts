'use client';

import Link from 'next/link';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, FileCode2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { callCommand } from '@/lib/artifacts/client';
import type { Artifact } from '@/lib/artifacts/contracts';
import { useSiteTools } from './site-tools';
import { PublishDialog } from './publish-dialog';

export function Library({
  openPublisher = false,
}: {
  openPublisher?: boolean;
}) {
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [create, setCreate] = useState(openPublisher);
  const refresh = useCallback(async () => {
    try {
      setItems(
        (
          await callCommand<{ artifacts: Artifact[] }>({
            action: 'list_artifacts',
          })
        ).artifacts,
      );
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  useSiteTools(refresh, () => setCreate(true));
  return (
    <div className="library-shell">
      <header className="site-header">
        <Link prefetch={false} className="wordmark" href="/">
          open-artifacts<span>.</span>
        </Link>
        <span className="private-label">Private library</span>
      </header>
      <main className="library-main">
        <div className="library-heading">
          <h1>Your artifacts</h1>
        </div>
        {error ? (
          <div className="empty-library">
            <p role="alert">{error}</p>
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : loading ? (
          <output className="loading-state">Opening your library…</output>
        ) : items.length ? (
          <div className="artifact-list">
            <div className="list-heading">
              <span>ARTIFACT</span>
              <span>REVIEW</span>
              <span>UPDATED</span>
            </div>
            {items.map((item) => (
              <Link
                prefetch={false}
                className="artifact-row"
                href={`/a/${item.id}`}
                key={item.id}
              >
                <span className="artifact-name">
                  <FileCode2 aria-hidden="true" />
                  <strong>{item.title}</strong>
                </span>
                <span className="row-review">
                  {item.open_comments
                    ? `${item.open_comments} open ${item.open_comments === 1 ? 'note' : 'notes'}`
                    : 'No open notes'}
                </span>
                <span className="row-date">
                  {new Date(item.updated_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                  <ArrowUpRight aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <section className="empty-library">
            <div className="empty-symbol" aria-hidden="true">
              [&nbsp;&nbsp;&nbsp;]
            </div>
            <h2>No artifacts yet</h2>
            <p>Artifacts you create with the plugin will appear here.</p>
          </section>
        )}
      </main>
      {create && (
        <PublishDialog
          onClose={() => setCreate(false)}
          onPublished={async (result) => {
            window.location.assign(`/a/${result.artifactId}`);
          }}
        />
      )}
    </div>
  );
}
