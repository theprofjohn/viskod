export interface SelectionTarget {
  selector: string;
  boundingBox: { x: number; y: number; width: number; height: number };
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
