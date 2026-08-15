import { PNG } from 'pngjs';

/**
 * Real pixel comparison for local visual review artifacts (Phase 31).
 *
 * Decodes both PNG crops (pngjs, pure JS) and compares RGBA pixels directly
 * — never raw file bytes. Handles size differences deliberately:
 *
 * - target geometry is compared SEPARATELY (see comparison.ts);
 * - both crops are placed into a deterministic common canvas
 *   (width = max, height = max, top-left aligned) WITHOUT scaling either
 *   image, because resizing can hide real size/layout changes;
 * - pixels present in only one crop (the padded region of the smaller one)
 *   count as changed and are highlighted in the diff image.
 *
 * The diff image is a developer-facing visualization: unchanged pixels are
 * subdued (reduced alpha of the before pixels), changed pixels are solid
 * highlight red.
 */

export interface PixelDiffMetrics {
  /** Fraction of changed pixels over the common canvas (0..1). */
  changedPixelRatio: number;
  /** Number of changed pixels over the common canvas. */
  changedPixels: number;
  /** Total comparable pixels (common canvas width × height). */
  totalPixels: number;
  /** Common canvas width (max of both crops). */
  width: number;
  /** Common canvas height (max of both crops). */
  height: number;
  beforeWidth: number;
  beforeHeight: number;
  afterWidth: number;
  afterHeight: number;
  /** True when both crops have identical dimensions. */
  dimensionsMatch: boolean;
  /** Per-channel color tolerance applied during comparison. */
  tolerance: number;
  /** Comparison config version — persisted so future threshold changes stay interpretable. */
  configVersion: number;
}

export interface PixelDiffResult extends PixelDiffMetrics {
  /** Highlighted diff PNG (unchanged subdued, changed red). */
  diffImage: Buffer;
}

export interface PixelDiffOptions {
  /** Per-channel RGB tolerance (0..255). Default 24 — absorbs antialiasing/subpixel noise. */
  tolerance?: number;
}

export const PIXEL_DIFF_CONFIG_VERSION = 1;
export const DEFAULT_PIXEL_TOLERANCE = 24;

export class ImageDecodeError extends Error {
  readonly code: 'INVALID_IMAGE' | 'UNSUPPORTED_IMAGE';
  constructor(code: 'INVALID_IMAGE' | 'UNSUPPORTED_IMAGE', message: string) {
    super(message);
    this.name = 'ImageDecodeError';
    this.code = code;
  }
}

/** Pixels whose alpha is at or below this are treated as fully transparent/background. */
const ALPHA_BACKGROUND_THRESHOLD = 128;

function decodePng(buffer: Buffer, label: string): PNG {
  try {
    const png = PNG.sync.read(buffer);
    if (
      !Number.isFinite(png.width) ||
      !Number.isFinite(png.height) ||
      png.width <= 0 ||
      png.height <= 0
    ) {
      throw new ImageDecodeError('INVALID_IMAGE', `${label} has invalid dimensions`);
    }
    return png;
  } catch (error) {
    if (error instanceof ImageDecodeError) throw error;
    throw new ImageDecodeError(
      'INVALID_IMAGE',
      `${label} is not a decodable PNG: ${String(error)}`,
    );
  }
}

function pixelIndex(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function pixelsEqual(
  bIdx: number,
  aIdx: number,
  before: Buffer,
  after: Buffer,
  tolerance: number,
): boolean {
  const bAlpha = before[bIdx + 3] ?? 0;
  const aAlpha = after[aIdx + 3] ?? 0;
  const bTransparent = bAlpha <= ALPHA_BACKGROUND_THRESHOLD;
  const aTransparent = aAlpha <= ALPHA_BACKGROUND_THRESHOLD;
  if (bTransparent && aTransparent) return true;
  if (bTransparent !== aTransparent) return false;
  const dr = Math.abs((before[bIdx] ?? 0) - (after[aIdx] ?? 0));
  const dg = Math.abs((before[bIdx + 1] ?? 0) - (after[aIdx + 1] ?? 0));
  const db = Math.abs((before[bIdx + 2] ?? 0) - (after[aIdx + 2] ?? 0));
  return dr <= tolerance && dg <= tolerance && db <= tolerance;
}

/**
 * Compare two PNG crops and produce pixel metrics + a highlight diff image.
 *
 * Throws `ImageDecodeError` for undecodable input — callers map that to a
 * typed comparison failure, never a fabricated visual result.
 */
export function compareElementImages(
  beforeBuffer: Buffer,
  afterBuffer: Buffer,
  options: PixelDiffOptions = {},
): PixelDiffResult {
  const tolerance = options.tolerance ?? DEFAULT_PIXEL_TOLERANCE;
  const before = decodePng(beforeBuffer, 'before');
  const after = decodePng(afterBuffer, 'after');

  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const totalPixels = width * height;

  // Diff canvas: start from the before pixels; changed pixels are painted
  // solid red; unchanged pixels are subdued (alpha scaled down).
  const diff = new PNG({ width, height });
  diff.data.fill(0);

  let changedPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hasBefore = x < before.width && y < before.height;
      const hasAfter = x < after.width && y < after.height;
      const dIdx = pixelIndex(x, y, width);

      if (hasBefore && hasAfter) {
        const bIdx = pixelIndex(x, y, before.width);
        const aIdx = pixelIndex(x, y, after.width);
        const same = pixelsEqual(bIdx, aIdx, before.data, after.data, tolerance);
        if (same) {
          // Subdued original pixels.
          const bAlpha = before.data[bIdx + 3] ?? 0;
          diff.data[dIdx] = before.data[bIdx] ?? 0;
          diff.data[dIdx + 1] = before.data[bIdx + 1] ?? 0;
          diff.data[dIdx + 2] = before.data[bIdx + 2] ?? 0;
          diff.data[dIdx + 3] = Math.round(bAlpha * 0.3);
        } else {
          changedPixels++;
          diff.data[dIdx] = 255;
          diff.data[dIdx + 1] = 59;
          diff.data[dIdx + 2] = 48;
          diff.data[dIdx + 3] = 255;
        }
      } else if (hasBefore || hasAfter) {
        // Pixel exists in only one crop: size/layout change evidence.
        changedPixels++;
        diff.data[dIdx] = 255;
        diff.data[dIdx + 1] = 59;
        diff.data[dIdx + 2] = 48;
        diff.data[dIdx + 3] = 255;
      }
      // Neither: transparent.
    }
  }

  const changedPixelRatio = totalPixels > 0 ? changedPixels / totalPixels : 0;

  return {
    changedPixelRatio,
    changedPixels,
    totalPixels,
    width,
    height,
    beforeWidth: before.width,
    beforeHeight: before.height,
    afterWidth: after.width,
    afterHeight: after.height,
    dimensionsMatch: before.width === after.width && before.height === after.height,
    tolerance,
    configVersion: PIXEL_DIFF_CONFIG_VERSION,
    diffImage: PNG.sync.write(diff),
  };
}

/** Validate that a buffer is a decodable PNG. Throws ImageDecodeError otherwise. */
export function assertValidPng(buffer: Buffer): { width: number; height: number } {
  const png = decodePng(buffer, 'image');
  return { width: png.width, height: png.height };
}
