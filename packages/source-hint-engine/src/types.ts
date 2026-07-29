export type DiscoveryMethod =
  | 'route-correlation'
  | 'component-naming'
  | 'class-name-match'
  | 'framework-convention'
  | 'file-exists'
  | 'style-adjacent'
  | 'case-insensitive'
  | 'heuristic-match';

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
  | 'heuristic';

export interface HintEvidence {
  type: EvidenceType;
  weight: number;
  detail: string;
  confidence: number;
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
    | 'generated';
  reason: string;
  relatedSelector?: string;
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
