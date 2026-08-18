import type http from 'node:http';

export const MAX_STUDIO_JSON_BODY_BYTES = 256 * 1024;
export const MAX_STUDIO_TEXT_BODY_BYTES = 16 * 1024;

/** Studio accepts loopback browser origins and the extension only. */
export function isAllowedStudioOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'chrome-extension:') return true;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function rejectOversizedBody(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (!Number.isFinite(contentLength) || contentLength <= MAX_STUDIO_JSON_BODY_BYTES) return false;
  res.statusCode = 413;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: 'Request body exceeds the 256 KiB limit.' }));
  req.resume();
  return true;
}
