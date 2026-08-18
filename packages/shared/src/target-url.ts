export interface TargetUrlPolicy {
  /** Remote HTTP(S) hosts remain disabled by default for local-first Viskod. */
  allowRemoteHosts?: boolean;
  /** Optional explicit remote host allowlist, compared case-insensitively. */
  allowedHosts?: readonly string[];
}

export interface TargetUrlValidation {
  valid: boolean;
  normalizedUrl?: string;
  hostname?: string;
  reason?: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

/** Validate an application target before it reaches a browser navigation. */
export function validateTargetUrl(url: string, policy: TargetUrlPolicy = {}): TargetUrlValidation {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return { valid: false, reason: 'Invalid URL: target URL is required.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL format.' };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
    return { valid: false, hostname, reason: 'URL must use http:// or https:// protocol.' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, hostname, reason: 'Target URL credentials are not allowed.' };
  }

  const isLoopback = LOOPBACK_HOSTS.has(hostname);
  const allowlisted = (policy.allowedHosts ?? []).some(
    (allowed) => allowed.trim().toLowerCase() === hostname,
  );
  if (!isLoopback && !(policy.allowRemoteHosts === true && allowlisted)) {
    return {
      valid: false,
      hostname,
      reason: 'URL must point to localhost or 127.0.0.1 for local development.',
    };
  }

  return { valid: true, hostname, normalizedUrl: parsed.toString() };
}
