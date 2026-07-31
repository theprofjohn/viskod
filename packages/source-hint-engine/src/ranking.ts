import type {
  SourceHint,
  UsageSiteSourceHint,
  RankingResult,
  SourceHintKind,
  SourceHintStatus,
  HintEvidence,
  HintRanking,
  HintSafety,
} from './types';
import { classifyHint, type ImportGraphEntry, detectLanguage } from './classifier';

const MAX_HINTS = 10;
const AMBIGUITY_THRESHOLD = 0.1;
const LOW_CONFIDENCE_THRESHOLD = 0.3;

interface RankInput {
  hints: SourceHint[];
  routePath?: string;
  routeFile?: string;
  matchedRoute?: { path: string; file: string; type: string; isDynamic: boolean };
  domText?: string;
  domTestId?: string;
  domAriaLabel?: string;
  domClassName?: string;
  importGraph?: ImportGraphEntry[];
  projectRootPath?: string;
}

const KIND_SCORE_WEIGHTS: Record<SourceHintKind, number> = {
  'usage-site': 1.0,
  'route-owner': 0.85,
  'component-owner': 0.7,
  'definition-site': 0.5,
  'style-owner': 0.4,
  'test-owner': 0.2,
  unknown: 0.1,
};

const EVIDENCE_SIGNAL_WEIGHTS: Record<string, number> = {
  'route-match': 0.9,
  'jsx-text-match': 0.85,
  'aria-label-match': 0.8,
  'testid-match': 0.85,
  'text-content-match': 0.75,
  'import-graph-match': 0.7,
  'component-name-match': 0.5,
  'class-name-match': 0.4,
  'file-exists': 0.6,
  'case-insensitive-match': 0.5,
  'style-adjacent': 0.3,
  'file-name-match': 0.4,
  'nearby-text-match': 0.6,
  'source-map': 0.9,
  'framework-convention': 0.3,
  'directory-convention': 0.3,
  'data-attribute-match': 0.5,
  'heuristic': 0.2,
};

export function rankHints(input: RankInput): RankingResult {
  const warnings: string[] = [];

  if (input.hints.length === 0) {
    return {
      status: 'missing',
      topHints: [],
      warnings: ['No source hints available'],
    };
  }

  // Classify and score each hint
  const classified: Array<{
    hint: SourceHint;
    kind: SourceHintKind;
    score: number;
    confidence: number;
    reasons: string[];
    penalties: string[];
  }> = [];

  for (const hint of input.hints) {
    const { kind, symbol, route, location } = classifyHint({
      filePath: hint.filePath,
      exists: hint.exists,
      matchType: hint.matchType,
      evidence: hint.evidence,
      discoveryMethod: hint.discoveryMethod,
      routePath: input.routePath,
      routeFile: input.routeFile,
      matchedRoute: input.matchedRoute,
      domText: input.domText,
      domTestId: input.domTestId,
      domAriaLabel: input.domAriaLabel,
      domClassName: input.domClassName,
      importGraph: input.importGraph,
    });

    const { score, confidence, reasons, penalties } = computeScore(hint, kind, input);

    classified.push({
      hint,
      kind,
      score,
      confidence,
      reasons,
      penalties,
    });
  }

  // Sort by score descending (deterministic: break ties by filePath)
  classified.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 0.001) {
      return a.hint.filePath.localeCompare(b.hint.filePath);
    }
    return b.score - a.score;
  });

  // Detect ambiguity
  let status: SourceHintStatus = 'ranked';
  if (classified.length >= 2) {
    const topScore = classified[0]!.score;
    const secondScore = classified[1]!.score;
    if (topScore - secondScore < AMBIGUITY_THRESHOLD) {
      status = 'ambiguous';
      warnings.push(
        `Top candidates are very close (score diff: ${(topScore - secondScore).toFixed(3)}). Multiple files are plausible.`,
      );
    }
  }

  // Check low confidence
  if (classified.length > 0 && classified[0]!.confidence < LOW_CONFIDENCE_THRESHOLD) {
    status = 'low_confidence';
    warnings.push('All hints have low confidence. Treat as suggestions only.');
  }

  // Build UsageSiteSourceHint output
  const topHints: UsageSiteSourceHint[] = classified.slice(0, MAX_HINTS).map((c, idx) => {
    const { kind, symbol, route, location } = classifyHint({
      filePath: c.hint.filePath,
      exists: c.hint.exists,
      matchType: c.hint.matchType,
      evidence: c.hint.evidence,
      discoveryMethod: c.hint.discoveryMethod,
      routePath: input.routePath,
      routeFile: input.routeFile,
      matchedRoute: input.matchedRoute,
      domText: input.domText,
      domTestId: input.domTestId,
      domAriaLabel: input.domAriaLabel,
      domClassName: input.domClassName,
      importGraph: input.importGraph,
    });

    const displayPath = sanitizePath(c.hint.filePath, input.projectRootPath);
    const safety = checkSafety(c.hint.filePath);

    const ranking: HintRanking = {
      score: Math.round(c.score * 10000) / 10000,
      confidence: Math.round(c.confidence * 10000) / 10000,
      rank: idx + 1,
      reasons: c.reasons,
      penalties: c.penalties,
    };

    return {
      schemaVersion: 1 as const,
      hintId: c.hint.hintId,
      kind,
      status: idx === 0 ? status : (status === 'ambiguous' ? 'ambiguous' : 'ranked'),
      file: {
        displayPath,
        language: detectLanguage(c.hint.filePath),
      },
      location: location ?? c.hint.location,
      symbol: symbol ?? c.hint.symbol,
      route: route ?? (input.routePath ? { routePath: input.routePath, routeFile: input.routeFile } : undefined),
      evidence: c.hint.evidence,
      ranking,
      safety,
    };
  });

  return { status, topHints, warnings };
}

function computeScore(
  hint: SourceHint,
  kind: SourceHintKind,
  input: RankInput,
): { score: number; confidence: number; reasons: string[]; penalties: string[] } {
  let score = 0;
  let confidence = hint.confidence;
  const reasons: string[] = [];
  const penalties: string[] = [];

  // Base score from kind classification
  const kindWeight = KIND_SCORE_WEIGHTS[kind] ?? 0.1;
  score += kindWeight * 0.4;
  reasons.push(`kind=${kind} (weight=${kindWeight})`);

  // Evidence-based scoring
  let evidenceScore = 0;
  let evidenceCount = 0;
  for (const ev of hint.evidence) {
    const signalWeight = EVIDENCE_SIGNAL_WEIGHTS[ev.type] ?? 0.2;
    evidenceScore += signalWeight * ev.confidence;
    evidenceCount++;
  }
  if (evidenceCount > 0) {
    const avgEvidence = evidenceScore / evidenceCount;
    score += avgEvidence * 0.4;
    reasons.push(`evidence avg=${avgEvidence.toFixed(3)} (${evidenceCount} signals)`);
  }

  // Existence bonus
  if (hint.exists) {
    score += 0.1;
    reasons.push('file exists on disk');
  } else {
    penalties.push('file does not exist on disk');
    confidence *= 0.5;
  }

  // Route match bonus
  if (input.matchedRoute && hint.filePath === input.matchedRoute.file) {
    score += 0.15;
    reasons.push('matches current route file');
  } else if (kind === 'route-owner') {
    score += 0.05;
    reasons.push('is a route/page file');
  }

  // Usage-site bonus for files containing visible text
  if (kind === 'usage-site') {
    score += 0.1;
    reasons.push('identified as usage site');
  }

  // Penalty for definition-site (reusable primitives)
  if (kind === 'definition-site') {
    penalties.push('reusable UI primitive (definition site)');
    confidence *= 0.8;
  }

  // Penalty for test/story files
  if (kind === 'test-owner') {
    penalties.push('test or story file');
    confidence *= 0.3;
  }

  // Penalty for generated/build paths
  const parts = hint.filePath.split(/[/\\]/);
  const hasGeneratedDir = parts.some((p) =>
    ['node_modules', 'dist', 'build', '.next', '.output'].includes(p.toLowerCase()),
  );
  if (hasGeneratedDir) {
    penalties.push('generated/build output');
    confidence *= 0.2;
  }

  // Clamp
  score = Math.min(Math.max(score, 0), 1);
  confidence = Math.min(Math.max(confidence, 0), 1);

  return { score, confidence, reasons, penalties };
}

function sanitizePath(filePath: string, projectRoot?: string): string {
  // Always return repo-relative display path
  if (projectRoot && filePath.startsWith(projectRoot)) {
    return filePath.slice(projectRoot.length).replace(/^[/\\]/, '');
  }
  return filePath;
}

function checkSafety(filePath: string): HintSafety {
  const containsAbsolutePath =
    /^[A-Z]:\\/.test(filePath) || filePath.startsWith('/home/') || filePath.startsWith('/tmp/');

  return {
    redactionApplied: false,
    userVisible: true,
    containsAbsolutePath,
  };
}
