/**
 * Phase 30 — evidence-based source-hint calibration.
 *
 * Every candidate is scored from explicit, classified evidence signals.
 * Signals are grouped into INDEPENDENT families: two variants of the same
 * observation (e.g. exact text match + normalized text match) are ONE family
 * and never corroborate each other.
 *
 * Strength classification (VISKOD-AUDIT-008):
 * - STRONG: route ownership, route-import path, stable-identifier definition.
 *   These are required to reach `probable`/`exact`.
 * - MODERATE: unique visible text, class-name file existence, explicit
 *   component reference.
 * - WEAK: duplicate visible text, generic class names (`card`, `button`, …),
 *   style adjacency, filename/directory conventions.
 *
 * Invariants (contract tests depend on these):
 * - A text-only or generic-component-only candidate can NEVER reach
 *   `probable` or `exact` (hard cap `TEXT_ONLY_MAX`).
 * - Without at least one strong family, a candidate can never reach
 *   `probable` (hard cap `NO_STRONG_MAX`).
 * - `exact` requires multiple independent strong signals AND a unique text or
 *   stable-identifier corroboration — effectively rare.
 */

import type { SourceQualification, SourceResolution } from './types';

/** Independent evidence families. */
export type EvidenceFamily =
  | 'route-ownership'
  | 'import-path'
  | 'stable-identifier'
  | 'usage-text'
  | 'class-file'
  | 'generic-class'
  | 'component-ref'
  | 'style-adjacent';

export const STRONG_FAMILIES: Partial<Record<EvidenceFamily, true>> = {
  'route-ownership': true,
  'import-path': true,
  'stable-identifier': true,
};

/** Base score contributed by a family when it is the strongest present. */
const FAMILY_BASE: Record<EvidenceFamily, number> = {
  'route-ownership': 0.55,
  'import-path': 0.55,
  'stable-identifier': 0.55,
  'usage-text': 0.34,
  'class-file': 0.5,
  'generic-class': 0.3,
  'component-ref': 0.42,
  'style-adjacent': 0.3,
};

/** Effective base for unique visible text (a single-file text match). */
const UNIQUE_TEXT_BASE = 0.48;

/** Bonus per additional INDEPENDENT family, capped. */
const FAMILY_BONUS = 0.1;
const FAMILY_BONUS_CAP = 0.2;

/** Unique visible text bonus (only when the text family is present). */
const UNIQUE_TEXT_BONUS = 0.06;

/** Exact current-route file bonus (candidate IS the matched route file). */
const ROUTE_FILE_BONUS = 0.06;

/**
 * Hard caps. These are the calibration boundary: no formula can push a weak
 * candidate above its cap, so text/generic matches can never masquerade as
 * high-confidence ownership.
 */
const NO_STRONG_MAX = 0.62; // without a strong family → never probable
const TEXT_ONLY_MAX = 0.6; // text-only or generic-component-only → never high
const WEAK_MAX = 0.42; // duplicate-text / generic-class / component-ref only

export const MIN_CONFIDENCE = 0.3;

const QUALIFICATION_BANDS: Array<{ min: number; qualification: SourceQualification }> = [
  { min: 0.9, qualification: 'exact' },
  { min: 0.65, qualification: 'probable' },
  { min: 0.35, qualification: 'possible' },
  { min: 0.3, qualification: 'weak' },
];

/** Deterministic qualification from a calibrated confidence score. */
export function qualifyConfidence(confidence: number): SourceQualification {
  for (const band of QUALIFICATION_BANDS) {
    if (confidence >= band.min) return band.qualification;
  }
  return 'weak';
}

export interface FamilySignal {
  family: EvidenceFamily;
  /** Human-readable, user-safe reason (bounded length by caller). */
  reason: string;
}

export interface EvidenceScoreInput {
  /** Independent families observed for this candidate (deduplicated). */
  families: FamilySignal[];
  /** Visible-text family observed AND the text is unique across the scan. */
  uniqueText?: boolean;
  /** Candidate is the current matched route file itself. */
  isRouteFile?: boolean;
}

export interface EvidenceScore {
  confidence: number;
  qualification: SourceQualification;
  reasons: string[];
}

/**
 * Deterministic evidence combination:
 *
 *   confidence = max(family bases) + bonus per additional independent family
 *                (capped) + unique-text bonus + exact-route-file bonus
 *
 * then apply hard caps by family strength. The result is rounded to 4dp so
 * equal evidence produces identical numbers across runs/processes.
 */
export function scoreEvidence(input: EvidenceScoreInput): EvidenceScore {
  const families = [...new Set(input.families.map((f) => f.family))];
  const reasons = input.families.map((f) => f.reason);

  if (families.length === 0) {
    return { confidence: 0, qualification: 'weak', reasons: [] };
  }

  // Unique visible text is a stronger text signal: single-file text match.
  const uniqueText = input.uniqueText === true && families.includes('usage-text');
  const base = Math.max(
    ...families.map((f) => (f === 'usage-text' && uniqueText ? UNIQUE_TEXT_BASE : FAMILY_BASE[f])),
  );
  const bonus = Math.min((families.length - 1) * FAMILY_BONUS, FAMILY_BONUS_CAP);

  let confidence = base + bonus;
  if (uniqueText) {
    confidence += UNIQUE_TEXT_BONUS;
  }
  if (input.isRouteFile && families.includes('route-ownership')) {
    confidence += ROUTE_FILE_BONUS;
  }

  // Calibration caps — never allow weak evidence to inflate.
  const hasStrong = families.some((f) => STRONG_FAMILIES[f] === true);
  if (!hasStrong) {
    confidence = Math.min(confidence, NO_STRONG_MAX);
  }
  const onlyWeakOrText = families.every((f) =>
    ['usage-text', 'generic-class', 'component-ref', 'style-adjacent'].includes(f),
  );
  if (onlyWeakOrText) {
    confidence = Math.min(confidence, TEXT_ONLY_MAX);
  }
  if (families.length === 1) {
    const single = families[0];
    const singleWeak =
      single === 'generic-class' ||
      single === 'component-ref' ||
      (single === 'usage-text' && !uniqueText);
    if (singleWeak) {
      confidence = Math.min(confidence, WEAK_MAX);
    }
  }

  const rounded = Math.round(confidence * 10000) / 10000;
  return {
    confidence: rounded,
    qualification: qualifyConfidence(rounded),
    reasons,
  };
}

/**
 * Deterministic overall resolution from the ranked candidate set.
 *
 * Ambiguity rule (no random tie-breaking):
 * 1. No candidates → unavailable.
 * 2. Top candidate is `exact` → resolved (a verified association is not
 *    ambiguous).
 * 3. Top two are effectively tied (margin < 0.02) → ambiguous.
 * 4. Top two share a qualification and the margin is small (< 0.08) →
 *    ambiguous — equal-tier candidates cannot be safely distinguished.
 * 5. A single weak candidate (or all-weak with no tie) → unavailable: weak
 *    evidence is not enough to claim a source.
 * 6. Otherwise → resolved.
 */
export interface QualifiedCandidate {
  confidence: number;
  qualification?: SourceQualification;
  /** Stable tie-break key (repo-relative path). */
  path: string;
}

export const AMBIGUITY_TIE_MARGIN = 0.02;
export const AMBIGUITY_TIER_MARGIN = 0.08;

export function computeSourceResolution(candidates: QualifiedCandidate[]): {
  resolution: SourceResolution;
  status: 'ranked' | 'ambiguous' | 'low_confidence' | 'missing';
} {
  if (candidates.length === 0) {
    return { resolution: 'unavailable', status: 'missing' };
  }

  const sorted = [...candidates].sort((a, b) => {
    const diff = a.confidence - b.confidence;
    if (Math.abs(diff) >= 0.0001) return b.confidence - a.confidence;
    return a.path.localeCompare(b.path);
  });

  const top = sorted[0];
  if (!top) return { resolution: 'unavailable', status: 'missing' };
  const second = sorted[1];
  const topQual = top.qualification ?? qualifyConfidence(top.confidence);

  if (topQual === 'exact') {
    return { resolution: 'resolved', status: 'ranked' };
  }

  if (second) {
    const secondQual = second.qualification ?? qualifyConfidence(second.confidence);
    const margin = top.confidence - second.confidence;
    if (margin < AMBIGUITY_TIE_MARGIN) {
      return { resolution: 'ambiguous', status: 'ambiguous' };
    }
    if (secondQual === topQual && margin < AMBIGUITY_TIER_MARGIN) {
      return { resolution: 'ambiguous', status: 'ambiguous' };
    }
  }

  if (topQual === 'weak') {
    return { resolution: 'unavailable', status: 'low_confidence' };
  }

  return { resolution: 'resolved', status: 'ranked' };
}

export function familyOfSignal(type: string): EvidenceFamily | null {
  switch (type) {
    case 'route-match':
      return 'route-ownership';
    case 'import-graph-match':
      return 'import-path';
    case 'id-match':
    case 'testid-match':
      return 'stable-identifier';
    case 'text-content-match':
    case 'jsx-text-match':
    case 'nearby-text-match':
      return 'usage-text';
    case 'class-name-match':
      return 'class-file';
    case 'file-exists':
      return 'class-file';
    case 'case-insensitive-match':
      return 'class-file';
    case 'style-adjacent':
      return 'style-adjacent';
    case 'component-name-match':
      return 'component-ref';
    default:
      return null;
  }
}
