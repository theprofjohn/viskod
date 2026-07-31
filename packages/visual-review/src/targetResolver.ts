import type { ReviewSnapshotRef, ResolvedRecaptureTarget } from './types';

interface StoredVisualSelectionTarget {
  targetId?: string;
  documentOrder?: number;
  geometry?: {
    viewportRect?: { x: number; y: number; width: number; height: number };
    documentRect?: { x: number; y: number; width: number; height: number };
  };
  semantics?: {
    tagName?: string;
    role?: string;
    accessibleName?: string;
    textPreview?: string;
    inputType?: string;
    isInteractive?: boolean;
  };
  fingerprints?: {
    stableAttributes?: Record<string, string>;
    ancestorFingerprint?: string[];
    siblingFingerprint?: { index?: number; nearbyText?: string[] };
    domPathFingerprint?: string[];
  };
  resolutionCandidates?: Array<{
    strategy: string;
    value: unknown;
    confidence: number;
  }>;
}

interface StoredVisualSelection {
  selectionId?: string;
  targets?: StoredVisualSelectionTarget[];
  summary?: {
    label?: string;
    role?: string;
    textPreview?: string;
    targetCount?: number;
  };
  resolution?: {
    status?: string;
    confidence?: number;
  };
}

const STABLE_ATTR_KEYS = [
  'data-testid',
  'data-test-id',
  'data-id',
  'id',
  'name',
  'aria-label',
  'data-cy',
  'data-test',
  'role',
];

function escapeCssSelector(value: string): string {
  return value.replace(/([^\w-])/g, '\\$1');
}

function buildSelectorFromStableAttributes(
  attrs: Record<string, string>,
): string | null {
  for (const key of STABLE_ATTR_KEYS) {
    const val = attrs[key];
    if (val && typeof val === 'string' && val.length > 0) {
      return `[${key}="${escapeCssSelector(val)}"]`;
    }
  }
  return null;
}

function buildSelectorFromAncestors(
  ancestorFingerprint: string[],
  tagName: string,
): string | null {
  if (ancestorFingerprint.length === 0 || !tagName) return null;

  const parts: string[] = [tagName.toLowerCase()];
  for (let i = ancestorFingerprint.length - 1; i >= 0 && parts.length < 5; i--) {
    const tag = ancestorFingerprint[i];
    if (tag && typeof tag === 'string' && tag.length > 0) {
      parts.unshift(tag.toLowerCase());
    }
  }

  if (parts.length >= 2) {
    return parts.join(' > ');
  }
  return null;
}

function buildSelectorFromSemantics(
  semantics: StoredVisualSelectionTarget['semantics'],
): string | null {
  if (!semantics?.tagName) return null;

  const tag = semantics.tagName.toLowerCase();

  if (semantics.role) {
    return `${tag}[role="${semantics.role}"]`;
  }

  if (semantics.accessibleName) {
    return `${tag}[aria-label="${escapeCssSelector(semantics.accessibleName)}"]`;
  }

  if (semantics.inputType) {
    return `${tag}[type="${semantics.inputType}"]`;
  }

  return null;
}

export function resolveRecaptureTarget(
  beforeSnapshot: ReviewSnapshotRef,
): ResolvedRecaptureTarget | null {
  const geometry = beforeSnapshot.visualEvidence?.cropRect;

  const storedTarget = extractStoredTarget(beforeSnapshot);
  if (!storedTarget) {
    if (geometry && geometry.width > 0 && geometry.height > 0) {
      return {
        selector: `body`,
        boundingBox: geometry,
        source: 'review-recapture',
        resolvedFrom: 'geometry-fallback',
        confidence: 0.3,
      };
    }
    return null;
  }

  const stableAttrs = storedTarget.fingerprints?.stableAttributes;
  if (stableAttrs && Object.keys(stableAttrs).length > 0) {
    const selector = buildSelectorFromStableAttributes(stableAttrs);
    if (selector) {
      return {
        selector,
        boundingBox: geometry ?? storedTarget.geometry?.viewportRect ?? { x: 0, y: 0, width: 100, height: 100 },
        source: 'review-recapture',
        resolvedFrom: 'stable-attribute',
        confidence: 0.9,
      };
    }
  }

  const ancestors = storedTarget.fingerprints?.ancestorFingerprint;
  const tagName = storedTarget.semantics?.tagName;
  if (ancestors && ancestors.length > 0 && tagName) {
    const selector = buildSelectorFromAncestors(ancestors, tagName);
    if (selector) {
      return {
        selector,
        boundingBox: geometry ?? storedTarget.geometry?.viewportRect ?? { x: 0, y: 0, width: 100, height: 100 },
        source: 'review-recapture',
        resolvedFrom: 'ancestor-path',
        confidence: 0.7,
      };
    }
  }

  const semanticSelector = buildSelectorFromSemantics(storedTarget.semantics);
  if (semanticSelector) {
    return {
      selector: semanticSelector,
      boundingBox: geometry ?? storedTarget.geometry?.viewportRect ?? { x: 0, y: 0, width: 100, height: 100 },
      source: 'review-recapture',
      resolvedFrom: 'stable-attribute',
      confidence: 0.6,
    };
  }

  if (geometry && geometry.width > 0 && geometry.height > 0) {
    return {
      selector: tagName ? tagName.toLowerCase() : 'body',
      boundingBox: geometry,
      source: 'review-recapture',
      resolvedFrom: 'geometry-fallback',
      confidence: 0.3,
    };
  }

  return null;
}

function extractStoredTarget(
  beforeSnapshot: ReviewSnapshotRef,
): StoredVisualSelectionTarget | null {
  const source = beforeSnapshot.source as Record<string, unknown>;
  const selectionSnapshot = source?.selectionSnapshot as StoredVisualSelection | undefined;

  if (selectionSnapshot?.targets && selectionSnapshot.targets.length > 0) {
    return selectionSnapshot.targets[0];
  }

  return null;
}
