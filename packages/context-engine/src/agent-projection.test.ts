import { describe, expect, it } from 'vitest';
import { buildAgentContextProjection } from './agent-projection';
import type { ProjectionPacketSource } from './agent-projection';

function makeSource(overrides: Partial<ProjectionPacketSource> = {}): ProjectionPacketSource {
  return {
    captureId: 'cap-1',
    packetId: 'pkt-1',
    captureStatus: 'partial',
    timestamp: 'now',
    selection: {
      selector: '.save-btn',
      tagName: 'button',
      boundingBox: { x: 10, y: 20, width: 120, height: 40 },
      text: 'Save changes — a '.repeat(200),
    },
    dom: {
      attributes: Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [`attr-${i}`, `value-${i}-${'x'.repeat(500)}`]),
      ),
    },
    browser: {
      url: 'http://example.test/settings?token=abc123',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    },
    hierarchy: {
      selectedNode: { tagName: 'button', depth: 1 },
      parents: Array.from({ length: 30 }, (_, i) => ({
        tagName: `p${i}`,
        depth: i,
        text: `text-${i}`,
      })),
    },
    styles: {
      computed: Object.fromEntries(
        Array.from({ length: 80 }, (_, i) => [`--prop-${i}`, `${'v'.repeat(400)}${i}`]),
      ),
    },
    screenshots: [
      { type: 'selection', format: 'png', width: 120, height: 40, sizeBytes: 0, sensitive: true },
    ],
    sourceHints: Array.from({ length: 20 }, (_, i) => ({
      filePath: `f${i}.tsx`,
      displayPath: `f${i}.tsx`,
      confidence: 0.4,
      qualification: 'possible',
      reasons: ['visible text match'],
    })),
    evidence: {
      dom: { state: 'collected' },
      hierarchy: { state: 'collected' },
      styles: { state: 'collected' },
      screenshot: { state: 'omitted_sensitive' },
      runtime: { state: 'collected' },
      sourceHints: { state: 'unavailable' },
    },
    runtimeEvidence: {
      console: Array.from({ length: 40 }, (_, i) => ({
        level: i % 2 ? 'warn' : 'error',
        message: `msg-${i}-${'m'.repeat(600)}`,
      })),
      network: Array.from({ length: 25 }, (_, i) => ({
        request: { method: 'GET', url: `http://example.test/api/${i}/${'p'.repeat(400)}` },
        response: { status: 200 },
      })),
      selectedElement: {
        tagName: 'button',
        text: 'Save changes',
        attributes: { 'data-testid': 'save-btn' },
      },
    },
    metadata: { redactions: ['email'] },
    ...overrides,
  };
}

describe('buildAgentContextProjection', () => {
  it('is compact and bounded', () => {
    const p = buildAgentContextProjection(makeSource());
    // Attributes capped at 20, values at 200 chars.
    expect(Object.keys(p.target.attributes)).toHaveLength(20);
    for (const v of Object.values(p.target.attributes)) expect(v.length).toBeLessThanOrEqual(201);
    // Parents capped at 8.
    expect(p.hierarchy.parents).toHaveLength(8);
    // Styles capped at 40 entries, values at 200 chars.
    expect(Object.keys(p.styles.computed)).toHaveLength(40);
    for (const v of Object.values(p.styles.computed)) expect(v.length).toBeLessThanOrEqual(201);
    // Console grouped with sample capped at 200 chars; entries capped at 10.
    expect(p.runtime.console?.length ?? 0).toBeLessThanOrEqual(2);
    for (const c of p.runtime.console ?? []) expect(c.sample.length).toBeLessThanOrEqual(201);
    // Network capped at 10 with url capped at 200.
    expect(p.runtime.network).toHaveLength(10);
    for (const n of p.runtime.network ?? []) expect(n.url.length).toBeLessThanOrEqual(201);
    // Target text capped at 500.
    expect(p.target.text.length).toBeLessThanOrEqual(501);
  });

  it('carries identity, integrity, and evidence statuses', () => {
    const p = buildAgentContextProjection(makeSource(), {
      handoffId: 'handoff_abc123',
      issueId: 'issue-1',
      problem: { title: 'Fix save', summary: 'Button broken', userNote: 'expected result: works' },
      targetFingerprint: { targetCount: 1, confidence: 0.9, resolutionStatus: 'resolved' },
    });
    expect(p.captureId).toBe('cap-1');
    expect(p.packetId).toBe('pkt-1');
    expect(p.captureStatus).toBe('partial');
    expect(p.handoffId).toBe('handoff_abc123');
    expect(p.issueId).toBe('issue-1');
    expect(p.problem?.title).toBe('Fix save');
    expect(p.target.fingerprint).toEqual({
      targetCount: 1,
      confidence: 0.9,
      resolutionStatus: 'resolved',
    });
    expect(p.evidence.screenshot.state).toBe('omitted_sensitive');
    expect(p.evidence.sourceHints.state).toBe('unavailable');
    expect(p.sourceHints.status).toBe('unavailable');
    expect(p.sourceHints.count).toBe(20);
    // Phase 30: bounded candidates (5 max), no absolute paths, no unsupported
    // certainty.
    expect(p.sourceHints.candidates.length).toBeLessThanOrEqual(5);
    for (const c of p.sourceHints.candidates) {
      expect(c.path).not.toContain('C:\\');
      expect(c.path).not.toContain('/Users/');
      expect(['exact', 'probable', 'possible', 'weak']).toContain(c.qualification);
      expect(c.reasons.length).toBeLessThanOrEqual(3);
    }
  });

  it('marks screenshots sensitive and reports status', () => {
    const p = buildAgentContextProjection(makeSource());
    expect(p.screenshot.status).toBe('omitted_sensitive');
    expect(p.screenshot.count).toBe(1);
    expect(p.screenshot.sensitive).toBe(true);
    expect(p.screenshot.items[0]?.width).toBe(120);
  });

  it('never fabricates source hints: unavailable stays unavailable', () => {
    const p = buildAgentContextProjection(makeSource());
    expect(p.sourceHints.status).toBe('unavailable');
    expect(p.sourceHints.count).toBe(20); // count is factual; status is unavailable
    expect(p.sourceHints.resolution).toBe('ambiguous');
  });

  it('derives resolution deterministically from persisted candidates', () => {
    const resolved = buildAgentContextProjection(
      makeSource({
        evidence: {
          dom: { state: 'collected' },
          hierarchy: { state: 'collected' },
          styles: { state: 'collected' },
          screenshot: { state: 'omitted_sensitive' },
          runtime: { state: 'collected' },
          sourceHints: { state: 'collected' },
        },
        sourceHints: [
          {
            filePath: 'src/features/settings/SaveButton.tsx',
            displayPath: 'src/features/settings/SaveButton.tsx',
            confidence: 0.71,
            qualification: 'probable',
            reasons: ['unique visible text', 'imported by current route'],
          },
          {
            filePath: 'app/settings/page.tsx',
            displayPath: 'app/settings/page.tsx',
            confidence: 0.61,
            qualification: 'possible',
            reasons: ['current route maps to this file'],
          },
        ],
      }),
    );
    expect(resolved.sourceHints.resolution).toBe('resolved');
    // No persisted snapshot in this fixture → deterministic derivation,
    // clearly marked as such (legacy compatibility path).
    expect(resolved.sourceHints.resolutionSource).toBe('derived');
    expect(resolved.sourceHints.candidates[0]?.path).toBe('src/features/settings/SaveButton.tsx');
    expect(resolved.sourceHints.candidates[0]?.qualification).toBe('probable');
    expect(resolved.sourceHints.candidates[0]?.reasons[0]).toContain('unique visible text');
  });

  it('rejects absolute or escaping candidate paths in the projection', () => {
    const p = buildAgentContextProjection(
      makeSource({
        sourceHints: [
          {
            filePath: 'C:\\Users\\victim\\src\\Evil.tsx',
            displayPath: 'C:\\Users\\victim\\src\\Evil.tsx',
            confidence: 0.9,
            qualification: 'probable',
            reasons: ['leak'],
          },
          {
            filePath: '../outside.tsx',
            displayPath: '../outside.tsx',
            confidence: 0.9,
            qualification: 'probable',
            reasons: ['escape'],
          },
          {
            filePath: 'src/ok.tsx',
            displayPath: 'src/ok.tsx',
            confidence: 0.9,
            qualification: 'probable',
            reasons: ['fine'],
          },
        ],
      }),
    );
    const paths = p.sourceHints.candidates.map((c) => c.path);
    expect(paths).toEqual(['src/ok.tsx']);
    expect(JSON.stringify(p)).not.toContain('C:\\Users');
    expect(JSON.stringify(p)).not.toContain('..\\outside');
  });

  it('rejects file:// URIs and backslash paths in the projection (Phase 30A)', () => {
    const p = buildAgentContextProjection(
      makeSource({
        sourceHints: [
          {
            filePath: 'file:///tmp/x.ts',
            displayPath: 'file:///tmp/x.ts',
            confidence: 0.9,
            qualification: 'probable',
            reasons: ['uri'],
          },
          {
            filePath: 'src\\secret.ts',
            displayPath: 'src\\secret.ts',
            confidence: 0.9,
            qualification: 'probable',
            reasons: ['backslash'],
          },
          {
            filePath: '/Users/x/secret.ts',
            displayPath: '/Users/x/secret.ts',
            confidence: 0.9,
            qualification: 'probable',
            reasons: ['absolute'],
          },
          {
            filePath: 'src/ok.tsx',
            displayPath: 'src/ok.tsx',
            confidence: 0.9,
            qualification: 'probable',
            reasons: ['fine'],
          },
        ],
      }),
    );
    expect(p.sourceHints.candidates.map((c) => c.path)).toEqual(['src/ok.tsx']);
    expect(JSON.stringify(p)).not.toContain('file://');
    expect(JSON.stringify(p)).not.toContain('/Users/');
  });

  it('uses the PERSISTED capture-time resolution snapshot, never present-day policy (Phase 30A)', () => {
    // Two tied candidates would derive 'ambiguous' under today's rule, but the
    // capture-time snapshot concluded 'resolved'. The fresh process must
    // report the persisted conclusion verbatim.
    const p = buildAgentContextProjection(
      makeSource({
        sourceHintsResolution: {
          status: 'resolved',
          modelVersion: '2.0.0',
          topCandidate: 'src/components/TargetCard.jsx',
        },
        sourceHints: [
          {
            filePath: 'src/components/TargetCard.jsx',
            displayPath: 'src/components/TargetCard.jsx',
            confidence: 0.54,
            qualification: 'possible',
            reasons: ['visible text found only in this file'],
          },
          {
            filePath: 'src/components/OtherCard.jsx',
            displayPath: 'src/components/OtherCard.jsx',
            confidence: 0.54,
            qualification: 'possible',
            reasons: ['visible text also appears in other files'],
          },
        ],
      }),
    );
    expect(p.sourceHints.resolution).toBe('resolved');
    expect(p.sourceHints.resolutionSource).toBe('persisted');
    expect(p.sourceHints.modelVersion).toBe('2.0.0');
    // Candidates preserved verbatim: qualification, confidence, order.
    expect(p.sourceHints.candidates.map((c) => c.path)).toEqual([
      'src/components/TargetCard.jsx',
      'src/components/OtherCard.jsx',
    ]);
    for (const c of p.sourceHints.candidates) {
      expect(c.qualification).toBe('possible');
      expect(c.confidence).toBe(0.54);
    }
  });

  it('persisted resolution wins even when today\u2019s derivation would disagree (Phase 30A stability)', () => {
    // Single probable candidate would derive 'resolved'; the persisted
    // snapshot says 'ambiguous'. The snapshot is the historical conclusion.
    const p = buildAgentContextProjection(
      makeSource({
        sourceHintsResolution: {
          status: 'ambiguous',
          modelVersion: '2.0.0',
        },
        sourceHints: [
          {
            filePath: 'src/features/settings/SaveButton.tsx',
            displayPath: 'src/features/settings/SaveButton.tsx',
            confidence: 0.71,
            qualification: 'probable',
            reasons: ['unique visible text'],
          },
        ],
      }),
    );
    expect(p.sourceHints.resolution).toBe('ambiguous');
    expect(p.sourceHints.resolutionSource).toBe('persisted');
    expect(p.sourceHints.candidates[0]?.qualification).toBe('probable');
    expect(p.sourceHints.candidates[0]?.confidence).toBe(0.71);
  });

  it('legacy packets without a snapshot derive resolution and mark it as derived (Phase 30A)', () => {
    const p = buildAgentContextProjection(
      makeSource({
        sourceHints: [
          {
            filePath: 'src/components/TargetCard.jsx',
            displayPath: 'src/components/TargetCard.jsx',
            confidence: 0.54,
            qualification: 'possible',
            reasons: ['visible text found only in this file'],
          },
        ],
      }),
    );
    expect(p.sourceHints.resolution).toBe('resolved');
    expect(p.sourceHints.resolutionSource).toBe('derived');
    expect(p.sourceHints.modelVersion).toBeUndefined();
    expect(p.sourceHints.candidates[0]?.qualification).toBe('possible');
  });

  it('does not re-derive qualification from confidence for persisted candidates (Phase 30A)', () => {
    // A weak 0.40 candidate must stay weak — confidence-based re-derivation
    // would have promoted it to possible.
    const p = buildAgentContextProjection(
      makeSource({
        sourceHintsResolution: { status: 'unavailable', modelVersion: '2.0.0' },
        sourceHints: [
          {
            filePath: 'src/components/Generic.jsx',
            displayPath: 'src/components/Generic.jsx',
            confidence: 0.4,
            qualification: 'weak',
            reasons: ['generic class — weak evidence'],
          },
        ],
      }),
    );
    expect(p.sourceHints.candidates[0]?.qualification).toBe('weak');
    expect(p.sourceHints.candidates[0]?.confidence).toBe(0.4);
    expect(p.sourceHints.resolution).toBe('unavailable');
    expect(p.sourceHints.resolutionSource).toBe('persisted');
  });

  it('no absolute paths or raw payloads in the projection', () => {
    const json = JSON.stringify(buildAgentContextProjection(makeSource()));
    expect(json).not.toContain('captureDir');
    expect(json).not.toContain('packet.json');
    expect(json).not.toContain('/tmp/');
    expect(json).not.toContain('C:\\');
  });
});
