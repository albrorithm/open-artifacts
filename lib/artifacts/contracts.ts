import { z } from 'zod';
import { pointKey, readPoint } from './point';
import {
  maxReviewTargetLength,
  readReviewTarget,
  targetKey,
  type ReviewTarget,
} from './review-target';

export const id = z.string().uuid();
export const targetSchema = z
  .object({
    anchorId: z.string().max(160).nullable(),
    excerpt: z.string().max(1200),
    section: z.string().max(200),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .or(z.literal('')),
    viewState: z
      .record(
        z.string().max(160),
        z.union([
          z.string().max(maxReviewTargetLength),
          z.number().finite(),
          z.boolean(),
        ]),
      )
      .superRefine((value, context) => {
        const keys = Object.keys(value);
        const ordinaryKeys = keys.filter(
          (key) => key !== pointKey && key !== targetKey,
        );
        const tooMany =
          targetKey in value ? ordinaryKeys.length > 19 : keys.length > 20;
        if (tooMany)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Too many view-state values.',
          });
        for (const key of keys) {
          if (key === targetKey) {
            if (!readReviewTarget(value[key]))
              context.addIssue({
                code: z.ZodIssueCode.custom,
                path: [key],
                message: 'Invalid comment target.',
              });
          } else if (
            typeof value[key] === 'string' &&
            value[key].length > 300
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: 'View-state values must be at most 300 characters.',
            });
          }
        }
      })
      .refine(
        (v) => !(pointKey in v) || readPoint(v[pointKey]) !== null,
        'Invalid comment placement.',
      ),
  })
  .strict()
  .refine(
    (v) => !v.anchorId || !!v.fingerprint,
    'Anchored comments require a context fingerprint.',
  );

export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list_artifacts') }).strict(),
  z
    .object({
      action: z.literal('get_artifact'),
      artifactId: id,
      revisionId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('publish_artifact'),
      artifactId: id.optional(),
      baseRevisionId: id.optional(),
      requestId: id,
      title: z.string().trim().min(1).max(160),
      note: z.string().trim().max(800).default(''),
      html: z
        .string()
        .min(1)
        .max(512_000)
        .refine(
          (value) => new TextEncoder().encode(value).length <= 512_000,
          'HTML must be at most 512 KB.',
        ),
    })
    .strict(),
  z
    .object({ action: z.literal('get_review_context'), artifactId: id })
    .strict(),
  z
    .object({
      action: z.literal('add_comment'),
      artifactId: id,
      revisionId: id,
      requestId: id,
      body: z.string().trim().min(1).max(4000),
      target: targetSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('set_thread_status'),
      threadId: id,
      version: z.number().int().positive(),
      status: z.enum(['open', 'resolved']),
    })
    .strict(),
  z
    .object({
      action: z.literal('reply_to_comment'),
      threadId: id,
      requestId: id,
      body: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({ action: z.literal('create_review_batch'), artifactId: id })
    .strict(),
  z
    .object({
      action: z.literal('mark_addressed'),
      threadId: id,
      revisionId: id,
      batchId: id,
      requestId: id,
      body: z.string().trim().min(1).max(4000),
    })
    .strict(),
]);

export type Command = z.infer<typeof commandSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Artifact = {
  id: string;
  title: string;
  current_revision_id: string;
  created_at: string;
  updated_at: string;
  open_comments?: number;
};
export type Revision = {
  id: string;
  artifact_id: string;
  number: number;
  title: string;
  note: string;
  content_sha256: string;
  created_at: string;
};
export type ReviewThread = {
  id: string;
  artifact_id: string;
  revision_id: string;
  number: number;
  anchor_id: string | null;
  excerpt: string;
  section: string;
  context_fingerprint: string;
  view_state_json: string;
  review_target?: ReviewTarget | null;
  is_from_earlier_revision: boolean;
  body: string;
  status: 'open' | 'resolved';
  version: number;
  created_at: string;
  updated_at: string;
};
export type ThreadEvent = {
  id: string;
  thread_id: string;
  kind: 'reply' | 'addressed';
  actor: string;
  body: string;
  revision_id: string | null;
  batch_id: string | null;
  created_at: string;
};
export type ArtifactDetail = {
  artifact: Artifact;
  revision: Revision;
  revisions: Revision[];
  html: string;
  threads: ReviewThread[];
  events: ThreadEvent[];
};
export const emptyTarget: Target = {
  anchorId: null,
  excerpt: '',
  section: '',
  fingerprint: '',
  viewState: {},
};
