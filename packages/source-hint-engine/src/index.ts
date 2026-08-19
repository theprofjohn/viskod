import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EventBus } from '@viskod/event-bus';
import type { Result, ViskodError, WorkspaceMetadata } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';

import { mapWithConcurrency } from './async-pool';
import type { ImportGraphEntry } from './classifier';
import { MIN_CONFIDENCE, scoreEvidence } from './evidence';
import type { EvidenceFamily } from './evidence';
import type { FsActivity, FsActivitySnapshot } from './fs-activity';
import { FsActivity as FsActivityImpl } from './fs-activity';
import {
  DEFAULT_SCAN_CONCURRENCY,
  buildImportGraphAsync,
  buildLocalDependencyClosureAsync,
} from './import-graph';
import { LruCache } from './lru-cache';
import { ManifestCache, SourceFingerprintService } from './manifest-cache';
import { rankHints } from './ranking';
import {
  DEFAULT_SCAN_BUDGET,
  type ScanBudget,
  ScanBudgetExceededError,
  ScanCancelledError,
} from './scan-control';
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
  ScanCancelledError,
  DEFAULT_SCAN_BUDGET,
  DEFAULT_SCAN_CONCURRENCY,
} from './import-graph';
export type { ScanBudget } from './import-graph';
export { mapWithConcurrency } from './async-pool';
export {
  ManifestCache,
  SourceFingerprintService,
  MANIFEST_CACHE_MAX,
  MANIFEST_CACHE_TTL_MS,
} from './manifest-cache';
export type { ManifestCacheEntry, ManifestFileEntry } from './manifest-cache';
export { FsActivity } from './fs-activity';
export type { FsActivitySnapshot } from './fs-activity';
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
const HINT_CACHE_MAX = 500;
const HINT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const IMPORT_GRAPH_CACHE_MAX = 50;
const IMPORT_GRAPH_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
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

/** Resolve the full set of directories to scan, including workspace package sourceRoots. */
export function resolveWorkspaceDirs(baseDirs: string[], workspace?: WorkspaceMetadata): string[] {
  const dirs = [...baseDirs, ...USAGE_SITE_DIRS];
  if (workspace?.isWorkspace) {
    for (const pkg of workspace.packages) {
      for (const src of pkg.sourceRoots) {
        dirs.push(src);
      }
    }
  }
  return [...new Set(dirs)];
}

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

/** Safety: lexical and real-path containment inside the explicit project root. */
function isContainedPath(rootPath: string, candidatePath: string): boolean {
  try {
    const root = fs.realpathSync(rootPath);
    const candidate = fs.realpathSync(candidatePath);
    const relative = path.relative(root, candidate);
    return (
      relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  } catch {
    return false;
  }
}

function isSafeRelativePath(relPath: string): boolean {
  if (!relPath || path.posix.isAbsolute(relPath) || /^[A-Za-z]:[\\/]/.test(relPath)) return false;
  const normalized = path.posix.normalize(relPath);
  return normalized !== '..' && !normalized.startsWith('../');
}

function safePath(rootPath: string, relPath: string): string | null {
  if (!isSafeRelativePath(relPath)) return null;
  const candidate = path.resolve(rootPath, relPath.replace(/\\/g, path.sep));
  const relative = path.relative(path.resolve(rootPath), candidate);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    ? candidate
    : null;
}

function resolvePathWithCase(
  rootPath: string,
  relativePath: string,
): { resolved: string | null; matchType: 'exact' | 'case-insensitive' | null } {
  const full = safePath(rootPath, relativePath);
  if (!full) return { resolved: null, matchType: null };
  const parent = path.dirname(full);
  const targetBase = path.basename(full);
  if (!fs.existsSync(parent) || !isContainedPath(rootPath, parent))
    return { resolved: null, matchType: null };
  try {
    const entries = fs.readdirSync(parent);
    const normalizeForCompare = (s: string) => s.replace(/[^a-z0-9.]/gi, '').toLowerCase();
    const normalizedTarget = normalizeForCompare(targetBase);
    const ciMatch = entries.find((e) => normalizeForCompare(e) === normalizedTarget);
    if (!ciMatch) return { resolved: null, matchType: null };
    const resolved = path.join(parent, ciMatch);
    return isContainedPath(rootPath, resolved)
      ? { resolved, matchType: 'case-insensitive' }
      : { resolved: null, matchType: null };
  } catch {
    return { resolved: null, matchType: null };
  }
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

/**
 * Phase 33A: the cache key is fingerprint-scoped. The fingerprint comes from
 * the engine's `SourceFingerprintService` (manifest-validated, stat-only on
 * warm queries), so any source/config change rotates the key and every
 * resolution consumes ONE coherent repository generation.
 */
function buildCacheKey(fingerprint: string, input: HintInput): string {
  const rt = input.route;
  const dc = input.domContext;
  return `${fingerprint}:${rt.pathname}:${dc.tagName}:${dc.id ?? ''}:${dc.className ?? ''}:${dc.role ?? ''}:${dc.testId ?? ''}:${dc.text ?? ''}`;
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
]);

function extractTextWords(text: string): string[] {
  const words = text
    .split(/[\s\n]+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
    .filter(
      (word) => word.length >= 4 && !UTILITY_BLACKLIST.has(word) && Number.isNaN(Number(word)),
    );
  return [...new Set(words)];
}

interface FileSignals {
  matchedWords: string[];
  stableIdHits: string[];
  componentRefHits: string[];
}

interface ScanContext {
  files: number;
  startMs: number;
  budget: ScanBudget;
  /** Phase 33A: filesystem activity instrumentation (reads/parses/stats). */
  activity: FsActivity;
  /** Phase 33A: bounded parallelism for per-file work. */
  concurrency: number;
}

function touchScan(ctx: ScanContext): void {
  if (ctx.budget.signal?.aborted) throw new ScanCancelledError();
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

async function walkCodeFiles(
  rootPath: string,
  dir: string,
  ctx: ScanContext,
  collect: (relPath: string, fullPath: string) => void,
  depth = 0,
): Promise<void> {
  if (depth > 10) return;
  if (ctx.budget.signal?.aborted) throw new ScanCancelledError();
  const dirPath = path.join(rootPath, dir.replace(/\//g, path.sep));
  let items: fs.Dirent[];
  try {
    items = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  ctx.activity.record('readdir');
  items.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of items) {
    if (ctx.budget.signal?.aborted) throw new ScanCancelledError();
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name))
        await walkCodeFiles(rootPath, `${dir}/${entry.name}`, ctx, collect, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!EXTENSION_PATTERNS.includes(ext)) continue;
    touchScan(ctx);
    collect(`${dir}/${entry.name}`, fullPath);
  }
}

async function scanProjectFiles(
  input: HintInput,
  ctx: ScanContext,
): Promise<Map<string, FileSignals>> {
  const result = new Map<string, FileSignals>();
  const rootPath = input.project.metadata.rootPath;
  const dc = input.domContext;
  const textWords = extractTextWords(dc.text ?? '');
  const textPattern =
    textWords.length > 0
      ? new RegExp(`\\b(?:${textWords.map(escapeRegExp).join('|')})\\b`, 'gi')
      : null;
  const stableIds = [dc.id, dc.testId].filter((value): value is string =>
    Boolean(value && value.length >= 4 && !GENERIC_IDENTIFIERS.has(value.toLowerCase())),
  );
  const componentNames = extractComponentNames(input);

  // Phase 33A: enumerate first (budget-bounded), then process the collected
  // files with a bounded concurrency window — never unbounded Promise.all.
  const files: Array<{ relPath: string; fullPath: string }> = [];
  for (const dir of resolveWorkspaceDirs(
    input.project.componentIndex?.directories ?? [],
    input.project.workspace,
  )) {
    await walkCodeFiles(rootPath, dir, ctx, (relPath, fullPath) => {
      files.push({ relPath, fullPath });
    });
  }

  const processed = await mapWithConcurrency(
    files,
    ctx.concurrency,
    async ({ relPath, fullPath }): Promise<{ relPath: string; signals: FileSignals } | null> => {
      let content: string;
      try {
        content = await fs.promises.readFile(fullPath, 'utf-8');
      } catch {
        return null;
      }
      ctx.activity.record('contentRead');
      const matchedWords = textPattern
        ? [
            ...new Set(
              [...content.matchAll(textPattern)]
                .map((m) => (m[0] ?? '').toLowerCase())
                .filter((word) => textWords.includes(word)),
            ),
          ]
        : [];
      const stableIdHits = stableIds.filter(
        (s) =>
          content.includes(`id="${s}"`) ||
          content.includes(`id='${s}'`) ||
          content.includes(`data-testid="${s}"`) ||
          content.includes(`data-testid='${s}'`),
      );
      const componentRefHits = componentNames.filter((name) =>
        new RegExp(`\\b${escapeRegExp(name)}\\b`).test(content),
      );
      ctx.activity.record('contentParse');
      if (!matchedWords.length && !stableIdHits.length && !componentRefHits.length) return null;
      return { relPath, signals: { matchedWords, stableIdHits, componentRefHits } };
    },
    { signal: ctx.budget.signal },
  );
  for (const entry of processed) {
    if (entry) result.set(entry.relPath, entry.signals);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
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

async function collectCandidates(input: HintInput, ctx: ScanContext): Promise<CandidateEvidence[]> {
  const rootPath = input.project.metadata.rootPath;
  const dc = input.domContext;
  const matchedRoute = input.route.matchedRoute;
  const byPath = new Map<string, CandidateEvidence>();

  const add = (candidate: CandidateEvidence): void => {
    const candidatePath = safePath(rootPath, candidate.filePath);
    if (
      !candidatePath ||
      !fs.existsSync(candidatePath) ||
      !isContainedPath(rootPath, candidatePath)
    )
      return;
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

  // 1. Current rendered-route owners (strong). The route map may contain a
  // page and one or more layouts for the same pathname; retain all of them
  // as bounded candidates so shared-layout ambiguity remains honest.
  const routeCandidates = (
    input.route.matchedRoutes?.length
      ? input.route.matchedRoutes
      : matchedRoute
        ? [matchedRoute]
        : []
  ).filter((route) => route.type === 'page' || route.type === 'layout');

  for (const route of routeCandidates) {
    if (!isSafeRelativePath(route.file)) continue;
    add({
      filePath: route.file,
      exists: true,
      matchType: 'usage-site',
      discoveryMethod: 'route-correlation',
      isRouteFile: true,
      families: [
        {
          family: 'route-ownership',
          reason: `current route ${route.path ?? ''} maps to this ${route.type}`,
        },
      ],
    });
  }

  // 2. Bounded import-closure of each rendered current-route owner.
  // Traversal remains governed by the existing Phase 33 budget/signal.
  for (const route of routeCandidates) {
    if (!isSafeRelativePath(route.file)) continue;
    try {
      const closure = await buildLocalDependencyClosureAsync(rootPath, route.file, ctx.budget);
      for (const file of closure) {
        if (file === route.file || !isSafeRelativePath(file)) continue;
        add({
          filePath: file,
          exists: true,
          matchType: 'usage-site',
          discoveryMethod: 'import-graph',
          families: [
            {
              family: 'import-path',
              reason: `imported (directly or transitively) by current route ${route.path ?? ''}`,
            },
          ],
        });
      }
    } catch (error) {
      if (error instanceof ScanBudgetExceededError) throw error;
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
  const signals = await scanProjectFiles(input, ctx);

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
  private cache = new LruCache<string, SourceHint[]>(HINT_CACHE_MAX, HINT_CACHE_TTL_MS);
  private importGraphCache = new LruCache<string, ImportGraphEntry[]>(
    IMPORT_GRAPH_CACHE_MAX,
    IMPORT_GRAPH_CACHE_TTL_MS,
  );
  private hintsGenerated = 0;
  private hintsFailed = 0;
  private hintsUnavailable = 0;
  private processingTimes: number[] = [];
  private eventBus: EventBus;
  /** Phase 33A: filesystem read/parse instrumentation (engine-scoped). */
  private activity: FsActivity;
  /** Phase 33A: manifest-validated source fingerprint service (warm caches). */
  private fingerprintService: SourceFingerprintService;
  /** Phase 33A: scan generations — bumped on invalidation. */
  private generation = 0;
  /**
   * One resolution consumes one coherent generation: the fingerprint is
   * memoized per resolution so the hint key and the import-graph key observe
   * the SAME source snapshot.
   */
  private lastFingerprint: { root: string; dirsKey: string; value: string } | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.activity = new FsActivityImpl();
    this.fingerprintService = new SourceFingerprintService(new ManifestCache(), this.activity, {
      skipDirs: SKIP_DIRS,
      extensions: EXTENSION_PATTERNS,
    });
  }

  /** Phase 33A: current scan generation (bumped by invalidateCache). */
  get generationNumber(): number {
    return this.generation;
  }

  /** Phase 33A: filesystem activity counters since construction/last reset. */
  fsActivity(): FsActivitySnapshot {
    return this.activity.snapshot();
  }

  /** Phase 33A: reset the filesystem activity counters. */
  resetFsActivity(): void {
    this.activity.reset();
  }

  private async currentFingerprint(
    root: string,
    dirs: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const dirsKey = [...new Set(dirs)].sort().join(',');
    if (this.lastFingerprint?.root === root && this.lastFingerprint.dirsKey === dirsKey) {
      return this.lastFingerprint.value;
    }
    const value = await this.fingerprintService.getFingerprint(root, dirs, signal);
    this.lastFingerprint = { root, dirsKey, value };
    return value;
  }

  async resolveUsageSiteHints(
    input: HintInput,
    maxHints?: number,
    options?: {
      useImportGraph?: boolean;
      budget?: Partial<ScanBudget>;
      signal?: AbortSignal;
      concurrency?: number;
    },
  ): Promise<Result<RankingResult>> {
    const startTime = performance.now();

    try {
      // Generate base hints first
      const hintResult = await this.generateHints(input, {
        budget: options?.budget,
        signal: options?.signal,
        concurrency: options?.concurrency,
      });
      if (!hintResult.ok) {
        return ok({
          status: 'missing',
          resolution: 'unavailable',
          topHints: [],
          warnings: [hintResult.error.message],
        });
      }

      const hints = hintResult.value;

      // Build or retrieve import graph. Phase 33A: the graph key is scoped by
      // the source fingerprint, so a source/config change rotates the key and
      // the graph is rebuilt — the graph is always coherent with the hints.
      const rootPath = input.project.metadata.rootPath;
      // The graph scans the SAME dir set as the hint fingerprint (workspace
      // sourceRoots included), so the fingerprint memo serves both and one
      // resolution observes one coherent repository generation.
      const dirs = resolveWorkspaceDirs(
        input.project.componentIndex?.directories ?? [],
        input.project.workspace,
      );
      const budget = this.resolveBudget(options?.budget);
      if (options?.signal) budget.signal = options.signal;
      let importGraph: ImportGraphEntry[] | undefined = undefined;
      if (rootPath && dirs.length > 0 && options?.useImportGraph !== false) {
        const graphKey = `${await this.currentFingerprint(rootPath, dirs, budget.signal)}\u0000${rootPath}`;
        importGraph = this.importGraphCache.get(graphKey);
        if (!importGraph) {
          try {
            importGraph = await buildImportGraphAsync(rootPath, dirs, budget, {
              concurrency: options?.concurrency,
              activity: this.activity,
            });
            this.importGraphCache.set(graphKey, importGraph);
          } catch (error) {
            if (error instanceof ScanBudgetExceededError || error instanceof ScanCancelledError) {
              return ok({
                status: 'missing',
                resolution: 'unavailable',
                topHints: [],
                warnings:
                  error instanceof ScanCancelledError
                    ? ['Source scan cancelled — source resolution unavailable']
                    : ['Source scan budget exceeded — source resolution unavailable'],
              });
            }
            importGraph = undefined;
          }
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
    options?: { budget?: Partial<ScanBudget>; signal?: AbortSignal; concurrency?: number },
  ): Promise<Result<SourceHint[]>> {
    const startTime = performance.now();
    const budget = this.resolveBudget(options?.budget);
    if (options?.signal) budget.signal = options.signal;
    // Phase 33A: one resolution consumes one coherent repository generation.
    const startGeneration = this.generation;
    // The fingerprint memo is PER-RESOLUTION: cleared here so every
    // resolution revalidates the manifest (change detection), while the
    // hint-key and import-graph-key computations within THIS resolution share
    // one coherent fingerprint.
    this.lastFingerprint = null;

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

      const rootPath = input.project.metadata.rootPath;
      const dirs = resolveWorkspaceDirs(
        input.project.componentIndex?.directories ?? [],
        input.project.workspace,
      );
      const fingerprint = await this.currentFingerprint(rootPath, dirs, budget.signal);
      const cacheKey = buildCacheKey(fingerprint, input);
      const cached = this.cache.get(cacheKey);
      if (cached) return ok(cached);

      // Budget-bounded evidence collection (Phase 30 latency guard; Phase 33A
      // adds signal + bounded concurrency + fs instrumentation).
      const ctx: ScanContext = {
        files: 0,
        startMs: Date.now(),
        budget,
        activity: this.activity,
        concurrency: Math.max(1, Math.floor(options?.concurrency ?? DEFAULT_SCAN_CONCURRENCY)),
      };
      const candidates = await collectCandidates(input, ctx);

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

      // Phase 33A generation guard: an in-flight resolution that started
      // before an invalidation must never populate the NEW generation's
      // cache — old inventory is never combined with new metadata. The
      // computed result (coherent as of its start snapshot) is still
      // returned; the next query recomputes.
      if (this.generation === startGeneration) {
        this.cache.set(cacheKey, hints);
      }
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
      if (e instanceof ScanCancelledError) {
        this.hintsUnavailable++;
        return err(
          shError(
            'SH_SCAN_CANCELLED',
            'Source scan cancelled.',
            'The scan was aborted by its cancellation signal.',
            'Retry the source resolution; no partial inventory is cached.',
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
      importGraphCacheSize: this.importGraphCache.size,
      generation: this.generation,
      averageProcessingTimeMs: avgMs,
    };
  }

  async clearCache(): Promise<Result<void>> {
    this.cache.clear();
    this.importGraphCache.clear();
    this.fingerprintService.cacheClear();
    this.lastFingerprint = null;
    return ok(undefined);
  }

  /** Invalidate cached entries for a specific project root. */
  invalidateCache(rootPath: string): void {
    // Phase 33A generation bump: fingerprint/config invalidation moves
    // generation N → N+1. In-flight resolutions started at N may settle but
    // never commit into the new generation.
    void rootPath;
    this.generation++;
    // For hints: clear the entire hint cache when workspace changes — acceptable
    // because workspace changes are rare events.
    this.cache.clear();
    this.importGraphCache.clear();
    this.fingerprintService.cacheClear();
    this.lastFingerprint = null;
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
