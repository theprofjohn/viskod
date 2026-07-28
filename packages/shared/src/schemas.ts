import { z } from 'zod';

export const IdentifierSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const SemVerSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const ViewportSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  deviceScaleFactor: z.number().min(0.5).max(3.0),
});

export const SpacingSchema = z.object({
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
});

export const ErrorCategorySchema = z.enum([
  'validation',
  'runtime',
  'network',
  'storage',
  'browser',
  'plugin',
  'security',
  'internal',
  'configuration',
]);

export const ErrorSeveritySchema = z.enum(['info', 'warning', 'recoverable', 'critical', 'fatal']);

export const ViskodErrorSchema = z.object({
  code: z.string().min(1),
  category: ErrorCategorySchema,
  severity: ErrorSeveritySchema,
  message: z.string().min(1),
  cause: z.string().optional(),
  recovery: z.string().optional(),
  correlationId: IdentifierSchema,
  subsystem: z.string().min(1),
  timestamp: TimestampSchema,
  metadata: z.record(z.unknown()).optional(),
});
