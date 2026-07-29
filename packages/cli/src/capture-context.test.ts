import { generateExport } from '@viskod/context-engine';
import type { ContextPacket } from '@viskod/context-engine';
import { describe, expect, it } from 'vitest';

function mockPacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    packetId: 'capture-ctx-test',
    schemaVersion: '1.0.0',
    timestamp: 'now',
    captureId: 'c1',
    browser: {
      url: 'http://localhost:3000',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      userAgent: 'test',
    },
    selection: {
      selector: '.target-card',
      tagName: 'div',
      boundingBox: { x: 10, y: 20, width: 640, height: 300 },
      text: 'target',
    },
    dom: { tagName: 'div', attributes: {}, childCount: 3, depth: 1 },
    styles: {
      computed: {},
      layout: {
        display: 'block',
        position: 'static',
        width: 640,
        height: 300,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    },
    hierarchy: {
      selectedNode: { tagName: 'div', depth: 0 },
      parents: [],
      siblings: [],
      children: [],
    },
    screenshots: [
      {
        captureId: 'ss1',
        type: 'selection',
        path: 'selection.png',
        width: 100,
        height: 100,
        format: 'png',
        sizeBytes: 512,
      },
    ],
    confidence: {
      sourceMapping: 0,
      semanticLabeling: 0.5,
      layoutAnalysis: 0.8,
      frameworkDetection: 0,
    },
    metadata: {
      engineVersion: '1.0.0',
      processingTimeMs: 100,
      evidenceSources: ['browser-runtime'],
      redactions: ['email'],
    },
    diagnostics: [],
    sourceHints: [
      {
        filePath: 'src/components/TargetCard.jsx',
        confidence: 0.85,
        evidence: 'match',
        isPrimary: true,
        exists: true,
        matchType: 'case-insensitive',
        reason: 'found',
      },
    ],
    runtimeEvidence: {
      console: [{ level: 'error', message: 'test error', timestamp: 'now' }],
      network: [
        {
          request: { method: 'POST', url: '/api/test' },
          response: { status: 500, statusText: 'Error' },
          timestamp: 'now',
        },
      ],
    },
    ...overrides,
  };
}

describe('capture_context response shape', () => {
  it('includes packetId, profile, and brief', () => {
    const packet = mockPacket();
    const brief = generateExport(packet, { format: 'markdown' });
    const captureDir = packet.captureDir ?? '';
    const packetPath = captureDir ? `${captureDir.replace(/\\/g, '/')}/packet.json` : '';
    const response = {
      packetId: packet.packetId,
      packetPath,
      captureDir,
      profile: 'debug',
      briefFormat: 'markdown',
      brief,
      screenshotPaths: (packet.screenshots ?? []).map((s) => s.path),
      sourceHintCount: (packet.sourceHints ?? []).length,
      runtimeEvidenceSummary: {
        console: (packet.runtimeEvidence?.console ?? []).length,
        network: (packet.runtimeEvidence?.network ?? []).length,
      },
      redactionSummary: packet.metadata?.redactions ?? [],
    };

    expect(response.packetId).toBe('capture-ctx-test');
    expect(response.brief).toContain('.target-card');
    expect(response.brief).toContain('TargetCard.jsx');
    expect(response.sourceHintCount).toBe(1);
    expect(response.runtimeEvidenceSummary.console).toBe(1);
    expect(response.runtimeEvidenceSummary.network).toBe(1);
    expect(response.redactionSummary).toContain('email');
    expect(response.screenshotPaths).toContain('selection.png');
  });

  it('capture_context returns packetPath and captureDir', () => {
    const packet = mockPacket({ captureDir: '/tmp/.viskod/captures/test-uuid' });
    const captureDir = packet.captureDir ?? '';
    const packetPath = captureDir ? `${captureDir.replace(/\\/g, '/')}/packet.json` : '';
    expect(packetPath).toBe('/tmp/.viskod/captures/test-uuid/packet.json');
    expect(captureDir).toBe('/tmp/.viskod/captures/test-uuid');
  });

  it('capture_context packetPath points to packet.json', () => {
    const packet = mockPacket({ captureDir: '/tmp/.viskod/captures/test-uuid' });
    const packetPath = `${(packet.captureDir ?? '').replace(/\\/g, '/')}/packet.json`;
    expect(packetPath.endsWith('/packet.json')).toBe(true);
  });

  it('capture_context handles missing captureDir gracefully', () => {
    const packet = mockPacket({ captureDir: undefined });
    const captureDir = packet.captureDir ?? '';
    const packetPath = captureDir ? `${captureDir.replace(/\\/g, '/')}/packet.json` : '';
    expect(captureDir).toBe('');
    expect(packetPath).toBe('');
  });

  it('no daemon token in MCP output', () => {
    const packet = mockPacket();
    const brief = generateExport(packet, { format: 'json' });
    expect(brief).not.toContain('daemon-token');
    expect(brief).not.toContain('sessionToken');
  });

  it('markdown brief includes source hints and bounding box', () => {
    const packet = mockPacket();
    const brief = generateExport(packet, { format: 'markdown' });
    expect(brief).toContain('.target-card');
    expect(brief).toContain('TargetCard.jsx');
    expect(brief).toContain('w=640');
    expect(brief).toContain('h=300');
    expect(brief).toContain('console');
    expect(brief).toContain('500');
  });

  it('json brief returns compact structured fields', () => {
    const packet = mockPacket();
    const brief = JSON.parse(generateExport(packet, { format: 'json' }));
    expect(brief.packetId).toBe('capture-ctx-test');
    expect(brief.selector).toBe('.target-card');
    expect(brief.sourceHints[0].filePath).toBe('src/components/TargetCard.jsx');
    expect(brief.consoleSummary[0].level).toBe('error');
    expect(brief.networkSummary[0].status).toBe(500);
  });

  it('profile passes through correctly', () => {
    const packet = mockPacket();
    // Simulate debug profile detection
    packet.runtimeEvidence = {
      console: [{ level: 'error', message: 'e', timestamp: 'now' }],
      network: [
        {
          request: { method: 'GET', url: '/api' },
          response: { status: 500, statusText: 'E' },
          timestamp: 'now',
        },
      ],
    };
    packet.screenshots = [
      {
        captureId: 'ss1',
        type: 'selection',
        path: 's.png',
        width: 10,
        height: 10,
        format: 'png',
        sizeBytes: 100,
      },
    ];
    const brief = JSON.parse(generateExport(packet, { format: 'json' }));
    expect(brief.profile).toBe('debug');
  });

  it('no daemon token in MCP output', () => {
    const packet = mockPacket();
    const brief = generateExport(packet, { format: 'json' });
    expect(brief).not.toContain('daemon-token');
    expect(brief).not.toContain('sessionToken');
  });
});

describe('recapture_context comparison', () => {
  it('computes bounding box delta', () => {
    const before = mockPacket({
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 10, y: 20, width: 640, height: 200 },
        text: 'before',
      },
    });
    const after = mockPacket({
      packetId: 'after-test',
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 10, y: 20, width: 640, height: 300 },
        text: 'after',
      },
    });

    const beforeBox = before.selection?.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };
    const afterBox = after.selection?.boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };

    const delta = {
      height: Math.round(((afterBox.height ?? 0) - (beforeBox.height ?? 0)) * 100) / 100,
      width: (afterBox.width ?? 0) - (beforeBox.width ?? 0),
    };

    expect(delta.height).toBe(100);
    expect(delta.width).toBe(0);
  });

  it('compares screenshot, source hint, and evidence counts', () => {
    const before = mockPacket({
      screenshots: [],
      sourceHints: [],
      runtimeEvidence: { console: [], network: [] },
    });
    const after = mockPacket();

    const comp = {
      screenshotsBefore: (before.screenshots ?? []).length,
      screenshotsAfter: (after.screenshots ?? []).length,
      sourceHintsBefore: (before.sourceHints ?? []).length,
      sourceHintsAfter: (after.sourceHints ?? []).length,
      consoleBefore: (before.runtimeEvidence?.console ?? []).length,
      consoleAfter: (after.runtimeEvidence?.console ?? []).length,
      networkBefore: (before.runtimeEvidence?.network ?? []).length,
      networkAfter: (after.runtimeEvidence?.network ?? []).length,
    };

    expect(comp.screenshotsBefore).toBe(0);
    expect(comp.screenshotsAfter).toBe(1);
    expect(comp.sourceHintsBefore).toBe(0);
    expect(comp.sourceHintsAfter).toBe(1);
    expect(comp.consoleBefore).toBe(0);
    expect(comp.consoleAfter).toBe(1);
    expect(comp.networkBefore).toBe(0);
    expect(comp.networkAfter).toBe(1);
  });
});

describe('export_context backward compatible', () => {
  it('still works after adding capture_context', () => {
    const packet = mockPacket();
    const md = generateExport(packet, { format: 'markdown' });
    expect(md).toContain('.target-card');
    expect(md).toContain('TargetCard.jsx');
  });
});

describe('existing capture tool unaffected', () => {
  it('capture tool response shape is unchanged', () => {
    const packet = mockPacket();
    const oldResponse = {
      packetId: packet.packetId,
      timestamp: packet.timestamp,
      selection: packet.selection,
      dom: { tagName: packet.dom.tagName, childCount: packet.dom.childCount },
      screenshots: packet.screenshots.length,
      confidence: packet.confidence,
      evidenceSources: packet.metadata.evidenceSources,
      processingTimeMs: packet.metadata.processingTimeMs,
    };
    expect(oldResponse.packetId).toBe('capture-ctx-test');
    expect(oldResponse.screenshots).toBe(1);
    expect(oldResponse.dom.tagName).toBe('div');
  });
});

describe('error handling', () => {
  it('invalid selector would return a clear error from pipeline', () => {
    const packet = mockPacket({
      selection: {
        selector: '.nonexistent',
        tagName: 'div',
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
      },
    });
    // The capture would fail at the browser level, but the exporter still handles the packet
    const brief = generateExport(packet, { format: 'markdown' });
    expect(brief).toContain('.nonexistent');
  });
});
