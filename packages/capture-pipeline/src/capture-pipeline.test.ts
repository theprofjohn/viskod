import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CapturePipeline } from './index';

const TEST_DIR = path.join(process.cwd(), '.viskod-test-capture-pipeline');

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

  describe('screenshot path metadata', () => {
    it('includes capture directory in StoredCapture after persist', async () => {
      const packet = { packetId: crypto.randomUUID() };
      const screenshots = [
        {
          captureId: crypto.randomUUID(),
          type: 'viewport' as const,
          buffer: Buffer.alloc(512),
          format: 'png' as const,
          width: 1280,
          height: 720,
        },
      ];

      const result = await pipeline.persistCapture(packet, screenshots, 'http://localhost:3000', {
        width: 1280,
        height: 720,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.captureDir).toBeDefined();
        expect(result.value.captureDir).toContain(TEST_DIR);
        expect(fs.existsSync(result.value.captureDir)).toBe(true);
        expect(result.value.screenshotCount).toBe(1);
      }
    });

    it('stores screenshots with resolvable type.format filenames', async () => {
      const packet = { packetId: crypto.randomUUID() };
      const screenshots = [
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
      ];

      const result = await pipeline.persistCapture(packet, screenshots, 'http://localhost:3000', {
        width: 1280,
        height: 720,
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
  });

  describe('storage cleanup', () => {
    it('removes old captures beyond retention period', async () => {
      createDummyCapture(TEST_DIR, 'capture-recent', 1);
      createDummyCapture(TEST_DIR, 'capture-old', 10);
      createDummyCapture(TEST_DIR, 'capture-very-old', 30);

      const deleted = await pipeline.runRetentionCleanup(7);

      expect(deleted.ok).toBe(true);
      if (deleted.ok) {
        expect(deleted.value).toBe(2);
        expect(fs.existsSync(path.join(TEST_DIR, 'capture-recent'))).toBe(true);
        expect(fs.existsSync(path.join(TEST_DIR, 'capture-old'))).toBe(false);
        expect(fs.existsSync(path.join(TEST_DIR, 'capture-very-old'))).toBe(false);
      }
    });

    it('does not delete unrelated files in the base directory', async () => {
      createDummyCapture(TEST_DIR, 'capture-recent', 1);
      createDummyCapture(TEST_DIR, 'capture-old', 14);

      fs.writeFileSync(path.join(TEST_DIR, 'unrelated.txt'), 'not a capture');
      fs.mkdirSync(path.join(TEST_DIR, 'other-data'), { recursive: true });
      fs.writeFileSync(path.join(TEST_DIR, 'other-data', 'data.json'), '{}');

      const deleted = await pipeline.runRetentionCleanup(7);

      expect(deleted.ok).toBe(true);
      if (deleted.ok) {
        expect(deleted.value).toBe(1);
        expect(fs.existsSync(path.join(TEST_DIR, 'unrelated.txt'))).toBe(true);
        expect(fs.existsSync(path.join(TEST_DIR, 'other-data'))).toBe(true);
        expect(fs.existsSync(path.join(TEST_DIR, 'other-data', 'data.json'))).toBe(true);
      }
    });

    it('always keeps the most recent capture regardless of age', async () => {
      createDummyCapture(TEST_DIR, 'capture-only', 365);

      const deleted = await pipeline.runRetentionCleanup(1);

      expect(deleted.ok).toBe(true);
      if (deleted.ok) {
        expect(deleted.value).toBe(0);
        expect(fs.existsSync(path.join(TEST_DIR, 'capture-only'))).toBe(true);
      }
    });

    it('handles empty base directory gracefully', async () => {
      const deleted = await pipeline.runRetentionCleanup(7);
      expect(deleted.ok).toBe(true);
      if (deleted.ok) {
        expect(deleted.value).toBe(0);
      }
    });

    it('rejects negative retention days', async () => {
      const deleted = await pipeline.runRetentionCleanup(-1);
      expect(deleted.ok).toBe(false);
    });
  });
});
