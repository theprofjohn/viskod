import type { Rect, VisualSelectionTarget } from './types';
import { normalizeRect, rectsIntersect, rectArea, intersectionRatio, rectContains, isZeroArea } from './geometry';
import type { VisualSelectionConfig } from './types';
import { DEFAULT_VISUAL_SELECTION_CONFIG } from './types';

export interface BoxCandidate {
  targetId: string;
  boundingRect: Rect;
  tagName: string;
  documentOrder: number;
  ancestorDepth: number;
  isInteractive: boolean;
  isTechnical: boolean;
  isViskodOwned: boolean;
  isHidden: boolean;
  intersectionArea: number;
  visibleRatio: number;
}

export interface BoxSelectionResult {
  targets: VisualSelectionTarget[];
  truncated: boolean;
  candidateCount: number;
  warnings: string[];
}

function documentOrderSort(a: { documentOrder: number }, b: { documentOrder: number }): number {
  return a.documentOrder - b.documentOrder;
}

function isDescendantOfAny(
  candidate: BoxCandidate,
  others: BoxCandidate[],
): boolean {
  for (const other of others) {
    if (other === candidate) continue;
    if (candidate.ancestorDepth > other.ancestorDepth && rectContains(other.boundingRect, candidate.boundingRect)) {
      return true;
    }
  }
  return false;
}

function isStructuralWrapper(candidate: BoxCandidate): boolean {
  const structuralTags = ['div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav'];
  if (!structuralTags.includes(candidate.tagName)) return false;
  return !candidate.isInteractive;
}

function isEquivalent(a: VisualSelectionTarget, b: VisualSelectionTarget): boolean {
  if (a.semantics.tagName !== b.semantics.tagName) return false;
  if (a.semantics.role !== b.semantics.role) return false;
  if (a.semantics.accessibleName !== b.semantics.accessibleName) return false;
  if (a.semantics.textPreview !== b.semantics.textPreview) return false;
  return true;
}

export function collectBoxCandidates(
  elements: BoxCandidate[],
  dragRect: Rect,
  config: VisualSelectionConfig = DEFAULT_VISUAL_SELECTION_CONFIG,
): BoxCandidate[] {
  const normalized = normalizeRect(dragRect);
  const viewport: Rect = { x: 0, y: 0, width: 99999, height: 99999 };

  return elements.filter((el) => {
    if (el.isViskodOwned) return false;
    if (el.isTechnical) return false;
    if (el.isHidden) return false;
    if (isZeroArea(el.boundingRect)) return false;

    const intersect = rectsIntersect(el.boundingRect, normalized);
    if (!intersect) return false;

    const ratio = intersectionRatio(el.boundingRect, normalized);
    if (ratio < config.minIntersectionRatio) return false;

    const area = rectArea(el.boundingRect);
    if (area < config.minVisibleArea) return false;

    return true;
  });
}

export function reduceBoxSelection(
  candidates: BoxCandidate[],
  config: VisualSelectionConfig = DEFAULT_VISUAL_SELECTION_CONFIG,
): { selected: BoxCandidate[]; warnings: string[] } {
  const warnings: string[] = [];

  let filtered = candidates.filter((c) => {
    if (c.ancestorDepth > config.maxAncestorDepth) return false;
    return true;
  });

  const nonWrappers = filtered.filter((c) => !isStructuralWrapper(c));
  const structuralParentIds = new Set<string>();

  if (nonWrappers.length > 0) {
    const wrappers = filtered.filter((c) => isStructuralWrapper(c));
    for (const wrapper of wrappers) {
      const containsNonWrapper = nonWrappers.some((nw) => {
        if (nw === wrapper) return false;
        if (wrapper.ancestorDepth < nw.ancestorDepth && rectContains(wrapper.boundingRect, nw.boundingRect)) {
          return true;
        }
        return false;
      });
      const containsNoNonWrapperPeer = nonWrappers.every((nw) => {
        if (nw === wrapper) return false;
        return !(wrapper.ancestorDepth < nw.ancestorDepth && rectContains(wrapper.boundingRect, nw.boundingRect));
      });
      if (!containsNonWrapper || containsNoNonWrapperPeer) {
        structuralParentIds.add(wrapper.targetId);
      }
    }
  }

  filtered = filtered.filter((c) => !isStructuralWrapper(c) || structuralParentIds.has(c.targetId));

  const descendants = new Set<string>();
  for (let i = 0; i < filtered.length; i++) {
    for (let j = 0; j < filtered.length; j++) {
      if (i === j) continue;
      const ci = filtered[i];
      const cj = filtered[j];
      if (!ci || !cj) continue;
      if (cj.ancestorDepth > ci.ancestorDepth && rectContains(ci.boundingRect, cj.boundingRect)) {
        if (cj.isInteractive || ci.isInteractive === cj.isInteractive) {
          descendants.add(cj.targetId);
        }
      }
    }
  }

  filtered = filtered.filter((c) => !descendants.has(c.targetId));

  let truncated = false;
  if (filtered.length > config.maxSelectedTargets) {
    filtered = filtered.slice(0, config.maxSelectedTargets);
    truncated = true;
    warnings.push(`This region contains too many elements. Select a smaller area.`);
  }

  filtered.sort(documentOrderSort);

  return { selected: filtered, warnings };
}

export function boxCandidateToTarget(
  candidate: BoxCandidate,
): VisualSelectionTarget {
  return {
    targetId: candidate.targetId,
    documentOrder: candidate.documentOrder,
    geometry: {
      viewportRect: candidate.boundingRect,
      visibleRatio: candidate.visibleRatio,
    },
    semantics: {
      tagName: candidate.tagName,
      isInteractive: candidate.isInteractive,
    },
    fingerprints: {},
    resolutionCandidates: [
      {
        strategy: 'geometry',
        value: candidate.boundingRect,
        confidence: 0.5,
      },
    ],
  };
}

export function deduplicateTargets(targets: VisualSelectionTarget[]): VisualSelectionTarget[] {
  const unique: VisualSelectionTarget[] = [];
  for (const t of targets) {
    const isDup = unique.some((u) => isEquivalent(t, u));
    if (!isDup) {
      unique.push(t);
    }
  }
  return unique;
}
