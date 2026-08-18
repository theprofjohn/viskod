import type { WorkspaceMetadata } from '@viskod/shared';

export type DiscoveryMethod =
  | 'route-correlation'
  | 'component-naming'
  | 'class-name-match'
  | 'framework-convention'
  | 'file-exists'
  | 'style-adjacent'
  | 'case-insensitive'
  | 'heuristic-match'
  | 'usage-site'
  | 'import-graph'
  | 'jsx-text'
  | 'aria-label-match'
  | 'test-id-match'
  | 'nearby-text';

export type EvidenceType =
  | 'route-match'
  | 'component-name-match'
  | 'class-name-match'
  | 'id-match'
  | 'testid-match'
  | 'file-name-match'
  | 'framework-convention'
  | 'directory-convention'
  | 'data-attribute-match'
  | 'file-exists'
  | 'case-insensitive-match'
  | 'style-adjacent'
  | 'heuristic'
  | 'text-content-match'
  | 'import-graph-match'
  | 'jsx-text-match'
  | 'aria-label-match'
  | 'nearby-text-match'
  | 'source-map';

export interface HintEvidence {
  type: EvidenceType;
  weight: number;
  detail: string;
  confidence: number;
  /** true = directly observed in the DOM/project; false = inferred/heuristic. */
  observed?: boolean;
}

export type SourceHintKind =
  | 'usage-site'
  | 'definition-site'
  | 'route-owner'
  | 'component-owner'
  | 'style-owner'
  | 'test-owner'
  | 'unknown';

export type SourceHintStatus = 'ranked' | 'ambiguous' | 'low_confidence' | 'missing';

/**
 * Phase 30 trust contract — candidate-level qualification.
 *
 * Source hints are guidance, not proof. Every candidate carries an explicit
 * semantic qualification derived from the EVIDENCE, never from the candidate
 * class alone:
 *
 * - `exact`    — direct, stable, verifiable association (multiple independent
 *               strong signals agree on one file; e.g. current-route file that
 *               defines the target's stable identifier and is the only file
 *               containing the unique visible text).
 * - `probable` — independent evidence corroborates one file (e.g. unique
 *               visible text + route ownership + import path).
 * - `possible` — a single moderate signal or weak signals that agree (e.g.
 *               unique visible text with no route/import corroboration).
 * - `weak`     — a weak signal only (duplicate visible text, generic class
 *               name, generic component name). Never presented as ownership.
 *
 * Text-only or generic-component-only matches can never reach `probable` or
 * `exact`: WRONG-BUT-CONFIDENT IS WORSE THAN UNAVAILABLE.
 */
export type SourceQualification = 'exact' | 'probable' | 'possible' | 'weak';

/**
 * Phase 30 trust contract — overall source-resolution result.
 *
 * - `resolved`   — one candidate is clearly stronger than the rest.
 * - `ambiguous`  — two or more candidates are too close to distinguish
 *                 safely; the bounded candidate set is returned with reasons.
 * - `unavailable`— no credible candidate, project root unknown/unsupported,
 *                 scan budget exceeded, or source resolution disabled.
 */
export type SourceResolution = 'resolved' | 'ambiguous' | 'unavailable';

export interface HintLocation {
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface HintSymbol {
  componentName?: string;
  exportName?: string;
  propName?: string;
  jsxTag?: string;
}

export interface HintRoute {
  routePath?: string;
  routeFile?: string;
  isCurrentRoute?: boolean;
}

export interface HintRanking {
  score: number;
  confidence: number;
  rank: number;
  reasons: string[];
  penalties: string[];
}

export interface HintSafety {
  redactionApplied: boolean;
  userVisible: boolean;
  containsAbsolutePath: boolean;
}

export interface UsageSiteSourceHint {
  schemaVersion: 1;
  hintId: string;
  kind: SourceHintKind;
  status: SourceHintStatus;
  file: {
    displayPath: string;
    absolutePath?: string;
    language?: string;
    framework?: string;
  };
  location?: HintLocation;
  symbol?: HintSymbol;
  route?: HintRoute;
  evidence: HintEvidence[];
  ranking: HintRanking;
  safety: HintSafety;
  /** Phase 30: semantic qualification derived from evidence. */
  qualification: SourceQualification;
  /** Phase 30: concise evidence reasons. */
  reasons: string[];
}

export interface RankingResult {
  status: SourceHintStatus;
  /** Phase 30: semantic resolution state (resolved/ambiguous/unavailable). */
  resolution: SourceResolution;
  topHints: UsageSiteSourceHint[];
  warnings: string[];
}

export interface SourceHint {
  hintId: string;
  filePath: string;
  confidence: number;
  evidence: HintEvidence[];
  discoveryMethod: DiscoveryMethod;
  framework?: string;
  isPrimary: boolean;
  timestamp: string;
  schemaVersion: string;
  exists: boolean;
  matchType:
    | 'exact'
    | 'case-insensitive'
    | 'style-adjacent'
    | 'generated-non-existing'
    | 'generated'
    | 'usage-site';
  reason: string;
  relatedSelector?: string;
  kind?: SourceHintKind;
  status?: SourceHintStatus;
  location?: HintLocation;
  symbol?: HintSymbol;
  route?: HintRoute;
  ranking?: HintRanking;
  safety?: HintSafety;
  /** Phase 30: semantic qualification derived from evidence, never class. */
  qualification?: SourceQualification;
  /** Phase 30: concise user/agent-safe evidence reasons. */
  reasons?: string[];
}

export interface DOMContext {
  tagName: string;
  id?: string;
  className?: string;
  classList?: string[];
  dataAttributes?: Record<string, string>;
  role?: string;
  testId?: string;
  parentTagName?: string;
  text?: string;
}

export interface RouteContext {
  url: string;
  pathname: string;
  matchedRoute?: {
    path: string;
    file: string;
    type: string;
    isDynamic: boolean;
  };
}

export interface ProjectContext {
  metadata: {
    projectId: string;
    name: string;
    rootPath: string;
    packageManager: string;
    language: string;
  };
  routeMap?: {
    routes: Array<{ path: string; file: string; type: string }>;
  };
  componentIndex?: {
    directories: string[];
  };
  framework?: {
    primary: string | null;
    detected: string[];
    confidence: number;
  };
  workspace?: WorkspaceMetadata;
}

export interface HintInput {
  domContext: DOMContext;
  route: RouteContext;
  project: ProjectContext;
  framework?: {
    framework: string;
    conventions: Record<string, string>;
  };
  captureId?: string;
}

export interface HintEngineHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  hintsGenerated: number;
  hintsFailed: number;
  cacheSize: number;
  /** Phase 33A: import graph cache occupancy (bounded by IMPORT_GRAPH_CACHE_MAX). */
  importGraphCacheSize: number;
  /** Phase 33A: current scan generation (bumped by invalidateCache). */
  generation: number;
  averageProcessingTimeMs: number;
}
