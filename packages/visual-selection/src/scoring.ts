import type { Rect } from './types';
import { rectArea, intersectionRatio, rectContains, isZeroArea } from './geometry';

export interface CandidateElement {
  tagName: string;
  boundingRect: Rect;
  viewportRect: Rect;
  isInteractive: boolean;
  role: string | null;
  accessibleName: string | null;
  hasVisibleText: boolean;
  hasStableAttributes: boolean;
  ancestorDepth: number;
  isLabelControl: boolean;
  childCount: number;
  parentTagName: string;
  isViskodOwned: boolean;
  isTechnical: boolean;
  isPseudoContent: boolean;
  isHidden: boolean;
  isOutsideViewport: boolean;
  parentBoundingRect: Rect | null;
}

export interface CandidateScore {
  element: CandidateElement;
  score: number;
  signals: Record<string, number>;
}

const WEIGHTS = {
  insideVisibleBounds: 0.20,
  isInteractive: 0.15,
  semanticRole: 0.10,
  accessibleName: 0.10,
  visibleText: 0.08,
  stableAttributes: 0.08,
  preciseRegion: 0.10,
  notExcessivelyLarge: 0.05,
  notTinyDecorative: 0.03,
  labelControl: 0.05,
  appropriateDepth: 0.06,
};

function sigmoid(x: number, midpoint: number, steepness: number): number {
  return 1 / (1 + Math.exp(-steepness * (x - midpoint)));
}

export function scoreCandidate(el: CandidateElement, pointerX: number, pointerY: number): CandidateScore {
  const signals: Record<string, number> = {};

  const insideBounds =
    pointerX >= el.viewportRect.x &&
    pointerX <= el.viewportRect.x + el.viewportRect.width &&
    pointerY >= el.viewportRect.y &&
    pointerY <= el.viewportRect.y + el.viewportRect.height;
  signals.insideVisibleBounds = insideBounds ? 1 : 0;

  signals.isInteractive = el.isInteractive ? 1 : 0;
  signals.semanticRole = el.role ? 1 : 0;
  signals.accessibleName = el.accessibleName ? 1 : 0;
  signals.visibleText = el.hasVisibleText ? 1 : 0;
  signals.stableAttributes = el.hasStableAttributes ? 1 : 0;

  const area = rectArea(el.viewportRect);
  if (el.parentBoundingRect && area > 0) {
    const parentArea = rectArea(el.parentBoundingRect);
    signals.preciseRegion = parentArea > 0 ? sigmoid(area / parentArea, 0.3, 10) : 0.5;
  } else {
    signals.preciseRegion = 0.5;
  }

  signals.notExcessivelyLarge = area > 0 ? sigmoid(1 / (area / 100000), 2, 2) : 0;

  signals.notTinyDecorative = area >= 16 ? 1 : 0;
  signals.labelControl = el.isLabelControl ? 1 : 0;

  signals.appropriateDepth = sigmoid(6 - el.ancestorDepth, 3, 1);

  let totalScore = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const signalValue = signals[key] ?? 0;
    totalScore += signalValue * weight;
  }

  return { element: el, score: totalScore, signals };
}

export function filterCandidates(elements: CandidateElement[]): CandidateElement[] {
  return elements.filter((el) => {
    if (el.isViskodOwned) return false;
    if (el.isTechnical) return false;
    if (el.isHidden) return false;
    if (isZeroArea(el.viewportRect)) return false;
    if (el.isOutsideViewport) return false;
    if (el.tagName === 'html' || el.tagName === 'body') {
      const viewport: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
      const ratio = intersectionRatio(el.viewportRect, viewport);
      if (ratio > 0.8) return false;
    }
    return true;
  });
}

export function scoreAndRank(elements: CandidateElement[], pointerX: number, pointerY: number): CandidateScore[] {
  const filtered = filterCandidates(elements);
  const scored = filtered.map((el) => scoreCandidate(el, pointerX, pointerY));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

export function isAmbiguous(
  topScore: number,
  secondScore: number,
  margin: number,
  threshold: number,
): boolean {
  if (topScore < threshold) return true;
  if (topScore - secondScore < margin) return true;
  return false;
}

export function selectBestCandidate(
  scored: CandidateScore[],
  threshold: number,
  margin: number,
): { best: CandidateScore | null; ambiguous: boolean } {
  if (scored.length === 0) return { best: null, ambiguous: false };
  const best = scored[0];
  if (best === undefined) return { best: null, ambiguous: false };

  if (best.score < threshold) return { best: null, ambiguous: false };

  if (scored.length > 1) {
    const second = scored[1];
    if (second && isAmbiguous(best.score, second.score, margin, threshold)) {
      return { best, ambiguous: true };
    }
  }

  return { best, ambiguous: false };
}
