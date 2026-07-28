export interface SessionInfo {
  sessionId: string;
  pid: number;
  port: number;
  status: 'starting' | 'running' | 'stopped';
  browserUrl?: string;
  startedAt: string;
  projectRoot: string;
}

export interface DaemonRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface DaemonResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}
