import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CapturePipeline, type PersistFailureStage, PersistedPacketSchema } from './index';

const TEST_DIR = path.join(os.tmpdir(), `.viskod-test-capture-pipeline-${Date.now()}`);

function makePacketJson(overrides: Record<string, unknown> = {}): string {
  const packet = {
    packetId: crypto.randomUUID(),
    schemaVersion: '1.1.0',
    timestamp: new Date().toISOString(),
    captureId: crypto.randomUUID(),
    captureStatus: 'partial',
    evidence: {
      dom: { state: 'collected' },
      hierarchy: { state: 'collected' },
      styles: { state: 'collected' },
      screenshot: {
        state: 'omitted_sensitive',
        diagnostic: {
          provider: 'screenshot',
          code: 'SCREENSHOT_OMITTED_SENSITIVE',
          reason: 'privacy policy',
        },
      },
      runtime: { state: 'collected' },
      sourceHints: { state: 'unavailable' },
    },
    browser: {
      url: 'http://localhost:3000',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      userAgent: 'Chromium test',
    },
    selection: {
      selector: '.target-card',
      tagName: 'div',
      boundingBox: { x: 10, y: 20, width: 640, height: 300 },
      text: 'Target content',
    },
    dom: { tagName: 'div', attributes: { class: 'target-card' }, childCount: 3, depth: 1 },
    styles: { computed: { display: 'block' }, layout: null },
    hierarchy: {
      selectedNode: { tagName: 'div', depth: 1 },
      parents: [],
      siblings: [],
      children: [],
    },
    screenshots: [],
    confidence: {
      sourceMapping: null,
      semanticLabeling: null,
      layoutAnalysis: null,
      frameworkDetection: null,
    },
    metadata: {
      engineVersion: '1.0.0',
      processingTimeMs: 10,
      evidenceSources: ['browser-runtime'],
      redactions: [],
      capturePolicy: { screenshot: 'omitted_sensitive' },
    },
    diagnostics: [],
    sourceHints: [],
    ...overrides,
  };
  return JSON.stringify(packet);
}

describe('CapturePipeline', () => {
  let pipeline: CapturePipeline;

  beforeEach(() => {
    cleanupTestDir();
    pipeline = new CapturePipeline(TEST_DIR);
  });

  afterEach(() => {
    cleanupTestDir();
  });

  function cleanupTestDir() {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  }

  function createDummyCapture(dir: string, captureId: string, daysAgo: number): void {
    const captureDir = path.join(dir, captureId);
    fs.mkdirSync(captureDir, { recursive: true });
    const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
    fs.writeFileSync(
      path.join(captureDir, 'metadata.json'),
      JSON.stringify({
        captureId,
        packetId: crypto.randomUUID(),
        schemaVersion: '1.0.0',
        createdAt,
        screenshots: [],
        page: { url: 'http://localhost:3000', viewport: { width: 1280, height: 720 } },
        tags: [],
      }),
      'utf-8',
    );
    fs.writeFileSync(path.join(captureDir, 'selection.png'), Buffer.alloc(1024));
  }

  describe('eager storage directory', () => {
    it('eagerly creates storage directory in constructor', async () => {
      const freshDir = path.join(os.tmpdir(), `.viskod-test-eager-${Date.now()}`);
      expect(fs.existsSync(freshDir)).toBe(false);
      new CapturePipeline(freshDir);
      expect(fs.existsSync(freshDir)).toBe(true);
      expect(fs.statSync(freshDir).isDirectory()).toBe(true);
      fs.rmSync(freshDir, { recursive: true, force: true });
    });
  });

  describe('atomic capture persistence', () => {
    it('commits a complete capture directory with metadata + packet', async () => {
      const captureId = crypto.randomUUID();
      const result = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
        screenshots: [
          {
            captureId: crypto.randomUUID(),
            type: 'selection' as const,
            buffer: Buffer.alloc(512),
            format: 'png' as const,
            width: 1280,
            height: 720,
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(path.isAbsolute(result.value.captureDir)).toBe(true);
        expect(fs.existsSync(result.value.captureDir)).toBe(true);
        expect(fs.existsSync(path.join(result.value.captureDir, 'metadata.json'))).toBe(true);
        expect(fs.existsSync(path.join(result.value.captureDir, 'packet.json'))).toBe(true);
        expect(fs.existsSync(path.join(result.value.captureDir, 'selection.png'))).toBe(true);
        expect(result.value.captureStatus).toBe('partial');
        expect(result.value.screenshotCount).toBe(1);
        // No temp residue.
        const entries = fs.readdirSync(TEST_DIR);
        expect(entries).toEqual([captureId]);
      }
    });

    it('no .tmp files remain after successful persist', async () => {
      const captureId = crypto.randomUUID();
      const result = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
        screenshots: [
          {
            captureId: crypto.randomUUID(),
            type: 'viewport' as const,
            buffer: Buffer.alloc(64),
            format: 'png' as const,
            width: 10,
            height: 10,
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const entries = fs.readdirSync(result.value.captureDir);
        expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
      }
    });

    it('rejects a packet whose captureId does not match the persistence id', async () => {
      const result = await pipeline.persistCapture({
        captureId: crypto.randomUUID(),
        packetJson: makePacketJson(), // captureId inside differs
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CP_PACKET_MISMATCH');
      // Nothing committed.
      expect(fs.readdirSync(TEST_DIR)).toEqual([]);
    });

    it('rejects a packet that fails the persisted-schema envelope', async () => {
      const result = await pipeline.persistCapture({
        captureId: crypto.randomUUID(),
        packetJson: JSON.stringify({ test: true }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CP_PACKET_INVALID');
      expect(fs.readdirSync(TEST_DIR)).toEqual([]);
    });

    it('rejects invalid JSON before any disk write', async () => {
      const result = await pipeline.persistCapture({
        captureId: crypto.randomUUID(),
        packetJson: '{not valid json',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CP_PACKET_INVALID');
      expect(fs.readdirSync(TEST_DIR)).toEqual([]);
    });

    it('rejects invalid capture ids', async () => {
      for (const bad of ['../evil', 'C:\\Users\\secret', '/etc/passwd', '..\\..\\secret']) {
        const result = await pipeline.persistCapture({
          captureId: bad,
          packetJson: makePacketJson(),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('CP_INVALID_CAPTURE_ID');
      }
      expect(fs.readdirSync(TEST_DIR)).toEqual([]);
    });
  });

  describe('persistence failure injection', () => {
    const STAGES: Array<{ stage: PersistFailureStage; label: string }> = [
      { stage: 'before-metadata', label: 'before metadata write' },
      { stage: 'after-artifact', label: 'after one artifact write' },
      { stage: 'before-packet', label: 'before packet write' },
      { stage: 'during-packet', label: 'during packet write' },
      { stage: 'before-commit', label: 'immediately before commit/rename' },
    ];

    for (const { stage, label } of STAGES) {
      it(`fails at ${label}: never listable, never retrievable, no committed dir`, async () => {
        const failing = new CapturePipeline(TEST_DIR, { failOn: stage });
        const captureId = crypto.randomUUID();
        const result = await failing.persistCapture({
          captureId,
          packetJson: makePacketJson({ captureId }),
          screenshots: [
            {
              captureId: crypto.randomUUID(),
              type: 'selection' as const,
              buffer: Buffer.alloc(64),
              format: 'png' as const,
              width: 10,
              height: 10,
            },
          ],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('CP_PERSIST_FAILED');

        // No committed capture directory.
        expect(fs.existsSync(path.join(TEST_DIR, captureId))).toBe(false);
        // listCaptures exposes nothing.
        const listed = await pipeline.listCaptures();
        expect(listed.ok).toBe(true);
        if (listed.ok) expect(listed.value).toEqual([]);
        // getCapture returns not found.
        const got = await pipeline.getCapture(captureId);
        expect(got.ok).toBe(false);
        // loadPersistedPacket returns not found.
        const loaded = await pipeline.loadPersistedPacket(captureId);
        expect(loaded.ok).toBe(false);
      });
    }

    it('temporary residue from a failed capture is never treated as a capture', async () => {
      const failing = new CapturePipeline(TEST_DIR, { failOn: 'after-artifact' });
      const captureId = crypto.randomUUID();
      await failing.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
        screenshots: [
          {
            captureId: crypto.randomUUID(),
            type: 'selection' as const,
            buffer: Buffer.alloc(64),
            format: 'png' as const,
            width: 10,
            height: 10,
          },
        ],
      });
      // Residue may exist best-effort, but the recovery pipeline must ignore it.
      const entries = fs.readdirSync(TEST_DIR);
      const committed = entries.filter((e) => /^[0-9a-f-]{36}$/i.test(e));
      expect(committed).toEqual([]);
      const listed = await pipeline.listCaptures();
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.value).toEqual([]);
    });

    it('one failed capture does not corrupt another committed capture', async () => {
      const okId = crypto.randomUUID();
      const okResult = await pipeline.persistCapture({
        captureId: okId,
        packetJson: makePacketJson({ captureId: okId }),
      });
      expect(okResult.ok).toBe(true);

      const failing = new CapturePipeline(TEST_DIR, { failOn: 'before-commit' });
      const failId = crypto.randomUUID();
      const failResult = await failing.persistCapture({
        captureId: failId,
        packetJson: makePacketJson({ captureId: failId }),
      });
      expect(failResult.ok).toBe(false);

      // The good capture is intact and loadable.
      const good = await pipeline.loadPersistedPacket(okId);
      expect(good.ok).toBe(true);
      const listed = await pipeline.listCaptures();
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.map((c) => c.captureId)).toEqual([okId]);
      }
    });
  });

  describe('durable lookup by opaque id', () => {
    it('loads the persisted packet by captureId after a fresh pipeline instance (restart)', async () => {
      const captureId = crypto.randomUUID();
      const packetId = crypto.randomUUID();
      const first = new CapturePipeline(TEST_DIR);
      const persisted = await first.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId, packetId }),
      });
      expect(persisted.ok).toBe(true);

      // Fresh instance — no in-memory state shared (process restart analog).
      const second = new CapturePipeline(TEST_DIR);
      const got = await second.getCapture(captureId);
      expect(got.ok).toBe(true);
      if (got.ok) {
        expect(got.value.captureId).toBe(captureId);
        expect(got.value.packetId).toBe(packetId);
        expect(got.value.packetPresent).toBe(true);
      }

      const loaded = await second.loadPersistedPacket(captureId);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.value.captureId).toBe(captureId);
        expect(loaded.value.packetId).toBe(packetId);
      }
    });

    it('resolves packetId → capture deterministically', async () => {
      const captureId = crypto.randomUUID();
      const packetId = crypto.randomUUID();
      const first = new CapturePipeline(TEST_DIR);
      const persisted = await first.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId, packetId }),
      });
      expect(persisted.ok).toBe(true);

      const second = new CapturePipeline(TEST_DIR);
      const byPacket = await second.getPacketCapture(packetId);
      expect(byPacket.ok).toBe(true);
      if (byPacket.ok) expect(byPacket.value.captureId).toBe(captureId);

      const missing = await second.getPacketCapture(crypto.randomUUID());
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe('CP_CAPTURE_NOT_FOUND');
    });

    it('returns typed failure for a missing capture', async () => {
      const result = await pipeline.getCapture(crypto.randomUUID());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CP_CAPTURE_NOT_FOUND');
    });
  });

  describe('corruption and mismatch safety', () => {
    it('corrupt JSON packet → typed corruption failure', async () => {
      const captureId = crypto.randomUUID();
      const persisted = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
      });
      expect(persisted.ok).toBe(true);
      fs.writeFileSync(path.join(TEST_DIR, captureId, 'packet.json'), '{broken', 'utf-8');
      const loaded = await pipeline.loadPersistedPacket(captureId);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error.code).toBe('CP_PACKET_CORRUPT');
    });

    it('schema-invalid packet → typed corruption failure', async () => {
      const captureId = crypto.randomUUID();
      const persisted = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
      });
      expect(persisted.ok).toBe(true);
      fs.writeFileSync(
        path.join(TEST_DIR, captureId, 'packet.json'),
        JSON.stringify({ packetId: 'x' }),
        'utf-8',
      );
      const loaded = await pipeline.loadPersistedPacket(captureId);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error.code).toBe('CP_PACKET_CORRUPT');
    });

    it('packet referencing a different captureId → typed mismatch failure', async () => {
      const captureId = crypto.randomUUID();
      const persisted = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
      });
      expect(persisted.ok).toBe(true);
      const other = makePacketJson({ captureId: crypto.randomUUID() });
      fs.writeFileSync(path.join(TEST_DIR, captureId, 'packet.json'), other, 'utf-8');
      const loaded = await pipeline.loadPersistedPacket(captureId);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error.code).toBe('CP_PACKET_MISMATCH');
    });

    it('packet/metadata packetId disagreement → typed mismatch failure', async () => {
      const captureId = crypto.randomUUID();
      const persisted = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
      });
      expect(persisted.ok).toBe(true);
      const metaPath = path.join(TEST_DIR, captureId, 'metadata.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.packetId = crypto.randomUUID();
      fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf-8');
      const loaded = await pipeline.loadPersistedPacket(captureId);
      expect(loaded.ok).toBe(false);
      if (!loaded.ok) expect(loaded.error.code).toBe('CP_PACKET_MISMATCH');
    });

    it('getCapture rejects metadata referencing another capture', async () => {
      const captureId = crypto.randomUUID();
      const persisted = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
      });
      expect(persisted.ok).toBe(true);
      const metaPath = path.join(TEST_DIR, captureId, 'metadata.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.captureId = crypto.randomUUID();
      fs.writeFileSync(metaPath, JSON.stringify(meta), 'utf-8');
      const got = await pipeline.getCapture(captureId);
      expect(got.ok).toBe(false);
      if (!got.ok) expect(got.error.code).toBe('CP_METADATA_CORRUPT');
    });
  });

  describe('Phase 30A — persisted source-hint schema validation', () => {
    const VALID_HINT = {
      filePath: 'src/components/TargetCard.jsx',
      displayPath: 'src/components/TargetCard.jsx',
      confidence: 0.54,
      qualification: 'possible',
      reasons: ['visible text found only in this file'],
      matchType: 'usage-site',
      exists: true,
    };
    const VALID_RESOLUTION = { status: 'resolved', modelVersion: '2.0.0' };

    it('persists and round-trips valid qualified candidates + resolution snapshot', async () => {
      const captureId = crypto.randomUUID();
      const packetJson = makePacketJson({
        captureId,
        sourceHints: [VALID_HINT],
        sourceHintsResolution: {
          ...VALID_RESOLUTION,
          topCandidate: 'src/components/TargetCard.jsx',
        },
      });
      const persisted = await pipeline.persistCapture({ captureId, packetJson });
      expect(persisted.ok).toBe(true);
      const loaded = await pipeline.loadPersistedPacket(captureId);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.value.sourceHints[0]?.filePath).toBe('src/components/TargetCard.jsx');
        expect(loaded.value.sourceHints[0]?.qualification).toBe('possible');
        expect(loaded.value.sourceHints[0]?.confidence).toBe(0.54);
        expect(loaded.value.sourceHintsResolution?.status).toBe('resolved');
        expect(loaded.value.sourceHintsResolution?.modelVersion).toBe('2.0.0');
        expect(loaded.value.sourceHintsResolution?.topCandidate).toBe(
          'src/components/TargetCard.jsx',
        );
      }
    });

    it('a FUTURE source model version is still interpretable via its persisted result', async () => {
      // The version boundary: old captures stay interpretable using their
      // persisted snapshot — a future model version must not be rejected.
      const captureId = crypto.randomUUID();
      const packetJson = makePacketJson({
        captureId,
        sourceHints: [VALID_HINT],
        sourceHintsResolution: { status: 'resolved', modelVersion: '3.0.0' },
      });
      const persisted = await pipeline.persistCapture({ captureId, packetJson });
      expect(persisted.ok).toBe(true);
      const loaded = await pipeline.loadPersistedPacket(captureId);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.value.sourceHintsResolution?.modelVersion).toBe('3.0.0');
    });

    const CORRUPT_CASES: Array<{ label: string; patch: Record<string, unknown> }> = [
      {
        label: 'invalid qualification',
        patch: { sourceHints: [{ ...VALID_HINT, qualification: 'certain' }] },
      },
      { label: 'confidence above 1', patch: { sourceHints: [{ ...VALID_HINT, confidence: 1.5 }] } },
      {
        label: 'confidence negative',
        patch: { sourceHints: [{ ...VALID_HINT, confidence: -0.1 }] },
      },
      {
        label: 'non-numeric confidence',
        patch: { sourceHints: [{ ...VALID_HINT, confidence: 'high' }] },
      },
      {
        label: 'absolute POSIX path',
        patch: { sourceHints: [{ ...VALID_HINT, filePath: '/Users/x/secret.ts' }] },
      },
      {
        label: 'absolute Windows path',
        patch: { sourceHints: [{ ...VALID_HINT, filePath: 'C:\\secret.ts' }] },
      },
      {
        label: 'traversal path',
        patch: { sourceHints: [{ ...VALID_HINT, filePath: '../../secret.ts' }] },
      },
      {
        label: 'file:// URI path',
        patch: { sourceHints: [{ ...VALID_HINT, filePath: 'file:///tmp/x.ts' }] },
      },
      {
        label: 'malformed reasons (not an array)',
        patch: { sourceHints: [{ ...VALID_HINT, reasons: 'visible text' }] },
      },
      { label: 'reason not a string', patch: { sourceHints: [{ ...VALID_HINT, reasons: [42] }] } },
      {
        label: 'invalid resolution state',
        patch: { sourceHintsResolution: { status: 'certain', modelVersion: '2.0.0' } },
      },
      {
        label: 'malformed model version',
        patch: { sourceHintsResolution: { status: 'resolved', modelVersion: 'abc' } },
      },
    ];

    for (const { label, patch } of CORRUPT_CASES) {
      it(`rejects corrupt persisted source data at WRITE: ${label}`, async () => {
        const captureId = crypto.randomUUID();
        const result = await pipeline.persistCapture({
          captureId,
          packetJson: makePacketJson({ captureId, ...patch }),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('CP_PACKET_INVALID');
        expect(fs.readdirSync(TEST_DIR)).toEqual([]);
      });

      it(`rejects corrupt persisted source data at LOAD: ${label}`, async () => {
        const captureId = crypto.randomUUID();
        const persisted = await pipeline.persistCapture({
          captureId,
          packetJson: makePacketJson({ captureId }),
        });
        expect(persisted.ok).toBe(true);
        // Tamper the committed packet exactly like a corrupt/tampered capture.
        const parsed = JSON.parse(makePacketJson({ captureId, ...patch }));
        fs.writeFileSync(
          path.join(TEST_DIR, captureId, 'packet.json'),
          JSON.stringify(parsed),
          'utf-8',
        );
        const loaded = await pipeline.loadPersistedPacket(captureId);
        expect(loaded.ok).toBe(false);
        if (!loaded.ok) expect(loaded.error.code).toBe('CP_PACKET_CORRUPT');
      });
    }

    it('a hint without a recognized qualification is rejected (never re-derived)', async () => {
      const captureId = crypto.randomUUID();
      const result = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({
          captureId,
          sourceHints: [{ ...VALID_HINT, qualification: undefined }],
        }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('CP_PACKET_INVALID');
    });
  });

  describe('persisted representation', () => {
    it('persisted packet round-trips through the schema', async () => {
      const captureId = crypto.randomUUID();
      const packetJson = makePacketJson({ captureId });
      const persisted = await pipeline.persistCapture({ captureId, packetJson });
      expect(persisted.ok).toBe(true);
      const loaded = await pipeline.loadPersistedPacket(captureId);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        const parsed = PersistedPacketSchema.safeParse(loaded.value);
        expect(parsed.success).toBe(true);
      }
    });

    it('metadata page info matches the persisted packet (single source of truth)', async () => {
      const captureId = crypto.randomUUID();
      const packetJson = makePacketJson({
        captureId,
        browser: {
          url: 'http://example.test/app',
          viewport: { width: 800, height: 600, deviceScaleFactor: 2 },
          userAgent: 'UA',
        },
      });
      const persisted = await pipeline.persistCapture({ captureId, packetJson });
      expect(persisted.ok).toBe(true);
      const meta = JSON.parse(
        fs.readFileSync(path.join(TEST_DIR, captureId, 'metadata.json'), 'utf-8'),
      );
      expect(meta.page.url).toBe('http://example.test/app');
      expect(meta.page.viewport).toEqual({ width: 800, height: 600 });
    });
  });

  describe('screenshot path metadata', () => {
    it('stores screenshots with resolvable type.format filenames', async () => {
      const captureId = crypto.randomUUID();
      const result = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
        screenshots: [
          {
            captureId: crypto.randomUUID(),
            type: 'viewport' as const,
            buffer: Buffer.alloc(512),
            format: 'png' as const,
            width: 1280,
            height: 720,
          },
          {
            captureId: crypto.randomUUID(),
            type: 'selection' as const,
            buffer: Buffer.alloc(256),
            format: 'jpeg' as const,
            width: 640,
            height: 480,
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const captureDir = result.value.captureDir;
        expect(fs.existsSync(path.join(captureDir, 'viewport.png'))).toBe(true);
        expect(fs.existsSync(path.join(captureDir, 'selection.jpeg'))).toBe(true);
        expect(fs.existsSync(path.join(captureDir, 'metadata.json'))).toBe(true);

        const meta = JSON.parse(fs.readFileSync(path.join(captureDir, 'metadata.json'), 'utf-8'));
        expect(meta.screenshots[0].path).toBe('viewport.png');
        expect(meta.screenshots[1].path).toBe('selection.jpeg');
      }
    });

    it('metadata screenshot paths are simple relative filenames', async () => {
      const captureId = crypto.randomUUID();
      const result = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
        screenshots: [
          {
            captureId: crypto.randomUUID(),
            type: 'selection' as const,
            buffer: Buffer.alloc(256),
            format: 'png' as const,
            width: 1280,
            height: 720,
          },
        ],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const stored = result.value;
        const meta = JSON.parse(
          fs.readFileSync(path.join(stored.captureDir, 'metadata.json'), 'utf-8'),
        );
        for (const shot of meta.screenshots) {
          expect(shot.path).not.toContain(path.sep);
          expect(shot.path).toMatch(/^\w+\.\w+$/);
          expect(fs.existsSync(path.join(stored.captureDir, shot.path))).toBe(true);
        }
      }
    });
  });

  describe('storage cleanup and listing', () => {
    it('removes old captures beyond retention period', async () => {
      createDummyCapture(TEST_DIR, crypto.randomUUID(), 1);
      createDummyCapture(TEST_DIR, crypto.randomUUID(), 10);
      createDummyCapture(TEST_DIR, crypto.randomUUID(), 30);

      const deleted = await pipeline.runRetentionCleanup(7);
      expect(deleted.ok).toBe(true);
      if (deleted.ok) expect(deleted.value).toBe(2);
    });

    it('does not delete unrelated files in the base directory', async () => {
      createDummyCapture(TEST_DIR, crypto.randomUUID(), 1);
      createDummyCapture(TEST_DIR, crypto.randomUUID(), 14);

      fs.writeFileSync(path.join(TEST_DIR, 'unrelated.txt'), 'not a capture');
      fs.mkdirSync(path.join(TEST_DIR, 'other-data'), { recursive: true });
      fs.writeFileSync(path.join(TEST_DIR, 'other-data', 'data.json'), '{}');

      const deleted = await pipeline.runRetentionCleanup(7);
      expect(deleted.ok).toBe(true);
      if (deleted.ok) expect(deleted.value).toBe(1);
      expect(fs.existsSync(path.join(TEST_DIR, 'unrelated.txt'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'other-data'))).toBe(true);
    });

    it('always keeps the most recent capture regardless of age', async () => {
      createDummyCapture(TEST_DIR, crypto.randomUUID(), 365);
      const deleted = await pipeline.runRetentionCleanup(1);
      expect(deleted.ok).toBe(true);
      if (deleted.ok) expect(deleted.value).toBe(0);
    });

    it('handles empty base directory gracefully', async () => {
      const deleted = await pipeline.runRetentionCleanup(7);
      expect(deleted.ok).toBe(true);
      if (deleted.ok) expect(deleted.value).toBe(0);
    });

    it('rejects negative retention days', async () => {
      const deleted = await pipeline.runRetentionCleanup(-1);
      expect(deleted.ok).toBe(false);
    });

    it('listCaptures ignores temporary directories', async () => {
      fs.mkdirSync(path.join(TEST_DIR, `${crypto.randomUUID()}.tmp-123`), { recursive: true });
      const listed = await pipeline.listCaptures();
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.value).toEqual([]);
    });

    it('allows zero screenshots (audit profile)', async () => {
      const captureId = crypto.randomUUID();
      const result = await pipeline.persistCapture({
        captureId,
        packetJson: makePacketJson({ captureId }),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.screenshotCount).toBe(0);
        expect(fs.existsSync(path.join(result.value.captureDir, 'packet.json'))).toBe(true);
      }
    });
  });
});
