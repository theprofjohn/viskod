import { describe, expect, it } from 'vitest';
import { OVERLAY_CSS_PREFIX, VISKOD_STORAGE_DIR } from './constants';
import { ErrorCategory, ErrorSeverity, err, isRecoverable, ok } from './errors';
import { isSafeRelativeSourcePath } from './paths';
import {
  BoundingBoxSchema,
  IdentifierSchema,
  SemVerSchema,
  TimestampSchema,
  ViewportSchema,
  ViskodErrorSchema,
} from './schemas';

describe('ok()', () => {
  it('creates a valid Result with value and success flag', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });
});

describe('err()', () => {
  it('creates an error Result with error details', () => {
    const error = {
      code: 'TEST_ERROR',
      category: ErrorCategory.INTERNAL,
      severity: ErrorSeverity.FATAL,
      message: 'Something broke',
      correlationId: 'abc-123',
      subsystem: 'test',
      timestamp: new Date().toISOString(),
    };
    const result = err(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(error);
    }
  });
});

describe('isRecoverable', () => {
  it('returns false for FATAL, false for CRITICAL, true for RECOVERABLE', () => {
    const fatalErr = {
      code: 'X',
      category: ErrorCategory.INTERNAL,
      severity: ErrorSeverity.FATAL,
      message: '',
      correlationId: '',
      subsystem: '',
      timestamp: '',
    };
    const criticalErr = { ...fatalErr, severity: ErrorSeverity.CRITICAL };
    const recoverableErr = { ...fatalErr, severity: ErrorSeverity.RECOVERABLE };

    expect(isRecoverable(fatalErr)).toBe(false);
    expect(isRecoverable(criticalErr)).toBe(false);
    expect(isRecoverable(recoverableErr)).toBe(true);
  });
});

describe('IdentifierSchema', () => {
  it('validates a UUID v4 string', () => {
    const valid = '550e8400-e29b-41d4-a716-446655440000';
    const invalid = 'not-a-uuid';

    expect(IdentifierSchema.safeParse(valid).success).toBe(true);
    expect(IdentifierSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('TimestampSchema', () => {
  it('validates an ISO 8601 string', () => {
    const valid = '2025-01-15T10:30:00.000Z';
    const invalid = '2025-01-15 10:30:00';

    expect(TimestampSchema.safeParse(valid).success).toBe(true);
    expect(TimestampSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('SemVerSchema', () => {
  it('validates semver patterns', () => {
    const valid = '1.2.3';
    const invalid = 'v1.2.3';

    expect(SemVerSchema.safeParse(valid).success).toBe(true);
    expect(SemVerSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('ViskodErrorSchema', () => {
  it('validates a complete error object', () => {
    const error = {
      code: 'E001',
      category: 'internal',
      severity: 'fatal',
      message: 'test',
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      subsystem: 'test',
      timestamp: '2025-01-15T10:30:00.000Z',
    };
    expect(ViskodErrorSchema.safeParse(error).success).toBe(true);
  });

  it('rejects an error object missing code', () => {
    const error = {
      category: 'internal',
      severity: 'fatal',
      message: 'test',
      correlationId: '550e8400-e29b-41d4-a716-446655440000',
      subsystem: 'test',
      timestamp: '2025-01-15T10:30:00.000Z',
    };
    expect(ViskodErrorSchema.safeParse(error).success).toBe(false);
  });
});

describe('BoundingBoxSchema', () => {
  it('rejects negative width', () => {
    const invalid = { x: 0, y: 0, width: -1, height: 100 };
    expect(BoundingBoxSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('ViewportSchema', () => {
  it('rejects width 0', () => {
    const invalid = { width: 0, height: 720 };
    expect(ViewportSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('Constants', () => {
  it('VISKOD_STORAGE_DIR is correct', () => {
    expect(VISKOD_STORAGE_DIR).toBe('.viskod');
  });

  it('OVERLAY_CSS_PREFIX is __viskod_', () => {
    expect(OVERLAY_CSS_PREFIX).toBe('__viskod_');
  });
});

describe('isSafeRelativeSourcePath (Phase 30A load-side gate)', () => {
  it('accepts repository-relative paths', () => {
    for (const p of [
      'src/components/TargetCard.jsx',
      'app/settings/page.tsx',
      'features/a/StatusWidgetA.jsx',
      'index.ts',
      'src/deeply/nested/component.module.css',
    ]) {
      expect(isSafeRelativeSourcePath(p), `'${p}' should be safe`).toBe(true);
    }
  });

  it('rejects absolute and drive-letter paths', () => {
    for (const p of [
      '/Users/x/secret.ts',
      '/etc/passwd',
      'C:\\secret.ts',
      'C:/secret.ts',
      'd:\\Users\\victim\\Evil.tsx',
      '\\\\server\\share\\x.ts',
    ]) {
      expect(isSafeRelativeSourcePath(p), `'${p}' must be rejected`).toBe(false);
    }
  });

  it('rejects traversal paths', () => {
    for (const p of [
      '../../secret.ts',
      '../secret.ts',
      'src/../../outside.ts',
      '..',
      'a/../b.ts',
      'src/..\\secret.ts',
    ]) {
      expect(isSafeRelativeSourcePath(p), `'${p}' must be rejected`).toBe(false);
    }
  });

  it('rejects URI-scheme paths and empty values', () => {
    for (const p of ['file:///tmp/x.ts', 'file:///Users/x.ts', '']) {
      expect(isSafeRelativeSourcePath(p), `'${p}' must be rejected`).toBe(false);
    }
    expect(isSafeRelativeSourcePath(null as unknown as string)).toBe(false);
    expect(isSafeRelativeSourcePath(42 as unknown as string)).toBe(false);
  });
});
