/**
 * Capture integrity contract (Phase 29).
 *
 * A capture result is one of:
 *
 * - `complete`: every enabled evidence provider required by the capture
 *   profile succeeded. Nothing is missing and nothing was deliberately
 *   omitted.
 * - `partial`: the core target is valid and required core target evidence
 *   succeeded, but one or more OPTIONAL enabled evidence providers failed or
 *   were deliberately omitted for privacy (e.g. screenshots under the
 *   default agent-safe policy). A partial packet is still usable, and its
 *   `evidence` map states exactly what is missing and why.
 * - `failed`: core identity/capture requirements failed (unresolved target,
 *   detached resolved target, corrupt core DOM evidence, required
 *   persistence failure, invalid packet schema). A failed capture never
 *   returns a successful packet — `generatePacket` fails closed with a typed
 *   error.
 *
 * The packet-level `captureStatus` field carries `complete | partial`;
 * `failed` is expressed by the error result, never by a fabricated packet.
 */

export type CaptureIntegrity = 'complete' | 'partial' | 'failed';

export type EvidenceState =
  | 'collected'
  | 'disabled'
  | 'unavailable'
  | 'failed'
  | 'redacted'
  | 'omitted_sensitive';

/** Sanitized machine-readable failure detail — never secrets, stacks, or paths. */
export interface EvidenceDiagnostic {
  provider: string;
  code: string;
  reason: string;
}

export interface EvidenceStatus {
  state: EvidenceState;
  diagnostic?: EvidenceDiagnostic;
}

export interface EvidenceMap {
  dom: EvidenceStatus;
  hierarchy: EvidenceStatus;
  styles: EvidenceStatus;
  screenshot: EvidenceStatus;
  runtime: EvidenceStatus;
  sourceHints: EvidenceStatus;
}

export const EVIDENCE_PROVIDERS = [
  'dom',
  'hierarchy',
  'styles',
  'screenshot',
  'runtime',
  'sourceHints',
] as const;
export type EvidenceProvider = (typeof EVIDENCE_PROVIDERS)[number];

export const COLLECTED: EvidenceStatus = { state: 'collected' };
export const DISABLED: EvidenceStatus = { state: 'disabled' };
export const UNAVAILABLE: EvidenceStatus = { state: 'unavailable' };

/** Explicit unavailable with an actionable, sanitized reason (Phase 30). */
export function unavailableStatus(
  provider: EvidenceProvider,
  code: string,
  reason: string,
): EvidenceStatus {
  return { state: 'unavailable', diagnostic: { provider, code, reason } };
}

export function failedStatus(
  provider: EvidenceProvider,
  code: string,
  reason: string,
): EvidenceStatus {
  return { state: 'failed', diagnostic: { provider, code, reason } };
}

export function omittedSensitiveStatus(
  provider: EvidenceProvider,
  code = 'SCREENSHOT_OMITTED_SENSITIVE',
  reason = 'Raw screenshot pixels are not persisted under the agent-safe privacy policy',
): EvidenceStatus {
  return { state: 'omitted_sensitive', diagnostic: { provider, code, reason } };
}

/**
 * Derive the packet-level integrity from the evidence map.
 * `disabled`/`unavailable` do not degrade integrity; `failed` and
 * `omitted_sensitive` make the capture `partial`. The `failed` state of the
 * contract is expressed by an error result, never by a packet.
 */
export function deriveCaptureIntegrity(evidence: EvidenceMap): 'complete' | 'partial' {
  const degraded = EVIDENCE_PROVIDERS.some(
    (p) => evidence[p].state === 'failed' || evidence[p].state === 'omitted_sensitive',
  );
  return degraded ? 'partial' : 'complete';
}
