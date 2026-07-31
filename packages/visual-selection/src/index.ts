export {
  VisualSelectionServiceImpl,
} from './service';
export type {
  VisualSelectionService,
  VisualSelectionServiceHealth,
} from './service';

export type {
  VisualSelection,
  VisualSelectionMode,
  VisualSelectionTarget,
  VisualSelectionSummary,
  VisualSelectionResolution,
  VisualSelectionConfig,
  Rect,
  PageInfo,
  ViewportInfo,
  TargetGeometry,
  SemanticInfo,
  Fingerprints,
  FrameworkHints,
  ResolutionCandidate,
  SelectionErrorCode,
} from './types';

export {
  DEFAULT_VISUAL_SELECTION_CONFIG,
} from './types';

export {
  normalizeRect,
  rectsIntersect,
  intersectionRect,
  rectArea,
  intersectionRatio,
  visibleRatio,
  rectContains,
  centerOfRect,
  isZeroArea,
} from './geometry';

export {
  scoreCandidate,
  filterCandidates,
  scoreAndRank,
  isAmbiguous,
  selectBestCandidate,
} from './scoring';
export type {
  CandidateElement,
  CandidateScore,
} from './scoring';

export {
  collectBoxCandidates,
  reduceBoxSelection,
  boxCandidateToTarget,
  deduplicateTargets,
} from './box-selection';
export type {
  BoxCandidate,
  BoxSelectionResult,
} from './box-selection';

export {
  resolveTarget,
} from './resolver';
export type {
  ResolvedTarget,
  ResolvedElement,
} from './resolver';

export {
  redactSelectionData,
  normalizeText,
  truncateText,
} from './redaction';
export type {
  SelectionRedactionResult,
} from './redaction';

export {
  VisualSelectionSchema,
  VisualSelectionTargetSchema,
  RectSchema,
} from './schemas';

export {
  SelectionOverlayController,
} from './integration';
export type {
  OverlayIntegrationOptions,
  BrowserIntegration,
  OverlayEvent,
} from './integration';
