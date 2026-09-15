import { z } from 'zod';
import type { ReviewTarget } from './review-target';

// Versioned placement metadata shares the immutable captured view state.
export const pointKey = '__oa_point';
export const pointSchema = z
  .object({
    version: z.literal(1),
    x: z.number().finite().min(0).max(10_000_000),
    y: z.number().finite().min(0).max(10_000_000),
    width: z.number().finite().positive().max(100_000),
    relativeX: z.number().finite().min(0).max(1),
    relativeY: z.number().finite().min(0).max(1),
    path: z
      .string()
      .max(120)
      .regex(/^\d+(\.\d+)*$/)
      .or(z.literal('')),
  })
  .strict();
export type CommentPoint = z.infer<typeof pointSchema>;
export type FramePin = {
  id: string;
  anchorId: string | null;
  point: CommentPoint | null;
  context: string;
  target?: ReviewTarget | null;
  crossRevision?: boolean;
  showPin?: boolean;
};
export type PinPosition = { id: string; x: number; y: number };

export function readPoint(value: unknown): CommentPoint | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const parsed = pointSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function threadPoint(viewStateJson: string): CommentPoint | null {
  try {
    return readPoint(JSON.parse(viewStateJson)?.[pointKey]);
  } catch {
    return null;
  }
}
