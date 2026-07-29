import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EventBus } from '@viskod/event-bus';
import type { Result, ViskodError } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';

import type {
  DiscoveryMethod,
  HintEngineHealth,
  HintEvidence,
  HintInput,
  SourceHint,
} from './types';

export type { HintEngineHealth, HintEvidence, HintInput, SourceHint };
export * from './types';

const SCHEMA_VERSION = '1.0.0';
const MIN_CONFIDENCE = 0.1;
const MAX_HINTS = 10;
const SUBSYSTEM = 'source-hint-engine';

const EXTENSION_PATTERNS = ['.tsx', '.jsx', '.vue', '.svelte', '.ts', '.js'];

const STYLE_EXTENSIONS = ['.css', '.scss', '.less', '.module.css', '.module.scss'];

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

function resolvePathWithCase(
  rootPath: string,
  relativePath: string,
): { resolved: string | null; matchType: 'exact' | 'case-insensitive' | null } {
  const full = path.join(rootPath, relativePath.replace(/\//g, path.sep));
  if (fs.existsSync(full)) return { resolved: full, matchType: 'exact' };
  const parent = path.dirname(full);
  const targetBase = path.basename(full);
  if (!fs.existsSync(parent)) return { resolved: null, matchType: null };
  try {
    const entries = fs.readdirSync(parent);
    // Normalize by removing non-alphanumeric chars for case-insensitive comparison
    const normalizeForCompare = (s: string) => s.replace(/[^a-z0-9.]/gi, '').toLowerCase();
    const normalizedTarget = normalizeForCompare(targetBase);
    const ciMatch = entries.find((e) => normalizeForCompare(e) === normalizedTarget);
    if (ciMatch) return { resolved: path.join(parent, ciMatch), matchType: 'case-insensitive' };
  } catch {
    // permission error
  }
  return { resolved: null, matchType: null };
}

function findAdjacentStyleFiles(
  rootPath: string,
  componentDir: string,
  componentName: string,
): string[] {
  const results: string[] = [];
  const dirPath = path.join(rootPath, componentDir.replace(/\//g, path.sep));
  if (!fs.existsSync(dirPath)) return results;
  try {
    const entries = fs.readdirSync(dirPath);
    const baseName = path.basename(componentName, path.extname(componentName));
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      const entryBase = path.basename(entry, ext);
      if (STYLE_EXTENSIONS.includes(ext) && entryBase.toLowerCase() === baseName.toLowerCase()) {
        results.push(`${componentDir}/${entry}`);
      }
    }
  } catch {
    // permission error
  }
  return results;
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

// ---- Existence + case-insensitive aware class-name matching ----

interface ResolvedCandidate {
  filePath: string;
  exists: boolean;
  matchType:
    | 'exact'
    | 'case-insensitive'
    | 'style-adjacent'
    | 'generated-non-existing'
    | 'generated'
    | 'usage-site';
  reason: string;
  relatedSelector?: string;
  confidence: number;
  discoveryMethod: DiscoveryMethod;
}

function collectResolvedCandidates(input: HintInput): ResolvedCandidate[] {
  const candidates: ResolvedCandidate[] = [];
  const rootPath = input.project.metadata.rootPath;
  const dirs = input.project.componentIndex?.directories ?? [];
  const dc = input.domContext;
  if (!rootPath || dirs.length === 0) return candidates;

  const searchTerms: string[] = [];
  if (dc.className) {
    searchTerms.push(...dc.className.split(/\s+/).filter(Boolean));
  }

  const seenPaths = new Set<string>();

  for (const term of searchTerms) {
    const lowerTerm = term.toLowerCase();
    // Generate candidate file paths from class name patterns
    const generatedPaths: string[] = [];
    for (const dir of dirs) {
      for (const ext of EXTENSION_PATTERNS) {
        generatedPaths.push(`${dir}/${lowerTerm}${ext}`);
        generatedPaths.push(`${dir}/${lowerTerm}/index${ext}`);
        generatedPaths.push(`${dir}/components/${lowerTerm}${ext}`);
      }
    }

    for (const genPath of generatedPaths) {
      if (seenPaths.has(genPath)) continue;
      seenPaths.add(genPath);

      const { resolved, matchType } = resolvePathWithCase(rootPath, genPath);

      if (resolved) {
        // File exists (exact or case-insensitive)
        const relPath = path.relative(rootPath, resolved).replace(/\\/g, '/');
        const ci = matchType === 'case-insensitive';
        const confidence = ci ? 0.85 : 0.95;
        candidates.push({
          filePath: relPath,
          exists: true,
          matchType: ci ? 'case-insensitive' : 'exact',
          reason: ci
            ? `Case-insensitive match: generated "${genPath}" resolved to "${relPath}"`
            : `File exists: ${relPath} (matched from class "${term}")`,
          relatedSelector: term,
          confidence,
          discoveryMethod: ci ? 'case-insensitive' : 'file-exists',
        });

        // Adjacent style files
        const componentName = path.basename(resolved);
        const relativeDir = path.dirname(relPath).replace(/\\/g, '/');
        const styleFiles = findAdjacentStyleFiles(rootPath, relativeDir, componentName);
        for (const sf of styleFiles) {
          if (seenPaths.has(sf)) continue;
          seenPaths.add(sf);
          candidates.push({
            filePath: sf,
            exists: true,
            matchType: 'style-adjacent',
            reason: `Style file adjacent to component "${relPath}": ${sf}`,
            relatedSelector: term,
            confidence: 0.8,
            discoveryMethod: 'style-adjacent',
          });
        }
      } else {
        // Generated candidate does not exist
        const confidence = 0.3;
        candidates.push({
          filePath: genPath,
          exists: false,
          matchType: 'generated-non-existing',
          reason: `Generated from class "${term}": ${genPath} (file does not exist)`,
          relatedSelector: term,
          confidence,
          discoveryMethod: 'class-name-match',
        });
      }
    }
  }

  return candidates;
}

// ---- Usage-site matcher (finds files containing visible text + component references) ----

interface UsageSiteCandidate {
  filePath: string;
  reason: string;
  confidence: number;
  matchedText: string[];
}

function findUsageSiteCandidates(input: HintInput): UsageSiteCandidate[] {
  const candidates: UsageSiteCandidate[] = [];
  const rootPath = input.project.metadata.rootPath;
  const dirs = input.project.componentIndex?.directories ?? [];
  const dc = input.domContext;
  if (!rootPath || dirs.length === 0) return [];

  // Extract meaningful visible text from the DOM (skip short fragments)
  const visibleText = (dc.text || '').trim();
  if (!visibleText || visibleText.length < 5) return [];

  // Collect significant phrases (exclude common Tailwind utility prefix words)
  const UTILITY_BLACKLIST = new Set([
    'flex',
    'grid',
    'inline',
    'block',
    'items',
    'justify',
    'content',
    'self',
    'place',
    'auto',
    'min',
    'max',
    'none',
    'full',
    'size',
    'text',
    'font',
    'tracking',
    'leading',
    'align',
    'break',
    'whitespace',
    'truncate',
    'overflow',
    'scroll',
    'visible',
    'hidden',
    'absolute',
    'relative',
    'fixed',
    'sticky',
    'static',
    'inset',
    'start',
    'end',
    'left',
    'right',
    'top',
    'bottom',
    'zindex',
    'order',
    'col',
    'row',
    'cols',
    'rows',
    'float',
    'clear',
    'object',
    'aspect',
    'basis',
    'grow',
    'shrink',
    'shadow',
    'opacity',
    'cursor',
    'select',
    'pointer',
    'resize',
    'transition',
    'duration',
    'ease',
    'delay',
    'animate',
    'scale',
    'rotate',
    'translate',
    'skew',
    'transform',
    'origin',
    'ring',
    'filter',
    'backdrop',
    'divide',
    'space',
    'gap',
    'between',
    'around',
    'evenly',
    'children',
    'first',
    'last',
    'odd',
    'even',
    'visited',
    'checked',
    'focus',
    'hover',
    'active',
    'disabled',
    'group',
    'peer',
    'dark',
    'light',
    'motion',
    'supports',
    'aria',
    'data',
    'state',
    'open',
    'closed',
    'selected',
    'expanded',
    'border',
    'rounded',
    'outline',
    'decoration',
    'underline',
    'capitalize',
    'italic',
    'bold',
    'semibold',
    'extrabold',
    'black',
    'thin',
    'extralight',
    'light',
    'medium',
    'normal',
    'wght',
    'bgcard',
    'surface',
    'muted',
    'destructive',
    'primary',
    'secondary',
    'accent',
    'chart',
    'foreground',
    'background',
    'input',
    'popover',
    'sidebar',
    'linethrough',
    'overline',
    'normalcase',
    'lowercase',
    'uppercase',
    'linethrough',
  ]);
  const words = visibleText
    .split(/[\s\n]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(
      (w) => w.length >= 4 && !UTILITY_BLACKLIST.has(w.toLowerCase()) && Number.isNaN(Number(w)),
    );
  const uniqueWords = [...new Set(words.map((w) => w.toLowerCase()))];
  if (uniqueWords.length === 0) return candidates;

  // Collect component names from the hierarchy hint (data-slot, tag names)
  const componentNames: string[] = [];
  // data-slot attributes often contain component family names
  if (dc.role === 'card' || dc.className?.includes('card') || dc.tagName === 'div') {
    componentNames.push('Card');
  }

  const seenPaths = new Set<string>();

  // Also search common page/feature directories where usage sites typically live
  const usageSiteDirs = [
    ...dirs,
    'src/features',
    'src/pages',
    'src/routes',
    'src/app',
    'features',
    'pages',
    'routes',
    'app',
  ];
  const uniqueDirs = [...new Set(usageSiteDirs)];

  // Search project files in component AND page directories
  for (const dir of uniqueDirs) {
    const dirPath = path.join(rootPath, dir.replace(/\//g, path.sep));
    if (!fs.existsSync(dirPath)) continue;

    try {
      const walkDir = (dir: string) => {
        let items: fs.Dirent[];
        try {
          items = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of items) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
            continue;
          }
          if (!entry.isFile()) continue;
          const ext = path.extname(entry.name).toLowerCase();
          if (!EXTENSION_PATTERNS.includes(ext) && !STYLE_EXTENSIONS.includes(ext)) continue;

          const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
          if (seenPaths.has(relPath)) continue;

          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const contentLower = content.toLowerCase();
            const matchedWords = uniqueWords.filter((w) => contentLower.includes(w));
            if (matchedWords.length === 0) continue;

            const hasComponentRef =
              componentNames.length === 0 ||
              componentNames.some((cn) => content.includes(`<${cn}`) || content.includes(cn));

            if (hasComponentRef) {
              seenPaths.add(relPath);
              const matchRatio = matchedWords.length / uniqueWords.length;
              // Base 0.9 to beat generic class-name exact matches (max 0.95)
              const confidence = 0.9 + matchRatio * 0.09;
              candidates.push({
                filePath: relPath,
                reason: `Usage-site: file contains visible text "${matchedWords.slice(0, 3).join(', ')}"${componentNames.length > 0 ? ` and references ${componentNames[0]}` : ''}`,
                confidence: Math.min(confidence, 0.95),
                matchedText: matchedWords,
              });
            }
          } catch {
            // skip unreadable files
          }
        }
      };
      walkDir(dirPath);
    } catch {
      // skip unreadable directories
    }
  }

  return candidates;
}

// ---- Legacy matchers (used for non-existence-based evidence) ----

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

function matchClassNameLegacy(input: HintInput): HintEvidence[] {
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

      if (!input.project.metadata.rootPath) {
        return err(
          shError(
            'SH_NO_ROOT_PATH',
            'Project root path is missing.',
            'SourceHintEngine needs rootPath to check file existence.',
            'Ensure ProjectScanner provides rootPath in project metadata.',
          ),
        );
      }

      const cacheKey = buildCacheKey(input);
      const cached = this.cache.get(cacheKey);
      if (cached) return ok(cached);

      // Phase 1: existence-aware resolution (new)
      const resolvedCandidates = collectResolvedCandidates(input);

      // Phase 2: legacy evidence collection for additional context
      const legacyCandidates: Array<{ filePath: string; evidence: HintEvidence[] }> = [];
      const matched = input.route.matchedRoute;
      const routeEvidence = matchRoute(input);
      if (routeEvidence.length > 0 && matched) {
        legacyCandidates.push({ filePath: matched.file, evidence: routeEvidence });
      }
      const componentEvidence = matchComponentName(input);
      if (componentEvidence.length > 0) {
        const seen = new Set<string>();
        for (const ev of componentEvidence) {
          const fp = ev.detail.match(/"(.+?)"/)?.[1] ?? '';
          if (fp && !seen.has(fp)) {
            seen.add(fp);
            legacyCandidates.push({ filePath: fp, evidence: [ev] });
          }
        }
      }
      const legacyClassNameEvidence = matchClassNameLegacy(input);
      if (legacyClassNameEvidence.length > 0) {
        const seen = new Set<string>();
        for (const ev of legacyClassNameEvidence) {
          const match = ev.detail.match(/"(.*?)"/g);
          const fp = match?.[1]?.replace(/^"|"$/g, '') ?? '';
          if (fp && !seen.has(fp)) {
            seen.add(fp);
            legacyCandidates.push({ filePath: fp, evidence: [ev] });
          }
        }
      }

      // Phase 3: usage-site candidates (visible text + component reference matching)
      const usageSiteCandidates = findUsageSiteCandidates(input);

      // Merge existence-aware candidates with legacy evidence and usage-site candidates
      // Priority: usage-site > exact existing > case-insensitive > style-adjacent > existing with legacy > generated non-existing
      const existingPaths = new Set(
        resolvedCandidates.filter((c) => c.exists).map((c) => c.filePath.toLowerCase()),
      );

      // Boost existing resolved candidates with any matching legacy evidence
      const scoredMap = new Map<string, ResolvedCandidate>();

      // Insert usage-site candidates FIRST (highest priority)
      for (const uc of usageSiteCandidates) {
        const key = uc.filePath.toLowerCase();
        const confidence = uc.confidence;
        scoredMap.set(key, {
          filePath: uc.filePath,
          exists: true,
          matchType: 'usage-site',
          reason: uc.reason,
          confidence,
          discoveryMethod: 'usage-site',
        });
      }

      for (const rc of resolvedCandidates) {
        const key = rc.filePath.toLowerCase();
        if (!scoredMap.has(key) || rc.confidence > (scoredMap.get(key)?.confidence ?? 0)) {
          scoredMap.set(key, rc);
        }
      }

      // Add legacy candidates that weren't found by existence check
      for (const lc of legacyCandidates) {
        const key = lc.filePath.toLowerCase();
        if (!existingPaths.has(key) && !scoredMap.has(key)) {
          const confidence = scoreHint(lc.evidence);
          scoredMap.set(key, {
            filePath: lc.filePath,
            exists: false,
            matchType: 'generated',
            reason: `Generated from evidence: ${lc.evidence.map((e) => e.type).join(', ')}`,
            confidence,
            discoveryMethod: 'class-name-match',
          });
        }
      }

      const scored: SourceHint[] = [];
      for (const [, hint] of scoredMap) {
        if (hint.confidence < MIN_CONFIDENCE) continue;
        const evidence: HintEvidence[] = [
          {
            type: 'file-exists',
            weight: 0.5,
            detail: hint.reason,
            confidence: hint.confidence,
          },
        ];
        scored.push({
          hintId: buildHintId(hint.filePath, evidence),
          filePath: hint.filePath,
          confidence: Math.round(hint.confidence * 10000) / 10000,
          evidence,
          discoveryMethod: hint.discoveryMethod,
          framework: input.framework?.framework ?? input.project.framework?.primary ?? undefined,
          isPrimary: false,
          timestamp: new Date().toISOString(),
          schemaVersion: SCHEMA_VERSION,
          exists: hint.exists,
          matchType: hint.matchType,
          reason: hint.reason,
          relatedSelector: hint.relatedSelector,
        });
      }

      if (scored.length === 0) {
        this.hintsFailed++;
        return err(
          shError(
            'SH_INSUFFICIENT_EVIDENCE',
            'No hints met the minimum confidence threshold.',
            `All candidates scored below ${MIN_CONFIDENCE}.`,
            'Provide additional DOM evidence or re-scan the project.',
          ),
        );
      }

      // Sort by priority tier first, then confidence within tier
      // Tiers: usage-site (0) > existing exact (1) > existing case-insensitive (2) > existing style (3) > generated (4)
      const matchTypeTier: Record<string, number> = {
        'usage-site': 0,
        exact: 1,
        'case-insensitive': 2,
        'style-adjacent': 3,
        generated: 4,
        'generated-non-existing': 4,
      };
      scored.sort((a, b) => {
        const tierA = matchTypeTier[a.matchType] ?? 99;
        const tierB = matchTypeTier[b.matchType] ?? 99;
        if (tierA !== tierB) return tierA - tierB;
        return b.confidence - a.confidence;
      });

      const deduped: SourceHint[] = [];
      const seenFilePaths = new Set<string>();
      for (const hint of scored) {
        if (seenFilePaths.has(hint.filePath.toLowerCase())) continue;
        seenFilePaths.add(hint.filePath.toLowerCase());
        deduped.push(hint);
        if (deduped.length >= MAX_HINTS) break;
      }

      if (deduped[0]) deduped[0].isPrimary = true;

      this.cache.set(cacheKey, deduped);
      this.hintsGenerated++;

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'SH_EVENT:HINTS_GENERATED',
        timestamp: new Date().toISOString(),
        version: SCHEMA_VERSION,
        source: 'source-hint-engine',
        correlationId: input.captureId ?? crypto.randomUUID(),
        payload: {
          hintCount: deduped.length,
          primaryHint: deduped[0]?.filePath ?? null,
          processingTimeMs: Math.round(performance.now() - startTime),
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
    lines.push(`- **Exists:** ${hint.exists ? 'Yes' : 'No'}`);
    lines.push(`- **Match Type:** ${hint.matchType}`);
    lines.push(`- **Discovery Method:** ${hint.discoveryMethod}`);
    lines.push(`- **Reason:** ${hint.reason}`);
    if (hint.relatedSelector) lines.push(`- **Related Selector:** ${hint.relatedSelector}`);
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
    if (hint.exists && hint.matchType === 'exact') {
      lines.push(
        'File confirmed on disk with exact name match. High confidence this is the correct source file.',
      );
    } else if (hint.exists && hint.matchType === 'case-insensitive') {
      lines.push('File found on disk via case-insensitive match. Likely the correct source file.');
    } else if (hint.exists && hint.matchType === 'style-adjacent') {
      lines.push('Style file adjacent to a confirmed component. Likely the correct style source.');
    } else {
      lines.push(
        'Low confidence. Treat this as a suggestion only — the file does not exist on disk.',
      );
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
      if (failRate >= 0.5) status = 'unavailable';
      else if (failRate >= 0.25) status = 'degraded';
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
