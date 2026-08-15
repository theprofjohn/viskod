export interface SelectionTarget {
  selector: string;
  /**
   * Observed target evidence (Phase 28A geometry trust contract).
   *
   * When present this bounding box is treated as TRUSTED target evidence and
   * MAY disambiguate a multi-match selector (see BrowserRuntime.resolveSelector):
   * it is either captured from an actual overlay-selected element, persisted
   * from a real previous selection, or explicitly supplied by a caller whose
   * API contract identifies it as target evidence.
   *
   * When absent there is NO trusted disambiguation available: a selector that
   * matches multiple elements MUST fail with SELECTOR_AMBIGUOUS. Entry points
   * MUST NOT manufacture a default/placeholder box merely because a schema
   * once required one; provenance is never inferred from numeric values.
   */
  boundingBox?: { x: number; y: number; width: number; height: number };
  source: 'studio' | 'mcp' | 'overlay' | 'keyboard' | 'automation';
}

export interface HierarchyNode {
  tagName: string;
  depth: number;
  attributes: Record<string, string>;
  childCount: number;
  text?: string;
}

export interface HierarchyRoot {
  selectedNode: HierarchyNode;
  parents: HierarchyNode[];
  siblings: HierarchyNode[];
  children: HierarchyNode[];
  landmarks: Array<{ tagName: string; role?: string; label?: string; depth: number }>;
}

export interface SelectionGeometry {
  boundingBox: { x: number; y: number; width: number; height: number };
  visibleRegion: { x: number; y: number; width: number; height: number };
  clipState: 'visible' | 'partially-clipped' | 'fully-clipped';
  viewportIntersectionRatio: number;
}

export interface VisibilityReport {
  display: string;
  visible: boolean;
  opacity: number;
  isClipped: boolean;
  viewportVisible: boolean;
  stackingContext: string;
  reasons: string[];
}

export interface AccessibilityInfo {
  role: string | null;
  name: string | null;
  landmark: string | null;
  headingLevel: number | null;
  hasFocus: boolean;
  tabIndex: number | null;
}

export interface SelectionSnapshot {
  selectionId: string;
  target: SelectionTarget;
  hierarchy: HierarchyRoot;
  geometry: SelectionGeometry;
  visibility: VisibilityReport;
  accessibility: AccessibilityInfo;
  timestamp: string;
  schemaVersion: string;
}

export interface SelectionEngineHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  activeSelection: boolean;
  selectionsProcessed: number;
  selectionsFailed: number;
  averageProcessingTimeMs: number;
}
