import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareScreenshots } from './pixel-diff';

describe('pixel-diff', () => {
  const tmpDir = os.tmpdir();

  function writePng(filename: string, width: number, height: number, fillByte: number): string {
    const filePath = path.join(tmpDir, filename);
    // Minimal valid PNG: signature + IHDR + IDAT + IEND
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // IHDR chunk
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8; // bit depth
    ihdrData[9] = 2; // color type (RGB)
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace
    const ihdr = makeChunk('IHDR', ihdrData);

    // IDAT chunk (uncompressed image data)
    const rowBytes = 1 + width * 3; // filter byte + RGB
    const rawImage = Buffer.alloc(rowBytes * height, fillByte);
    for (let y = 0; y < height; y++) {
      rawImage[y * rowBytes] = 0; // no filter
    }
    const zlib = require('node:zlib');
    const compressed = zlib.deflateSync(rawImage);
    const idat = makeChunk('IDAT', compressed);

    // IEND chunk
    const iend = makeChunk('IEND', Buffer.alloc(0));

    const png = Buffer.concat([signature, ihdr, idat, iend]);
    fs.writeFileSync(filePath, png);
    return filePath;
  }

  function makeChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type, 'ascii');
    const crcInput = Buffer.concat([typeBuffer, data]);
    const crc = crc32(crcInput);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuffer, data, crcBuf]);
  }

  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i] ?? 0;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  it('returns null for non-existent files', () => {
    const result = compareScreenshots('/nonexistent/a.png', '/nonexistent/b.png');
    expect(result).toBeNull();
  });

  it('detects identical files', () => {
    const filePath = writePng('identical.png', 2, 2, 128);
    const result = compareScreenshots(filePath, filePath);
    expect(result).not.toBeNull();
    expect(result?.changedPixelRatio).toBe(0);
    expect(result?.dimensionsMatch).toBe(true);
  });

  it('detects different files', () => {
    const a = writePng('diff-a.png', 2, 2, 128);
    const b = writePng('diff-b.png', 2, 2, 200);
    const result = compareScreenshots(a, b);
    expect(result).not.toBeNull();
    expect(result).toBeDefined();
    expect(result?.changedPixelRatio).toBeGreaterThan(0);
    expect(result?.dimensionsMatch).toBe(true);
    expect(result?.width).toBe(2);
    expect(result?.height).toBe(2);
  });

  it('reports dimensions mismatch', () => {
    const a = writePng('dim-a.png', 10, 10, 128);
    const b = writePng('dim-b.png', 20, 20, 128);
    const result = compareScreenshots(a, b);
    expect(result).not.toBeNull();
    expect(result?.dimensionsMatch).toBe(false);
    expect(result?.changedPixelRatio).toBe(1);
  });

  it('parses PNG dimensions correctly', () => {
    const filePath = writePng('dims.png', 100, 50, 0);
    const result = compareScreenshots(filePath, filePath);
    expect(result).not.toBeNull();
    expect(result?.width).toBe(100);
    expect(result?.height).toBe(50);
  });
});
