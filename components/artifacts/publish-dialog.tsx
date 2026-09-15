'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { callCommand } from '@/lib/artifacts/client';
import { geistAssets } from '@/lib/artifacts/geist-assets';
import { prepareGeistPublication } from '@/lib/artifacts/geist-pack';

export function PublishDialog({
  onClose,
  artifactId,
  baseRevisionId,
  initialTitle = '',
  initialHtml = '',
  sourceHint = '',
  onPublished,
}: {
  onClose: () => void;
  artifactId?: string;
  baseRevisionId?: string;
  initialTitle?: string;
  initialHtml?: string;
  sourceHint?: string;
  onPublished: (result: {
    artifactId: string;
    revisionId: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [html, setHtml] = useState(initialHtml);
  const [sourceMode, setSourceMode] = useState<'file' | 'paste'>('paste');
  const [fileSummary, setFileSummary] = useState<{
    name: string;
    bytes: number;
  } | null>(null);
  const [note, setNote] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const readSequence = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const changed = () => {
    setRequestId(crypto.randomUUID());
    setError('');
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="publish-dialog" showCloseButton={!busy}>
        <DialogTitle>
          {artifactId ? 'Publish a revision' : 'New artifact'}
        </DialogTitle>
        <DialogDescription>
          Paste HTML or choose a file. Each publication creates a new revision.
        </DialogDescription>
        {sourceHint && <p className="fine-print">{sourceHint}</p>}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !html) return;
            setBusy(true);
            setError('');
            try {
              const result = await callCommand<{
                artifactId: string;
                revisionId: string;
              }>({
                action: 'publish_artifact',
                artifactId,
                baseRevisionId,
                requestId,
                title,
                note,
                html: prepareGeistPublication(html, geistAssets),
              });
              await onPublished(result);
              onClose();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Title
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                changed();
              }}
              maxLength={160}
              required
              disabled={busy}
            />
          </label>
          <label>
            HTML file
            <input
              type="file"
              accept=".html,.htm,text/html"
              ref={fileInput}
              disabled={busy}
              onChange={async (e) => {
                const sequence = ++readSequence.current;
                const file = e.target.files?.[0];
                setHtml('');
                setFileSummary(null);
                setRequestId(crypto.randomUUID());
                setError('');
                setSourceMode('file');
                if (!file) return;
                if (file.size > 512000) {
                  e.target.value = '';
                  setError('Choose an HTML file smaller than 512 KB.');
                  return;
                }
                try {
                  const contents = await file.text();
                  if (sequence !== readSequence.current) return;
                  if (!contents) {
                    e.target.value = '';
                    setError('Choose an HTML file with some content.');
                    return;
                  }
                  setHtml(contents);
                  setFileSummary({ name: file.name, bytes: file.size });
                  if (!title)
                    setTitle(
                      (current) =>
                        current || file.name.replace(/\.html?$/i, ''),
                    );
                } catch {
                  if (sequence !== readSequence.current) return;
                  e.target.value = '';
                  setError('That HTML file could not be read.');
                }
              }}
            />
          </label>
          {sourceMode === 'file' ? (
            <div className="fine-print" aria-live="polite">
              {fileSummary
                ? `Ready: ${fileSummary.name} (${fileSummary.bytes.toLocaleString()} bytes)`
                : 'Choose an HTML file, or paste its contents instead.'}
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  readSequence.current++;
                  if (fileInput.current) fileInput.current.value = '';
                  setSourceMode('paste');
                  setHtml('');
                  setFileSummary(null);
                  setError('');
                  changed();
                }}
                disabled={busy}
              >
                Paste HTML instead
              </Button>
            </div>
          ) : (
            <label>
              Paste HTML
              <textarea
                className="source-input"
                value={html}
                onChange={(e) => {
                  setHtml(e.target.value);
                  changed();
                }}
                maxLength={512000}
                required
                spellCheck={false}
                disabled={busy}
                placeholder="<!doctype html>…"
              />
            </label>
          )}
          {artifactId && (
            <label>
              What changed?
              <textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  changed();
                }}
                maxLength={800}
                disabled={busy}
              />
            </label>
          )}
          <p className="fine-print">
            Include styles and scripts in the file. Add data-review-id to
            sections for stable comment targets. External assets are restricted.
          </p>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button
              variant="outline"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !html}>
              {busy ? 'Publishing…' : 'Publish artifact'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
