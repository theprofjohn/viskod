import { describe, expect, it } from 'vitest';
import { DiagnosticsEngine } from './index';

describe('DiagnosticsEngine', () => {
  it('records a diagnostic entry', () => {
    const engine = new DiagnosticsEngine();
    const record = engine.record({
      subsystem: 'browser-runtime',
      level: 'warning',
      code: 'BR_TIMEOUT',
      message: 'Navigation timed out',
    });
    expect(record.id).toBeTruthy();
    expect(record.timestamp).toBeTruthy();
    expect(record.subsystem).toBe('browser-runtime');
    expect(record.level).toBe('warning');
  });

  it('enforces max records limit', () => {
    const engine = new DiagnosticsEngine(10);
    for (let i = 0; i < 20; i++) {
      engine.record({ subsystem: 'test', level: 'info', code: 'T001', message: `msg ${i}` });
    }
    expect(engine.getRecentRecords(50).length).toBe(10);
  });

  it('registers and queries subsystems', () => {
    const engine = new DiagnosticsEngine();
    engine.registerSubsystem({
      name: 'browser-runtime',
      status: 'healthy',
      metrics: { uptime: 3600 },
    });
    const sub = engine.getSubsystem('browser-runtime');
    expect(sub?.status).toBe('healthy');
    expect(sub?.metrics.uptime).toBe(3600);
  });

  it('updates subsystem health', () => {
    const engine = new DiagnosticsEngine();
    engine.registerSubsystem({ name: 'vce', status: 'healthy', metrics: { packets: 0 } });
    engine.updateSubsystem('vce', { status: 'degraded', metrics: { packets: 5 } });
    const sub = engine.getSubsystem('vce');
    expect(sub?.status).toBe('degraded');
    expect(sub?.metrics.packets).toBe(5);
  });

  it('filters records by subsystem', () => {
    const engine = new DiagnosticsEngine();
    engine.record({ subsystem: 'br', level: 'info', code: 'B1', message: 'started' });
    engine.record({ subsystem: 'vce', level: 'error', code: 'V1', message: 'failed' });
    engine.record({ subsystem: 'br', level: 'warning', code: 'B2', message: 'slow' });
    expect(engine.getRecordsBySubsystem('br').length).toBe(2);
    expect(engine.getRecordsBySubsystem('vce').length).toBe(1);
  });

  it('gets errors only', () => {
    const engine = new DiagnosticsEngine();
    engine.record({ subsystem: 'test', level: 'info', code: 'T1', message: 'ok' });
    engine.record({ subsystem: 'test', level: 'error', code: 'T2', message: 'fail' });
    engine.record({ subsystem: 'test', level: 'critical', code: 'T3', message: 'crash' });
    expect(engine.getErrors().length).toBe(2);
  });

  it('generates health report', () => {
    const engine = new DiagnosticsEngine();
    engine.registerSubsystem({ name: 'br', status: 'healthy', metrics: {} });
    engine.registerSubsystem({ name: 'vce', status: 'degraded', metrics: {} });
    const report = engine.getReport();
    expect(report.overallStatus).toBe('degraded');
    expect(report.subsystems.length).toBe(2);
  });

  it('clears all records', () => {
    const engine = new DiagnosticsEngine();
    engine.record({ subsystem: 'test', level: 'info', code: 'T1', message: 'hello' });
    engine.clear();
    expect(engine.getRecentRecords().length).toBe(0);
  });

  it('health reports correct counts', () => {
    const engine = new DiagnosticsEngine();
    engine.record({ subsystem: 'a', level: 'error', code: 'E1', message: 'e' });
    engine.record({ subsystem: 'b', level: 'warning', code: 'W1', message: 'w' });
    engine.record({ subsystem: 'c', level: 'info', code: 'I1', message: 'i' });
    const h = engine.health();
    expect(h.totalRecords).toBe(3);
    expect(h.errorCount).toBe(1);
    expect(h.warningCount).toBe(1);
  });
});
