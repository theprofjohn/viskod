import type { Rect } from './types';

export function normalizeRect(a: Rect): Rect {
  const x = Math.min(a.x, a.x + a.width);
  const y = Math.min(a.y, a.y + a.height);
  const width = Math.abs(a.width);
  const height = Math.abs(a.height);
  return { x, y, width, height };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  const an = normalizeRect(a);
  const bn = normalizeRect(b);
  return !(
    an.x + an.width <= bn.x ||
    bn.x + bn.width <= an.x ||
    an.y + an.height <= bn.y ||
    bn.y + bn.height <= an.y
  );
}

export function intersectionRect(a: Rect, b: Rect): Rect | null {
  const an = normalizeRect(a);
  const bn = normalizeRect(b);
  const x = Math.max(an.x, bn.x);
  const y = Math.max(an.y, bn.y);
  const width = Math.min(an.x + an.width, bn.x + bn.width) - x;
  const height = Math.min(an.y + an.height, bn.y + bn.height) - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function rectArea(r: Rect): number {
  if (r.width <= 0 || r.height <= 0) return 0;
  return r.width * r.height;
}

export function intersectionRatio(a: Rect, b: Rect): number {
  const aArea = rectArea(a);
  if (aArea === 0) return 0;
  const inter = intersectionRect(a, b);
  if (!inter) return 0;
  return rectArea(inter) / aArea;
}

export function visibleRatio(a: Rect, viewport: Rect): number {
  return intersectionRatio(a, viewport);
}

export function rectContains(a: Rect, b: Rect): boolean {
  const an = normalizeRect(a);
  const bn = normalizeRect(b);
  return (
    an.x <= bn.x &&
    an.y <= bn.y &&
    an.x + an.width >= bn.x + bn.width &&
    an.y + an.height >= bn.y + bn.height
  );
}

export function centerOfRect(r: Rect): { cx: number; cy: number } {
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}

export function distanceBetweenRects(a: Rect, b: Rect): number {
  const ac = centerOfRect(a);
  const bc = centerOfRect(b);
  return Math.sqrt((ac.cx - bc.cx) ** 2 + (ac.cy - bc.cy) ** 2);
}

export function rectsEqual(a: Rect, b: Rect, tolerance = 0): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

export function isZeroArea(r: Rect): boolean {
  return r.width <= 0 || r.height <= 0;
}
