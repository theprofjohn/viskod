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
}

export type SourceHintKind =
  | 'usage-site'
  | 'definition-site'
  | 'route-owner'
  | 'component-owner'
  | 'style-owner'
  | 'test-owner'
  | 'unknown';

export type SourceHintStatus =
  | 'ranked'
  | 'ambiguous'
  | 'low_confidence'
  | 'missing';

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
}

export interface RankingResult {
  status: SourceHintStatus;
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
  averageProcessingTimeMs: number;
}
