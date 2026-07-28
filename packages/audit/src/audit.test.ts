import { describe, expect, it } from 'vitest';
import { AuditEngine } from './index';

describe('AuditEngine', () => {
  it('logs an audit entry', () => {
    const engine = new AuditEngine();
    const entry = engine.log({
      actor: 'user-1',
      action: 'capture',
      subsystem: 'browser-runtime',
      detail: 'Screenshot captured',
      status: 'success',
      correlationId: 'corr-1',
    });
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeTruthy();
    expect(entry.actor).toBe('user-1');
    expect(entry.action).toBe('capture');
    expect(entry.status).toBe('success');
  });

  it('enforces max entries', () => {
    const engine = new AuditEngine(10);
    for (let i = 0; i < 20; i++) {
      engine.log({
        actor: 'user',
        action: 'scan',
        subsystem: 'ps',
        detail: `s${i}`,
        status: 'success',
      });
    }
    const all = engine.query({ limit: 100 });
    expect(all.length).toBe(10);
  });

  it('queries by actor', () => {
    const engine = new AuditEngine();
    engine.log({
      actor: 'alice',
      action: 'capture',
      subsystem: 'br',
      detail: 'a',
      status: 'success',
    });
    engine.log({ actor: 'bob', action: 'scan', subsystem: 'ps', detail: 'b', status: 'success' });
    expect(engine.query({ actor: 'alice' }).length).toBe(1);
  });

  it('queries by action', () => {
    const engine = new AuditEngine();
    engine.log({ actor: 'u1', action: 'capture', subsystem: 'br', detail: 'c', status: 'success' });
    engine.log({ actor: 'u1', action: 'scan', subsystem: 'ps', detail: 's', status: 'failure' });
    expect(engine.query({ action: 'scan' }).length).toBe(1);
  });

  it('queries by status', () => {
    const engine = new AuditEngine();
    engine.log({
      actor: 'u1',
      action: 'capture',
      subsystem: 'br',
      detail: 'ok',
      status: 'success',
    });
    engine.log({
      actor: 'u1',
      action: 'capture',
      subsystem: 'br',
      detail: 'fail',
      status: 'failure',
    });
    expect(engine.query({ status: 'failure' }).length).toBe(1);
  });

  it('queries by correlationId', () => {
    const engine = new AuditEngine();
    engine.log({
      actor: 'u1',
      action: 'capture',
      subsystem: 'br',
      detail: 'a',
      status: 'success',
      correlationId: 'abc',
    });
    engine.log({
      actor: 'u2',
      action: 'scan',
      subsystem: 'ps',
      detail: 'b',
      status: 'success',
      correlationId: 'abc',
    });
    expect(engine.getByCorrelationId('abc').length).toBe(2);
  });

  it('gets recent actions within time window', () => {
    const engine = new AuditEngine();
    engine.log({
      actor: 'u1',
      action: 'capture',
      subsystem: 'br',
      detail: 'ok',
      status: 'success',
    });
    expect(engine.getRecentActions(60).length).toBe(1);
  });

  it('gets failures', () => {
    const engine = new AuditEngine();
    engine.log({
      actor: 'u1',
      action: 'capture',
      subsystem: 'br',
      detail: 'ok',
      status: 'success',
    });
    engine.log({ actor: 'u1', action: 'scan', subsystem: 'ps', detail: 'fail', status: 'failure' });
    expect(engine.getFailures().length).toBe(1);
  });

  it('clears all entries', () => {
    const engine = new AuditEngine();
    engine.log({
      actor: 'u1',
      action: 'capture',
      subsystem: 'br',
      detail: 'ok',
      status: 'success',
    });
    engine.clear();
    expect(engine.query().length).toBe(0);
  });

  it('reports health with dates', () => {
    const engine = new AuditEngine();
    engine.log({ actor: 'u1', action: 'scan', subsystem: 'ps', detail: 'ok', status: 'success' });
    const h = engine.health();
    expect(h.totalEntries).toBe(1);
    expect(h.newestEntry).toBeTruthy();
    expect(h.oldestEntry).toBeTruthy();
    expect(h.status).toBe('healthy');
  });

  it('health returns null dates when empty', () => {
    const engine = new AuditEngine();
    const h = engine.health();
    expect(h.totalEntries).toBe(0);
    expect(h.oldestEntry).toBeNull();
    expect(h.newestEntry).toBeNull();
  });

  it('query respects limit', () => {
    const engine = new AuditEngine();
    for (let i = 0; i < 10; i++) {
      engine.log({
        actor: 'u',
        action: 'scan',
        subsystem: 'ps',
        detail: `s${i}`,
        status: 'success',
      });
    }
    expect(engine.query({ limit: 3 }).length).toBe(3);
  });
});
