import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EventBus } from '@viskod/event-bus';
import type { Result, ViskodError } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';

import type { ImportGraphEntry } from './classifier';
import { MIN_CONFIDENCE, scoreEvidence } from './evidence';
import type { EvidenceFamily } from './evidence';
import { buildImportGraph, buildLocalDependencyClosure } from './import-graph';
import { DEFAULT_SCAN_BUDGET, type ScanBudget, ScanBudgetExceededError } from './import-graph';
import { rankHints } from './ranking';
import type {
  DiscoveryMethod,
  EvidenceType,
  HintEngineHealth,
  HintEvidence,
  HintInput,
  RankingResult,
  SourceHint,
  SourceQualification,
  UsageSiteSourceHint,
} from './types';

export type {
  HintEngineHealth,
  HintEvidence,
  HintInput,
  RankingResult,
  SourceHint,
  UsageSiteSourceHint,
  SourceQualification,
};
export * from './types';
export { classifyHint, detectLanguage } from './classifier';
export { rankHints } from './ranking';
export {
  buildImportGraph,
  buildLocalDependencyClosure,
  findImporters,
  findImports,
  resolveLocalImport,
  ScanBudgetExceededError,
  DEFAULT_SCAN_BUDGET,
} from './import-graph';
export type { ScanBudget } from './import-graph';
export {
  computeSourceResolution,
  qualifyConfidence,
  scoreEvidence,
  MIN_CONFIDENCE,
} from './evidence';
export type { EvidenceFamily, EvidenceScoreInput, FamilySignal } from './evidence';
export type { ImportGraphEntry } from './classifier';

/**
 * Schema version of generated hints. 2.0.0 = Phase 30 calibration: numeric
 * confidence is now an evidence-based score with an explicit semantic
 * qualification. Callers must never compare a legacy inflated value with a
 * calibrated one as if they were the same scale.
 *
 * Exported so the capture pipeline can persist the model version that
 * produced a capture-time source-resolution snapshot (Phase 30A). A future
 * model bumps this version; persisted snapshots keep their capture-time
 * conclusion regardless.
 */
export const SOURCE_HINT_SCHEMA_VERSION = '2.0.0';
const SCHEMA_VERSION = SOURCE_HINT_SCHEMA_VERSION;
const MAX_HINTS = 10;
const SUBSYSTEM = 'source-hint-engine';

const EXTENSION_PATTERNS = ['.tsx', '.jsx', '.vue', '.svelte', '.ts', '.js'];

const STYLE_EXTENSIONS = ['.css', '.scss', '.less', '.module.css', '.module.scss'];

/** Directories scanned for usage sites (existing convention). */
const USAGE_SITE_DIRS = [
  'src/features',
  'src/pages',
  'src/routes',
  'src/app',
  'features',
  'pages',
  'routes',
  'app',
];

/** Class tokens too generic to imply ownership (weak evidence only). */
const GENERIC_TOKENS = new Set([
  'card',
  'button',
  'btn',
  'item',
  'container',
  'section',
  'wrapper',
  'box',
  'panel',
  'header',
  'footer',
  'nav',
  'list',
  'row',
  'column',
  'grid',
  'group',
  'badge',
  'avatar',
  'icon',
  'label',
  'input',
  'select',
  'textarea',
  'form',
  'dialog',
  'modal',
  'menu',
  'tooltip',
  'popover',
  'table',
  'tab',
  'alert',
  'spinner',
  'sheet',
  'separator',
  'command',
  'calendar',
  'combobox',
  'dropdown',
  'accordion',
  'tabs',
  'progress',
  'switch',
  'slider',
  'field',
  'content',
  'title',
  'description',
  'text',
  'link',
  'image',
  'avatar',
  // Layout/utility classes — a file matching one of these by name is weak
  // evidence, never ownership.
  'flex',
  'grid',
  'block',
  'inline',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'main',
  'aside',
  'article',
  'status',
  'banner',
]);

/** Generic DOM identifiers that never imply ownership. */
const GENERIC_IDENTIFIERS = new Set([
  'app',
  'root',
  'main',
  'content',
  'wrapper',
  'container',
  'page',
  'header',
  'footer',
  'nav',
  'body',
]);

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

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

/** Safety: a candidate path must be repo-relative and inside the root. */
function isSafeRelativePath(relPath: string): boolean {
  if (!relPath) return false;
  if (path.posix.isAbsolute(relPath)) return false;
  if (/^[A-Za-z]:[\\/]/.test(relPath)) return false;
  const normalized = path.posix.normalize(relPath);
  if (normalized === '..' || normalized.startsWith('../')) return false;
  return true;
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

function buildCacheKey(input: HintInput): string {
  const rt = input.route;
  const dc = input.domContext;
  // Text, role, and testId are part of the evidence: two elements on the same
  // route with the same tag/id/class but different visible text must not share
  // a cache entry (that produced stale hints dependent on call order).
  return `${rt.pathname}:${dc.tagName}:${dc.id ?? ''}:${dc.className ?? ''}:${dc.role ?? ''}:${dc.testId ?? ''}:${dc.text ?? ''}`;
}

function buildHintId(filePath: string, evidence: HintEvidence[]): string {
  const evidenceHash = djb2(evidence.map((e) => e.type).join(','));
  return `${encodeURIComponent(filePath)}#${evidenceHash}`;
}

// ---------------------------------------------------------------------------
// Visible-text word extraction
// ---------------------------------------------------------------------------

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
]);

/** Extract meaningful visible-text words (deduplicated, lowercase). */
function extractTextWords(text: string): string[] {
  const words = text
    .split(/[\s\n]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(
      (w) => w.length >= 4 && !UTILITY_BLACKLIST.has(w.toLowerCase()) && Number.isNaN(Number(w)),
    );
  return [...new Set(words.map((w) => w.toLowerCase()))];
}

// ---------------------------------------------------------------------------
// Project file scan (one deterministic pass, budget-bounded)
// ---------------------------------------------------------------------------

interface FileSignals {
  /** Visible-text words found in the file content. */
  matchedWords: string[];
  /** Stable identifiers (id/testid) literally defined in the file. */
  stableIdHits: string[];
  /** Explicitly observed component names referenced in the file. */
  componentRefHits: string[];
}

interface ScanContext {
  files: number;
  startMs: number;
  budget: ScanBudget;
}

function touchScan(ctx: ScanContext): void {
  ctx.files++;
  if (ctx.files > ctx.budget.maxFiles || Date.now() - ctx.startMs > ctx.budget.maxTimeMs) {
    throw new ScanBudgetExceededError();
  }
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.output',
  '.nuxt',
  '.cache',
  'coverage',
  '.git',
]);

function walkCodeFiles(
  rootPath: string,
  dir: string,
  ctx: ScanContext,
  visit: (relPath: string, fullPath: string) => void,
  depth = 0,
): void {
  if (depth > 10) return;
  const dirPath = path.join(rootPath, dir.replace(/\//g, path.sep));
  let items: fs.Dirent[];
  try {
    items = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  // Deterministic enumeration: filesystem order must never influence output.
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of items) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkCodeFiles(rootPath, `${dir}/${entry.name}`, ctx, visit, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!EXTENSION_PATTERNS.includes(ext)) continue;
    touchScan(ctx);
    visit(`${dir}/${entry.name}`, fullPath);
  }
}

function scanProjectFiles(input: HintInput, ctx: ScanContext): Map<string, FileSignals> {
  const result = new Map<string, FileSignals>();
  const rootPath = input.project.metadata.rootPath;
  const dirs = input.project.componentIndex?.directories ?? [];
  const dc = input.domContext;
  const textWords = extractTextWords(dc.text ?? '');
  // Word-boundary matching: 'save' must NOT match the identifier 'SaveButton'.
  const textPattern =
    textWords.length > 0
      ? new RegExp(`\\b(?:${textWords.map(escapeRegExp).join('|')})\\b`, 'gi')
      : null;
  const stableIds: string[] = [];
  const id = (dc.id ?? '').trim();
  const testId = (dc.testId ?? '').trim();
  if (id && id.length >= 4 && !GENERIC_IDENTIFIERS.has(id.toLowerCase())) stableIds.push(id);
  if (testId && testId.length >= 4 && !GENERIC_IDENTIFIERS.has(testId.toLowerCase()))
    stableIds.push(testId);
  const componentNames = extractComponentNames(input);
  const uniqueDirs = [...new Set([...dirs, ...USAGE_SITE_DIRS])];

  for (const dir of uniqueDirs) {
    walkCodeFiles(rootPath, dir, ctx, (relPath, fullPath) => {
      let content: string;
      try {
        content = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        return;
      }
      const matchedWords: string[] = [];
      if (textPattern) {
        const seenWords = new Set<string>();
        for (const m of content.matchAll(textPattern)) {
          const word = (m[0] ?? '').toLowerCase();
          if (textWords.includes(word)) seenWords.add(word);
        }
        matchedWords.push(...seenWords);
      }
      const stableIdHits: string[] = [];
      for (const s of stableIds) {
        if (
          content.includes(`id="${s}"`) ||
          content.includes(`id='${s}'`) ||
          content.includes(`data-testid="${s}"`) ||
          content.includes(`data-testid='${s}'`)
        ) {
          stableIdHits.push(s);
        }
      }
      const componentRefHits: string[] = [];
      for (const name of componentNames) {
        // JSX tag, call, or export reference to an explicitly observed name.
        if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(content)) {
          componentRefHits.push(name);
        }
      }
      if (matchedWords.length > 0 || stableIdHits.length > 0 || componentRefHits.length > 0) {
        result.set(relPath, { matchedWords, stableIdHits, componentRefHits });
      }
    });
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Component names derived ONLY from explicit DOM instrumentation
 * (data-component/data-slot attributes). A generic `div` or ARIA role never
 * produces a component name (VISKOD-AUDIT-008 Card regression).
 */
function extractComponentNames(input: HintInput): string[] {
  const attrs = input.domContext.dataAttributes ?? {};
  const names = new Set<string>();
  for (const key of ['data-component', 'data-slot', 'data-layer']) {
    const value = attrs[key];
    if (!value) continue;
    for (const token of value.split(/[\s,]+/)) {
      const clean = token.trim();
      if (clean && /^[A-Za-z][A-Za-z0-9]*$/.test(clean)) names.add(clean);
    }
  }
  return [...names];
}

// ---------------------------------------------------------------------------
// Evidence assembly per candidate file
// ---------------------------------------------------------------------------

interface CandidateEvidence {
  filePath: string;
  exists: boolean;
  matchType: SourceHint['matchType'];
  discoveryMethod: DiscoveryMethod;
  families: Array<{ family: EvidenceFamily; reason: string }>;
  uniqueText?: boolean;
  isRouteFile?: boolean;
  relatedSelector?: string;
}

function collectCandidates(input: HintInput, ctx: ScanContext): CandidateEvidence[] {
  const rootPath = input.project.metadata.rootPath;
  const dc = input.domContext;
  const matchedRoute = input.route.matchedRoute;
  const byPath = new Map<string, CandidateEvidence>();

  const add = (candidate: CandidateEvidence): void => {
    if (!isSafeRelativePath(candidate.filePath)) return;
    const key = candidate.filePath.toLowerCase();
    const existing = byPath.get(key);
    if (existing) {
      // MERGE independent signals for the same file: a route file that also
      // contains the visible text carries BOTH evidence families.
      const existingFamilies = new Set(existing.families.map((f) => f.family));
      for (const family of candidate.families) {
        if (!existingFamilies.has(family.family)) {
          existing.families.push(family);
          existingFamilies.add(family.family);
        }
      }
      existing.uniqueText = existing.uniqueText || candidate.uniqueText;
      existing.isRouteFile = existing.isRouteFile || candidate.isRouteFile;
      return;
    }
    byPath.set(key, candidate);
  };

  // 1. Current route owner (strong).
  if (matchedRoute?.file && isSafeRelativePath(matchedRoute.file)) {
    add({
      filePath: matchedRoute.file,
      exists: true,
      matchType: 'usage-site',
      discoveryMethod: 'route-correlation',
      isRouteFile: true,
      families: [
        {
          family: 'route-ownership',
          reason: `current route ${matchedRoute.path ?? ''} maps to this file`,
        },
      ],
    });
  }

  // 2. Import-closure of the current route (strong corroboration).
  let importClosure: Set<string> | null = null;
  if (matchedRoute?.file && isSafeRelativePath(matchedRoute.file)) {
    try {
      importClosure = buildLocalDependencyClosure(rootPath, matchedRoute.file, ctx.budget);
    } catch (error) {
      if (error instanceof ScanBudgetExceededError) throw error;
      importClosure = null;
    }
    if (importClosure) {
      for (const file of importClosure) {
        if (file === matchedRoute.file) continue;
        if (!isSafeRelativePath(file)) continue;
        add({
          filePath: file,
          exists: true,
          matchType: 'usage-site',
          discoveryMethod: 'import-graph',
          families: [
            {
              family: 'import-path',
              reason: 'imported (directly or transitively) by the current route',
            },
          ],
        });
      }
    }
  }

  // 3. Class-name file existence (moderate/weak depending on specificity).
  const classTokens = (dc.className ?? '').split(/\s+/).filter(Boolean);
  for (const term of classTokens) {
    const lowerTerm = term.toLowerCase();
    const generic = GENERIC_TOKENS.has(lowerTerm);
    const dirs = input.project.componentIndex?.directories ?? [];
    const generatedPaths: string[] = [];
    for (const dir of dirs) {
      for (const ext of EXTENSION_PATTERNS) {
        generatedPaths.push(`${dir}/${lowerTerm}${ext}`);
        generatedPaths.push(`${dir}/${lowerTerm}/index${ext}`);
        generatedPaths.push(`${dir}/components/${lowerTerm}${ext}`);
      }
    }
    for (const genPath of generatedPaths) {
      const { resolved, matchType } = resolvePathWithCase(rootPath, genPath);
      if (!resolved) continue;
      const relPath = path.relative(rootPath, resolved).replace(/\\/g, '/');
      const family: EvidenceFamily = generic ? 'generic-class' : 'class-file';
      const ci = matchType === 'case-insensitive';
      add({
        filePath: relPath,
        exists: true,
        matchType: ci ? 'case-insensitive' : 'exact',
        discoveryMethod: ci ? 'case-insensitive' : 'file-exists',
        relatedSelector: term,
        families: [
          {
            family,
            reason: generic
              ? `generic class '${term}' matches a file — weak evidence`
              : `file exists matching class '${term}'`,
          },
        ],
      });
      // Adjacent style files (dependent evidence, weak).
      const componentName = path.basename(resolved);
      const relativeDir = path.dirname(relPath).replace(/\\/g, '/');
      const styleFiles = findAdjacentStyleFiles(rootPath, relativeDir, componentName);
      for (const sf of styleFiles) {
        add({
          filePath: sf,
          exists: true,
          matchType: 'style-adjacent',
          discoveryMethod: 'style-adjacent',
          relatedSelector: term,
          families: [
            {
              family: 'style-adjacent',
              reason: `style file adjacent to ${relPath}`,
            },
          ],
        });
      }
    }
  }

  // 4. Project file scan: visible text, stable identifiers, component refs.
  const textWords = extractTextWords(dc.text ?? '');
  const signals = scanProjectFiles(input, ctx);

  // Word frequency across the scanned scope — duplicate text is weak.
  const wordFrequency = new Map<string, number>();
  for (const [, fileSig] of signals) {
    for (const w of fileSig.matchedWords) {
      wordFrequency.set(w, (wordFrequency.get(w) ?? 0) + 1);
    }
  }

  for (const [relPath, fileSig] of [...signals.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const families: Array<{ family: EvidenceFamily; reason: string }> = [];
    let uniqueText = false;

    if (fileSig.matchedWords.length > 0 && textWords.length > 0) {
      const anyDuplicate = fileSig.matchedWords.some((w) => (wordFrequency.get(w) ?? 0) > 1);
      uniqueText = !anyDuplicate;
      const sample = fileSig.matchedWords.slice(0, 3).join(', ');
      families.push({
        family: 'usage-text',
        reason: uniqueText
          ? `visible text (${sample}) found only in this file`
          : `visible text (${sample}) also appears in other files — weak evidence`,
      });
    }
    for (const s of fileSig.stableIdHits) {
      families.push({
        family: 'stable-identifier',
        reason: `file defines the target's stable identifier '${s}'`,
      });
    }
    for (const name of fileSig.componentRefHits) {
      families.push({
        family: 'component-ref',
        reason: `file references observed component '${name}'`,
      });
    }
    if (families.length === 0) continue;
    add({
      filePath: relPath,
      exists: true,
      matchType: 'usage-site',
      discoveryMethod: fileSig.stableIdHits.length > 0 ? 'test-id-match' : 'usage-site',
      families,
      uniqueText,
    });
  }

  return [...byPath.values()];
}

// ---------------------------------------------------------------------------
// SourceHintEngine
// ---------------------------------------------------------------------------

export class SourceHintEngine {
  private cache = new Map<string, SourceHint[]>();
  private importGraphCache = new Map<string, ImportGraphEntry[]>();
  private hintsGenerated = 0;
  private hintsFailed = 0;
  private hintsUnavailable = 0;
  private processingTimes: number[] = [];
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async resolveUsageSiteHints(
    input: HintInput,
    maxHints?: number,
    options?: { useImportGraph?: boolean; budget?: Partial<ScanBudget> },
  ): Promise<Result<RankingResult>> {
    const startTime = performance.now();

    try {
      // Generate base hints first
      const hintResult = await this.generateHints(input, options);
      if (!hintResult.ok) {
        return ok({
          status: 'missing',
          resolution: 'unavailable',
          topHints: [],
          warnings: [hintResult.error.message],
        });
      }

      const hints = hintResult.value;

      // Build or retrieve import graph
      const rootPath = input.project.metadata.rootPath;
      const dirs = input.project.componentIndex?.directories ?? [];
      const graphKey = rootPath;
      let importGraph =
        options?.useImportGraph === false ? undefined : this.importGraphCache.get(graphKey);
      if (!importGraph && options?.useImportGraph !== false && rootPath && dirs.length > 0) {
        try {
          importGraph = buildImportGraph(rootPath, dirs, this.resolveBudget(options?.budget));
          this.importGraphCache.set(graphKey, importGraph);
        } catch (error) {
          if (error instanceof ScanBudgetExceededError) {
            return ok({
              status: 'missing',
              resolution: 'unavailable',
              topHints: [],
              warnings: ['Source scan budget exceeded — source resolution unavailable'],
            });
          }
          importGraph = undefined;
        }
      }

      // Rank hints
      const rankingResult = rankHints({
        hints,
        routePath: input.route.pathname,
        routeFile: input.route.matchedRoute?.file,
        matchedRoute: input.route.matchedRoute,
        domText: input.domContext.text,
        domTestId: input.domContext.testId,
        domAriaLabel: input.domContext.role,
        domClassName: input.domContext.className,
        importGraph: importGraph ?? undefined,
        projectRootPath: rootPath,
      });

      // Apply maxHints limit
      if (maxHints && maxHints > 0 && rankingResult.topHints.length > maxHints) {
        rankingResult.topHints = rankingResult.topHints.slice(0, maxHints);
      }

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'SH_EVENT:USAGE_SITE_HINTS_RESOLVED',
        timestamp: new Date().toISOString(),
        version: SCHEMA_VERSION,
        source: 'source-hint-engine',
        correlationId: input.captureId ?? crypto.randomUUID(),
        payload: {
          status: rankingResult.status,
          resolution: rankingResult.resolution,
          hintCount: rankingResult.topHints.length,
          processingTimeMs: Math.round(performance.now() - startTime),
        },
      });

      return ok(rankingResult);
    } catch (e) {
      return err(
        shError(
          'SH_RANKING_FAILED',
          'Failed to rank usage-site hints.',
          e instanceof Error ? e.message : String(e),
          'This is an internal error. Report it if it persists.',
        ),
      );
    }
  }

  private resolveBudget(partial?: Partial<ScanBudget>): ScanBudget {
    return { ...DEFAULT_SCAN_BUDGET, ...(partial ?? {}) };
  }

  async generateHints(
    input: HintInput,
    options?: { budget?: Partial<ScanBudget> },
  ): Promise<Result<SourceHint[]>> {
    const startTime = performance.now();
    const budget = this.resolveBudget(options?.budget);

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

      // Budget-bounded evidence collection (Phase 30 latency guard).
      const ctx: ScanContext = { files: 0, startMs: Date.now(), budget };
      const candidates = collectCandidates(input, ctx);

      // Score every candidate from its evidence families.
      const scored: Array<{
        candidate: CandidateEvidence;
        confidence: number;
        qualification: SourceQualification;
        reasons: string[];
      }> = [];
      for (const candidate of candidates) {
        const { confidence, qualification, reasons } = scoreEvidence({
          families: candidate.families,
          uniqueText: candidate.uniqueText,
          isRouteFile: candidate.isRouteFile,
        });
        if (confidence < MIN_CONFIDENCE) continue;
        scored.push({ candidate, confidence, qualification, reasons });
      }

      if (scored.length === 0) {
        this.hintsUnavailable++;
        return err(
          shError(
            'SH_INSUFFICIENT_EVIDENCE',
            'No source candidate met the minimum evidence threshold.',
            `All candidates scored below ${MIN_CONFIDENCE}.`,
            'Provide additional DOM evidence or re-scan the project.',
          ),
        );
      }

      // Deterministic ordering: qualification tier → confidence → strong
      // evidence count → stable relative path.
      const tier: Record<SourceQualification, number> = {
        exact: 4,
        probable: 3,
        possible: 2,
        weak: 1,
      };
      const strongFamilyCount = (c: CandidateEvidence): number =>
        c.families.filter((f) =>
          ['route-ownership', 'import-path', 'stable-identifier'].includes(f.family),
        ).length;
      scored.sort((a, b) => {
        const tierDiff = (tier[b.qualification] ?? 0) - (tier[a.qualification] ?? 0);
        if (tierDiff !== 0) return tierDiff;
        const confDiff = b.confidence - a.confidence;
        if (Math.abs(confDiff) >= 0.0001) return confDiff;
        const strongDiff = strongFamilyCount(b.candidate) - strongFamilyCount(a.candidate);
        if (strongDiff !== 0) return strongDiff;
        return a.candidate.filePath.localeCompare(b.candidate.filePath);
      });

      const hints: SourceHint[] = [];
      const seenPaths = new Set<string>();
      for (const entry of scored) {
        const filePath = entry.candidate.filePath;
        const key = filePath.toLowerCase();
        if (seenPaths.has(key)) continue;
        seenPaths.add(key);
        const { candidate, confidence, qualification, reasons } = entry;
        const evidence: HintEvidence[] = candidate.families.map((f) => ({
          type: evidenceTypeForFamily(f.family),
          weight: 0.5,
          detail: f.reason,
          confidence,
          observed: true,
        }));
        hints.push({
          hintId: buildHintId(filePath, evidence),
          filePath,
          confidence,
          qualification,
          reasons,
          evidence,
          discoveryMethod: candidate.discoveryMethod,
          framework: input.framework?.framework ?? input.project.framework?.primary ?? undefined,
          isPrimary: false,
          timestamp: new Date().toISOString(),
          schemaVersion: SCHEMA_VERSION,
          exists: candidate.exists,
          matchType: candidate.matchType,
          reason: reasons[0] ?? candidate.families[0]?.reason ?? '',
          relatedSelector: candidate.relatedSelector,
        });
        if (hints.length >= MAX_HINTS) break;
      }

      if (hints[0]) hints[0].isPrimary = true;

      this.cache.set(cacheKey, hints);
      this.hintsGenerated++;

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'SH_EVENT:HINTS_GENERATED',
        timestamp: new Date().toISOString(),
        version: SCHEMA_VERSION,
        source: 'source-hint-engine',
        correlationId: input.captureId ?? crypto.randomUUID(),
        payload: {
          hintCount: hints.length,
          primaryHint: hints[0]?.filePath ?? null,
          processingTimeMs: Math.round(performance.now() - startTime),
        },
      });

      return ok(hints);
    } catch (e) {
      if (e instanceof ScanBudgetExceededError) {
        this.hintsUnavailable++;
        return err(
          shError(
            'SH_BUDGET_EXCEEDED',
            'Source scan budget exceeded.',
            `Scan exceeded ${budget.maxFiles} files or ${budget.maxTimeMs}ms.`,
            'Source resolution is unavailable for this repository. Reduce repository size or wait for Phase 33 async scanning.',
          ),
        );
      }
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
    if (!hint.reasons || hint.reasons.length === 0) {
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
    lines.push(`- **Qualification:** ${hint.qualification ?? 'unknown'}`);
    lines.push(`- **Confidence:** ${(hint.confidence * 100).toFixed(1)}%`);
    lines.push(`- **Exists:** ${hint.exists ? 'Yes' : 'No'}`);
    lines.push(`- **Match Type:** ${hint.matchType}`);
    lines.push(`- **Discovery Method:** ${hint.discoveryMethod}`);
    if (hint.relatedSelector) lines.push(`- **Related Selector:** ${hint.relatedSelector}`);
    lines.push(`- **Primary Hint:** ${hint.isPrimary ? 'Yes' : 'No'}`);
    lines.push('');
    lines.push('### Why this file was suggested');
    lines.push('');
    for (const reason of hint.reasons) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
    lines.push('### Interpretation');
    const qualification = hint.qualification ?? 'weak';
    if (qualification === 'exact') {
      lines.push(
        'Direct, stable association between the target and this file (multiple independent signals agree).',
      );
    } else if (qualification === 'probable') {
      lines.push(
        'Independent evidence corroborates this file. Treat as the likely source, not proof.',
      );
    } else if (qualification === 'possible') {
      lines.push(
        'One moderate signal points here without corroboration. Treat as a suggestion only.',
      );
    } else {
      lines.push(
        'Weak evidence only. Do not treat this as the source without further investigation.',
      );
    }
    return ok(lines.join('\n'));
  }

  health(): HintEngineHealth {
    const total = this.hintsGenerated + this.hintsFailed + this.hintsUnavailable;
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

function evidenceTypeForFamily(family: EvidenceFamily): EvidenceType {
  switch (family) {
    case 'route-ownership':
      return 'route-match';
    case 'import-path':
      return 'import-graph-match';
    case 'stable-identifier':
      return 'testid-match';
    case 'usage-text':
      return 'text-content-match';
    case 'class-file':
      return 'class-name-match';
    case 'generic-class':
      return 'class-name-match';
    case 'component-ref':
      return 'component-name-match';
    case 'style-adjacent':
      return 'style-adjacent';
    default:
      return 'heuristic';
  }
}
