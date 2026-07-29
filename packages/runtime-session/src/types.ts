export interface SessionInfo {
  sessionId: string;
  pid: number;
  port: number;
  token: string;
  status: 'starting' | 'running' | 'stopped';
  browserUrl?: string;
  startedAt: string;
  projectRoot: string;
}

export interface DaemonRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  token?: string;
}

export interface DaemonResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}
