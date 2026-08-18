import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FsActivity } from './fs-activity';
import { ScanCancelledError } from './scan-control';

/**
 * Phase 33A — source fingerprint manifest cache.
 *
 * Contract (documented in the Phase 33A report):
 * - key: `${rootPath}\u0000${sorted scanned dirs joined by ','}`
 * - max entries: `MANIFEST_CACHE_MAX` (20) — LRU eviction, proven bounded by test
 * - TTL: `MANIFEST_CACHE_TTL_MS` (10 min) — expired entries are REVALIDATED
 *   against the filesystem before reuse (validation is authoritative and
 *   cheap: stat-only, zero content reads); rebuilt only when changed
 * - invalidation trigger: any source/config file change detected by the
 *   validation walk (size/mtimeMs mismatch, add, delete), or engine
 *   `invalidateCache(rootPath)`
 * - lifecycle/root scope: per `SourceHintEngine` instance, scoped to a
 *   project root + scanned dir set
 *
 * The manifest stores size+mtimeMs per code file plus the config files
 * (package.json, pnpm-workspace.yaml). Reuse validates the manifest with a
 * stat-only walk — never reading file content — so a warm query performs zero
 * content reads/parses. Content edits, additions, deletions, and config
 * changes all change size/mtimeMs and therefore force a rebuild.
 */

export interface ManifestFileEntry {
  size: number;
  mtimeMs: number;
}

export interface ManifestCacheEntry {
  fingerprint: string;
  manifest: Map<string, ManifestFileEntry>;
  /** Config file stats at build time (null when the file is absent). */
  config: {
    packageJson: ManifestFileEntry | null;
    workspaceYaml: ManifestFileEntry | null;
  };
  builtAt: number;
}

export const MANIFEST_CACHE_MAX = 20;
export const MANIFEST_CACHE_TTL_MS = 10 * 60 * 1000;

interface ManifestCacheRecord extends ManifestCacheEntry {
  expiresAt: number;
}

export class ManifestCache {
  private records = new Map<string, ManifestCacheRecord>();
  readonly maxEntries = MANIFEST_CACHE_MAX;
  readonly ttlMs = MANIFEST_CACHE_TTL_MS;

  get(key: string): ManifestCacheEntry | undefined {
    const record = this.records.get(key);
    if (!record) return undefined;
    if (Date.now() > record.expiresAt) {
      // Expired: caller revalidates against the filesystem; the record stays
      // until validation decides (reuse refreshes, mismatch rebuilds).
      return { ...record, builtAt: record.builtAt };
    }
    // LRU touch.
    this.records.delete(key);
    this.records.set(key, record);
    return { ...record, builtAt: record.builtAt };
  }

  touch(key: string): void {
    const record = this.records.get(key);
    if (!record) return;
    record.expiresAt = Date.now() + this.ttlMs;
    this.records.delete(key);
    this.records.set(key, record);
  }

  set(key: string, entry: ManifestCacheEntry): void {
    this.records.delete(key);
    this.records.set(key, { ...entry, expiresAt: Date.now() + this.ttlMs });
    while (this.records.size > this.maxEntries) {
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
  }

  delete(key: string): boolean {
    return this.records.delete(key);
  }

  clear(): void {
    this.records.clear();
  }

  get size(): number {
    return this.records.size;
  }
}

const CONFIG_FILES = ['package.json', 'pnpm-workspace.yaml'] as const;

/**
 * Fingerprint service: returns the deterministic source fingerprint for a
 * root + dir set, reusing the manifest cache when the filesystem is
 * unchanged. All filesystem access is recorded in `activity` so tests can
 * prove warm-cache read counts.
 */
export class SourceFingerprintService {
  private readonly cache: ManifestCache;
  private readonly activity: FsActivity;
  private readonly skipDirs: ReadonlySet<string>;
  private readonly extensions: readonly string[];
  private readonly maxDepth: number;

  constructor(
    cache: ManifestCache,
    activity: FsActivity,
    options: { skipDirs: ReadonlySet<string>; extensions: readonly string[]; maxDepth?: number },
  ) {
    this.cache = cache;
    this.activity = activity;
    this.skipDirs = options.skipDirs;
    this.extensions = options.extensions;
    this.maxDepth = options.maxDepth ?? 12;
  }

  cacheKey(rootPath: string, dirs: readonly string[]): string {
    return `${rootPath}\u0000${[...new Set(dirs)].sort().join(',')}`;
  }

  /** Clear every cached manifest/fingerprint (full invalidation). */
  cacheClear(): void {
    this.cache.clear();
  }

  async getFingerprint(
    rootPath: string,
    dirs: readonly string[],
    signal?: AbortSignal,
  ): Promise<string> {
    const key = this.cacheKey(rootPath, dirs);
    const config = await this.statConfig(rootPath, signal);
    const cached = this.cache.get(key);
    if (cached && this.configMatches(cached.config, config)) {
      const valid = await this.manifestMatches(rootPath, dirs, cached.manifest, signal);
      if (valid) {
        this.cache.touch(key);
        return cached.fingerprint;
      }
    }
    const built = await this.buildManifest(rootPath, dirs, config, signal);
    this.cache.set(key, built);
    return built.fingerprint;
  }

  private async statConfig(
    rootPath: string,
    signal?: AbortSignal,
  ): Promise<ManifestCacheEntry['config']> {
    const result: ManifestCacheEntry['config'] = { packageJson: null, workspaceYaml: null };
    for (const name of CONFIG_FILES) {
      if (signal?.aborted) throw new ScanCancelledError();
      try {
        const info = await fs.promises.stat(path.join(rootPath, name));
        this.activity.record('stat');
        result[name === 'package.json' ? 'packageJson' : 'workspaceYaml'] = {
          size: info.size,
          mtimeMs: info.mtimeMs,
        };
      } catch {
        result[name === 'package.json' ? 'packageJson' : 'workspaceYaml'] = null;
      }
    }
    return result;
  }

  private configMatches(a: ManifestCacheEntry['config'], b: ManifestCacheEntry['config']): boolean {
    const same = (x: ManifestFileEntry | null, y: ManifestFileEntry | null): boolean =>
      (x === null && y === null) ||
      (x !== null && y !== null && x.size === y.size && x.mtimeMs === y.mtimeMs);
    return same(a.packageJson, b.packageJson) && same(a.workspaceYaml, b.workspaceYaml);
  }

  /**
   * Stat-only validation walk: readdir + per-file stat, compare against the
   * cached manifest. Never reads content. Early-exits on the first mismatch.
   *
   * A directory that does NOT exist is fine — the scanned dir set may include
   * optional/usage dirs; the final manifest-size check catches entries that
   * disappeared under previously-existing dirs.
   */
  private async manifestMatches(
    rootPath: string,
    dirs: readonly string[],
    manifest: Map<string, ManifestFileEntry>,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const seen = new Set<string>();
    const walk = async (dirAbs: string, depth: number): Promise<boolean> => {
      if (depth > this.maxDepth) return true;
      if (signal?.aborted) throw new ScanCancelledError();
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
      } catch {
        // Missing/unreadable directory contributes no files — treat as valid;
        // the global seen-vs-manifest size check catches disappeared files.
        return true;
      }
      this.activity.record('readdir');
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (signal?.aborted) throw new ScanCancelledError();
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dirAbs, entry.name);
        if (entry.isDirectory()) {
          if (!this.skipDirs.has(entry.name)) {
            const ok = await walk(full, depth + 1);
            if (!ok) return false;
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!this.extensions.includes(ext)) continue;
        const rel = path.relative(rootPath, full).replace(/\\/g, '/');
        seen.add(rel);
        let info: fs.Stats;
        try {
          info = await fs.promises.stat(full);
        } catch {
          return false;
        }
        this.activity.record('stat');
        const cached = manifest.get(rel);
        if (!cached || cached.size !== info.size || cached.mtimeMs !== info.mtimeMs) return false;
      }
      return true;
    };

    for (const dir of dirs) {
      const dirAbs = path.resolve(rootPath, dir.replace(/\//g, path.sep));
      const ok = await walk(dirAbs, 0);
      if (!ok) return false;
    }
    // Every manifest entry must still exist.
    if (seen.size !== manifest.size) return false;
    return true;
  }

  /** Full walk: builds the manifest and the deterministic fingerprint. */
  private async buildManifest(
    rootPath: string,
    dirs: readonly string[],
    config: ManifestCacheEntry['config'],
    signal?: AbortSignal,
  ): Promise<ManifestCacheEntry> {
    const manifest = new Map<string, ManifestFileEntry>();
    const fingerprintParts: string[] = [];
    const walk = async (dirAbs: string, depth: number): Promise<void> => {
      if (depth > this.maxDepth) return;
      if (signal?.aborted) throw new ScanCancelledError();
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
      } catch {
        return;
      }
      this.activity.record('readdir');
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (signal?.aborted) throw new ScanCancelledError();
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dirAbs, entry.name);
        if (entry.isDirectory()) {
          if (!this.skipDirs.has(entry.name)) await walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!this.extensions.includes(ext)) continue;
        const rel = path.relative(rootPath, full).replace(/\\/g, '/');
        try {
          const info = await fs.promises.stat(full);
          this.activity.record('stat');
          manifest.set(rel, { size: info.size, mtimeMs: info.mtimeMs });
          fingerprintParts.push(`${rel}:${info.size}:${info.mtimeMs}`);
        } catch {
          // A concurrent deletion simply changes the next fingerprint.
        }
      }
    };

    for (const dir of dirs) {
      await walk(path.resolve(rootPath, dir.replace(/\//g, path.sep)), 0);
    }
    for (const [name, entry] of [
      ['package.json', config.packageJson],
      ['pnpm-workspace.yaml', config.workspaceYaml],
    ] as const) {
      fingerprintParts.push(entry ? `${name}:${entry.size}:${entry.mtimeMs}` : `${name}:missing`);
    }
    return {
      fingerprint: djb2(fingerprintParts.sort().join('|')),
      manifest,
      config,
      builtAt: Date.now(),
    };
  }
}

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}
