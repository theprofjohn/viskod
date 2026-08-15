import { type ImportGraphEntry, classifyHint, detectLanguage } from './classifier';
import { computeSourceResolution } from './evidence';
import type {
  HintRanking,
  HintSafety,
  RankingResult,
  SourceHint,
  SourceHintKind,
  SourceHintStatus,
  UsageSiteSourceHint,
} from './types';

const MAX_HINTS = 10;
const LOW_CONFIDENCE_THRESHOLD = 0.35;

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

const KIND_PENALTY: Record<SourceHintKind, number> = {
  'usage-site': 1.0,
  'route-owner': 1.0,
  'component-owner': 0.9,
  'definition-site': 0.8,
  'style-owner': 0.9,
  'test-owner': 0.3,
  unknown: 0.9,
};

export function rankHints(input: RankInput): RankingResult {
  const warnings: string[] = [];

  if (input.hints.length === 0) {
    return {
      status: 'missing',
      resolution: 'unavailable',
      topHints: [],
      warnings: ['No source hints available'],
    };
  }

  // Classify and score each hint. The calibrated confidence comes from the
  // evidence model; ranking only applies kind penalties (test/story files
  // rank lower, etc.) — it never inflates confidence.
  const classified: Array<{
    hint: SourceHint;
    kind: SourceHintKind;
    score: number;
    confidence: number;
    reasons: string[];
    penalties: string[];
  }> = [];

  for (const hint of input.hints) {
    const { kind } = classifyHint({
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

  // Deterministic sort: score desc, stable path asc.
  classified.sort((a, b) => {
    const diff = a.score - b.score;
    if (Math.abs(diff) >= 0.0001) return b.score - a.score;
    return a.hint.filePath.localeCompare(b.hint.filePath);
  });

  // Phase 30 semantic resolution from the EVIDENCE (unpenalized), so
  // ambiguity is a property of the evidence, not of ranking adjustments.
  const { resolution, status } = computeSourceResolution(
    input.hints.map((h) => ({
      confidence: h.confidence,
      qualification: h.qualification,
      path: h.filePath,
    })),
  );

  if (resolution === 'ambiguous') {
    warnings.push(
      'Top candidates are too close to distinguish safely. Multiple files are plausible.',
    );
  }

  // Backward-compatible status: low-confidence single candidates.
  let finalStatus: SourceHintStatus = status;
  if (
    classified.length > 0 &&
    (classified[0]?.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD &&
    status !== 'ambiguous'
  ) {
    finalStatus = 'low_confidence';
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
      status: idx === 0 ? finalStatus : finalStatus === 'ambiguous' ? 'ambiguous' : 'ranked',
      file: {
        displayPath,
        language: detectLanguage(c.hint.filePath),
      },
      location: location ?? c.hint.location,
      symbol: symbol ?? c.hint.symbol,
      route:
        route ??
        (input.routePath ? { routePath: input.routePath, routeFile: input.routeFile } : undefined),
      evidence: c.hint.evidence,
      ranking,
      safety,
      qualification: c.hint.qualification ?? qualifyFromScore(c.hint.confidence),
      reasons: c.hint.reasons ?? [],
    };
  });

  return { status: finalStatus, resolution, topHints, warnings };
}

function computeScore(
  hint: SourceHint,
  kind: SourceHintKind,
  input: RankInput,
): { score: number; confidence: number; reasons: string[]; penalties: string[] } {
  const reasons: string[] = [...(hint.reasons ?? [])];
  const penalties: string[] = [];

  let score = hint.confidence;
  let confidence = hint.confidence;

  // Kind penalty — never a bonus that inflates confidence.
  const kindFactor = KIND_PENALTY[kind] ?? 0.9;
  if (kindFactor < 1) {
    penalties.push(`${kind} (penalty ${kindFactor})`);
    score *= kindFactor;
    confidence *= kindFactor;
  }

  // Existence is already part of the evidence model; non-existing files are
  // never generated anymore, but keep the guard for legacy callers.
  if (!hint.exists) {
    penalties.push('file does not exist on disk');
    score *= 0.5;
    confidence *= 0.5;
  }

  // Route match bonus only when the candidate IS the matched route file.
  if (input.matchedRoute && hint.filePath === input.matchedRoute.file) {
    reasons.push('matches the current route file');
    score += 0.05;
  }

  // Penalty for test/story files (already in kind factor; keep reason).
  if (kind === 'test-owner') {
    penalties.push('test or story file');
  }

  // Penalty for generated/build paths
  const parts = hint.filePath.split(/[/\\]/);
  const hasGeneratedDir = parts.some((p) =>
    ['node_modules', 'dist', 'build', '.next', '.output'].includes(p.toLowerCase()),
  );
  if (hasGeneratedDir) {
    penalties.push('generated/build output');
    score *= 0.2;
    confidence *= 0.2;
  }

  score = Math.min(Math.max(score, 0), 1);
  confidence = Math.min(Math.max(confidence, 0), 1);

  return { score, confidence, reasons, penalties };
}

function qualifyFromScore(confidence: number): 'exact' | 'probable' | 'possible' | 'weak' {
  if (confidence >= 0.9) return 'exact';
  if (confidence >= 0.65) return 'probable';
  if (confidence >= 0.35) return 'possible';
  return 'weak';
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
