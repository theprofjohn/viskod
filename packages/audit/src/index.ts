// @viskod/audit — ALPHA (enterprise audit trail)

export type AuditAction =
  | 'capture'
  | 'selection'
  | 'navigation'
  | 'scan'
  | 'browser_launch'
  | 'browser_shutdown'
  | 'plugin_register'
  | 'plugin_activate'
  | 'permission_grant'
  | 'permission_revoke'
  | 'mcp_tool'
  | 'cli_command';

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: AuditAction;
  subsystem: string;
  detail: string;
  status: 'success' | 'failure';
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditFilter {
  actor?: string;
  action?: AuditAction;
  subsystem?: string;
  status?: 'success' | 'failure';
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface AuditHealth {
  status: 'healthy' | 'degraded';
  totalEntries: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

export class AuditEngine {
  private entries: AuditEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries;
  }

  log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry {
    const record: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.entries.push(record);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
    return record;
  }

  query(filter: AuditFilter = {}): AuditEntry[] {
    let results = [...this.entries];
    const { actor, action, subsystem, status, fromDate, toDate, limit } = filter;
    if (actor) results = results.filter((e) => e.actor === actor);
    if (action) results = results.filter((e) => e.action === action);
    if (subsystem) results = results.filter((e) => e.subsystem === subsystem);
    if (status) results = results.filter((e) => e.status === status);
    if (fromDate) results = results.filter((e) => e.timestamp >= fromDate);
    if (toDate) results = results.filter((e) => e.timestamp <= toDate);
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return results.slice(0, limit ?? 100);
  }

  getByCorrelationId(correlationId: string): AuditEntry[] {
    return this.entries.filter((e) => e.correlationId === correlationId);
  }

  getRecentActions(minutes = 60): AuditEntry[] {
    const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
    return this.entries.filter((e) => e.timestamp >= cutoff);
  }

  getFailures(): AuditEntry[] {
    return this.entries.filter((e) => e.status === 'failure');
  }

  clear(): void {
    this.entries = [];
  }

  health(): AuditHealth {
    const sorted = [...this.entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      status: 'healthy',
      totalEntries: this.entries.length,
      oldestEntry: sorted[0]?.timestamp ?? null,
      newestEntry: sorted[sorted.length - 1]?.timestamp ?? null,
    };
  }
}
