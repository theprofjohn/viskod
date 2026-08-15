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

function makeProject(rootPath: string) {
  return {
    metadata: {
      projectId: 'test',
      name: 't',
      rootPath,
      packageManager: 'pnpm',
      language: 'ts',
    },
    componentIndex: { directories: ['src/components'] },
  };
}

function makeTmpProject(): { dir: string; componentDir: string } {
  const dir = join(tmpdir(), `viskod-she-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const componentDir = join(dir, 'src', 'components');
  mkdirSync(componentDir, { recursive: true });
  return { dir, componentDir };
}

describe('SourceHintEngine hardening (Phase 30 calibrated)', () => {
  it('rejects hints when rootPath is missing', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput();
    input.project.metadata.rootPath = '';
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('root path');
  });

  it('returns unavailable (typed error) instead of fabricating non-existing candidates', async () => {
    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      project: makeProject('/nonexistent/path'),
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SH_INSUFFICIENT_EVIDENCE');
    }
  });

  it('ranks existing class-file matches above nothing fabricated — no ghost paths', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(join(componentDir, 'TargetCard.jsx'), 'export default function TargetCard() {}');
    writeFileSync(join(componentDir, 'TargetCard.css'), '.target-card { color: red }');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({ project: makeProject(dir) });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hints = result.value;
      expect(hints.length).toBeGreaterThan(0);
      // Every returned candidate is a real file — never a fabricated path.
      for (const hint of hints) {
        expect(hint.exists).toBe(true);
        expect(hint.matchType).not.toBe('generated-non-existing');
        expect(hint.matchType).not.toBe('generated');
      }
      // Class-name file existence is moderate evidence → possible at most.
      const primary = hints[0];
      expect(primary?.qualification).toBe('possible');
      expect(primary?.confidence).toBeLessThan(0.65);
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('finds case-insensitive matches with calibrated (not inflated) confidence', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(join(componentDir, 'TargetCard.jsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({ project: makeProject(dir) });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ciHints = result.value.filter((h) => h.matchType === 'case-insensitive');
      expect(ciHints.length).toBeGreaterThan(0);
      for (const h of ciHints) {
        expect(h.exists).toBe(true);
        expect(h.filePath.toLowerCase()).toContain('targetcard');
        // Calibrated: class-name-only evidence can never be high confidence.
        expect(h.confidence).toBe(0.5);
        expect(h.qualification).toBe('possible');
      }
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('suggests adjacent CSS files as weak evidence when a component is found', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(join(componentDir, 'TargetCard.jsx'), '');
    writeFileSync(join(componentDir, 'TargetCard.css'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({ project: makeProject(dir) });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cssHints = result.value.filter((h) => h.filePath.endsWith('.css'));
      expect(cssHints.length).toBeGreaterThan(0);
      for (const h of cssHints) {
        expect(h.exists).toBe(true);
        expect(h.qualification).toBe('weak');
        expect(h.confidence).toBeLessThan(0.35);
      }
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('confidence is differentiated and capped (no flat inflation)', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(join(componentDir, 'TargetCard.jsx'), '');
    writeFileSync(join(componentDir, 'TargetCard.css'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({ project: makeProject(dir) });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const confidences = result.value.map((h) => h.confidence);
      const uniqueConfidences = [...new Set(confidences)];
      expect(uniqueConfidences.length).toBeGreaterThan(1);
      for (const c of uniqueConfidences) expect(c).toBeLessThan(0.65);
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('includes reasons, matchType, and qualification for each hint', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(join(componentDir, 'TargetCard.jsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({ project: makeProject(dir) });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const hint of result.value) {
        expect(hint.reason).toBeTruthy();
        expect(hint.reasons?.length).toBeGreaterThan(0);
        expect(hint.matchType).toBeTruthy();
        expect(typeof hint.exists).toBe('boolean');
        expect(['exact', 'probable', 'possible', 'weak']).toContain(hint.qualification);
      }
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('backward compatible with schema version', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(join(componentDir, 'TargetCard.jsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({ project: makeProject(dir) });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.length > 0) {
      expect(result.value[0]?.schemaVersion).toBeTruthy();
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts className and generates hints from it', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(join(componentDir, 'TargetCard.jsx'), 'export default function TargetCard() {}');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      domContext: { tagName: 'div', className: 'target-card' },
      project: makeProject(dir),
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      const hasTargetCard = result.value.some((h) =>
        h.filePath.toLowerCase().includes('targetcard'),
      );
      expect(hasTargetCard).toBe(true);
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('uses cache for repeated identical inputs', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(join(componentDir, 'TargetCard.jsx'), '');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({ project: makeProject(dir) });
    const first = await engine.generateHints(input);
    const second = await engine.generateHints(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value[0]?.hintId).toBe(second.value[0]?.hintId);
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('exhausted scan budget returns explicit unavailable, not a hang (Phase 30)', async () => {
    const { dir, componentDir } = makeTmpProject();
    for (let i = 0; i < 20; i++) {
      writeFileSync(
        join(componentDir, `File${i}.tsx`),
        `export function File${i}() { return <p>Shared status ${i} banner</p>; }`,
      );
    }

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      domContext: { tagName: 'p', className: '', id: '', text: 'Shared status banner' },
      project: makeProject(dir),
    });
    // A budget of 2 files forces exhaustion on a 20-file tree.
    const result = await engine.generateHints(input, { budget: { maxFiles: 2, maxTimeMs: 5000 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SH_BUDGET_EXCEEDED');
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('never generates a Card candidate from a generic div alone (VISKOD-AUDIT-008)', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(join(componentDir, 'card.tsx'), 'export function Card() { return <div /> }');

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      // Generic div with NO class, NO id, NO text — the audit's dangerous case.
      domContext: { tagName: 'div', className: '', id: '', text: '' },
      project: makeProject(dir),
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // No evidence → explicit unavailable, NOT a fabricated high-confidence Card.
      expect(result.error.code).toBe('SH_INSUFFICIENT_EVIDENCE');
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('a generic div with class card never yields high confidence for card.tsx', async () => {
    const { dir, componentDir } = makeTmpProject();
    writeFileSync(
      join(componentDir, 'card.tsx'),
      'export function Card() { return <div>Card</div> }',
    );

    const engine = new SourceHintEngine(new EventBus());
    const input = makeHintInput({
      domContext: { tagName: 'div', className: 'card', id: '', text: 'Card' },
      project: makeProject(dir),
    });
    const result = await engine.generateHints(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const card = result.value.find((h) => h.filePath.toLowerCase().includes('card.tsx'));
      expect(card).toBeDefined();
      if (card) {
        // Generic class + single word 'Card': honest possible at most.
        // The audit bug was ~0.95 inflated confidence — this can never be
        // probable/exact or dominate ranking.
        expect(card.qualification).not.toBe('probable');
        expect(card.qualification).not.toBe('exact');
        expect(card.confidence).toBeLessThan(0.65);
      }
    }

    rmSync(dir, { recursive: true, force: true });
  });
});
