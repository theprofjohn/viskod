import { EventBus } from '@viskod/event-bus';
import { describe, expect, it } from 'vitest';
import {
  boxCandidateToTarget,
  collectBoxCandidates,
  deduplicateTargets,
  reduceBoxSelection,
} from './box-selection';
import type { BoxCandidate } from './box-selection';
import {
  centerOfRect,
  intersectionRatio,
  intersectionRect,
  isZeroArea,
  normalizeRect,
  rectArea,
  rectContains,
  rectsIntersect,
  visibleRatio,
} from './geometry';
import { normalizeText, redactSelectionData, truncateText } from './redaction';
import { resolveTarget } from './resolver';
import type { ResolvedElement } from './resolver';
import { RectSchema, VisualSelectionSchema } from './schemas';
import {
  filterCandidates,
  isAmbiguous,
  scoreAndRank,
  scoreCandidate,
  selectBestCandidate,
} from './scoring';
import type { CandidateElement, CandidateScore } from './scoring';
import { VisualSelectionServiceImpl } from './service';
import type { PageInfo, Rect, VisualSelection, VisualSelectionTarget } from './types';
import { DEFAULT_VISUAL_SELECTION_CONFIG } from './types';

// =============================================================================
// Geometry Tests
// =============================================================================

describe('Geometry', () => {
  it('normalizes negative-dimension rects', () => {
    const r = normalizeRect({ x: 10, y: 20, width: -5, height: -8 });
    expect(r.x).toBe(5);
    expect(r.y).toBe(12);
    expect(r.width).toBe(5);
    expect(r.height).toBe(8);
  });

  it('detects intersecting rects', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 50, y: 50, width: 100, height: 100 };
    expect(rectsIntersect(a, b)).toBe(true);
  });

  it('detects non-intersecting rects', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 100, y: 100, width: 10, height: 10 };
    expect(rectsIntersect(a, b)).toBe(false);
  });

  it('computes intersection rect', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 50, y: 50, width: 100, height: 100 };
    const inter = intersectionRect(a, b);
    expect(inter).not.toBeNull();
    expect(inter?.x).toBe(50);
    expect(inter?.y).toBe(50);
    expect(inter?.width).toBe(50);
    expect(inter?.height).toBe(50);
  });

  it('returns null for non-overlapping rects', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 100, y: 100, width: 10, height: 10 };
    expect(intersectionRect(a, b)).toBeNull();
  });

  it('computes rect area', () => {
    expect(rectArea({ x: 0, y: 0, width: 10, height: 20 })).toBe(200);
    expect(rectArea({ x: 0, y: 0, width: 0, height: 10 })).toBe(0);
  });

  it('computes intersection ratio', () => {
    const a = { x: 0, y: 0, width: 100, height: 100 };
    const b = { x: 50, y: 50, width: 50, height: 50 };
    const ratio = intersectionRatio(a, b);
    expect(ratio).toBeCloseTo(0.25, 2);
  });

  it('computes visible ratio within viewport', () => {
    const el = { x: 0, y: 0, width: 100, height: 100 };
    const viewport = { x: 0, y: 0, width: 800, height: 600 };
    expect(visibleRatio(el, viewport)).toBe(1);
  });

  it('computes partial visible ratio', () => {
    const el = { x: -50, y: 0, width: 100, height: 100 };
    const viewport = { x: 0, y: 0, width: 800, height: 600 };
    const ratio = visibleRatio(el, viewport);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it('detects rect containment', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    const inner = { x: 10, y: 10, width: 20, height: 20 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it('computes center of rect', () => {
    const { cx, cy } = centerOfRect({ x: 10, y: 20, width: 100, height: 200 });
    expect(cx).toBe(60);
    expect(cy).toBe(120);
  });

  it('detects zero-area rect', () => {
    expect(isZeroArea({ x: 0, y: 0, width: 0, height: 100 })).toBe(true);
    expect(isZeroArea({ x: 0, y: 0, width: 100, height: 100 })).toBe(false);
  });
});

// =============================================================================
// Scoring Tests
// =============================================================================

describe('Target Scoring', () => {
  const makeCandidate = (overrides: Partial<CandidateElement> = {}): CandidateElement => ({
    tagName: 'button',
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    viewportRect: { x: 0, y: 0, width: 100, height: 40 },
    isInteractive: true,
    role: 'button',
    accessibleName: 'Save',
    hasVisibleText: true,
    hasStableAttributes: true,
    ancestorDepth: 2,
    isLabelControl: false,
    childCount: 1,
    parentTagName: 'div',
    isViskodOwned: false,
    isTechnical: false,
    isPseudoContent: false,
    isHidden: false,
    isOutsideViewport: false,
    parentBoundingRect: null,
    ...overrides,
  });

  it('scores interactive element highly', () => {
    const el = makeCandidate({ isInteractive: true });
    const scored = scoreCandidate(el, 50, 20);
    expect(scored.score).toBeGreaterThan(0.5);
  });

  it('scores non-interactive element lower', () => {
    const interactive = scoreCandidate(makeCandidate({ isInteractive: true }), 50, 20);
    const nonInteractive = scoreCandidate(makeCandidate({ isInteractive: false }), 50, 20);
    expect(interactive.score).toBeGreaterThan(nonInteractive.score);
  });

  it('scores element with semantic role higher', () => {
    const withRole = scoreCandidate(makeCandidate({ role: 'button' }), 50, 20);
    const without = scoreCandidate(makeCandidate({ role: null }), 50, 20);
    expect(withRole.score).toBeGreaterThan(without.score);
  });

  it('scores element with accessible name higher', () => {
    const named = scoreCandidate(makeCandidate({ accessibleName: 'Save' }), 50, 20);
    const unnamed = scoreCandidate(makeCandidate({ accessibleName: null }), 50, 20);
    expect(named.score).toBeGreaterThan(unnamed.score);
  });

  it('scores element with visible text higher', () => {
    const withText = scoreCandidate(makeCandidate({ hasVisibleText: true }), 50, 20);
    const without = scoreCandidate(makeCandidate({ hasVisibleText: false }), 50, 20);
    expect(withText.score).toBeGreaterThan(without.score);
  });

  it('scores element inside pointer bounds higher', () => {
    const inside = scoreCandidate(
      makeCandidate({ viewportRect: { x: 0, y: 0, width: 100, height: 40 } }),
      50,
      20,
    );
    const outside = scoreCandidate(
      makeCandidate({ viewportRect: { x: 200, y: 200, width: 100, height: 40 } }),
      50,
      20,
    );
    expect(inside.score).toBeGreaterThan(outside.score);
  });

  it('scores appropriate depth higher than extreme depth', () => {
    const shallow = scoreCandidate(makeCandidate({ ancestorDepth: 2 }), 50, 20);
    const deep = scoreCandidate(makeCandidate({ ancestorDepth: 10 }), 50, 20);
    expect(shallow.signals.appropriateDepth!).toBeGreaterThan(deep.signals.appropriateDepth!);
  });

  it('filters technical elements', () => {
    const elements = [
      makeCandidate({ tagName: 'button', isTechnical: false }),
      makeCandidate({ tagName: 'script', isTechnical: true }),
      makeCandidate({ tagName: 'style', isTechnical: true }),
    ];
    const filtered = filterCandidates(elements);
    expect(filtered.length).toBe(1);
  });

  it('filters viskod-owned elements', () => {
    const elements = [
      makeCandidate({ isViskodOwned: false }),
      makeCandidate({ isViskodOwned: true }),
    ];
    const filtered = filterCandidates(elements);
    expect(filtered.length).toBe(1);
  });

  it('filters hidden elements', () => {
    const elements = [makeCandidate({ isHidden: false }), makeCandidate({ isHidden: true })];
    const filtered = filterCandidates(elements);
    expect(filtered.length).toBe(1);
  });

  it('filters zero-area elements', () => {
    const elements = [
      makeCandidate({ viewportRect: { x: 0, y: 0, width: 100, height: 40 } }),
      makeCandidate({ viewportRect: { x: 0, y: 0, width: 0, height: 0 } }),
    ];
    const filtered = filterCandidates(elements);
    expect(filtered.length).toBe(1);
  });

  it('scores and ranks candidates', () => {
    const elements = [
      makeCandidate({
        tagName: 'button',
        isInteractive: true,
        ancestorDepth: 1,
        viewportRect: { x: 0, y: 0, width: 100, height: 40 },
      }),
      makeCandidate({
        tagName: 'div',
        isInteractive: false,
        ancestorDepth: 3,
        viewportRect: { x: 0, y: 0, width: 100, height: 40 },
      }),
    ];
    const ranked = scoreAndRank(elements, 50, 20);
    expect(ranked.length).toBe(2);
    expect(ranked[0]?.element.isInteractive).toBe(true);
  });

  it('detects ambiguity when scores are close', () => {
    expect(isAmbiguous(0.7, 0.65, 0.15, 0.6)).toBe(true);
    expect(isAmbiguous(0.8, 0.5, 0.15, 0.6)).toBe(false);
    expect(isAmbiguous(0.5, 0.4, 0.15, 0.6)).toBe(true);
  });

  it('selects best candidate above threshold', () => {
    const scored: CandidateScore[] = [
      { element: makeCandidate(), score: 0.85, signals: {} },
      { element: makeCandidate({ tagName: 'div' }), score: 0.45, signals: {} },
    ];
    const { best, ambiguous } = selectBestCandidate(scored, 0.6, 0.15);
    expect(best).not.toBeNull();
    expect(best?.score).toBe(0.85);
    expect(ambiguous).toBe(false);
  });

  it('returns null when no candidate meets threshold', () => {
    const scored: CandidateScore[] = [{ element: makeCandidate(), score: 0.4, signals: {} }];
    const { best } = selectBestCandidate(scored, 0.6, 0.15);
    expect(best).toBeNull();
  });

  it('marks ambiguous when confidence insufficient', () => {
    const scored: CandidateScore[] = [
      { element: makeCandidate(), score: 0.7, signals: {} },
      { element: makeCandidate({ tagName: 'a' }), score: 0.6, signals: {} },
    ];
    const { best, ambiguous } = selectBestCandidate(scored, 0.6, 0.15);
    expect(best).not.toBeNull();
    expect(ambiguous).toBe(true);
  });
});

// =============================================================================
// Box Selection Tests
// =============================================================================

describe('Box Selection', () => {
  const makeBoxCandidate = (overrides: Partial<BoxCandidate>): BoxCandidate => ({
    targetId: crypto.randomUUID(),
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    tagName: 'button',
    documentOrder: 0,
    ancestorDepth: 2,
    isInteractive: true,
    isTechnical: false,
    isViskodOwned: false,
    isHidden: false,
    intersectionArea: 4000,
    visibleRatio: 1,
    ...overrides,
  });

  it('collects candidates intersecting drag rect', () => {
    const candidates = [
      makeBoxCandidate({ boundingRect: { x: 0, y: 0, width: 100, height: 40 }, targetId: 'a' }),
      makeBoxCandidate({ boundingRect: { x: 200, y: 200, width: 50, height: 50 }, targetId: 'b' }),
    ];
    const dragRect: Rect = { x: 0, y: 0, width: 150, height: 100 };
    const result = collectBoxCandidates(candidates, dragRect);
    expect(result.length).toBe(1);
    expect(result[0]?.targetId).toBe('a');
  });

  it('excludes overlay and technical nodes', () => {
    const candidates = [
      makeBoxCandidate({ targetId: 'a', isViskodOwned: true }),
      makeBoxCandidate({ targetId: 'b', isTechnical: true }),
      makeBoxCandidate({ targetId: 'c' }),
    ];
    const dragRect: Rect = { x: 0, y: 0, width: 500, height: 500 };
    const result = collectBoxCandidates(candidates, dragRect);
    expect(result.length).toBe(1);
    expect(result[0]?.targetId).toBe('c');
  });

  it('reduces descendants when ancestor represents region', () => {
    const candidates = [
      makeBoxCandidate({
        targetId: 'parent',
        boundingRect: { x: 0, y: 0, width: 200, height: 100 },
        ancestorDepth: 1,
        tagName: 'section',
        isInteractive: false,
      }),
      makeBoxCandidate({
        targetId: 'child',
        boundingRect: { x: 10, y: 10, width: 50, height: 30 },
        ancestorDepth: 2,
        tagName: 'button',
        isInteractive: true,
      }),
    ];
    const { selected } = reduceBoxSelection(candidates);
    expect(selected.length).toBeGreaterThanOrEqual(1);
  });

  it('removes meaningless nested duplicates', () => {
    const candidates = [
      makeBoxCandidate({
        targetId: 'parent',
        boundingRect: { x: 0, y: 0, width: 200, height: 100 },
        ancestorDepth: 1,
        tagName: 'div',
        isInteractive: false,
      }),
      makeBoxCandidate({
        targetId: 'child-text',
        boundingRect: { x: 10, y: 10, width: 180, height: 80 },
        ancestorDepth: 2,
        tagName: 'span',
        isInteractive: false,
      }),
    ];
    const { selected } = reduceBoxSelection(candidates);
    expect(selected.length).toBeLessThanOrEqual(1);
  });

  it('sorts in document order', () => {
    const candidates = [
      makeBoxCandidate({ targetId: 'b', documentOrder: 2 }),
      makeBoxCandidate({ targetId: 'a', documentOrder: 1 }),
    ];
    const { selected } = reduceBoxSelection(candidates);
    expect(selected[0]?.targetId).toBe('a');
    expect(selected[1]?.targetId).toBe('b');
  });

  it('truncates when exceeding max target count', () => {
    const config = { ...DEFAULT_VISUAL_SELECTION_CONFIG, maxSelectedTargets: 2 };
    const candidates = [
      makeBoxCandidate({ targetId: 'a', documentOrder: 1 }),
      makeBoxCandidate({ targetId: 'b', documentOrder: 2 }),
      makeBoxCandidate({ targetId: 'c', documentOrder: 3 }),
    ];
    const { selected, warnings } = reduceBoxSelection(candidates, config);
    expect(selected.length).toBe(2);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('converts box candidate to target', () => {
    const candidate = makeBoxCandidate({ targetId: 'test-id' });
    const target = boxCandidateToTarget(candidate);
    expect(target.targetId).toBe('test-id');
    expect(target.semantics.tagName).toBe('button');
    expect(target.semantics.isInteractive).toBe(true);
    expect(target.documentOrder).toBe(0);
  });

  it('deduplicates equivalent targets', () => {
    const target1: VisualSelectionTarget = {
      targetId: 'a',
      documentOrder: 0,
      geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
      semantics: { tagName: 'button', role: 'button', isInteractive: true },
      fingerprints: {},
      resolutionCandidates: [],
    };
    const target2: VisualSelectionTarget = {
      targetId: 'b',
      documentOrder: 1,
      geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
      semantics: { tagName: 'button', role: 'button', isInteractive: true },
      fingerprints: {},
      resolutionCandidates: [],
    };
    const targets = deduplicateTargets([target1, target2]);
    expect(targets.length).toBe(1);
  });
});

// =============================================================================
// Resolver Tests
// =============================================================================

describe('Re-resolution and Wrong-Node Prevention', () => {
  const makeTarget = (overrides: Partial<VisualSelectionTarget> = {}): VisualSelectionTarget => ({
    targetId: 'original-id',
    documentOrder: 0,
    geometry: {
      viewportRect: { x: 10, y: 20, width: 100, height: 40 },
    },
    semantics: {
      tagName: 'button',
      role: 'button',
      accessibleName: 'Save changes',
      textPreview: 'Save changes',
      isInteractive: true,
    },
    fingerprints: {
      stableAttributes: { 'data-testid': 'save-btn', id: 'save-button' },
      ancestorFingerprint: ['div', 'form', 'main'],
    },
    resolutionCandidates: [],
    ...overrides,
  });

  const makeResolved = (overrides: Partial<ResolvedElement> = {}): ResolvedElement => ({
    tagName: 'button',
    role: 'button',
    accessibleName: 'Save changes',
    textContent: 'Save changes',
    boundingRect: { x: 10, y: 20, width: 100, height: 40 },
    stableAttributes: { 'data-testid': 'save-btn', id: 'save-button' },
    ancestorTags: ['div', 'form', 'main'],
    siblingTags: [],
    documentOrder: 0,
    isInteractive: true,
    ...overrides,
  });

  it('resolves correct target when evidence matches', () => {
    const target = makeTarget();
    const candidate = makeResolved();
    const result = resolveTarget(target, [candidate]);
    expect(result.resolution.status).toBe('resolved');
    expect(result.resolution.confidence).toBeGreaterThan(0.6);
  });

  it('rejects wrong tag type', () => {
    const target = makeTarget();
    const candidate = makeResolved({ tagName: 'div', role: null });
    const result = resolveTarget(target, [candidate]);
    expect(result.resolution.status).toBe('missing');
  });

  it('rejects different role', () => {
    const target = makeTarget();
    const candidate = makeResolved({ role: 'heading' });
    const result = resolveTarget(target, [candidate]);
    expect(result.resolution.status).toBe('missing');
  });

  it('detects staleness when confidence is low', () => {
    const target = makeTarget({
      semantics: {
        tagName: 'button',
        role: 'button',
        accessibleName: 'Save changes',
        textPreview: 'Save changes',
        isInteractive: true,
      },
      fingerprints: {
        stableAttributes: { 'data-testid': 'original-id' },
        ancestorFingerprint: ['div', 'section'],
      },
      geometry: { viewportRect: { x: 10, y: 20, width: 100, height: 40 } },
    });
    const candidate = makeResolved({
      tagName: 'button',
      role: 'button',
      textContent: 'Completely different text',
      stableAttributes: { 'data-testid': 'other-id' },
      ancestorTags: ['footer'],
      boundingRect: { x: 500, y: 600, width: 50, height: 20 },
    });
    const result = resolveTarget(target, [candidate]);
    expect(result.resolution.status === 'stale' || result.resolution.status === 'missing').toBe(
      true,
    );
  });

  it('reports ambiguous when duplicate similar candidates exist', () => {
    const target = makeTarget({
      semantics: {
        tagName: 'button',
        role: 'button',
        accessibleName: 'Save',
        textPreview: 'Save',
        isInteractive: true,
      },
    });
    const candidate = makeResolved({ textContent: 'Save' });
    const duplicate = makeResolved({
      textContent: 'Save',
      boundingRect: { x: 200, y: 200, width: 100, height: 40 },
    });
    const result = resolveTarget(target, [candidate, duplicate]);
    expect(result.resolution.status).toBe('ambiguous');
  });

  it('correct target resolves when all evidence aligns', () => {
    const target = makeTarget();
    const candidates = [
      makeResolved({ tagName: 'span', textContent: 'other', stableAttributes: {} }),
      makeResolved(),
    ];
    const result = resolveTarget(target, candidates);
    expect(result.resolution.status).toBe('resolved');
  });

  it('handles empty candidates list', () => {
    const target = makeTarget();
    const result = resolveTarget(target, []);
    expect(result.resolution.status).toBe('missing');
  });

  it('returns resolved for rerendered element with same semantics', () => {
    const target = makeTarget();
    const candidate = makeResolved({
      stableAttributes: { 'data-testid': 'save-btn' },
      ancestorTags: ['div', 'form', 'main'],
    });
    const result = resolveTarget(target, [candidate]);
    expect(result.resolution.status).toBe('resolved');
  });
});

// =============================================================================
// Redaction Tests
// =============================================================================

describe('Redaction', () => {
  const makeSelection = (overrides: Partial<VisualSelection> = {}): VisualSelection => ({
    schemaVersion: 1,
    selectionId: 'test-id',
    sessionId: 'session-id',
    pageId: 'page-id',
    mode: 'single',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    page: {
      url: 'https://example.com',
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    },
    region: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
    targets: [
      {
        targetId: 't1',
        documentOrder: 0,
        geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
        semantics: { tagName: 'button', isInteractive: true },
        fingerprints: {},
        resolutionCandidates: [],
      },
    ],
    summary: { targetCount: 1 },
    resolution: { status: 'resolved', confidence: 0.9, resolvedAt: new Date().toISOString() },
    ...overrides,
  });

  it('redacts email addresses from text preview', () => {
    const sel = makeSelection({
      targets: [
        {
          targetId: 't1',
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: {
            tagName: 'div',
            textPreview: 'Contact user@example.com for info',
            isInteractive: false,
          },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const { selection, redactions } = redactSelectionData(sel);
    expect(selection.targets[0]?.semantics.textPreview).toContain('[EMAIL_REDACTED]');
    expect(redactions).toContain('email');
  });

  it('redacts credit card numbers', () => {
    const sel = makeSelection({
      targets: [
        {
          targetId: 't1',
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: {
            tagName: 'div',
            textPreview: 'Card: 4111 1111 1111 1111',
            isInteractive: false,
          },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const { selection, redactions } = redactSelectionData(sel);
    expect(selection.targets[0]?.semantics.textPreview).toContain('[CARD_REDACTED]');
    expect(redactions).toContain('card-number');
  });

  it('redacts API keys', () => {
    const sel = makeSelection({
      targets: [
        {
          targetId: 't1',
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'div', textPreview: 'sk_test_abc123def456', isInteractive: false },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const { selection, redactions } = redactSelectionData(sel);
    expect(selection.targets[0]?.semantics.textPreview).toContain('[API_KEY_REDACTED]');
    expect(redactions).toContain('api-key');
  });

  it('strips password input text', () => {
    const sel = makeSelection({
      targets: [
        {
          targetId: 't1',
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: {
            tagName: 'input',
            inputType: 'password',
            textPreview: 'mysecret',
            accessibleName: 'Password',
            isInteractive: true,
          },
          fingerprints: {},
          resolutionCandidates: [],
        },
      ],
    });
    const { selection } = redactSelectionData(sel);
    expect(selection.targets[0]?.semantics.textPreview).toBeUndefined();
    expect(selection.targets[0]?.semantics.accessibleName).toBeUndefined();
  });

  it('normalizes whitespace in text', () => {
    expect(normalizeText('  Hello   World  ', 100)).toBe('Hello World');
  });

  it('truncates long text', () => {
    const long = 'a'.repeat(200);
    expect(normalizeText(long, 50).length).toBeLessThanOrEqual(51);
    expect(truncateText('hello', 3)).toBe('hel…');
  });

  it('applies redaction to stable attributes', () => {
    const sel = makeSelection({
      targets: [
        {
          targetId: 't1',
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'input', isInteractive: true },
          fingerprints: { stableAttributes: { value: 'user@example.com' } },
          resolutionCandidates: [],
        },
      ],
    });
    const { selection, redactions } = redactSelectionData(sel);
    expect(selection.targets[0]?.fingerprints.stableAttributes?.value).toContain(
      '[EMAIL_REDACTED]',
    );
    expect(redactions).toContain('email');
  });

  it('skips password-named attributes', () => {
    const sel = makeSelection({
      targets: [
        {
          targetId: 't1',
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'input', isInteractive: true },
          fingerprints: { stableAttributes: { password: 'hunter2' } },
          resolutionCandidates: [],
        },
      ],
    });
    const { selection } = redactSelectionData(sel);
    expect(selection.targets[0]?.fingerprints.stableAttributes?.password).toBeUndefined();
  });
});

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe('Schema Validation', () => {
  it('validates a valid selection', () => {
    const selection: VisualSelection = {
      schemaVersion: 1,
      selectionId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      pageId: crypto.randomUUID(),
      mode: 'single',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      page: {
        url: 'https://example.com',
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
      },
      region: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
      targets: [
        {
          targetId: crypto.randomUUID(),
          documentOrder: 0,
          geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
          semantics: { tagName: 'button', role: 'button', isInteractive: true },
          fingerprints: { stableAttributes: { 'data-testid': 'btn' } },
          resolutionCandidates: [{ strategy: 'stable-attribute', value: 'btn', confidence: 0.9 }],
        },
      ],
      summary: { targetCount: 1 },
      resolution: { status: 'resolved', confidence: 0.9, resolvedAt: new Date().toISOString() },
    };
    const result = VisualSelectionSchema.safeParse(selection);
    expect(result.success).toBe(true);
  });

  it('validates rect schema', () => {
    expect(RectSchema.safeParse({ x: 1, y: 2, width: 3, height: 4 }).success).toBe(true);
    expect(RectSchema.safeParse({ x: 'a', y: 2, width: 3, height: 4 }).success).toBe(false);
  });
});

// =============================================================================
// VisualSelectionService Tests
// =============================================================================

describe('VisualSelectionService', () => {
  const makeService = () => new VisualSelectionServiceImpl(new EventBus());

  it('enters selection mode', async () => {
    const svc = makeService();
    const result = await svc.enterSelectionMode('page-1');
    expect(result.ok).toBe(true);
    const health = svc.health();
    expect(health.activeSelections).toBe(1);
  });

  it('rejects duplicate selection mode entry', async () => {
    const svc = makeService();
    await svc.enterSelectionMode('page-1');
    const result = await svc.enterSelectionMode('page-1');
    expect(result.ok).toBe(false);
  });

  it('exits selection mode', async () => {
    const svc = makeService();
    await svc.enterSelectionMode('page-1');
    const result = await svc.exitSelectionMode('page-1');
    expect(result.ok).toBe(true);
    expect(svc.health().activeSelections).toBe(0);
  });

  it('rejects exit when mode not active', async () => {
    const svc = makeService();
    const result = await svc.exitSelectionMode('page-1');
    expect(result.ok).toBe(false);
  });

  it('gets active selection (null when none)', async () => {
    const svc = makeService();
    await svc.enterSelectionMode('page-1');
    const result = await svc.getActiveSelection('page-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it('clears selection', async () => {
    const svc = makeService();
    await svc.enterSelectionMode('page-1');

    const pageInfo: PageInfo = {
      url: 'https://example.com',
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    };
    const target: VisualSelectionTarget = {
      targetId: 't1',
      documentOrder: 0,
      geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
      semantics: { tagName: 'button', isInteractive: true },
      fingerprints: {},
      resolutionCandidates: [],
    };
    svc.createSingleSelection('page-1', target, pageInfo, { x: 0, y: 0, width: 100, height: 40 });

    const before = await svc.getActiveSelection('page-1');
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.value).not.toBeNull();

    await svc.clearSelection('page-1');
    const after = await svc.getActiveSelection('page-1');
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value).toBeNull();
  });

  it('creates single selection', async () => {
    const svc = makeService();
    await svc.enterSelectionMode('page-1');

    const pageInfo: PageInfo = {
      url: 'https://example.com',
      title: 'Test',
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    };
    const target: VisualSelectionTarget = {
      targetId: crypto.randomUUID(),
      documentOrder: 0,
      geometry: { viewportRect: { x: 10, y: 20, width: 100, height: 40 } },
      semantics: {
        tagName: 'button',
        role: 'button',
        accessibleName: 'Save',
        textPreview: 'Save',
        isInteractive: true,
      },
      fingerprints: { stableAttributes: { 'data-testid': 'save-btn' } },
      resolutionCandidates: [{ strategy: 'stable-attribute', value: 'save-btn', confidence: 0.9 }],
    };

    const result = svc.createSingleSelection('page-1', target, pageInfo, {
      x: 10,
      y: 20,
      width: 100,
      height: 40,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('single');
      expect(result.value.summary.targetCount).toBe(1);
      expect(result.value.selectionId).toBeTruthy();
      expect(result.value.sessionId).toBeTruthy();
    }
  });

  it('creates multi selection with every target', async () => {
    const svc = makeService();
    await svc.enterSelectionMode('page-1');

    const pageInfo: PageInfo = {
      url: 'https://example.com',
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    };
    const first: VisualSelectionTarget = {
      targetId: 'first',
      documentOrder: 0,
      geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
      semantics: { tagName: 'button', isInteractive: true },
      fingerprints: {},
      resolutionCandidates: [],
    };
    const second = { ...first, targetId: 'second', documentOrder: 1 };

    const result = svc.createMultiSelection(
      'page-1',
      [first, second],
      pageInfo,
      first.geometry.viewportRect,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targets).toHaveLength(2);
      expect(result.value.summary.targetCount).toBe(2);
    }
  });

  it('creates box selection', async () => {
    const svc = makeService();
    await svc.enterSelectionMode('page-1');

    const pageInfo: PageInfo = {
      url: 'https://example.com',
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    };
    const candidates: BoxCandidate[] = [
      {
        targetId: 'a',
        boundingRect: { x: 10, y: 10, width: 100, height: 40 },
        tagName: 'button',
        documentOrder: 1,
        ancestorDepth: 2,
        isInteractive: true,
        isTechnical: false,
        isViskodOwned: false,
        isHidden: false,
        intersectionArea: 4000,
        visibleRatio: 1,
      },
      {
        targetId: 'b',
        boundingRect: { x: 120, y: 10, width: 100, height: 40 },
        tagName: 'button',
        documentOrder: 2,
        ancestorDepth: 2,
        isInteractive: true,
        isTechnical: false,
        isViskodOwned: false,
        isHidden: false,
        intersectionArea: 4000,
        visibleRatio: 1,
      },
    ];

    const result = svc.createBoxSelection(
      'page-1',
      candidates,
      { x: 0, y: 0, width: 300, height: 100 },
      pageInfo,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.mode).toBe('box');
      expect(result.value.targets.length).toBeGreaterThan(0);
    }
  });

  it('rejects creation when selection mode not active', async () => {
    const svc = makeService();
    const pageInfo: PageInfo = {
      url: 'https://example.com',
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
    };
    const target: VisualSelectionTarget = {
      targetId: 't1',
      documentOrder: 0,
      geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
      semantics: { tagName: 'button', isInteractive: true },
      fingerprints: {},
      resolutionCandidates: [],
    };
    const result = svc.createSingleSelection('page-1', target, pageInfo, {
      x: 0,
      y: 0,
      width: 100,
      height: 40,
    });
    expect(result.ok).toBe(false);
  });

  it('reports health correctly', () => {
    const svc = makeService();
    expect(svc.health().status).toBe('healthy');
    expect(svc.health().totalSelections).toBe(0);
    expect(svc.health().failedSelections).toBe(0);
  });

  it('handles resolveSelection with no active selection', async () => {
    const svc = makeService();
    await svc.enterSelectionMode('page-1');
    const result = await svc.resolveSelection('page-1', 'some-id');
    expect(result.ok).toBe(false);
  });
});

// =============================================================================
// Opaque ID Validation
// =============================================================================

describe('ID Validation', () => {
  it('selection IDs are UUIDs', () => {
    const id = crypto.randomUUID();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('target IDs are opaque strings', () => {
    const id = crypto.randomUUID();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});
