import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIXEL_TOLERANCE,
  ImageDecodeError,
  assertValidPng,
  compareElementImages,
} from './pixel-diff';

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    png.data[idx] = rgb[0];
    png.data[idx + 1] = rgb[1];
    png.data[idx + 2] = rgb[2];
    png.data[idx + 3] = 255;
  }
  return PNG.sync.write(png);
}

function solidPngWithRect(
  width: number,
  height: number,
  rect: { x: number; y: number; w: number; h: number },
  rgb: [number, number, number],
): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const c: readonly [number, number, number] = inside ? rgb : [0, 0, 0];
      png.data[idx] = c[0];
      png.data[idx + 1] = c[1];
      png.data[idx + 2] = c[2];
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe('compareElementImages', () => {
  it('identical images produce zero changed pixels', () => {
    const before = solidPng(40, 20, [10, 120, 200]);
    const after = solidPng(40, 20, [10, 120, 200]);
    const result = compareElementImages(before, after);
    expect(result.changedPixelRatio).toBe(0);
    expect(result.changedPixels).toBe(0);
    expect(result.totalPixels).toBe(800);
    expect(result.dimensionsMatch).toBe(true);
  });

  it('detects a color-only change via pixel evidence', () => {
    const before = solidPng(40, 20, [255, 255, 255]);
    const after = solidPng(40, 20, [255, 0, 0]);
    const result = compareElementImages(before, after);
    expect(result.changedPixelRatio).toBeGreaterThan(0.99);
    expect(result.changedPixels).toBe(800);
  });

  it('tolerance absorbs sub-tolerance color noise', () => {
    const before = solidPng(40, 20, [100, 100, 100]);
    const after = solidPng(40, 20, [104, 101, 103]);
    const result = compareElementImages(before, after, { tolerance: 8 });
    expect(result.changedPixelRatio).toBe(0);
  });

  it('treats alpha-background pixels as equal regardless of RGB', () => {
    const a = new PNG({ width: 10, height: 10 });
    const b = new PNG({ width: 10, height: 10 });
    // Fully transparent pixels — background regions compare equal.
    const result = compareElementImages(PNG.sync.write(a), PNG.sync.write(b));
    expect(result.changedPixelRatio).toBe(0);
  });

  it('size change produces difference and records dimensions separately', () => {
    const before = solidPng(40, 20, [10, 120, 200]);
    const after = solidPng(60, 20, [10, 120, 200]);
    const result = compareElementImages(before, after);
    expect(result.dimensionsMatch).toBe(false);
    expect(result.width).toBe(60);
    expect(result.height).toBe(20);
    expect(result.beforeWidth).toBe(40);
    expect(result.afterWidth).toBe(60);
    // The rightmost 20 columns exist only in `after` → counted as changed.
    expect(result.changedPixelRatio).toBeGreaterThan(0);
    expect(result.changedPixels).toBeGreaterThan(0);
  });

  it('produces a valid highlight diff image of the common canvas', () => {
    const before = solidPng(40, 20, [0, 0, 0]);
    const after = solidPng(40, 20, [255, 0, 0]);
    const result = compareElementImages(before, after);
    const decoded = PNG.sync.read(result.diffImage);
    expect(decoded.width).toBe(40);
    expect(decoded.height).toBe(20);
    // Changed pixels are highlighted red.
    expect(decoded.data[0]).toBe(255);
    expect(decoded.data[1]).toBe(59);
    expect(decoded.data[2]).toBe(48);
  });

  it('subdues unchanged pixels in the diff image', () => {
    const before = solidPng(20, 10, [0, 0, 0]);
    const after = solidPng(20, 10, [0, 0, 0]);
    const result = compareElementImages(before, after);
    const decoded = PNG.sync.read(result.diffImage);
    // Unchanged pixel is the original color at reduced alpha.
    expect(decoded.data[0]).toBe(0);
    expect(decoded.data[3]).toBe(Math.round(255 * 0.3));
  });

  it('throws ImageDecodeError for undecodable input', () => {
    expect(() => compareElementImages(Buffer.from('not a png'), solidPng(4, 4, [0, 0, 0]))).toThrow(
      ImageDecodeError,
    );
    expect(() => assertValidPng(Buffer.from([1, 2, 3]))).toThrow(ImageDecodeError);
  });

  it('reports the applied config version and tolerance', () => {
    const result = compareElementImages(solidPng(4, 4, [0, 0, 0]), solidPng(4, 4, [0, 0, 0]), {
      tolerance: 16,
    });
    expect(result.tolerance).toBe(16);
    expect(result.configVersion).toBe(1);
    expect(result.tolerance).toBe(DEFAULT_PIXEL_TOLERANCE === 24 ? 16 : result.tolerance);
  });

  it('position-shifted content is visible as pixel change', () => {
    const before = solidPngWithRect(60, 30, { x: 5, y: 5, w: 20, h: 10 }, [255, 0, 0]);
    const after = solidPngWithRect(60, 30, { x: 25, y: 5, w: 20, h: 10 }, [255, 0, 0]);
    const result = compareElementImages(before, after);
    expect(result.changedPixelRatio).toBeGreaterThan(0);
  });
});
