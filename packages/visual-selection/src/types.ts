export type VisualSelectionMode = 'single' | 'box';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportInfo {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  scrollX: number;
  scrollY: number;
}

export interface PageInfo {
  url: string;
  title?: string;
  navigationId?: string;
  documentId?: string;
  viewport: ViewportInfo;
}

export interface RegionInfo {
  viewportRect: Rect;
  documentRect?: Rect;
}

export interface SemanticInfo {
  tagName: string;
  role?: string;
  accessibleName?: string;
  textPreview?: string;
  inputType?: string;
  isInteractive: boolean;
}

export interface TargetGeometry {
  viewportRect: Rect;
  documentRect?: Rect;
  visibleRatio?: number;
}

export interface Fingerprints {
  stableAttributes?: Record<string, string>;
  ancestorFingerprint?: string[];
  siblingFingerprint?: {
    index?: number;
    nearbyText?: string[];
  };
  domPathFingerprint?: string[];
}

export interface FrameworkHints {
  framework?: string;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
  confidence?: number;
}

export interface ResolutionCandidate {
  strategy:
    | 'runtime-node'
    | 'stable-attribute'
    | 'accessibility'
    | 'semantic-text'
    | 'dom-fingerprint'
    | 'geometry';
  value: unknown;
  confidence: number;
}

export interface VisualSelectionTarget {
  targetId: string;
  documentOrder: number;
  geometry: TargetGeometry;
  semantics: SemanticInfo;
  fingerprints: Fingerprints;
  frameworkHints?: FrameworkHints;
  resolutionCandidates: ResolutionCandidate[];
  /**
   * Internal recapture/capture locator produced in page context (stable
   * attribute first, bounded ancestor path fallback). Never rendered as the
   * primary UI label; omitted when no safe unique locator can be produced.
   */
  selector?: string;
}

export interface VisualSelectionSummary {
  label?: string;
  role?: string;
  textPreview?: string;
  targetCount: number;
}

export interface VisualSelectionResolution {
  status: 'resolved' | 'ambiguous' | 'stale' | 'missing';
  confidence: number;
  resolvedAt: string;
  warnings?: string[];
}

export interface VisualSelection {
  schemaVersion: number;
  selectionId: string;
  sessionId: string;
  pageId: string;
  mode: VisualSelectionMode;
  createdAt: string;
  updatedAt: string;
  page: PageInfo;
  region: RegionInfo;
  targets: VisualSelectionTarget[];
  summary: VisualSelectionSummary;
  resolution: VisualSelectionResolution;
}

export interface VisualSelectionConfig {
  minIntersectionRatio: number;
  minVisibleArea: number;
  maxAncestorDepth: number;
  maxSelectedTargets: number;
  hoverUpdateThrottleMs: number;
  textPreviewMaxLength: number;
  ambiguityScoreMargin: number;
  confidenceThreshold: number;
  dragThreshold: number;
}

export const DEFAULT_VISUAL_SELECTION_CONFIG: VisualSelectionConfig = {
  minIntersectionRatio: 0.1,
  minVisibleArea: 16,
  maxAncestorDepth: 10,
  maxSelectedTargets: 50,
  hoverUpdateThrottleMs: 50,
  textPreviewMaxLength: 120,
  ambiguityScoreMargin: 0.15,
  confidenceThreshold: 0.6,
  dragThreshold: 5,
};

export type SelectionErrorCode =
  | 'NO_ACTIVE_PAGE'
  | 'SELECTION_MODE_ALREADY_ACTIVE'
  | 'SELECTION_MODE_NOT_ACTIVE'
  | 'OVERLAY_INJECTION_FAILED'
  | 'PAGE_NAVIGATION_DURING_SELECTION'
  | 'STALE_RUNTIME_NODE'
  | 'TARGET_MISSING'
  | 'TARGET_AMBIGUOUS'
  | 'UNSUPPORTED_CROSS_ORIGIN_FRAME'
  | 'SELECTION_TARGET_LIMIT_EXCEEDED'
  | 'PAGE_DISCONNECTED'
  | 'SESSION_MISMATCH'
  | 'INVALID_SELECTION_ID';
