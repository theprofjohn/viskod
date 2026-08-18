import { describe, expect, it } from 'vitest';
import { collectBoxCandidates, reduceBoxSelection } from './box-selection';
import type { BoxCandidate } from './box-selection';
import { resolveTarget } from './resolver';
import type { ResolvedElement } from './resolver';
import { filterCandidates, scoreAndRank, scoreCandidate } from './scoring';
import type { CandidateElement } from './scoring';
import type { VisualSelectionTarget } from './types';

function el(tag: string, overrides: Partial<CandidateElement> = {}): CandidateElement {
  return {
    tagName: tag,
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    viewportRect: { x: 0, y: 0, width: 100, height: 40 },
    isInteractive: false,
    role: null,
    accessibleName: null,
    hasVisibleText: false,
    hasStableAttributes: false,
    ancestorDepth: 1,
    isLabelControl: false,
    childCount: 0,
    parentTagName: 'div',
    isViskodOwned: false,
    isTechnical: false,
    isPseudoContent: false,
    isHidden: false,
    isOutsideViewport: false,
    parentBoundingRect: null,
    ...overrides,
  };
}

function boxEl(id: string, tag: string, overrides: Partial<BoxCandidate> = {}): BoxCandidate {
  return {
    targetId: id,
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    tagName: tag,
    documentOrder: 0,
    ancestorDepth: 2,
    isInteractive: false,
    isTechnical: false,
    isViskodOwned: false,
    isHidden: false,
    intersectionArea: 4000,
    visibleRatio: 1,
    ...overrides,
  };
}

function target(
  tag: string,
  overrides: Partial<VisualSelectionTarget> = {},
): VisualSelectionTarget {
  return {
    targetId: crypto.randomUUID(),
    documentOrder: 0,
    geometry: { viewportRect: { x: 0, y: 0, width: 100, height: 40 } },
    semantics: { tagName: tag, isInteractive: false, ...overrides.semantics },
    fingerprints: { ...overrides.fingerprints },
    resolutionCandidates: [],
    ...overrides,
  };
}

function resolved(tag: string, overrides: Partial<ResolvedElement> = {}): ResolvedElement {
  return {
    tagName: tag,
    role: null,
    accessibleName: null,
    textContent: '',
    boundingRect: { x: 0, y: 0, width: 100, height: 40 },
    stableAttributes: {},
    ancestorTags: [],
    siblingTags: [],
    documentOrder: 0,
    isInteractive: false,
    ...overrides,
  };
}

describe('DOM Selection Fixtures', () => {
  // Fixture: nested span inside a button
  it('prefers button over nested span', () => {
    const elements = [
      el('span', {
        viewportRect: { x: 10, y: 10, width: 80, height: 20 },
        isInteractive: false,
        ancestorDepth: 3,
        parentTagName: 'button',
        parentBoundingRect: { x: 10, y: 10, width: 80, height: 40 },
      }),
      el('button', {
        viewportRect: { x: 10, y: 10, width: 80, height: 40 },
        isInteractive: true,
        role: 'button',
        hasVisibleText: true,
        ancestorDepth: 2,
        childCount: 2,
      }),
    ];
    const ranked = scoreAndRank(elements, 50, 25);
    expect(ranked.length).toBe(2);
    expect(ranked[0]?.element.tagName).toBe('button');
  });

  // Fixture: icon-only button with accessible label
  it('selects icon-only button with accessible label', () => {
    const elements = [
      el('button', {
        viewportRect: { x: 10, y: 10, width: 40, height: 40 },
        isInteractive: true,
        role: 'button',
        accessibleName: 'Close',
        hasVisibleText: false,
        hasStableAttributes: true,
      }),
      el('i', {
        viewportRect: { x: 15, y: 15, width: 30, height: 30 },
        isInteractive: false,
        hasVisibleText: false,
        ancestorDepth: 3,
        parentBoundingRect: { x: 10, y: 10, width: 40, height: 40 },
      }),
    ];
    const ranked = scoreAndRank(elements, 30, 30);
    expect(ranked[0]?.element.tagName).toBe('button');
    expect(ranked[0]?.element.accessibleName).toBe('Close');
  });

  // Fixture: label associated with input
  it('scores label-associated input higher', () => {
    const elements = [
      el('input', {
        viewportRect: { x: 100, y: 10, width: 200, height: 30 },
        isInteractive: true,
        role: 'textbox',
        isLabelControl: true,
        hasStableAttributes: true,
      }),
      el('label', {
        viewportRect: { x: 10, y: 10, width: 80, height: 30 },
        isInteractive: false,
        hasVisibleText: true,
        ancestorDepth: 2,
      }),
    ];
    const scoredInput = scoreCandidate(elements[0] as NonNullable<(typeof elements)[0]>, 150, 25);
    const scoredLabel = scoreCandidate(elements[1] as NonNullable<(typeof elements)[1]>, 50, 25);
    expect(scoredInput.score).toBeGreaterThan(scoredLabel.score);
  });

  // Fixture: repeated buttons with identical text
  it('resolves correctly with duplicate text buttons', () => {
    const elements = [
      el('button', {
        viewportRect: { x: 10, y: 10, width: 80, height: 30 },
        isInteractive: true,
        role: 'button',
        accessibleName: 'Save',
        hasStableAttributes: true,
        ancestorDepth: 2,
      }),
      el('button', {
        viewportRect: { x: 10, y: 50, width: 80, height: 30 },
        isInteractive: true,
        role: 'button',
        accessibleName: 'Save',
        hasStableAttributes: false,
        ancestorDepth: 2,
      }),
    ];
    const ranked = scoreAndRank(elements, 50, 25);
    expect(ranked.length).toBe(2);
    expect(ranked[0]?.element.hasStableAttributes).toBe(true);
  });

  // Fixture: deeply nested wrappers
  it('penalizes extremely deep elements', () => {
    const shallow = el('button', {
      ancestorDepth: 2,
      viewportRect: { x: 10, y: 10, width: 100, height: 40 },
    });
    const deep = el('span', {
      ancestorDepth: 8,
      viewportRect: { x: 10, y: 10, width: 100, height: 40 },
    });
    const s1 = scoreCandidate(shallow, 50, 25);
    const s2 = scoreCandidate(deep, 50, 25);
    expect(s1.signals.appropriateDepth ?? 0).toBeGreaterThan(s2.signals.appropriateDepth ?? 0);
  });

  // Fixture: flex and grid layouts (elements at different positions)
  it('selects the element under pointer in flex layout', () => {
    const elements = [
      el('button', {
        viewportRect: { x: 10, y: 10, width: 80, height: 30 },
        isInteractive: true,
        role: 'button',
        accessibleName: 'Item 1',
        hasStableAttributes: true,
      }),
      el('button', {
        viewportRect: { x: 100, y: 10, width: 80, height: 30 },
        isInteractive: true,
        role: 'button',
        accessibleName: 'Item 2',
        hasStableAttributes: true,
      }),
      el('button', {
        viewportRect: { x: 190, y: 10, width: 80, height: 30 },
        isInteractive: true,
        role: 'button',
        accessibleName: 'Item 3',
        hasStableAttributes: true,
      }),
    ];
    const ranked = scoreAndRank(elements, 140, 25);
    expect(ranked[0]?.element.accessibleName).toBe('Item 2');
  });

  // Fixture: zero-size elements
  it('filters zero-size elements', () => {
    const elements = [
      el('button', { viewportRect: { x: 0, y: 0, width: 0, height: 0 }, isHidden: true }),
      el('div', { viewportRect: { x: 10, y: 10, width: 100, height: 40 } }),
    ];
    const filtered = filterCandidates(elements);
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.tagName).toBe('div');
  });

  // Fixture: hidden elements
  it('filters hidden elements', () => {
    const elements = [
      el('div', { isHidden: true }),
      el('button', { isHidden: false, viewportRect: { x: 10, y: 10, width: 100, height: 40 } }),
    ];
    const filtered = filterCandidates(elements);
    expect(filtered.length).toBe(1);
  });

  // Fixture: pointer-events: none (simulated as non-interactive)
  it('scores pointer-events-none elements lower', () => {
    const interactive = scoreCandidate(
      el('button', { isInteractive: true, role: 'button', hasStableAttributes: true }),
      50,
      20,
    );
    const none = scoreCandidate(
      el('div', { isInteractive: false, viewportRect: { x: 0, y: 0, width: 100, height: 40 } }),
      50,
      20,
    );
    expect(interactive.score).toBeGreaterThan(none.score);
  });

  // Fixture: box selection across multiple sibling controls
  it('box selection finds siblings in a region', () => {
    const candidates = [
      boxEl('a', 'button', {
        boundingRect: { x: 10, y: 10, width: 80, height: 30 },
        isInteractive: true,
        documentOrder: 1,
      }),
      boxEl('b', 'button', {
        boundingRect: { x: 100, y: 10, width: 80, height: 30 },
        isInteractive: true,
        documentOrder: 2,
      }),
      boxEl('c', 'button', {
        boundingRect: { x: 190, y: 10, width: 80, height: 30 },
        isInteractive: true,
        documentOrder: 3,
      }),
    ];
    const dragRect = { x: 0, y: 0, width: 300, height: 100 };
    const collected = collectBoxCandidates(candidates, dragRect);
    expect(collected.length).toBe(3);
  });

  // Fixture: box selection across a card region
  it('box selection identifies card region elements', () => {
    const candidates = [
      boxEl('card', 'article', {
        boundingRect: { x: 10, y: 10, width: 200, height: 300 },
        ancestorDepth: 1,
        isInteractive: false,
        isTechnical: false,
      }),
      boxEl('title', 'h2', {
        boundingRect: { x: 20, y: 20, width: 180, height: 30 },
        ancestorDepth: 2,
        isInteractive: false,
        documentOrder: 1,
      }),
      boxEl('desc', 'p', {
        boundingRect: { x: 20, y: 60, width: 180, height: 60 },
        ancestorDepth: 2,
        isInteractive: false,
        documentOrder: 2,
      }),
    ];
    const dragRect = { x: 5, y: 5, width: 210, height: 310 };
    const collected = collectBoxCandidates(candidates, dragRect);
    const { selected } = reduceBoxSelection(collected);
    expect(selected.length).toBeGreaterThan(0);
  });

  // Fixture: box selection - excludes overlay nodes
  it('box selection excludes overlay nodes', () => {
    const candidates = [
      boxEl('overlay', 'div', { isViskodOwned: true }),
      boxEl('real', 'button', {
        boundingRect: { x: 10, y: 10, width: 100, height: 40 },
        isInteractive: true,
      }),
    ];
    const dragRect = { x: 0, y: 0, width: 500, height: 500 };
    const collected = collectBoxCandidates(candidates, dragRect);
    expect(collected.length).toBe(1);
    expect(collected[0]?.targetId).toBe('real');
  });

  // Fixture: stale node after DOM replacement
  it('re-resolution returns stale for replaced element', () => {
    const original = target('button', {
      semantics: { tagName: 'button', isInteractive: true, textPreview: 'Old text' },
      fingerprints: { stableAttributes: { 'data-testid': 'old-btn' } },
    });
    const candidates = [
      resolved('button', {
        textContent: 'Completely different',
        stableAttributes: { 'data-testid': 'new-btn' },
        ancestorTags: ['section', 'footer'],
        boundingRect: { x: 500, y: 600, width: 50, height: 20 },
      }),
    ];
    const result = resolveTarget(original, candidates);
    expect(result.resolution.status === 'stale' || result.resolution.status === 'missing').toBe(
      true,
    );
  });

  // Fixture: SVG child elements (should be selectable if meaningful)
  it('does not crash on SVG-like bounding rects', () => {
    const svgChild = el('path', {
      viewportRect: { x: 10, y: 10, width: 5, height: 5 },
      isInteractive: false,
      tagName: 'path',
    });
    const scored = scoreCandidate(svgChild, 12, 12);
    expect(scored.score).toBeDefined();
    expect(Number.isFinite(scored.score)).toBe(true);
  });

  // Fixture: overlays with extremely high z-index
  it('hover mode ignores non-overlay elements with high z-index', () => {
    const elements = [
      el('div', {
        viewportRect: { x: 0, y: 0, width: 1000, height: 1000 },
        ancestorDepth: 1,
        isTechnical: true,
        isHidden: false,
      }),
      el('button', {
        viewportRect: { x: 100, y: 100, width: 100, height: 40 },
        isInteractive: true,
        role: 'button',
        accessibleName: 'Target',
        ancestorDepth: 3,
      }),
    ];
    // filterCandidates removes technical elements (html, body wrappers)
    const filtered = filterCandidates(elements);
    const buttonElement = filtered.find((e) => e.tagName === 'button');
    expect(buttonElement).toBeDefined();
  });

  // Fixture: text changes while role and stable attributes remain
  it('re-resolution works with text change when attrs match', () => {
    const original = target('button', {
      semantics: {
        tagName: 'button',
        isInteractive: true,
        textPreview: 'Submit form',
        role: 'button',
      },
      fingerprints: {
        stableAttributes: { 'data-testid': 'submit-btn', id: 'submit-button' },
        ancestorFingerprint: ['div', 'form'],
      },
    });
    const candidate = resolved('button', {
      textContent: 'Submit',
      stableAttributes: { 'data-testid': 'submit-btn', id: 'submit-button' },
      ancestorTags: ['div', 'form'],
      role: 'button',
    });
    const result = resolveTarget(original, [candidate]);
    expect(result.resolution.status).toBe('resolved');
    expect(result.resolution.confidence).toBeGreaterThan(0.6);
  });

  // Fixture: route transition (all evidence gone)
  it('returns missing after route transition', () => {
    const original = target('button', {
      semantics: { tagName: 'button', isInteractive: true, textPreview: 'Dashboard' },
      fingerprints: {
        stableAttributes: { 'data-testid': 'dash-link' },
        ancestorFingerprint: ['nav', 'header'],
      },
    });
    const candidate = resolved('h1', {
      textContent: 'Welcome',
      stableAttributes: {},
      ancestorTags: ['main'],
      tagName: 'h1',
    });
    const result = resolveTarget(original, [candidate]);
    expect(result.resolution.status).toBe('missing');
  });

  // Fixture: selection after viewport resize (geometry change)
  it('resolves after viewport resize when identity matches', () => {
    const original = target('button', {
      semantics: {
        tagName: 'button',
        isInteractive: true,
        textPreview: 'Continue',
        role: 'button',
      },
      fingerprints: {
        stableAttributes: { 'data-testid': 'continue-btn' },
        ancestorFingerprint: ['div', 'main'],
      },
      geometry: { viewportRect: { x: 400, y: 300, width: 120, height: 48 } },
    });
    const candidate = resolved('button', {
      textContent: 'Continue',
      stableAttributes: { 'data-testid': 'continue-btn' },
      ancestorTags: ['div', 'main'],
      boundingRect: { x: 200, y: 150, width: 120, height: 48 },
      role: 'button',
    });
    const result = resolveTarget(original, [candidate]);
    expect(result.resolution.status).toBe('resolved');
  });
});
