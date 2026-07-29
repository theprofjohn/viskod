import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import { SourceHintEngine } from './index';

function makeHintInput(overrides: Record<string, unknown> = {}) {
  return {
    domContext: {
      tagName: 'div',
      className: 'target-card',
      id: 'source-target-card',
      ...((overrides.domContext as Record<string, unknown>) ?? {}),
    },
    route: { url: 'http://localhost:3000', pathname: '/' },
    project: {
      metadata: {
        projectId: 'test-proj',
        name: 'test',
        rootPath: '/tmp',
        packageManager: 'pnpm',
        language: 'typescript',
      },
      componentIndex: { directories: ['src/components'] },
    },
    captureId: 'test-capture',
    ...overrides,
  };
}

describe('SourceHintEngine hardening', () => {
  it('rejects hints when rootPath is missing', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput();
    input.project.metadata.rootPath = '';
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('root path');
  });

  it('returns non-existing candidates when no files exist', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      project: {
        metadata: {
          projectId: 'test',
          name: 't',
          rootPath: '/nonexistent/path',
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      for (const hint of result.value) {
        expect(hint.exists).toBe(false);
      }
    }
  });

  it('ranks existing exact files above non-existing generated ones', async () => {
    const tmpDir = join(tmpdir(), `viskod-she-test-${Date.now()}`);
    const compDir = join(tmpDir, 'src', 'components');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'TargetCard.jsx'), 'export default function TargetCard() {}');
    writeFileSync(join(compDir, 'TargetCard.css'), '.target-card { color: red }');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      project: {
        metadata: {
          projectId: 'test',
          name: 't',
          rootPath: tmpDir,
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hints = result.value;
      expect(hints.length).toBeGreaterThan(0);
      // Primary should be an existing exact match
      expect(hints[0]?.exists).toBe(true);
      expect([0.8, 0.85, 0.95]).toContain(hints[0]?.confidence);
      // Non-existing should rank lower
      const nonExisting = hints.filter((h) => !h.exists);
      const existing = hints.filter((h) => h.exists);
      expect(existing.length).toBeGreaterThan(0);
      for (const ne of nonExisting) {
        const neIdx = hints.indexOf(ne);
        const lastExistingIdx = Math.max(...existing.map((e) => hints.indexOf(e)));
        expect(neIdx).toBeGreaterThan(lastExistingIdx);
      }
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds case-insensitive matches when exact casing differs', async () => {
    const tmpDir = join(tmpdir(), `viskod-she-ci-${Date.now()}`);
    const compDir = join(tmpDir, 'src', 'components');
    mkdirSync(compDir, { recursive: true });
    // Create file with different casing than the generated pattern
    writeFileSync(join(compDir, 'TargetCard.jsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      project: {
        metadata: {
          projectId: 'test',
          name: 't',
          rootPath: tmpDir,
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hints = result.value;
      const ciHints = hints.filter((h) => h.matchType === 'case-insensitive');
      expect(ciHints.length).toBeGreaterThan(0);
      for (const h of ciHints) {
        expect(h.exists).toBe(true);
        expect(h.filePath.toLowerCase()).toContain('targetcard');
        expect(h.confidence).toBe(0.85);
      }
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('suggests adjacent CSS files when a component is found', async () => {
    const tmpDir = join(tmpdir(), `viskod-she-css-${Date.now()}`);
    const compDir = join(tmpDir, 'src', 'components');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'TargetCard.jsx'), '');
    writeFileSync(join(compDir, 'TargetCard.css'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      project: {
        metadata: {
          projectId: 'test',
          name: 't',
          rootPath: tmpDir,
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cssHints = result.value.filter((h) => h.filePath.endsWith('.css'));
      expect(cssHints.length).toBeGreaterThan(0);
      for (const h of cssHints) {
        expect(h.exists).toBe(true);
        // May be found directly (case-insensitive) or via style adjacency
        expect(['style-adjacent', 'case-insensitive']).toContain(h.matchType);
      }
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('confidence is differentiated (not flat 0.65 anymore)', async () => {
    const tmpDir = join(tmpdir(), `viskod-she-conf-${Date.now()}`);
    const compDir = join(tmpDir, 'src', 'components');
    mkdirSync(compDir, { recursive: true });
    writeFileSync(join(compDir, 'TargetCard.jsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      project: {
        metadata: {
          projectId: 'test',
          name: 't',
          rootPath: tmpDir,
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const confidences = result.value.map((h) => h.confidence);
      const uniqueConfidences = [...new Set(confidences)];
      expect(uniqueConfidences.length).toBeGreaterThan(1);
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes reason and matchType for each hint', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      project: {
        metadata: {
          projectId: 'test',
          name: 't',
          rootPath: '/nonexistent',
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const hint of result.value) {
        expect(hint.reason).toBeTruthy();
        expect(hint.matchType).toBeTruthy();
        expect(typeof hint.exists).toBe('boolean');
      }
    }
  });

  it('backward compatible with schema version', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      project: {
        metadata: {
          projectId: 'test',
          name: 't',
          rootPath: '/nonexistent',
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.length > 0) {
      expect(result.value[0]?.schemaVersion).toBeTruthy();
    }
  });

  it('accepts className and generates hints from it', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      domContext: { tagName: 'div', className: 'target-card' },
      project: {
        metadata: {
          projectId: 'test',
          name: 't',
          rootPath: '/tmp',
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      const hasTargetCard = result.value.some((h) =>
        h.filePath.toLowerCase().includes('target-card'),
      );
      expect(hasTargetCard).toBe(true);
    }
  });

  it('uses cache for repeated identical inputs', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      project: {
        metadata: {
          projectId: 'test',
          name: 't',
          rootPath: '/nonexistent',
          packageManager: 'pnpm',
          language: 'ts',
        },
        componentIndex: { directories: ['src/components'] },
      },
    });
    const first = await engine.generateHints(input);
    const second = await engine.generateHints(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value[0]?.hintId).toBe(second.value[0]?.hintId);
    }
  });
});
