import { z } from 'zod';

// Target evidence belongs to the original revision's immutable view state.
export const targetKey = '__oa_target';
export const maxReviewTargetLength = 20_000;

const normalized = (value: string) =>
  value === value.replace(/\s+/g, ' ').trim();
const elementSchema = z
  .object({
    tag: z
      .string()
      .max(64)
      .regex(/^[a-z][a-z0-9-]*$/),
    path: z
      .string()
      .max(120)
      .regex(/^(?:\d+(?:\.\d+)*)?$/),
    cssPath: z.string().min(1).max(2000),
    reviewId: z.string().min(1).max(160).nullable(),
    text: z
      .string()
      .max(1200)
      .refine(normalized, 'Element text must be normalized.'),
    label: z.string().max(300),
  })
  .strict();

const textSchema = z
  .object({
    exact: z.string().min(1).max(8000),
    domExact: z.string().min(1).max(8000).optional(),
    prefix: z.string().max(200),
    suffix: z.string().max(200),
    // UTF-16 offsets in the common containing element's textContent.
    startOffset: z.number().int().min(0).max(10_000_000),
    endOffset: z.number().int().min(1).max(10_000_000),
  })
  .strict()
  .refine(
    (value) =>
      value.endOffset - value.startOffset ===
      (value.domExact ?? value.exact).length,
    'Text offsets must cover the DOM quote.',
  );

const dimensionsSchema = z
  .object({
    width: z.number().finite().positive().max(10_000_000),
    height: z.number().finite().positive().max(10_000_000),
  })
  .strict();
const rectangleSchema = z
  .object({
    x: z.number().finite().min(0).max(10_000_000),
    y: z.number().finite().min(0).max(10_000_000),
    width: z.number().finite().positive().max(10_000_000),
    height: z.number().finite().positive().max(10_000_000),
  })
  .strict();
const memberSchema = z
  .object({
    element: elementSchema,
    rect: rectangleSchema.extend({
      x: z.number().finite().min(-10_000_000).max(10_000_000),
      y: z.number().finite().min(-10_000_000).max(10_000_000),
    }),
    coverage: z.enum(['full', 'partial']),
  })
  .strict();
const fingerprintSchema = z.string().regex(/^v1:[a-f0-9]{16}$/);
const layoutSchema = z
  .object({
    members: z.array(memberSchema).max(8),
    truncated: z.boolean(),
    fingerprint: fingerprintSchema.optional(),
  })
  .strict();
const pointGeometrySchema = dimensionsSchema.extend({
  layout: layoutSchema.optional(),
});
const areaSchema = z
  .object({
    rect: rectangleSchema,
    viewport: dimensionsSchema,
    container: dimensionsSchema,
    layout: z
      .object({ fingerprint: fingerprintSchema, truncated: z.boolean() })
      .strict()
      .optional(),
    members: z.array(memberSchema).max(8),
    truncated: z.boolean(),
  })
  .strict()
  .refine(
    (area) =>
      area.rect.width >= 6 &&
      area.rect.height >= 6 &&
      area.rect.x + area.rect.width <= area.container.width + 1 &&
      area.rect.y + area.rect.height <= area.container.height + 1,
    'Selected area must fit its containing element.',
  );

export type TargetResolutionStatus =
  | 'checking'
  | 'matching'
  | 'changed'
  | 'missing'
  | 'ambiguous'
  | 'not_checked';
export type TargetResolution = { id: string; status: TargetResolutionStatus };

export const reviewTargetSchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        version: z.literal(1),
        kind: z.literal('element'),
        element: elementSchema,
      })
      .strict(),
    z
      .object({
        version: z.literal(1),
        kind: z.literal('text'),
        element: elementSchema,
        text: textSchema,
      })
      .strict(),
    z
      .object({
        version: z.literal(1),
        kind: z.literal('point'),
        element: elementSchema.optional(),
        geometry: pointGeometrySchema.optional(),
      })
      .strict(),
    z
      .object({
        version: z.literal(1),
        kind: z.literal('area'),
        element: elementSchema,
        area: areaSchema,
      })
      .strict(),
  ])
  .refine(
    (value) => JSON.stringify(value).length <= maxReviewTargetLength,
    'Comment target is too large.',
  );

export type ReviewTarget = z.infer<typeof reviewTargetSchema>;

export function parseReviewTarget(value: unknown): ReviewTarget | null {
  const parsed = reviewTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readReviewTarget(value: unknown): ReviewTarget | null {
  if (typeof value !== 'string' || value.length > maxReviewTargetLength)
    return null;
  try {
    return parseReviewTarget(JSON.parse(value));
  } catch {
    return null;
  }
}

export function threadReviewTarget(viewStateJson: string): ReviewTarget | null {
  try {
    return readReviewTarget(JSON.parse(viewStateJson)?.[targetKey]);
  } catch {
    return null;
  }
}
