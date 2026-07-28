import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import { SelectionEngine } from './index';
import type { SelectionTarget } from './index';

describe('SelectionEngine', () => {
  it('resolves a valid target from overlay source', async () => {
    const bus = new EventBus();
    const engine = new SelectionEngine(bus);
    const result = await engine.resolveTarget({
      selector: '.my-button',
      boundingBox: { x: 10, y: 20, width: 100, height: 40 },
      source: 'overlay',
      timestamp: new Date().toISOString(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selector).toBe('.my-button');
      expect(result.value.source).toBe('overlay');
      expect(result.value.boundingBox.x).toBe(10);
    }
  });

  it('rejects unknown source', async () => {
    const bus = new EventBus();
    const engine = new SelectionEngine(bus);
    const result = await engine.resolveTarget({
      selector: '.btn',
      boundingBox: { x: 0, y: 0, width: 0, height: 0 },
      source: 'invalid-source' as SelectionTarget['source'],
      timestamp: new Date().toISOString(),
    });
    expect(result.ok).toBe(false);
  });

  it('validates selection and produces snapshot', async () => {
    const bus = new EventBus();
    const engine = new SelectionEngine(bus);
    const target: SelectionTarget = {
      selector: '.header',
      boundingBox: { x: 0, y: 0, width: 800, height: 60 },
      source: 'studio',
    };
    const result = await engine.validateSelection(target);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.selectionId).toBeTruthy();
      expect(result.value.target.selector).toBe('.header');
      expect(result.value.hierarchy.selectedNode).toBeDefined();
      expect(result.value.geometry.boundingBox.width).toBe(800);
      expect(result.value.visibility.visible).toBe(true);
      expect(result.value.accessibility).toBeDefined();
      expect(result.value.schemaVersion).toBe('1.0.0');
    }
  });

  it('clears selection and resets state', async () => {
    const bus = new EventBus();
    const engine = new SelectionEngine(bus);
    await engine.resolveTarget({
      selector: '.btn',
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      source: 'mcp',
      timestamp: new Date().toISOString(),
    });
    const result = await engine.clearSelection();
    expect(result.ok).toBe(true);
    const health = engine.health();
    expect(health.activeSelection).toBe(false);
  });

  it('reports health with counters', () => {
    const bus = new EventBus();
    const engine = new SelectionEngine(bus);
    const health = engine.health();
    expect(health.status).toBe('healthy');
    expect(health.selectionsProcessed).toBe(0);
    expect(health.selectionsFailed).toBe(0);
    expect(health.averageProcessingTimeMs).toBe(0);
  });

  it('builds hierarchy with landmarks', async () => {
    const bus = new EventBus();
    const engine = new SelectionEngine(bus);
    const target: SelectionTarget = {
      selector: '#main-content',
      boundingBox: { x: 0, y: 0, width: 600, height: 400 },
      source: 'studio',
    };
    const result = await engine.buildHierarchy(target);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.landmarks.length).toBeGreaterThan(0);
      expect(result.value.selectedNode.attributes['data-selector']).toBe('#main-content');
    }
  });
});
