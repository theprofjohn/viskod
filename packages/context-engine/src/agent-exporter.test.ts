import { describe, expect, it } from 'vitest';
import { generateExport } from './agent-exporter';
import type { ContextPacket } from './index';

function mockPacket(overrides: Partial<ContextPacket> = {}): ContextPacket {
  return {
    packetId: 'test-packet-123',
    schemaVersion: '1.0.0',
    timestamp: '2026-07-29T00:00:00Z',
    captureId: 'capture-1',
    browser: {
      url: 'http://localhost:3000',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      userAgent: 'test',
    },
    selection: {
      selector: '.target-card',
      tagName: 'div',
      boundingBox: { x: 10, y: 20, width: 640, height: 300 },
      text: 'Target content here',
    },
    dom: { tagName: 'div', attributes: { class: 'target-card' }, childCount: 3, depth: 1 },
    styles: {
      computed: { display: 'block' },
      layout: {
        display: 'block',
        position: 'static',
        width: 640,
        height: 300,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
      },
    },
    hierarchy: {
      selectedNode: { tagName: 'div', depth: 0 },
      parents: [{ tagName: 'body', depth: 1 }],
      siblings: [],
      children: [],
    },
    screenshots: [
      {
        captureId: 'ss1',
        type: 'selection',
        path: 'selection.png',
        width: 1280,
        height: 720,
        format: 'png',
        sizeBytes: 1024,
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
      processingTimeMs: 150,
      evidenceSources: ['browser-runtime', 'browser-runtime:evidence'],
      redactions: ['email', 'api-key'],
    },
    diagnostics: [],
    sourceHints: [
      {
        filePath: 'src/components/TargetCard.jsx',
        confidence: 0.85,
        evidence: 'class-name-match',
        isPrimary: true,
        exists: true,
        matchType: 'case-insensitive',
        reason: 'Case-insensitive match',
      },
      {
        filePath: 'src/components/TargetCard.css',
        confidence: 0.8,
        evidence: 'style-adjacent',
        isPrimary: false,
        exists: true,
        matchType: 'style-adjacent',
        reason: 'Style file adjacent',
      },
    ],
    runtimeEvidence: {
      console: [{ level: 'error', message: 'sk_test_abc should be redacted', timestamp: 'now' }],
      network: [
        {
          request: { method: 'GET', url: 'http://localhost:3000/api/test' },
          response: { status: 500, statusText: 'Error' },
          timestamp: 'now',
        },
      ],
    },
    ...overrides,
  };
}

describe('AgentContextExporter', () => {
  describe('markdown format', () => {
    it('includes selector and bounding box', () => {
      const output = generateExport(mockPacket(), { format: 'markdown' });
      expect(output).toContain('.target-card');
      expect(output).toContain('w=640');
      expect(output).toContain('h=300');
    });

    it('includes top source hints', () => {
      const output = generateExport(mockPacket(), { format: 'markdown' });
      expect(output).toContain('TargetCard.jsx');
      expect(output).toContain('TargetCard.css');
      expect(output).toContain('85%');
      expect(output).toContain('80%');
    });

    it('includes console evidence summary', () => {
      const output = generateExport(mockPacket(), { format: 'markdown' });
      expect(output).toContain('Console Evidence');
      expect(output).toContain('error');
    });

    it('includes network evidence summary', () => {
      const output = generateExport(mockPacket(), { format: 'markdown' });
      expect(output).toContain('Network Evidence');
      expect(output).toContain('500');
    });

    it('includes redaction summary', () => {
      const output = generateExport(mockPacket(), { format: 'markdown' });
      expect(output).toContain('Redactions Applied');
      expect(output).toContain('email');
      expect(output).toContain('api-key');
    });

    it('includes evidence sources', () => {
      const output = generateExport(mockPacket(), { format: 'markdown' });
      expect(output).toContain('browser-runtime');
      expect(output).toContain('browser-runtime:evidence');
    });

    it('includes suggested next steps', () => {
      const output = generateExport(mockPacket(), { format: 'markdown' });
      expect(output).toContain('Suggested Next Steps');
      expect(output).toContain('Re-capture');
    });

    it('handles missing optional fields gracefully', () => {
      const minimal: ContextPacket = {
        packetId: 'minimal',
        schemaVersion: '1.0.0',
        timestamp: 'now',
        captureId: 'c1',
        browser: {
          url: '',
          viewport: { width: 0, height: 0, deviceScaleFactor: 1 },
          userAgent: '',
        },
        selection: {
          selector: '#btn',
          tagName: 'button',
          boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        },
        dom: { tagName: 'button', attributes: {}, childCount: 0, depth: 0 },
        styles: {
          computed: {},
          layout: {
            display: 'block',
            position: 'static',
            width: 0,
            height: 0,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
          },
        },
        hierarchy: {
          selectedNode: { tagName: 'button', depth: 0 },
          parents: [],
          siblings: [],
          children: [],
        },
        screenshots: [],
        confidence: {
          sourceMapping: 0,
          semanticLabeling: 0,
          layoutAnalysis: 0,
          frameworkDetection: 0,
        },
        metadata: { engineVersion: '', processingTimeMs: 0, evidenceSources: [], redactions: [] },
        diagnostics: [],
        sourceHints: [],
      };
      const output = generateExport(minimal, { format: 'markdown' });
      expect(output).toContain('#btn');
      expect(output).toContain('No source hints');
    });
  });

  describe('json format', () => {
    it('includes compact structured fields', () => {
      const output = JSON.parse(generateExport(mockPacket(), { format: 'json' }));
      expect(output.packetId).toBe('test-packet-123');
      expect(output.selector).toBe('.target-card');
      expect(output.sourceHints[0].filePath).toBe('src/components/TargetCard.jsx');
    });

    it('includes console and network summaries', () => {
      const output = JSON.parse(generateExport(mockPacket(), { format: 'json' }));
      expect(output.consoleSummary.length).toBeGreaterThan(0);
      expect(output.networkSummary.length).toBeGreaterThan(0);
    });

    it('redacted values remain redacted in output', () => {
      const output = JSON.parse(generateExport(mockPacket(), { format: 'json' }));
      expect(output.redactions).toContain('email');
      expect(output.redactions).toContain('api-key');
    });

    it('detects profile from evidence', () => {
      const debug = mockPacket();
      debug.runtimeEvidence = {
        console: [{ level: 'error', message: 'err', timestamp: 'now' }],
        network: [
          {
            request: { method: 'GET', url: 'http://test.com' },
            response: { status: 200, statusText: 'OK' },
            timestamp: 'now',
          },
        ],
      };
      debug.screenshots = [
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
      const json = JSON.parse(generateExport(debug, { format: 'json' }));
      expect(json.profile).toBe('debug');

      const audit = mockPacket();
      audit.runtimeEvidence = {
        console: [{ level: 'error', message: 'err', timestamp: 'now' }],
        network: [
          {
            request: { method: 'GET', url: 'http://test.com' },
            response: { status: 200, statusText: 'OK' },
            timestamp: 'now',
          },
        ],
      };
      audit.screenshots = [];
      const json2 = JSON.parse(generateExport(audit, { format: 'json' }));
      expect(json2.profile).toBe('audit');

      const def = mockPacket();
      def.runtimeEvidence = {};
      def.screenshots = [
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
      const json3 = JSON.parse(generateExport(def, { format: 'json' }));
      expect(json3.profile).toBe('default');
    });
  });
});
