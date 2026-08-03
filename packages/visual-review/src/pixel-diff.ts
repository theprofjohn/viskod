import * as fs from 'node:fs';

export interface PixelDiffResult {
  /** Fraction of changed pixels (0-1) */
  changedPixelRatio: number;
  /** Total pixel count */
  totalPixels: number;
  /** Changed pixel count */
  changedPixels: number;
  /** Whether images have matching dimensions */
  dimensionsMatch: boolean;
  /** Width of compared images */
  width: number;
  /** Height of compared images */
  height: number;
}

/**
 * Compare two PNG screenshots at the byte level.
 * Uses raw buffer comparison — no external image library needed.
 *
 * Limitations:
 * - Requires identical dimensions (returns dimensionsMatch: false otherwise)
 * - Compares raw PNG bytes, not decoded pixels (compression artifacts may differ)
 * - Does not generate a visual diff image
 */
export function compareScreenshots(beforePath: string, afterPath: string): PixelDiffResult | null {
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) {
    return null;
  }

  const beforeBuf = fs.readFileSync(beforePath);
  const afterBuf = fs.readFileSync(afterPath);

  // Quick check: if file sizes are identical and buffers match, no diff
  if (beforeBuf.length === afterBuf.length && beforeBuf.equals(afterBuf)) {
    const dims = getPngDimensions(beforeBuf);
    return {
      changedPixelRatio: 0,
      totalPixels: dims ? dims.width * dims.height : 0,
      changedPixels: 0,
      dimensionsMatch: true,
      width: dims?.width ?? 0,
      height: dims?.height ?? 0,
    };
  }

  // Parse PNG dimensions from IHDR chunk (bytes 16-23)
  const beforeDims = getPngDimensions(beforeBuf);
  const afterDims = getPngDimensions(afterBuf);

  if (!beforeDims || !afterDims) {
    return null;
  }

  if (beforeDims.width !== afterDims.width || beforeDims.height !== afterDims.height) {
    return {
      changedPixelRatio: 1,
      totalPixels: beforeDims.width * beforeDims.height,
      changedPixels: beforeDims.width * beforeDims.height,
      dimensionsMatch: false,
      width: beforeDims.width,
      height: beforeDims.height,
    };
  }

  // Byte-level comparison of the raw PNG data
  // This catches any difference including pixel changes, compression differences
  const minLen = Math.min(beforeBuf.length, afterBuf.length);
  let changedBytes = 0;
  // Sample bytes at an adaptive step (~one sample per pixel on average) to bound work on large images
  const step = Math.max(1, Math.floor(minLen / (beforeDims.width * beforeDims.height)));
  for (let i = 0; i < minLen; i += step) {
    if (beforeBuf[i] !== afterBuf[i]) {
      changedBytes++;
    }
  }
  // Also count size difference as changed
  if (beforeBuf.length !== afterBuf.length) {
    changedBytes += Math.abs(beforeBuf.length - afterBuf.length);
  }

  const totalSamples = Math.ceil(minLen / step);
  const ratio = totalSamples > 0 ? changedBytes / totalSamples : 0;

  return {
    changedPixelRatio: Math.round(ratio * 1000) / 1000,
    totalPixels: beforeDims.width * beforeDims.height,
    changedPixels: Math.round(ratio * beforeDims.width * beforeDims.height),
    dimensionsMatch: true,
    width: beforeDims.width,
    height: beforeDims.height,
  };
}

function getPngDimensions(buf: Buffer): { width: number; height: number } | null {
  // PNG signature: 8 bytes, then IHDR chunk (13 bytes data)
  // Width: bytes 16-19 (big-endian uint32)
  // Height: bytes 20-23 (big-endian uint32)
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return null; // Not a PNG
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}
