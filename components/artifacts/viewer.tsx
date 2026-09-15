'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Download,
  Library,
  MessageSquare,
  MousePointer2,
  Plus,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { callCommand } from '@/lib/artifacts/client';
import { mergeReviewThreads } from '@/lib/artifacts/thread-state';
import {
  emptyTarget,
  type ArtifactDetail,
  type ReviewThread,
  type Target,
} from '@/lib/artifacts/contracts';
import {
  pointKey,
  readPoint,
  threadPoint,
  type FramePin,
  type PinPosition,
} from '@/lib/artifacts/point';
import {
  targetKey,
  readReviewTarget,
  threadReviewTarget,
  type TargetResolution,
  type TargetResolutionStatus,
} from '@/lib/artifacts/review-target';
import { ArtifactFrame } from './artifact-frame';
import { CommentPopover } from './comment-popover';
import { CommentInput } from './comment-input';
import { TargetContext } from './target-context';
import { PublishDialog } from './publish-dialog';
import { useSiteTools } from './site-tools';
import { geistAssets } from '@/lib/artifacts/geist-assets';
import { unpackGeistArtifact } from '@/lib/artifacts/geist-pack';

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Viewer({
  artifactId,
  revisionId,
}: {
  artifactId: string;
  revisionId?: string;
}) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [error, setError] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [publish, setPublish] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [focusArtifact, setFocusArtifact] = useState(false);
  const [target, setTarget] = useState<Target>(emptyTarget);
  const [body, setBody] = useState('');
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const draftRevisionRef = useRef<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const savingThreadsRef = useRef(new Set<string>());
  const [savingThreads, setSavingThreads] = useState(new Set<string>());
  const [threadErrors, setThreadErrors] = useState<Record<string, string>>({});
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [positionReport, setPositionReport] = useState<{
    revisionId: string;
    pins: FramePin[];
    positions: PinPosition[];
  } | null>(null);
  const [resolutionReport, setResolutionReport] = useState<{
    revisionId: string;
    pins: FramePin[];
    resolutions: TargetResolution[];
  } | null>(null);
  const [draftPosition, setDraftPosition] = useState<PinPosition | null>(null);
  const editableSource = useMemo(() => {
    try {
      return {
        html: unpackGeistArtifact(detail?.html ?? '', geistAssets),
        hint: '',
      };
    } catch {
      return {
        html: '',
        hint: 'This revision has no standard editable foundation. Download the HTML to edit it without changing its custom styles.',
      };
    }
  }, [detail?.html]);
  const [locate, setLocate] = useState<{ id: string; tick: number } | null>(
    null,
  );
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const refresh = useCallback(async () => {
    try {
      const incoming = await callCommand<ArtifactDetail>({
        action: 'get_artifact',
        artifactId,
        revisionId: revisionId ?? draftRevisionRef.current ?? undefined,
      });
      setDetail((current) => ({
        ...incoming,
        threads: mergeReviewThreads(
          current?.artifact.id === incoming.artifact.id ? current.threads : [],
          incoming.threads,
        ),
      }));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }, [artifactId, revisionId]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  useSiteTools(refresh, () => setPublish(true));
  const updateThreadStatus = useCallback(
    async (thread: ReviewThread, nextStatus: ReviewThread['status']) => {
      if (savingThreadsRef.current.has(thread.id)) return;
      savingThreadsRef.current.add(thread.id);
      setSavingThreads(new Set(savingThreadsRef.current));
      setThreadErrors((current) => ({ ...current, [thread.id]: '' }));
      const mergeThread = (saved: ReviewThread) => {
        setDetail((current) =>
          current?.artifact.id === saved.artifact_id
            ? {
                ...current,
                threads: mergeReviewThreads(current.threads, [saved]),
              }
            : current,
        );
      };
      try {
        const result = await callCommand<{ thread: ReviewThread }>({
          action: 'set_thread_status',
          threadId: thread.id,
          version: thread.version,
          status: nextStatus,
        });
        mergeThread(result.thread);
      } catch (err) {
        // Reconcile a conflict or lost response without refreshing other rows.
        try {
          const latest = await callCommand<{ threads: ReviewThread[] }>({
            action: 'get_review_context',
            artifactId: thread.artifact_id,
          });
          const saved = latest.threads.find(
            (candidate) => candidate.id === thread.id,
          );
          if (saved) {
            mergeThread(saved);
            if (saved.version > thread.version && saved.status === nextStatus)
              return;
          }
        } catch {
          // Keep the last confirmed state and leave this comment available to retry.
        }
        setThreadErrors((current) => ({
          ...current,
          [thread.id]: (err as Error).message,
        }));
      } finally {
        savingThreadsRef.current.delete(thread.id);
        setSavingThreads(new Set(savingThreadsRef.current));
      }
    },
    [],
  );
  const selectedResolvedId = detail?.threads.find(
    (thread) => thread.id === activeComment && thread.status === 'resolved',
  )?.id;
  const pins = useMemo<FramePin[]>(() => {
    if (!detail) return [];
    const saved: FramePin[] = detail.threads
      .map((thread) => ({
        id: thread.id,
        anchorId: thread.anchor_id,
        point: threadPoint(thread.view_state_json),
        target: threadReviewTarget(thread.view_state_json),
        context: thread.excerpt,
        crossRevision: thread.revision_id !== detail.revision.id,
        showPin: thread.status === 'open' || selectedResolvedId === thread.id,
      }))
      .filter((pin) => pin.point || pin.target || pin.anchorId)
      .slice(0, draftRevision === detail.revision.id ? 499 : 500);
    const point = readPoint(target.viewState[pointKey]);
    const reviewTarget = readReviewTarget(target.viewState[targetKey]);
    if (point && draftRevision === detail.revision.id)
      saved.push({
        id: 'draft',
        anchorId: target.anchorId,
        point,
        target: reviewTarget,
        context: target.excerpt,
        crossRevision: false,
        showPin: true,
      });
    return saved;
  }, [detail, target, draftRevision, selectedResolvedId]);
  const cancelPlacement = useCallback(() => {
    if (activeComment) setActiveComment(null);
    else {
      setCommenting(false);
    }
  }, [activeComment]);
  useEffect(() => {
    if (!commenting || activeComment || commentsOpen) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        setCommenting(false);
        document.getElementById('comments-toggle')?.focus();
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [commenting, activeComment, commentsOpen]);
  const updateTarget = (value: Target, position: PinPosition) => {
    if (busy || !readPoint(value.viewState[pointKey])) return;
    if (body.trim() && draftRevision && draftRevision !== detail?.revision.id) {
      setError(
        'Your unfinished comment belongs to an earlier revision. Open that revision to finish it.',
      );
      setCommentsOpen(true);
      return;
    }
    setError('');
    setTarget(value);
    draftRevisionRef.current = detail?.revision.id ?? null;
    setDraftRevision(detail?.revision.id ?? null);
    setRequestId(crypto.randomUUID());
    setActiveComment('draft');
    setDraftPosition(position);
    requestAnimationFrame(() =>
      document.getElementById('point-comment-body')?.focus(),
    );
  };
  const discardDraft = () => {
    setBody('');
    setTarget(emptyTarget);
    setDraftPosition(null);
    setDraftRevision(null);
    draftRevisionRef.current = null;
    setRequestId(crypto.randomUUID());
    setError('');
    setActiveComment(null);
  };
  const saveComment = async () => {
    if (!detail || busy || !body.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await callCommand<{ thread: ReviewThread }>({
        action: 'add_comment',
        artifactId,
        revisionId: draftRevision ?? detail.revision.id,
        requestId,
        body,
        target,
      });
      await refresh();
      setBody('');
      setTarget(emptyTarget);
      setDraftPosition(null);
      setDraftRevision(null);
      draftRevisionRef.current = null;
      setRequestId(crypto.randomUUID());
      setActiveComment(result.thread.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!detail)
    return (
      <main className="loading-state">
        <Link prefetch={false} href="/">
          Back to library
        </Link>
        <p role={error ? 'alert' : 'status'}>
          {error || 'Opening your artifact…'}
        </p>
        {error && <Button onClick={() => void refresh()}>Retry</Button>}
      </main>
    );
  const openCount = detail.threads.filter(
    (thread) => thread.status === 'open',
  ).length;
  const selectedThread = detail.threads.find(
    (thread) => thread.id === activeComment,
  );
  const resolution = (id: string): TargetResolutionStatus => {
    if (
      resolutionReport?.revisionId === detail.revision.id &&
      resolutionReport.pins === pins
    ) {
      const reported = resolutionReport.resolutions.find(
        (item) => item.id === id,
      );
      if (reported) return reported.status;
    }
    return pins.some((pin) => pin.id === id) ? 'checking' : 'not_checked';
  };
  const positions =
    positionReport?.revisionId === detail.revision.id &&
    positionReport.pins === pins
      ? positionReport.positions
      : [];
  const draftPositions =
    draftRevision === detail.revision.id &&
    draftPosition &&
    resolution('draft') === 'checking' &&
    !positions.some((point) => point.id === 'draft')
      ? [draftPosition]
      : [];
  const visiblePositions = [...positions, ...draftPositions].filter(
    (point) =>
      (point.id === 'draft' || resolution(point.id) === 'matching') &&
      typeof window !== 'undefined' &&
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < window.innerWidth &&
      point.y < window.innerHeight,
  );
  const activePosition = visiblePositions.find(
    (point) =>
      point.id === activeComment &&
      pins.some((pin) => pin.id === point.id && pin.showPin !== false),
  );
  const status = (thread: ReviewThread) =>
    ({
      checking: 'Checking target…',
      matching: 'Target matches this revision',
      changed: 'Target changed',
      missing: 'Target no longer found',
      ambiguous: 'Target has multiple matches',
      not_checked: 'Target not checked',
    })[resolution(thread.id)];
  const renderThread = (thread: ReviewThread, compact = false) => (
    <article
      className="review-thread"
      key={thread.id}
      id={`note-${thread.number}`}
    >
      <div className="thread-meta">
        <strong>#{thread.number}</strong>
        <Button
          variant="ghost"
          className="thread-status-action"
          disabled={savingThreads.has(thread.id)}
          aria-busy={savingThreads.has(thread.id)}
          onClick={() =>
            void updateThreadStatus(
              thread,
              thread.status === 'open' ? 'resolved' : 'open',
            )
          }
        >
          {savingThreads.has(thread.id)
            ? 'Saving…'
            : thread.status === 'open'
              ? 'Resolve'
              : 'Reopen'}
        </Button>
      </div>
      {threadErrors[thread.id] && (
        <p className="thread-status-error" role="alert">
          {threadErrors[thread.id]}
        </p>
      )}
      <p className="thread-body">{thread.body}</p>
      <TargetContext
        target={threadReviewTarget(thread.view_state_json)}
        section={thread.section}
        excerpt={thread.excerpt}
        compact={compact}
      />
      {thread.revision_id !== detail.revision.id && (
        <p className="comment-original-revision">
          {(detail.revisions.find(
            (revision) => revision.id === thread.revision_id,
          )?.number ?? detail.revision.number) < detail.revision.number
            ? 'From an earlier revision.'
            : 'From another revision.'}{' '}
          <Link
            prefetch={false}
            href={`/a/${artifactId}/r/${thread.revision_id}`}
          >
            Open original revision
          </Link>
        </p>
      )}
      {!compact && (
        <div className="target-status">
          <span>{status(thread)}</span>
          {resolution(thread.id) === 'matching' && (
            <button
              onClick={() => {
                setFocusArtifact(true);
                setCommenting(true);
                setActiveComment(thread.id);
                setLocate({ id: thread.id, tick: Date.now() });
                setCommentsOpen(false);
              }}
            >
              Locate
            </button>
          )}
        </div>
      )}
      {detail.events
        .filter((e) => e.thread_id === thread.id)
        .map((event) => (
          <div className="agent-reply" key={event.id}>
            <strong>
              Agent · {event.kind === 'addressed' ? 'Addressed' : 'Reply'}
            </strong>
            <p>{event.body}</p>
            {event.revision_id && (
              <Link
                prefetch={false}
                href={`/a/${artifactId}/r/${event.revision_id}`}
              >
                View revision
              </Link>
            )}
          </div>
        ))}
    </article>
  );
  return (
    <div className="viewer-shell">
      <h1 className="sr-only">{detail.artifact.title}</h1>
      <main className="artifact-field" aria-label="Artifact">
        <ArtifactFrame
          key={detail.revision.id}
          html={detail.html}
          revisionId={detail.revision.id}
          commenting={commenting && !commentsOpen}
          onTarget={updateTarget}
          onCancel={cancelPlacement}
          onError={setError}
          pins={pins}
          onPositions={(next, displayedRevisionId) => {
            if (displayedRevisionId === detail.revision.id)
              setPositionReport({
                revisionId: displayedRevisionId,
                pins,
                positions: next,
              });
          }}
          onResolutions={(next, displayedRevisionId) => {
            if (displayedRevisionId === detail.revision.id)
              setResolutionReport({
                revisionId: displayedRevisionId,
                pins,
                resolutions: next,
              });
          }}
          locate={locate}
        />
      </main>
      <Sheet
        open={commentsOpen}
        onOpenChange={(open) => {
          setCommentsOpen(open);
          if (open) {
            setActiveComment(null);
            setFocusArtifact(false);
          }
        }}
      >
        <div className="comment-tools">
          <Link
            href="/"
            prefetch={false}
            className="library-toggle"
            aria-label="Library"
            title="Library"
          >
            <Library aria-hidden="true" />
          </Link>
          <Button
            id="comments-toggle"
            variant="outline"
            className="comments-toggle"
            aria-label={
              commenting ? 'Exit comment mode' : 'Comment on this artifact'
            }
            aria-pressed={commenting}
            title={commenting ? 'Exit comment mode' : 'Comments'}
            disabled={busy}
            onClick={() => {
              setCommenting(!commenting);
              setActiveComment(null);
              setCommentsOpen(false);
              if (!commenting)
                document.getElementById('artifact-preview')?.focus();
            }}
          >
            {commenting ? (
              <MousePointer2 aria-hidden="true" />
            ) : (
              <MessageSquare aria-hidden="true" />
            )}
          </Button>
          {commenting && (
            <SheetTrigger
              aria-label={`View all comments, ${openCount} open`}
              render={
                <Button variant="outline" className="comments-list-toggle" />
              }
            >
              <MessageSquare aria-hidden="true" />
              <span>{openCount}</span>
            </SheetTrigger>
          )}
        </div>
        {commenting && !commentsOpen && activeComment !== 'draft' && error && (
          <div className="comment-placement-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {commenting && !commentsOpen && (
          <div className="comment-pins">
            {visiblePositions
              .filter((position) =>
                pins.some(
                  (pin) => pin.id === position.id && pin.showPin !== false,
                ),
              )
              .map((position) => {
                const thread = detail.threads.find(
                  (thread) => thread.id === position.id,
                );
                return (
                  <button
                    key={position.id}
                    id={`comment-pin-${position.id}`}
                    className="comment-pin"
                    aria-label={
                      position.id === 'draft'
                        ? 'Resume unfinished comment'
                        : `Open comment ${thread?.number}`
                    }
                    aria-expanded={activeComment === position.id}
                    style={{ left: position.x, top: position.y }}
                    onClick={() => setActiveComment(position.id)}
                  >
                    {position.id === 'draft' ? (
                      <MessageSquare size={14} />
                    ) : (
                      thread?.number
                    )}
                  </button>
                );
              })}
          </div>
        )}
        {commenting && !commentsOpen && activeComment && activePosition && (
          <CommentPopover
            key={activeComment}
            pinId={activeComment}
            title={
              activeComment === 'draft'
                ? 'Add a comment'
                : `Comment ${selectedThread?.number}`
            }
            onClose={() => {
              if (activeComment === 'draft' && !body.trim() && !busy)
                discardDraft();
              else setActiveComment(null);
            }}
          >
            {activeComment === 'draft' ? (
              <form
                className="point-comment-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveComment();
                }}
              >
                <TargetContext
                  target={readReviewTarget(target.viewState[targetKey])}
                  section={target.section}
                  excerpt={target.excerpt}
                  compact
                />
                <label className="sr-only" htmlFor="point-comment-body">
                  Your comment
                </label>
                <CommentInput
                  id="point-comment-body"
                  placeholder="What would you like to change?"
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                  required
                  maxLength={4000}
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      void saveComment();
                    }
                  }}
                />
                {error && (
                  <p className="point-comment-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="point-comment-actions">
                  <button
                    type="button"
                    className="discard-comment"
                    disabled={busy}
                    onClick={discardDraft}
                  >
                    Discard
                  </button>
                  <Button
                    type="submit"
                    size="icon"
                    disabled={busy || !body.trim()}
                    aria-label={busy ? 'Saving comment' : 'Save comment'}
                  >
                    <ArrowUp />
                  </Button>
                </div>
              </form>
            ) : (
              selectedThread && renderThread(selectedThread, true)
            )}
          </CommentPopover>
        )}
        <SheetContent
          className="comments-panel"
          showCloseButton={false}
          initialFocus={() => document.getElementById('comments-heading')}
          finalFocus={() =>
            document.getElementById(
              focusArtifact ? 'artifact-preview' : 'comments-toggle',
            )
          }
        >
          <header className="comments-heading">
            <div>
              <SheetTitle id="comments-heading" tabIndex={-1}>
                Comments
              </SheetTitle>
              <SheetDescription>{detail.artifact.title}</SheetDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Artifact options"
                render={<Button variant="ghost" size="icon" />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="artifact-options" align="end">
                <DropdownMenuItem onClick={() => window.location.assign('/')}>
                  <ArrowLeft />
                  Library
                </DropdownMenuItem>
                {detail.revisions.length > 1 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>History</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="artifact-options">
                      {detail.revisions.map((revision) => (
                        <DropdownMenuItem
                          key={revision.id}
                          onClick={() =>
                            window.location.assign(
                              `/a/${artifactId}/r/${revision.id}`,
                            )
                          }
                        >
                          {revision.id === detail.artifact.current_revision_id
                            ? 'Current'
                            : new Date(revision.created_at).toLocaleString()}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuItem onClick={() => setPublish(true)}>
                  <Plus />
                  Publish revision
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    download(detail.html, 'artifact.html', 'text/html')
                  }
                >
                  <Download />
                  Download HTML
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      const data = await callCommand({
                        action: 'get_review_context',
                        artifactId,
                      });
                      download(
                        JSON.stringify(data, null, 2),
                        'review-context.json',
                        'application/json',
                      );
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  Download comments
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <SheetClose
              aria-label="Close comments"
              render={<Button variant="ghost" size="icon" />}
            >
              <X />
            </SheetClose>
          </header>
          <div className="review-rail">
            {detail.revision.id !== detail.artifact.current_revision_id && (
              <p className="history-banner">
                Earlier publication ·{' '}
                <Link prefetch={false} href={`/a/${artifactId}`}>
                  Open current
                </Link>
              </p>
            )}
            {error && (
              <div className="error-message" role="alert">
                {error}
                <Button variant="ghost" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            )}
            <div className="comment-panel-actions">
              <Button
                variant="ghost"
                className="place-comment"
                onClick={() => {
                  setFocusArtifact(true);
                  setCommentsOpen(false);
                  setCommenting(true);
                }}
              >
                <Plus />
                Place a comment
              </Button>
              <Button
                variant="ghost"
                className="resolve-all"
                disabled={savingThreads.size > 0 || openCount === 0}
                onClick={() =>
                  void Promise.all(
                    detail.threads
                      .filter((thread) => thread.status === 'open')
                      .map((thread) => updateThreadStatus(thread, 'resolved')),
                  )
                }
              >
                Mark all as resolved
              </Button>
            </div>
            <div className="note-filter">
              <button
                aria-pressed={filter === 'open'}
                onClick={() => setFilter('open')}
              >
                Open ({openCount})
              </button>
              <button
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                All ({detail.threads.length})
              </button>
            </div>
            <div className="threads">
              {detail.threads
                .filter(
                  (thread) => filter === 'all' || thread.status === 'open',
                )
                .map((thread) => renderThread(thread))}
              {!detail.threads.some(
                (thread) => filter === 'all' || thread.status === 'open',
              ) && (
                <div className="no-notes">
                  <h3>No open comments</h3>
                  <p>
                    Select text or click an element to comment. Drag from empty
                    space to select an area.
                  </p>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      {publish && (
        <PublishDialog
          onClose={() => setPublish(false)}
          artifactId={artifactId}
          baseRevisionId={detail.revision.id}
          initialTitle={detail.artifact.title}
          initialHtml={editableSource.html}
          sourceHint={editableSource.hint}
          onPublished={async (result) => {
            window.location.assign(`/a/${artifactId}/r/${result.revisionId}`);
          }}
        />
      )}
    </div>
  );
}
