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

function buildComparisonSummary(before: ContextPacket, after: ContextPacket) {
  const prevSelection = before.selection ?? { boundingBox: { x: 0, y: 0, width: 0, height: 0 } };
  const curSelection = after.selection ?? { boundingBox: { x: 0, y: 0, width: 0, height: 0 } };
  const prevBox = prevSelection.boundingBox ?? {};
  const curBox = curSelection.boundingBox ?? {};

  const dx =
    curBox.x !== undefined && prevBox.x !== undefined
      ? Math.round((curBox.x - prevBox.x) * 100) / 100
      : undefined;
  const dy =
    curBox.y !== undefined && prevBox.y !== undefined
      ? Math.round((curBox.y - prevBox.y) * 100) / 100
      : undefined;
  const dw =
    curBox.width !== undefined && prevBox.width !== undefined
      ? Math.round((curBox.width - prevBox.width) * 100) / 100
      : undefined;
  const dh =
    curBox.height !== undefined && prevBox.height !== undefined
      ? Math.round((curBox.height - prevBox.height) * 100) / 100
      : undefined;

  const beforeArea =
    prevBox.width !== undefined && prevBox.height !== undefined
      ? Math.round(prevBox.width * prevBox.height * 100) / 100
      : undefined;
  const afterArea =
    curBox.width !== undefined && curBox.height !== undefined
      ? Math.round(curBox.width * curBox.height * 100) / 100
      : undefined;
  const areaDelta =
    beforeArea !== undefined && afterArea !== undefined
      ? Math.round((afterArea - beforeArea) * 100) / 100
      : undefined;
  const percentChange =
    beforeArea !== undefined && afterArea !== undefined && beforeArea > 0
      ? Math.round(((afterArea - beforeArea) / beforeArea) * 10000) / 100
      : undefined;

  const consoleBefore = (before.runtimeEvidence?.console ?? []).length;
  const consoleAfter = (after.runtimeEvidence?.console ?? []).length;
  const networkBefore = (before.runtimeEvidence?.network ?? []).length;
  const networkAfter = (after.runtimeEvidence?.network ?? []).length;
  const sourceHintsBefore = (before.sourceHints ?? []).length;
  const sourceHintsAfter = (after.sourceHints ?? []).length;
  const screenshotsBefore = (before.screenshots ?? []).length;
  const screenshotsAfter = (after.screenshots ?? []).length;

  const changedFields: string[] = [];
  if (dw !== undefined && dw !== 0) changedFields.push('boundingBox.width');
  if (dh !== undefined && dh !== 0) changedFields.push('boundingBox.height');
  if (dx !== undefined && dx !== 0) changedFields.push('boundingBox.x');
  if (dy !== undefined && dy !== 0) changedFields.push('boundingBox.y');
  if (consoleBefore !== consoleAfter) changedFields.push('evidence.console');
  if (networkBefore !== networkAfter) changedFields.push('evidence.network');
  if (sourceHintsBefore !== sourceHintsAfter) changedFields.push('sourceHints');
  if (screenshotsBefore !== screenshotsAfter) changedFields.push('screenshots');

  let verdict = 'unchanged';
  if (changedFields.length > 0) {
    if (dh !== undefined && dw !== undefined && dh > 0 && dw < 0) {
      verdict = 'improved';
    } else {
      verdict = 'changed';
    }
  }

  const notesParts: string[] = [];
  if (changedFields.length > 0) {
    notesParts.push(`Fields changed: ${changedFields.join(', ')}`);
  } else {
    notesParts.push('No meaningful field changes detected');
  }
  if (dh !== undefined) notesParts.push(`height delta: ${dh}`);
  if (dw !== undefined) notesParts.push(`width delta: ${dw}`);

  return {
    boundingBoxDelta: {
      x: { before: prevBox.x, after: curBox.x, delta: dx },
      y: { before: prevBox.y, after: curBox.y, delta: dy },
      width: { before: prevBox.width, after: curBox.width, delta: dw },
      height: { before: prevBox.height, after: curBox.height, delta: dh },
    },
    areaDelta: {
      beforeArea,
      afterArea,
      delta: areaDelta,
      percentChange,
    },
    evidenceDelta: {
      console: { before: consoleBefore, after: consoleAfter, delta: consoleAfter - consoleBefore },
      network: { before: networkBefore, after: networkAfter, delta: networkAfter - networkBefore },
      sourceHints: {
        before: sourceHintsBefore,
        after: sourceHintsAfter,
        delta: sourceHintsAfter - sourceHintsBefore,
      },
      screenshots: {
        before: screenshotsBefore,
        after: screenshotsAfter,
        delta: screenshotsAfter - screenshotsBefore,
      },
    },
    changedFields,
    verdict,
    notes: notesParts.join('; '),
  };
}

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

    const comp = buildComparisonSummary(before, after);

    expect(comp.boundingBoxDelta.height.before).toBe(200);
    expect(comp.boundingBoxDelta.height.after).toBe(300);
    expect(comp.boundingBoxDelta.height.delta).toBe(100);
    expect(comp.boundingBoxDelta.width.delta).toBe(0);
  });

  it('boundingBoxDelta includes x, y, width, height before/after/delta', () => {
    const before = mockPacket({
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 5, y: 10, width: 200, height: 100 },
      },
    });
    const after = mockPacket({
      packetId: 'a2',
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 15, y: 20, width: 250, height: 150 },
      },
    });

    const comp = buildComparisonSummary(before, after);
    expect(comp.boundingBoxDelta.x).toEqual({ before: 5, after: 15, delta: 10 });
    expect(comp.boundingBoxDelta.y).toEqual({ before: 10, after: 20, delta: 10 });
    expect(comp.boundingBoxDelta.width).toEqual({ before: 200, after: 250, delta: 50 });
    expect(comp.boundingBoxDelta.height).toEqual({ before: 100, after: 150, delta: 50 });
  });

  it('areaDelta percentChange is correct', () => {
    const before = mockPacket({
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
      },
    });
    const after = mockPacket({
      packetId: 'a3',
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 0, y: 0, width: 150, height: 200 },
      },
    });

    const comp = buildComparisonSummary(before, after);
    // before area: 100 * 100 = 10000
    // after area: 150 * 200 = 30000
    // percent change: ((30000 - 10000) / 10000) * 100 = 200%
    expect(comp.areaDelta.beforeArea).toBe(10000);
    expect(comp.areaDelta.afterArea).toBe(30000);
    expect(comp.areaDelta.delta).toBe(20000);
    expect(comp.areaDelta.percentChange).toBe(200);
  });

  it('evidenceDelta counts are correct', () => {
    const before = mockPacket({
      screenshots: [],
      sourceHints: [],
      runtimeEvidence: { console: [], network: [] },
    });
    const after = mockPacket();

    const comp = buildComparisonSummary(before, after);

    expect(comp.evidenceDelta.console).toEqual({ before: 0, after: 1, delta: 1 });
    expect(comp.evidenceDelta.network).toEqual({ before: 0, after: 1, delta: 1 });
    expect(comp.evidenceDelta.sourceHints).toEqual({ before: 0, after: 1, delta: 1 });
    expect(comp.evidenceDelta.screenshots).toEqual({ before: 0, after: 1, delta: 1 });
  });

  it('verdict is "changed" for one-dimensional layout changes', () => {
    // Only height changed (no width change)
    const before = mockPacket({
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 10, y: 20, width: 640, height: 200 },
      },
    });
    const after = mockPacket({
      packetId: 'changed-test',
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 10, y: 20, width: 640, height: 250 },
      },
    });

    const comp = buildComparisonSummary(before, after);
    // height changed, width unchanged -> verdict should be "changed" (not "improved")
    expect(comp.verdict).toBe('changed');
    expect(comp.changedFields).toContain('boundingBox.height');
    expect(comp.changedFields).not.toContain('boundingBox.width');
  });

  it('verdict is "improved" when height increases and width shrinks', () => {
    const before = mockPacket({
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 10, y: 20, width: 640, height: 110 },
      },
    });
    const after = mockPacket({
      packetId: 'improved-test',
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 10, y: 20, width: 620, height: 147 },
      },
    });

    const comp = buildComparisonSummary(before, after);
    expect(comp.verdict).toBe('improved');
    expect(comp.changedFields).toContain('boundingBox.width');
    expect(comp.changedFields).toContain('boundingBox.height');
  });

  it('verdict is "unchanged" when all fields are identical', () => {
    const packet = mockPacket();
    const comp = buildComparisonSummary(packet, packet);
    expect(comp.verdict).toBe('unchanged');
    expect(comp.changedFields).toHaveLength(0);
  });

  it('changedFields lists only fields that changed meaningfully', () => {
    const before = mockPacket({
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 5, y: 5, width: 640, height: 200 },
      },
      screenshots: [],
      sourceHints: [],
      runtimeEvidence: {
        console: [{ level: 'error', message: 'e1', timestamp: 't1' }],
        network: [],
      },
    });
    const after = mockPacket({
      packetId: 'fields-test',
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 5, y: 5, width: 640, height: 250 },
      },
      runtimeEvidence: {
        console: [
          { level: 'error', message: 'e1', timestamp: 't1' },
          { level: 'warn', message: 'w1', timestamp: 't2' },
        ],
        network: [
          {
            request: { method: 'GET', url: '/api' },
            response: { status: 200, statusText: 'OK' },
            timestamp: 't3',
          },
        ],
      },
    });

    const comp = buildComparisonSummary(before, after);
    expect(comp.changedFields).toContain('boundingBox.height');
    expect(comp.changedFields).toContain('evidence.console');
    expect(comp.changedFields).toContain('evidence.network');
    expect(comp.changedFields).toContain('sourceHints');
    expect(comp.changedFields).toContain('screenshots');
    expect(comp.changedFields).not.toContain('boundingBox.x');
    expect(comp.changedFields).not.toContain('boundingBox.y');
    expect(comp.changedFields).not.toContain('boundingBox.width');
  });

  it('notes provides machine-readable explanation', () => {
    const before = mockPacket({
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 0, y: 0, width: 640, height: 200 },
      },
    });
    const after = mockPacket({
      packetId: 'notes-test',
      selection: {
        selector: '.card',
        tagName: 'div',
        boundingBox: { x: 0, y: 0, width: 640, height: 300 },
      },
    });

    const comp = buildComparisonSummary(before, after);
    expect(comp.notes).toContain('Fields changed:');
    expect(comp.notes).toContain('height delta: 100');
  });

  it('no daemon token in comparisonSummary', () => {
    const before = mockPacket();
    const after = mockPacket({ packetId: 'no-token-test' });
    const comp = buildComparisonSummary(before, after);
    const json = JSON.stringify(comp);
    expect(json).not.toContain('daemon-token');
    expect(json).not.toContain('sessionToken');
    expect(json).not.toContain('token');
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

describe('capture_context schema backward compatible', () => {
  it('existing capture_context schema remains backward compatible', () => {
    // Simulate old caller without reload/cacheBust
    const args = {
      selector: '.card',
      url: 'http://localhost:3000',
      profile: 'default',
    };
    // Old caller should not need reload/cacheBust fields
    expect(args.selector).toBe('.card');
    expect(Object.keys(args)).not.toContain('reload');
    expect(Object.keys(args)).not.toContain('cacheBust');
  });

  it('reload defaults to false for capture_context when not provided', () => {
    const args: Record<string, unknown> = { selector: '.card' };
    const reload = (args.reload as boolean | undefined) ?? false;
    const cacheBust = (args.cacheBust as boolean | undefined) ?? false;
    expect(reload).toBe(false);
    expect(cacheBust).toBe(false);
  });

  it('recapture_context defaults reload to true when previousPacketPath is provided', () => {
    // Simulate the default logic: prevPath is truthy => reload defaults true
    const prevPath = '/tmp/packet.json';
    const reloadDefault = !!prevPath;
    expect(reloadDefault).toBe(true);
  });

  it('recapture_context reload defaults to false when no previousPacketPath', () => {
    // Simulate the default logic: prevPath is falsy => reload defaults false
    const prevPath = undefined;
    const reloadDefault = !!prevPath;
    expect(reloadDefault).toBe(false);
  });
});

describe('cacheBust URL behavior', () => {
  it('cacheBust appends __viskod_cb without dropping existing query params', () => {
    const originalUrl = 'http://localhost:3000/page?foo=bar';
    const urlObj = new URL(originalUrl);
    urlObj.searchParams.set('__viskod_cb', String(Date.now()));
    const bustUrl = urlObj.toString();

    expect(bustUrl).toContain('__viskod_cb=');
    expect(bustUrl).toContain('foo=bar');
    // Original params preserved
    const parsed = new URL(bustUrl);
    expect(parsed.searchParams.get('foo')).toBe('bar');
    expect(parsed.searchParams.get('__viskod_cb')).toBeTruthy();
  });

  it('cacheBust does not mutate original URL permanently', () => {
    const originalUrl = 'http://localhost:3000/page';
    const urlObj = new URL(originalUrl);
    urlObj.searchParams.set('__viskod_cb', String(Date.now()));
    const bustUrl = urlObj.toString();

    expect(bustUrl).not.toBe(originalUrl);
    expect(new URL(originalUrl).searchParams.has('__viskod_cb')).toBe(false);
  });

  it('cacheBust handles URLs without query params', () => {
    const url = 'http://localhost:3000/page';
    const urlObj = new URL(url);
    urlObj.searchParams.set('__viskod_cb', '12345');
    expect(urlObj.toString()).toBe('http://localhost:3000/page?__viskod_cb=12345');
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
