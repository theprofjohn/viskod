import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './index';

describe('EventBus', () => {
  it('publishes events to matching subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('test:event', handler);
    bus.publish({
      eventId: '1',
      eventType: 'test:event',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c1',
      payload: {},
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not deliver to non-matching subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('other:event', handler);
    bus.publish({
      eventId: '2',
      eventType: 'test:event',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c2',
      payload: {},
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe removes handler', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const sub = bus.subscribe('test:event', handler);
    if (sub.ok) bus.unsubscribe(sub.value.id);
    bus.publish({
      eventId: '3',
      eventType: 'test:event',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c3',
      payload: {},
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('once option auto-unsubscribes', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('test:event', handler, { once: true });
    bus.publish({
      eventId: '4',
      eventType: 'test:event',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c4',
      payload: {},
    });
    bus.publish({
      eventId: '5',
      eventType: 'test:event',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c5',
      payload: {},
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('filters events when filter provided', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('test:event', handler, { filter: (e) => (e.payload as { n: number }).n > 5 });
    bus.publish({
      eventId: '6',
      eventType: 'test:event',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c6',
      payload: { n: 3 },
    });
    bus.publish({
      eventId: '7',
      eventType: 'test:event',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c7',
      payload: { n: 10 },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('getDiagnostics returns stats', () => {
    const bus = new EventBus();
    bus.subscribe('test:event', vi.fn());
    bus.publish({
      eventId: '8',
      eventType: 'test:event',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c8',
      payload: {},
    });
    const diag = bus.getDiagnostics();
    expect(diag.totalPublished).toBe(1);
    expect(diag.totalDelivered).toBe(1);
  });

  it('subscriber error does not crash bus', () => {
    const bus = new EventBus();
    const goodHandler = vi.fn();
    const badHandler = vi.fn(() => {
      throw new Error('boom');
    });
    bus.subscribe('test:event', badHandler);
    bus.subscribe('test:event', goodHandler);
    bus.publish({
      eventId: '9',
      eventType: 'test:event',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c9',
      payload: {},
    });
    expect(goodHandler).toHaveBeenCalled();
  });

  it('delivers events to all subscribers', () => {
    const bus = new EventBus();
    const received: string[] = [];
    void bus.subscribe('test:multi', () => {
      received.push('a');
    });
    void bus.subscribe('test:multi', () => {
      received.push('b');
    });
    bus.publish({
      eventId: 'e1',
      eventType: 'test:multi',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c1',
      payload: {},
    });
    expect(received).toEqual(['a', 'b']);
  });

  it('does not deliver to unsubscribed handlers', () => {
    const bus = new EventBus();
    const received: string[] = [];
    const result = bus.subscribe('test:unsub', () => {
      received.push('x');
    });
    if (result.ok) bus.unsubscribe(result.value.id);
    bus.publish({
      eventId: 'e2',
      eventType: 'test:unsub',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'test',
      correlationId: 'c2',
      payload: {},
    });
    expect(received).toEqual([]);
  });

  it('respects history limit', () => {
    const bus = new EventBus({ enableHistory: true, historySize: 2 });
    for (let i = 0; i < 5; i++) {
      bus.publish({
        eventId: `e${i}`,
        eventType: 'test:hist',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'test',
        correlationId: `c${i}`,
        payload: {},
      });
    }
    const history = (bus as unknown as { history: Array<unknown> }).history;
    expect(history.length).toBe(2);
  });

  it('rejects invalid event payload', () => {
    const bus = new EventBus();
    expect(() => bus.publish(null as never)).toThrow();
  });

  it('history is disabled by default', () => {
    const bus = new EventBus();
    const history = (bus as unknown as { history: Array<unknown> }).history;
    expect(history.length).toBe(0);
  });
});
