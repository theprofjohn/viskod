import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import { SourceHintEngine } from './index';
import { LruCache } from './lru-cache';
import { ManifestCache } from './manifest-cache';
import { createWorkspaceFixture, hintInputFor } from './workspace-fixture';
import type { WorkspaceFixture } from './workspace-fixture';

/**
 * Phase 33A — cache capacity contract.
 *
 * Every repository/source cache must stay within its configured bound even
 * when capacity is exceeded:
 * - hint cache (LruCache, 500 entries, 5 min TTL)
 * - import graph cache (LruCache, 50 entries, 10 min TTL)
 * - manifest/fingerprint cache (ManifestCache, 20 entries, 10 min TTL)
 */
describe('cache bounds (capacity proof)', () => {
  it('LruCache never grows beyond its configured maxSize', () => {
    const max = 5;
    const cache = new LruCache<string, number>(max, 60_000);
    for (let i = 0; i < 100; i++) cache.set(`key-${i}`, i);
    expect(cache.size).toBe(max);
    // The most recently inserted entries survive.
    expect(cache.get('key-99')).toBe(99);
    expect(cache.get('key-0')).toBeUndefined();
  });

  it('LruCache evicts oldest entries first (LRU order)', () => {
    const cache = new LruCache<string, number>(3, 60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Touch 'a' so it becomes most-recent; then overflow evicts 'b'.
    expect(cache.get('a')).toBe(1);
    cache.set('d', 4);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
    expect(cache.size).toBe(3);
  });

  it('LruCache enforces TTL expiration', () => {
    const cache = new LruCache<string, number>(10, 50);
    cache.set('a', 1);
    // Bypass real waiting: expire by backdating through a second cache with
    // negative TTL — entries are expired on access.
    const expired = new LruCache<string, number>(10, -1);
    expired.set('a', 1);
    expect(expired.get('a')).toBeUndefined();
    expect(expired.size).toBe(0);
  });

  it('hint cache cannot grow beyond HINT_CACHE_MAX (500)', async () => {
    // Exceeding capacity requires > 500 distinct cache keys. The key embeds
    // the DOM context, so distinct ids rotate keys without file edits —
    // keeping each resolution small (small fixture) and the test fast.
    const fixture: WorkspaceFixture | null = createWorkspaceFixture({ fileCount: 20, seed: 21 });
    const engine = new SourceHintEngine(new EventBus());
    const max = 500;

    for (let i = 0; i < max + 10; i++) {
      const result = await engine.generateHints(hintInputFor(fixture, { id: `bound-target-${i}` }));
      expect(result.ok).toBe(true);
    }
    expect(engine.health().cacheSize).toBeLessThanOrEqual(max);
    fixture.cleanup();
  }, 30000);

  it('import graph cache cannot grow beyond IMPORT_GRAPH_CACHE_MAX (50)', async () => {
    const fixture = createWorkspaceFixture({ fileCount: 60, seed: 22 });
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture, { id: 'graph-bound-target' });
    const { writeFileSync } = await import('node:fs');

    // Each fingerprint rotation produces a NEW import-graph cache entry.
    for (let i = 0; i < 70; i++) {
      writeFileSync(fixture.targetAbsolute, `// graph iteration ${i} — rotate\n`, 'utf-8');
      await engine.resolveUsageSiteHints(input, 10, { useImportGraph: true });
    }
    expect(engine.health().importGraphCacheSize).toBeLessThanOrEqual(50);
    fixture.cleanup();
  });

  it('manifest cache cannot grow beyond MANIFEST_CACHE_MAX (20)', async () => {
    const cache = new ManifestCache();
    const max = cache.maxEntries;
    for (let i = 0; i < max + 25; i++) {
      cache.set(`root-${i}\u0000dirs-a,b`, {
        fingerprint: `fp-${i}`,
        manifest: new Map(),
        config: { packageJson: null, workspaceYaml: null },
        builtAt: Date.now(),
      });
    }
    expect(cache.size).toBeLessThanOrEqual(max);
    // The newest entry survives, the oldest was evicted.
    const newest = cache.get(`root-${max + 24}\u0000dirs-a,b`);
    expect(newest?.fingerprint).toBe(`fp-${max + 24}`);
    expect(cache.get('root-0\u0000dirs-a,b')).toBeUndefined();
  });

  it('clearCache empties every cache', async () => {
    const fixture = createWorkspaceFixture({ fileCount: 40, seed: 23 });
    const engine = new SourceHintEngine(new EventBus());
    const input = hintInputFor(fixture, { id: 'clear-target' });
    await engine.resolveUsageSiteHints(input, 10, { useImportGraph: true });
    expect(engine.health().cacheSize).toBeGreaterThan(0);
    await engine.clearCache();
    expect(engine.health().cacheSize).toBe(0);
    expect(engine.health().importGraphCacheSize).toBe(0);
    fixture.cleanup();
  });
});
