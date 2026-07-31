import type { VisualSelectionTarget, VisualSelectionResolution, Rect } from './types';

export interface ResolvedTarget {
  target: VisualSelectionTarget;
  resolution: VisualSelectionResolution;
}

export interface ResolvedElement {
  tagName: string;
  role: string | null;
  accessibleName: string | null;
  textContent: string;
  boundingRect: Rect;
  stableAttributes: Record<string, string>;
  ancestorTags: string[];
  siblingTags: string[];
  documentOrder: number;
  isInteractive: boolean;
}

const SIMILARITY_THRESHOLD = 0.6;

function tagRoleCompatible(original: VisualSelectionTarget, candidate: ResolvedElement): boolean {
  if (original.semantics.tagName !== candidate.tagName) return false;
  if (
    original.semantics.role &&
    candidate.role &&
    original.semantics.role !== candidate.role
  ) {
    return false;
  }
  return true;
}

function textSimilarity(a: string | undefined, b: string): number {
  if (!a || !b) return 0;
  const normA = a.toLowerCase().trim().slice(0, 50);
  const normB = b.toLowerCase().trim().slice(0, 50);
  if (normA === normB) return 1;
  if (normA.includes(normB) || normB.includes(normA)) return 0.8;
  const shorter = normA.length < normB.length ? normA : normB;
  const longer = normA.length < normB.length ? normB : normA;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] === longer[i]) matches++;
  }
  return matches / longer.length;
}

function ancestorSimilarity(
  originalFingerprints: string[] | undefined,
  candidateAncestors: string[],
): number {
  if (!originalFingerprints || originalFingerprints.length === 0) return 0.5;
  if (candidateAncestors.length === 0) return 0;
  let matches = 0;
  for (let i = 0; i < Math.min(originalFingerprints.length, candidateAncestors.length); i++) {
    const orig = originalFingerprints[i];
    const cand = candidateAncestors[i];
    if (orig && cand && orig === cand) matches++;
  }
  return matches / Math.max(originalFingerprints.length, 1);
}

function sizePositionSimilarity(
  originalRect: Rect,
  candidateRect: Rect,
): number {
  const areaDiff = Math.abs(rectArea(originalRect) - rectArea(candidateRect));
  const maxArea = Math.max(rectArea(originalRect), rectArea(candidateRect));
  const areaSim = maxArea > 0 ? 1 - Math.min(areaDiff / maxArea, 1) : 0.5;
  const posDiff = Math.sqrt(
    (originalRect.x - candidateRect.x) ** 2 +
    (originalRect.y - candidateRect.y) ** 2,
  );
  const posSim = Math.max(0, 1 - posDiff / 500);
  return (areaSim + posSim) / 2;
}

function rectArea(r: Rect): number {
  return r.width * r.height;
}

function stableAttributeMatch(
  originalAttrs: Record<string, string> | undefined,
  candidateAttrs: Record<string, string>,
): number {
  if (!originalAttrs || Object.keys(originalAttrs).length === 0) return 0.5;
  let matches = 0;
  let total = 0;
  const stableKeys = ['data-testid', 'data-test-id', 'data-id', 'id', 'name', 'aria-label', 'data-cy', 'data-test', 'role'];
  for (const key of stableKeys) {
    const origVal = originalAttrs[key];
    const candVal = candidateAttrs[key];
    if (origVal !== undefined && candVal !== undefined) {
      total++;
      if (origVal === candVal) matches++;
    }
  }
  if (total === 0) return 0.5;
  return matches / total;
}

export function resolveTarget(
  original: VisualSelectionTarget,
  candidates: ResolvedElement[],
): ResolvedTarget {
  const warnings: string[] = [];
  let bestScore = 0;
  let bestCandidate: ResolvedElement | null = null;

  for (const candidate of candidates) {
    if (!tagRoleCompatible(original, candidate)) continue;

    let score = 0;
    let totalWeight = 0;

    const tagWeight = 0.25;
    score += tagWeight * (original.semantics.tagName === candidate.tagName ? 1 : 0);
    totalWeight += tagWeight;

    const textSim = textSimilarity(original.semantics.textPreview, candidate.textContent);
    const textWeight = 0.20;
    score += textWeight * textSim;
    totalWeight += textWeight;

    const attrScore = stableAttributeMatch(original.fingerprints.stableAttributes, candidate.stableAttributes);
    const attrWeight = 0.25;
    score += attrWeight * attrScore;
    totalWeight += attrWeight;

    const ancSim = ancestorSimilarity(original.fingerprints.ancestorFingerprint, candidate.ancestorTags);
    const ancWeight = 0.15;
    score += ancWeight * ancSim;
    totalWeight += ancWeight;

    const geoSim = sizePositionSimilarity(
      original.geometry.viewportRect,
      candidate.boundingRect,
    );
    const geoWeight = 0.15;
    score += geoWeight * geoSim;
    totalWeight += geoWeight;

    if (totalWeight > 0) {
      score = score / totalWeight;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return {
      target: original,
      resolution: {
        status: 'missing',
        confidence: 0,
        resolvedAt: new Date().toISOString(),
        warnings: ['No compatible candidate found'],
      },
    };
  }

  if (bestScore < SIMILARITY_THRESHOLD) {
    return {
      target: original,
      resolution: {
        status: 'stale',
        confidence: bestScore,
        resolvedAt: new Date().toISOString(),
        warnings: ['Target has changed significantly'],
      },
    };
  }

  const closeCandidates = candidates.filter((c) => {
    if (c === bestCandidate) return false;
    if (!tagRoleCompatible(original, c)) return false;
    const textSim = textSimilarity(original.semantics.textPreview, c.textContent);
    return textSim > 0.8;
  });

  if (closeCandidates.length > 0) {
    warnings.push('Multiple similar candidates found');
    return {
      target: original,
      resolution: {
        status: 'ambiguous',
        confidence: bestScore,
        resolvedAt: new Date().toISOString(),
        warnings,
      },
    };
  }

  const updatedTarget: VisualSelectionTarget = {
    ...original,
    geometry: {
      viewportRect: bestCandidate.boundingRect,
    },
    semantics: {
      ...original.semantics,
      textPreview: bestCandidate.textContent.slice(0, 120),
    },
    fingerprints: {
      ...original.fingerprints,
      stableAttributes: {
        ...original.fingerprints.stableAttributes,
        ...Object.fromEntries(
          Object.entries(bestCandidate.stableAttributes).filter(
            ([_, v]) => typeof v === 'string',
          ),
        ),
      },
    },
  };

  return {
    target: updatedTarget,
    resolution: {
      status: 'resolved',
      confidence: bestScore,
      resolvedAt: new Date().toISOString(),
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  };
}

export function isWrongNode(
  original: VisualSelectionTarget,
  resolved: ResolvedElement,
): boolean {
  const compatible = tagRoleCompatible(original, resolved);
  if (!compatible) return true;
  const textSim = textSimilarity(original.semantics.textPreview, resolved.textContent);
  if (original.semantics.textPreview && textSim < 0.3) {
    return true;
  }
  return false;
}
