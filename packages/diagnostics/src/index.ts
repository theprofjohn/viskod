export interface DiagnosticRecord {
  id: string;
  timestamp: string;
  subsystem: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  code: string;
  message: string;
  detail?: string;
  correlationId?: string;
}

export interface SubsystemHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unavailable';
  uptime?: number;
  metrics: Record<string, number>;
  lastError?: string;
}

export interface DiagnosticReport {
  timestamp: string;
  overallStatus: 'healthy' | 'degraded' | 'unavailable';
  subsystems: SubsystemHealth[];
  recentRecords: DiagnosticRecord[];
}

export interface DiagnosticHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  totalRecords: number;
  errorCount: number;
  warningCount: number;
}

export class DiagnosticsEngine {
  private records: DiagnosticRecord[] = [];
  private subsystems = new Map<string, SubsystemHealth>();
  private maxRecords: number;

  constructor(maxRecords = 500) {
    this.maxRecords = maxRecords;
  }

  record(diagnostic: Omit<DiagnosticRecord, 'id' | 'timestamp'>): DiagnosticRecord {
    const record: DiagnosticRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...diagnostic,
    };
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
    return record;
  }

  registerSubsystem(health: SubsystemHealth): void {
    this.subsystems.set(health.name, health);
  }

  updateSubsystem(name: string, health: Partial<SubsystemHealth>): void {
    const existing = this.subsystems.get(name);
    if (existing) {
      this.subsystems.set(name, { ...existing, ...health });
    }
  }

  getSubsystem(name: string): SubsystemHealth | undefined {
    return this.subsystems.get(name);
  }

  getRecentRecords(limit = 50): DiagnosticRecord[] {
    return this.records.slice(-limit);
  }

  getRecordsBySubsystem(subsystem: string): DiagnosticRecord[] {
    return this.records.filter((r) => r.subsystem === subsystem);
  }

  getErrors(): DiagnosticRecord[] {
    return this.records.filter((r) => r.level === 'error' || r.level === 'critical');
  }

  getReport(): DiagnosticReport {
    const subsysArray = Array.from(this.subsystems.values());
    const overall = subsysArray.every((s) => s.status === 'healthy')
      ? 'healthy'
      : subsysArray.some((s) => s.status === 'unavailable')
        ? 'unavailable'
        : 'degraded';

    return {
      timestamp: new Date().toISOString(),
      overallStatus: overall,
      subsystems: subsysArray,
      recentRecords: this.records.slice(-20),
    };
  }

  clear(): void {
    this.records = [];
  }

  health(): DiagnosticHealth {
    return {
      status: 'healthy',
      totalRecords: this.records.length,
      errorCount: this.getErrors().length,
      warningCount: this.records.filter((r) => r.level === 'warning').length,
    };
  }
}
