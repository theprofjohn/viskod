import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import { BrowserRuntime } from './index';

describe('BrowserRuntime', () => {
  it('health returns unavailable with 0 uptime before launch', () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const health = br.health({ contextId: 'never-launched' });
    expect(health.status).toBe('unavailable');
    expect(health.uptime).toBe(0);
    expect(health.pageCount).toBe(0);
  });

  it('getDOMSnapshot returns error for invalid handle', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const result = await br.getDOMSnapshot({ contextId: 'invalid' }, '.foo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Handle not found');
  });

  it('getElementHierarchy returns error for invalid handle', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const result = await br.getElementHierarchy({ contextId: 'invalid' }, '.foo');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Handle not found');
  });

  it('captureScreenshot returns error for invalid handle', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const result = await br.captureScreenshot({ contextId: 'invalid' }, 'viewport');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('Handle not found');
  });

  it('shutdown returns error for invalid handle', async () => {
    const bus = new EventBus();
    const br = new BrowserRuntime(bus);
    const result = await br.shutdown({ contextId: 'invalid' });
    expect(result.ok).toBe(false);
  });
});
