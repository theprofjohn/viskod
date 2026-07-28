import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import { PluginSystem } from './index';
import type { PluginManifest } from './index';

describe('PluginSystem', () => {
  const sampleManifest: PluginManifest = {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin',
    main: './index.js',
    permissions: ['browser:launch'],
    capabilities: [{ type: 'tool', id: 'test-tool', description: 'A test tool' }],
  };

  it('registers a plugin', () => {
    const bus = new EventBus();
    const ps = new PluginSystem(bus);
    const instance = ps.register(sampleManifest);
    expect(instance.id).toBeTruthy();
    expect(instance.status).toBe('registered');
    expect(instance.manifest.name).toBe('test-plugin');
  });

  it('prevents duplicate registration', () => {
    const ps = new PluginSystem();
    ps.register(sampleManifest);
    expect(() => ps.register(sampleManifest)).toThrow('already registered');
  });

  it('activates a registered plugin', () => {
    const ps = new PluginSystem();
    ps.register(sampleManifest);
    const activated = ps.activate('test-plugin');
    expect(activated.status).toBe('active');
    expect(activated.activatedAt).toBeTruthy();
  });

  it('deactivates an active plugin', () => {
    const ps = new PluginSystem();
    ps.register(sampleManifest);
    ps.activate('test-plugin');
    const deactivated = ps.deactivate('test-plugin');
    expect(deactivated.status).toBe('registered');
  });

  it('unregisters a plugin', () => {
    const ps = new PluginSystem();
    ps.register(sampleManifest);
    ps.unregister('test-plugin');
    expect(ps.get('test-plugin')).toBeUndefined();
  });

  it('lists plugins by status', () => {
    const ps = new PluginSystem();
    const m2: PluginManifest = { ...sampleManifest, name: 'plugin-2' };
    ps.register(sampleManifest);
    ps.register(m2);
    ps.activate('test-plugin');
    expect(ps.list('active').length).toBe(1);
    expect(ps.list('registered').length).toBe(1);
    expect(ps.list().length).toBe(2);
  });

  it('throws on unknown plugin operations', () => {
    const ps = new PluginSystem();
    expect(() => ps.activate('unknown')).toThrow('not found');
    expect(() => ps.deactivate('unknown')).toThrow('not found');
    expect(() => ps.unregister('unknown')).toThrow('not found');
  });

  it('registers and executes hooks', async () => {
    const ps = new PluginSystem();
    const results: string[] = [];
    ps.registerHook('onCapture', async () => {
      results.push('hook1');
    });
    ps.registerHook('onCapture', async () => {
      results.push('hook2');
    });
    await ps.executeHook('onCapture', {
      eventBus: new EventBus(),
      config: {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(results).toEqual(['hook1', 'hook2']);
  });

  it('handles hook errors gracefully', async () => {
    const ps = new PluginSystem();
    const errors: string[] = [];
    ps.registerHook('badHook', async () => {
      throw new Error('hook crash');
    });
    await ps.executeHook('badHook', {
      eventBus: new EventBus(),
      config: {},
      logger: { info: () => {}, warn: () => {}, error: (msg) => errors.push(msg) },
    });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('hook crash');
  });

  it('reports health with counters', () => {
    const ps = new PluginSystem();
    ps.register(sampleManifest);
    ps.register({ ...sampleManifest, name: 'p2' });
    ps.activate('test-plugin');
    const h = ps.health();
    expect(h.totalPlugins).toBe(2);
    expect(h.activePlugins).toBe(1);
    expect(h.failedPlugins).toBe(0);
    expect(h.status).toBe('healthy');
  });

  it('returns empty hooks for unknown hook name', () => {
    const ps = new PluginSystem();
    expect(ps.getRegisteredHooks('nonexistent')).toEqual([]);
  });

  it('works without EventBus', () => {
    const ps = new PluginSystem();
    const instance = ps.register(sampleManifest);
    expect(instance.status).toBe('registered');
    ps.activate('test-plugin');
    expect(ps.get('test-plugin')?.status).toBe('active');
  });
});
