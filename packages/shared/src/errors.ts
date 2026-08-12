export const ErrorCategory = {
  VALIDATION: 'validation',
  RUNTIME: 'runtime',
  NETWORK: 'network',
  STORAGE: 'storage',
  BROWSER: 'browser',
  PLUGIN: 'plugin',
  SECURITY: 'security',
  INTERNAL: 'internal',
  CONFIGURATION: 'configuration',
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const ErrorSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  RECOVERABLE: 'recoverable',
  CRITICAL: 'critical',
  FATAL: 'fatal',
} as const;

export type ErrorSeverity = (typeof ErrorSeverity)[keyof typeof ErrorSeverity];

export interface ViskodError {
  code: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  cause?: string;
  recovery?: string;
  correlationId: string;
  subsystem: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type Result<T, E = ViskodError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(error: ViskodError): Result<never> {
  return { ok: false, error };
}

export function createViskodError(
  input: Omit<ViskodError, 'correlationId' | 'timestamp'>,
): ViskodError {
  return {
    ...input,
    correlationId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

export function isRecoverable(error: ViskodError): boolean {
  return error.severity !== ErrorSeverity.FATAL && error.severity !== ErrorSeverity.CRITICAL;
}
