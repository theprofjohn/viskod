import type { EventBus } from '@viskod/event-bus';
import type { Result, ViskodError } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';

import type { HintEngineHealth, HintEvidence, HintInput, SourceHint } from './types';

export type { HintEngineHealth, HintEvidence, HintInput, SourceHint };
export * from './types';

const SCHEMA_VERSION = '0.0.1';
const MIN_CONFIDENCE = 0.1;
const MAX_HINTS = 10;
const SUBSYSTEM = 'source-hint-engine';

function dirBasename(dir: string): string {
  const parts = dir.split('/');
  return parts[parts.length - 1] ?? '';
}

function shError(code: string, message: string, cause?: string, recovery?: string): ViskodError {
  return {
    code,
    category: ErrorCategory.RUNTIME,
    severity: ErrorSeverity.RECOVERABLE,
    message,
    cause,
    recovery,
    correlationId: crypto.randomUUID(),
    subsystem: SUBSYSTEM,
    timestamp: new Date().toISOString(),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

function scoreHint(evidence: HintEvidence[]): number {
  if (evidence.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const e of evidence) {
    weightedSum += e.weight * e.confidence;
    totalWeight += e.weight;
  }
  return totalWeight > 0 ? clamp(weightedSum / totalWeight, 0, 1) : 0;
}

function buildCacheKey(input: HintInput): string {
  const rt = input.route;
  const dc = input.domContext;
  return `${rt.pathname}:${dc.tagName}:${dc.id ?? ''}:${dc.className ?? ''}`;
}

function buildHintId(filePath: string, evidence: HintEvidence[]): string {
  const evidenceHash = djb2(evidence.map((e) => e.type).join(','));
  return `${encodeURIComponent(filePath)}#${evidenceHash}`;
}

function matchRoute(input: HintInput): HintEvidence[] {
  const evidence: HintEvidence[] = [];
  const matched = input.route.matchedRoute;
  if (matched) {
    evidence.push({
      type: 'route-match',
      weight: 0.35,
      detail: `Route matched: ${matched.path} -> ${matched.file}`,
      confidence: matched.isDynamic ? 0.6 : 0.9,
    });
  }
  return evidence;
}

function matchComponentName(input: HintInput): HintEvidence[] {
  const evidence: HintEvidence[] = [];
  const dirs = input.project.componentIndex?.directories;
  const dc = input.domContext;
  if (!dirs || dirs.length === 0) return evidence;
  if (!dc.className) return evidence;

  const names = dc.className.split(/\s+/).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const lowerDir = dir.toLowerCase();
      const lowerName = name.toLowerCase();
      if (lowerDir.includes(lowerName) || lowerName.includes(dirBasename(lowerDir))) {
        evidence.push({
          type: 'component-name-match',
          weight: 0.25,
          detail: `Class "${name}" matches component directory "${dir}"`,
          confidence: 0.7,
        });
      }
    }
  }
  return evidence;
}

function matchClassName(input: HintInput): HintEvidence[] {
  const evidence: HintEvidence[] = [];
  const dirs = input.project.componentIndex?.directories;
  const dc = input.domContext;
  if (!dirs || dirs.length === 0) return evidence;

  const searchTerms: string[] = [];
  if (dc.className) {
    searchTerms.push(...dc.className.split(/\s+/).filter(Boolean));
  }
  if (dc.classList) {
    searchTerms.push(...dc.classList);
  }

  for (const term of searchTerms) {
    const patterns = [
      `${term}.tsx`,
      `${term}.jsx`,
      `${term}.vue`,
      `${term}.svelte`,
      `components/${term}/index.tsx`,
      `components/${term}.tsx`,
      `${term}/index.tsx`,
      `${term}/index.jsx`,
      `${term}.component.tsx`,
      `${term}.component.jsx`,
    ];

    for (const pattern of patterns) {
      for (const dir of dirs) {
        const candidate = `${dir}/${pattern}`.toLowerCase();
        const searchTerm = term.toLowerCase();
        if (candidate.includes(searchTerm)) {
          evidence.push({
            type: 'class-name-match',
            weight: 0.2,
            detail: `Class "${term}" matches file pattern "${pattern}" in directory "${dir}"`,
            confidence: 0.65,
          });
        }
      }
    }
  }
  return evidence;
}

function matchFrameworkConvention(input: HintInput): HintEvidence[] {
  const evidence: HintEvidence[] = [];
  const fw = input.framework?.framework ?? input.project.framework?.primary;
  if (!fw) return evidence;

  const matched = input.route.matchedRoute;
  if (!matched) return evidence;

  const conventions: Record<string, (path: string, file: string) => HintEvidence | null> = {
    nextjs: (path, _file) => {
      const cleanPath = path.replace(/\[.*?\]/g, '[param]');
      const pageFile = `app${cleanPath}/page.tsx`;
      return {
        type: 'framework-convention',
        weight: 0.25,
        detail: `Next.js App Router convention: route "${path}" maps to "${pageFile}"`,
        confidence: 0.75,
      };
    },
    nuxt: (path, _file) => {
      const cleanPath = path.replace(/:.*?(\/|$)/g, '_$1');
      const pageFile = `pages${cleanPath}.vue`;
      return {
        type: 'framework-convention',
        weight: 0.25,
        detail: `Nuxt Pages convention: route "${path}" maps to "${pageFile}"`,
        confidence: 0.7,
      };
    },
    sveltekit: (path, _file) => {
      const pageFile = `routes${path}/+page.svelte`;
      return {
        type: 'framework-convention',
        weight: 0.25,
        detail: `SvelteKit convention: route "${path}" maps to "${pageFile}"`,
        confidence: 0.75,
      };
    },
  };

  const fwLower = fw.toLowerCase();
  for (const [key, fn] of Object.entries(conventions)) {
    if (fwLower.includes(key) || key.includes(fwLower)) {
      const item = fn(matched.path, matched.file);
      if (item) evidence.push(item);
    }
  }
  return evidence;
}

function matchId(input: HintInput): HintEvidence[] {
  const evidence: HintEvidence[] = [];
  const dc = input.domContext;
  if (!dc.id) return evidence;

  const dirs = input.project.componentIndex?.directories ?? [];
  for (const dir of dirs) {
    const lowerDir = dir.toLowerCase();
    const lowerId = dc.id.toLowerCase();
    if (lowerDir.includes(lowerId) || lowerId.includes(dirBasename(lowerDir))) {
      evidence.push({
        type: 'id-match',
        weight: 0.3,
        detail: `Element id "${dc.id}" matches directory "${dir}"`,
        confidence: 0.6,
      });
    }
  }
  return evidence;
}

function matchDataAttribute(input: HintInput): HintEvidence[] {
  const evidence: HintEvidence[] = [];
  const dc = input.domContext;
  if (!dc.testId) return evidence;

  const dirs = input.project.componentIndex?.directories ?? [];
  for (const dir of dirs) {
    const lowerDir = dir.toLowerCase();
    const lowerTestId = dc.testId.toLowerCase();
    if (lowerDir.includes(lowerTestId) || lowerTestId.includes(dirBasename(lowerDir))) {
      evidence.push({
        type: 'testid-match',
        weight: 0.3,
        detail: `Test ID "${dc.testId}" matches directory "${dir}"`,
        confidence: 0.55,
      });
    }
  }
  return evidence;
}

function collectCandidates(
  input: HintInput,
): Array<{ filePath: string; evidence: HintEvidence[] }> {
  const candidates: Array<{ filePath: string; evidence: HintEvidence[] }> = [];
  const matched = input.route.matchedRoute;

  // a) Route correlation
  const routeEvidence = matchRoute(input);
  if (routeEvidence.length > 0 && matched) {
    candidates.push({ filePath: matched.file, evidence: routeEvidence });
  }

  // b) Component naming
  const componentEvidence = matchComponentName(input);
  if (componentEvidence.length > 0) {
    const seen = new Set<string>();
    for (const ev of componentEvidence) {
      const fp = ev.detail.match(/"(.+?)"/)?.[1] ?? '';
      if (fp && !seen.has(fp)) {
        seen.add(fp);
        candidates.push({ filePath: fp, evidence: [ev] });
      }
    }
  }

  // c) Class name matching
  const classNameEvidence = matchClassName(input);
  if (classNameEvidence.length > 0) {
    const seen = new Set<string>();
    for (const ev of classNameEvidence) {
      const match = ev.detail.match(/"(.*?)"/g);
      const fp = match?.[1]?.replace(/^"|"$/g, '') ?? '';
      if (fp && !seen.has(fp)) {
        seen.add(fp);
        candidates.push({ filePath: fp, evidence: [ev] });
      }
    }
  }

  // d) Framework convention
  const fwEvidence = matchFrameworkConvention(input);
  if (fwEvidence.length > 0) {
    const seen = new Set<string>();
    for (const ev of fwEvidence) {
      const match = ev.detail.match(/"(.*?)"/);
      const fp = match?.[1] ?? '';
      if (fp && !seen.has(fp)) {
        seen.add(fp);
        candidates.push({ filePath: fp, evidence: [ev] });
      }
    }
  }

  // e) ID matching
  const idEvidence = matchId(input);
  if (idEvidence.length > 0) {
    const seen = new Set<string>();
    for (const ev of idEvidence) {
      const match = ev.detail.match(/"(.+?)"/);
      const fp = match?.[1] ?? '';
      if (fp && !seen.has(fp)) {
        seen.add(fp);
        candidates.push({ filePath: fp, evidence: [ev] });
      }
    }
  }

  // f) Data attribute
  const dataEvidence = matchDataAttribute(input);
  if (dataEvidence.length > 0) {
    const seen = new Set<string>();
    for (const ev of dataEvidence) {
      const match = ev.detail.match(/"(.+?)"/);
      const fp = match?.[1] ?? '';
      if (fp && !seen.has(fp)) {
        seen.add(fp);
        candidates.push({ filePath: fp, evidence: [ev] });
      }
    }
  }

  return candidates;
}

function determineDiscoveryMethod(evidence: HintEvidence[]): SourceHint['discoveryMethod'] {
  const types = evidence.map((e) => e.type);
  if (types.some((t) => t === 'route-match' || t === 'framework-convention'))
    return 'route-correlation';
  if (types.some((t) => t === 'component-name-match')) return 'component-naming';
  if (types.some((t) => t === 'class-name-match' || t === 'id-match' || t === 'testid-match'))
    return 'class-name-match';
  if (types.some((t) => t === 'framework-convention')) return 'framework-convention';
  return 'heuristic-match';
}

export class SourceHintEngine {
  private cache = new Map<string, SourceHint[]>();
  private hintsGenerated = 0;
  private hintsFailed = 0;
  private processingTimes: number[] = [];
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async generateHints(input: HintInput): Promise<Result<SourceHint[]>> {
    const startTime = performance.now();

    try {
      if (!input.project?.metadata?.projectId) {
        return err(
          shError(
            'SH_NO_PROJECT_METADATA',
            'Project metadata is missing.',
            'The input project context lacks required metadata.',
            'Ensure Project Scanner has run before requesting hints.',
          ),
        );
      }

      const cacheKey = buildCacheKey(input);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return ok(cached);
      }

      const fromCandidates = collectCandidates(input);

      if (fromCandidates.length === 0) {
        this.hintsFailed++;
        return err(
          shError(
            'SH_NO_CANDIDATES',
            'No source hint candidates were found.',
            'The DOM evidence and project data did not yield any candidates.',
            'Try capturing more specific UI elements or ensure the project has been scanned.',
          ),
        );
      }

      // Merge duplicate filePaths: combine evidence, keep highest-confidence entry
      const merged = new Map<string, HintEvidence[]>();
      for (const c of fromCandidates) {
        const existing = merged.get(c.filePath);
        if (!existing || c.evidence.length > existing.length) {
          merged.set(c.filePath, c.evidence);
        }
      }

      const scored: SourceHint[] = [];

      for (const [filePath, evidence] of merged) {
        const confidence = scoreHint(evidence);

        if (confidence < MIN_CONFIDENCE) continue;

        scored.push({
          hintId: buildHintId(filePath, evidence),
          filePath,
          confidence: Math.round(confidence * 10000) / 10000,
          evidence,
          discoveryMethod: determineDiscoveryMethod(evidence),
          framework: input.framework?.framework ?? input.project.framework?.primary ?? undefined,
          isPrimary: false,
          timestamp: new Date().toISOString(),
          schemaVersion: SCHEMA_VERSION,
        });
      }

      if (scored.length === 0) {
        this.hintsFailed++;
        return err(
          shError(
            'SH_INSUFFICIENT_EVIDENCE',
            'No hints met the minimum confidence threshold.',
            `All ${fromCandidates.length} candidates scored below ${MIN_CONFIDENCE}.`,
            'Provide additional DOM evidence (id, testId, classList) or re-scan the project.',
          ),
        );
      }

      scored.sort((a, b) => b.confidence - a.confidence);

      // Deduplicate by filePath: keep highest confidence
      const deduped: SourceHint[] = [];
      const seenFilePaths = new Set<string>();
      for (const hint of scored) {
        if (seenFilePaths.has(hint.filePath)) continue;
        seenFilePaths.add(hint.filePath);
        deduped.push(hint);
        if (deduped.length >= MAX_HINTS) break;
      }

      if (deduped[0]) {
        deduped[0].isPrimary = true;
      }

      this.cache.set(cacheKey, deduped);
      this.hintsGenerated++;

      const elapsed = performance.now() - startTime;
      this.processingTimes.push(elapsed);

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'SH_EVENT:HINTS_GENERATED',
        timestamp: new Date().toISOString(),
        version: '0.0.1',
        source: 'source-hint-engine',
        correlationId: input.captureId ?? crypto.randomUUID(),
        payload: {
          hintCount: deduped.length,
          primaryHint: deduped[0]?.filePath ?? null,
          processingTimeMs: Math.round(elapsed),
        },
      });

      return ok(deduped);
    } catch (e) {
      this.hintsFailed++;
      return err(
        shError(
          'SH_UNEXPECTED',
          'Unexpected error generating hints.',
          e instanceof Error ? e.message : String(e),
          'This is an internal error. Report it if it persists.',
        ),
      );
    }
  }

  async explainHint(hint: SourceHint): Promise<Result<string>> {
    if (!hint.evidence || hint.evidence.length === 0) {
      return err(
        shError(
          'SH_NO_EVIDENCE',
          'Cannot explain a hint with no evidence.',
          undefined,
          'Provide a hint with at least one piece of evidence.',
        ),
      );
    }

    const lines: string[] = [];
    lines.push(`## Source Hint: \`${hint.filePath}\``);
    lines.push('');
    lines.push(`- **Confidence:** ${(hint.confidence * 100).toFixed(1)}%`);
    lines.push(`- **Discovery Method:** ${hint.discoveryMethod}`);
    lines.push(`- **Framework:** ${hint.framework ?? 'unknown'}`);
    lines.push(`- **Primary Hint:** ${hint.isPrimary ? 'Yes' : 'No'}`);
    lines.push('');
    lines.push('### Evidence');
    lines.push('');
    lines.push('| Type | Confidence | Weight | Detail |');
    lines.push('|------|-----------|--------|--------|');
    for (const ev of hint.evidence) {
      lines.push(
        `| ${ev.type} | ${(ev.confidence * 100).toFixed(0)}% | ${ev.weight} | ${ev.detail} |`,
      );
    }
    lines.push('');
    lines.push('### Interpretation');
    lines.push('');
    if (hint.confidence >= 0.8) {
      lines.push('High confidence. This is likely the correct source file.');
    } else if (hint.confidence >= 0.5) {
      lines.push(
        'Moderate confidence. This file may be the source, but verification is recommended.',
      );
    } else {
      lines.push('Low confidence. Treat this as a suggestion only. More evidence is needed.');
    }

    return ok(lines.join('\n'));
  }

  health(): HintEngineHealth {
    const total = this.hintsGenerated + this.hintsFailed;
    const avgMs =
      this.processingTimes.length > 0
        ? Math.round(this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length)
        : 0;

    let status: HintEngineHealth['status'] = 'healthy';
    if (total > 0) {
      const failRate = this.hintsFailed / total;
      if (failRate >= 0.5) {
        status = 'unavailable';
      } else if (failRate >= 0.25) {
        status = 'degraded';
      }
    }

    return {
      status,
      hintsGenerated: this.hintsGenerated,
      hintsFailed: this.hintsFailed,
      cacheSize: this.cache.size,
      averageProcessingTimeMs: avgMs,
    };
  }

  async clearCache(): Promise<Result<void>> {
    this.cache.clear();
    return ok(undefined);
  }
}
