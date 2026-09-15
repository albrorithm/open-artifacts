'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { frameDocument } from '@/lib/artifacts/frame';
import { targetSchema, type Target } from '@/lib/artifacts/contracts';
import type { FramePin, PinPosition } from '@/lib/artifacts/point';
import type {
  TargetResolution,
  TargetResolutionStatus,
} from '@/lib/artifacts/review-target';
import { readFrameTheme } from '@/lib/artifacts/theme';

export type AnchorInventory = Record<
  string,
  { count: number; fingerprint: string }
>;
async function fingerprint(text: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export function ArtifactFrame({
  html,
  revisionId,
  commenting,
  onTarget,
  onCancel,
  onError,
  onInventory,
  locate,
  pins,
  onPositions,
  onResolutions,
}: {
  html: string;
  revisionId: string;
  commenting: boolean;
  onTarget: (target: Target, position: PinPosition) => void;
  onCancel: () => void;
  onError: (message: string) => void;
  onInventory?: (inventory: AnchorInventory) => void;
  locate: { id: string; tick: number } | null;
  pins: FramePin[];
  onPositions: (positions: PinPosition[], revisionId: string) => void;
  onResolutions: (resolutions: TargetResolution[], revisionId: string) => void;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({
    onTarget,
    onInventory,
    revisionId,
    commenting,
    onCancel,
    onError,
    pins,
    onPositions,
    onResolutions,
    locate,
  });
  useLayoutEffect(() => {
    callbacks.current = {
      onTarget,
      onInventory,
      revisionId,
      commenting,
      onCancel,
      onError,
      pins,
      onPositions,
      onResolutions,
      locate,
    };
  });
  const [token] = useState(() => crypto.randomUUID());
  const [navigated, setNavigated] = useState(false);
  const [theme, setTheme] = useState<ReturnType<typeof readFrameTheme>>(null);
  const loads = useRef(0);
  const source = useMemo(() => frameDocument(html, token), [html, token]);
  useEffect(() => {
    let active = true;
    let connected = false;
    let reports = 0;
    let reportWindow = Date.now();
    let targetSequence = 0;
    const receive = (event: MessageEvent) => {
      if (
        connected ||
        event.source !== iframe.current?.contentWindow ||
        event.data?.type !== 'oa-ready' ||
        event.data.token !== token
      )
        return;
      connected = true;
      const channel = new MessageChannel();
      port.current = channel.port1;
      channel.port1.onmessage = async (message) => {
        if (Date.now() - reportWindow > 1000) {
          reportWindow = Date.now();
          reports = 0;
        }
        if (!active || ++reports > 200) return;
        const data = message.data;
        if (!data || typeof data !== 'object') return;
        if (data.type === 'theme') {
          const next = readFrameTheme(data.color);
          if (next)
            setTheme((current) =>
              current?.color === next.color ? current : next,
            );
        } else if (data.type === 'cancel' && callbacks.current.commenting) {
          targetSequence++;
          callbacks.current.onCancel();
        } else if (
          data.type === 'selection-error' &&
          callbacks.current.commenting
        ) {
          targetSequence++;
          callbacks.current.onError(
            [
              'Select up to 8,000 characters for one comment.',
              'Select an area at least 6 by 6 pixels.',
              'This area cannot be attached. Try a smaller area within the artifact.',
            ].includes(data.message)
              ? data.message
              : 'This selection cannot be attached. Select text within the artifact or click an element.',
          );
        } else if (
          data.type === 'positions' &&
          data.revisionId === callbacks.current.revisionId &&
          data.generation === generation.current &&
          Array.isArray(data.positions) &&
          data.positions.length <= 500
        ) {
          const allowed = new Set(
            callbacks.current.pins
              .filter((pin) => pin.showPin !== false)
              .map((pin) => pin.id),
          );
          const positions: PinPosition[] = [];
          for (const point of data.positions) {
            if (
              !point ||
              !allowed.delete(point.id) ||
              !Number.isFinite(point.x) ||
              !Number.isFinite(point.y) ||
              Math.abs(point.x) > 10_000_000 ||
              Math.abs(point.y) > 10_000_000
            )
              continue;
            positions.push({ id: point.id, x: point.x, y: point.y });
          }
          callbacks.current.onPositions(
            positions,
            callbacks.current.revisionId,
          );
        } else if (
          data.type === 'resolutions' &&
          data.revisionId === callbacks.current.revisionId &&
          data.generation === generation.current &&
          Array.isArray(data.resolutions) &&
          data.resolutions.length <= 500
        ) {
          const statuses = new Set<TargetResolutionStatus>([
            'checking',
            'matching',
            'changed',
            'missing',
            'ambiguous',
            'not_checked',
          ]);
          const remaining = new Set(
            callbacks.current.pins.map((pin) => pin.id),
          );
          const resolutions: TargetResolution[] = [];
          for (const resolution of data.resolutions) {
            if (
              !resolution ||
              !statuses.has(resolution.status) ||
              !remaining.delete(resolution.id)
            )
              continue;
            resolutions.push({ id: resolution.id, status: resolution.status });
          }
          for (const id of remaining)
            resolutions.push({ id, status: 'not_checked' });
          callbacks.current.onResolutions(
            resolutions,
            callbacks.current.revisionId,
          );
        } else if (data.type === 'target' && callbacks.current.commenting) {
          const sequence = ++targetSequence;
          if (
            !Number.isFinite(data.position?.x) ||
            !Number.isFinite(data.position?.y) ||
            data.position.x < 0 ||
            data.position.y < 0 ||
            data.position.x > 100_000 ||
            data.position.y > 100_000
          )
            return;
          const parsed = targetSchema.safeParse({
            anchorId: data.anchorId,
            excerpt: data.excerpt,
            section: data.section,
            fingerprint: '0'.repeat(64),
            viewState: data.viewState,
          });
          if (!parsed.success) return;
          const target = {
            ...parsed.data,
            fingerprint: await fingerprint(parsed.data.excerpt),
          };
          if (
            active &&
            sequence === targetSequence &&
            callbacks.current.commenting
          )
            callbacks.current.onTarget(target, {
              id: 'draft',
              x: data.position.x,
              y: data.position.y,
            });
        } else if (
          data.type === 'inventory' &&
          callbacks.current.onInventory &&
          Array.isArray(data.anchors) &&
          data.anchors.length <= 500
        ) {
          const inventory: AnchorInventory = Object.create(null);
          for (const anchor of data.anchors) {
            if (
              typeof anchor?.id !== 'string' ||
              anchor.id.length > 160 ||
              typeof anchor.text !== 'string' ||
              anchor.text.length > 1200
            )
              return;
            inventory[anchor.id] = {
              count: (inventory[anchor.id]?.count ?? 0) + 1,
              fingerprint: await fingerprint(anchor.text),
            };
          }
          if (active) callbacks.current.onInventory?.(inventory);
        }
      };
      (event.source as Window).postMessage({ type: 'oa-connect', token }, '*', [
        channel.port2,
      ]);
      channel.port1.postMessage({
        type: 'mode',
        commenting: callbacks.current.commenting,
      });
      channel.port1.postMessage({
        type: 'pins',
        pins: callbacks.current.pins,
        revisionId: callbacks.current.revisionId,
        generation: generation.current,
      });
      if (callbacks.current.locate)
        channel.port1.postMessage({
          type: 'locate',
          id: callbacks.current.locate.id,
        });
    };
    window.addEventListener('message', receive);
    return () => {
      active = false;
      window.removeEventListener('message', receive);
      port.current?.close();
      port.current = null;
    };
  }, [token]);
  useEffect(() => {
    if (!theme || navigated) return;
    const root = document.documentElement;
    const previousColor = root.style.getPropertyValue(
      '--oa-browser-background',
    );
    const previousColorScheme = root.style.colorScheme;
    const themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    const schemeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="color-scheme"]',
    );
    const previousTheme = themeMeta?.content;
    const previousScheme = schemeMeta?.content;
    root.style.setProperty('--oa-browser-background', theme.color);
    root.style.colorScheme = theme.scheme;
    if (themeMeta) themeMeta.content = theme.color;
    if (schemeMeta) schemeMeta.content = theme.scheme;
    return () => {
      if (previousColor)
        root.style.setProperty('--oa-browser-background', previousColor);
      else root.style.removeProperty('--oa-browser-background');
      root.style.colorScheme = previousColorScheme;
      if (themeMeta && previousTheme !== undefined)
        themeMeta.content = previousTheme;
      if (schemeMeta && previousScheme !== undefined)
        schemeMeta.content = previousScheme;
    };
  }, [theme, navigated]);
  useEffect(() => {
    port.current?.postMessage({ type: 'mode', commenting });
  }, [commenting]);
  useLayoutEffect(() => {
    generation.current++;
    callbacks.current.onResolutions(
      pins.map((pin) => ({ id: pin.id, status: 'checking' })),
      revisionId,
    );
    callbacks.current.onPositions([], revisionId);
    port.current?.postMessage({
      type: 'pins',
      pins,
      revisionId,
      generation: generation.current,
    });
  }, [pins, revisionId]);
  useEffect(() => {
    if (locate) port.current?.postMessage({ type: 'locate', id: locate.id });
  }, [locate]);
  return navigated ? (
    <output className="frame-notice">
      This artifact navigated away from its saved page. Reload the revision to
      continue reviewing it.
    </output>
  ) : (
    <iframe
      ref={iframe}
      id="artifact-preview"
      title="Artifact preview"
      sandbox="allow-scripts"
      src="about:blank"
      srcDoc={source}
      referrerPolicy="no-referrer"
      allow=""
      onLoad={() => {
        if (++loads.current > 1) {
          port.current?.close();
          port.current = null;
          generation.current++;
          callbacks.current.onResolutions(
            callbacks.current.pins.map((pin) => ({
              id: pin.id,
              status: 'not_checked',
            })),
            callbacks.current.revisionId,
          );
          callbacks.current.onPositions([], callbacks.current.revisionId);
          setNavigated(true);
        }
      }}
    />
  );
}
