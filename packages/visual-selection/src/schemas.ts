import { z } from 'zod';

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const ViewportInfoSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  deviceScaleFactor: z.number().min(0.5).max(3.0).optional(),
  scrollX: z.number(),
  scrollY: z.number(),
});

export const PageInfoSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  navigationId: z.string().optional(),
  documentId: z.string().optional(),
  viewport: ViewportInfoSchema,
});

export const RegionInfoSchema = z.object({
  viewportRect: RectSchema,
  documentRect: RectSchema.optional(),
});

export const SemanticInfoSchema = z.object({
  tagName: z.string(),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  textPreview: z.string().optional(),
  inputType: z.string().optional(),
  isInteractive: z.boolean(),
});

export const TargetGeometrySchema = z.object({
  viewportRect: RectSchema,
  documentRect: RectSchema.optional(),
  visibleRatio: z.number().min(0).max(1).optional(),
});

export const FingerprintsSchema = z.object({
  stableAttributes: z.record(z.string()).optional(),
  ancestorFingerprint: z.array(z.string()).optional(),
  siblingFingerprint: z
    .object({
      index: z.number().optional(),
      nearbyText: z.array(z.string()).optional(),
    })
    .optional(),
  domPathFingerprint: z.array(z.string()).optional(),
});

export const FrameworkHintsSchema = z.object({
  framework: z.string().optional(),
  componentName: z.string().optional(),
  sourceFile: z.string().optional(),
  sourceLine: z.number().optional(),
  sourceColumn: z.number().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const ResolutionCandidateSchema = z.object({
  strategy: z.enum([
    'runtime-node',
    'stable-attribute',
    'accessibility',
    'semantic-text',
    'dom-fingerprint',
    'geometry',
  ]),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
});

export const VisualSelectionTargetSchema = z.object({
  targetId: z.string().min(1),
  documentOrder: z.number().int().nonnegative(),
  geometry: TargetGeometrySchema,
  semantics: SemanticInfoSchema,
  fingerprints: FingerprintsSchema,
  frameworkHints: FrameworkHintsSchema.optional(),
  resolutionCandidates: z.array(ResolutionCandidateSchema),
  selector: z.string().min(1).optional(),
});

export const VisualSelectionSummarySchema = z.object({
  label: z.string().optional(),
  role: z.string().optional(),
  textPreview: z.string().optional(),
  targetCount: z.number().int().nonnegative(),
});

export const VisualSelectionResolutionSchema = z.object({
  status: z.enum(['resolved', 'ambiguous', 'stale', 'missing']),
  confidence: z.number().min(0).max(1),
  resolvedAt: z.string(),
  warnings: z.array(z.string()).optional(),
});

export const VisualSelectionSchema = z.object({
  schemaVersion: z.literal(1),
  selectionId: z.string().min(1),
  sessionId: z.string().min(1),
  pageId: z.string().min(1),
  mode: z.enum(['single', 'box']),
  createdAt: z.string(),
  updatedAt: z.string(),
  page: PageInfoSchema,
  region: RegionInfoSchema,
  targets: z.array(VisualSelectionTargetSchema),
  summary: VisualSelectionSummarySchema,
  resolution: VisualSelectionResolutionSchema,
});

export const VisualSelectionModeSchema = z.enum(['single', 'box']);
