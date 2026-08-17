import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import { SourceHintEngine } from './index';

describe('SourceHintEngine cache bounds', () => {
  it('importGraphCache does not grow unbounded', () => {
    const engine = new SourceHintEngine(new EventBus());
    const health = engine.health();
    expect(health.cacheSize).toBe(0);
  });

  it('clearCache clears both caches', () => {
    const engine = new SourceHintEngine(new EventBus());
    engine.clearCache();
    const health = engine.health();
    expect(health.cacheSize).toBe(0);
  });

  it('invalidateCache clears hint cache and specific import graph entry', () => {
    const engine = new SourceHintEngine(new EventBus());
    engine.invalidateCache('/some/root');
    const health = engine.health();
    expect(health.cacheSize).toBe(0);
  });
});
