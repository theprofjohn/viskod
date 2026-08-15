import { deepRedactValue, sanitizeErrorDetail } from '@viskod/shared';
import type { ContextPacket } from './index';

/**
 * Packet-level redaction boundary (Phase 29).
 *
 * Every structured capture packet must pass through this boundary before it
 * is persisted or exported to an agent. The walk covers ALL textual leaves:
 * DOM text/attributes, hierarchy text, selected text, computed styles, URLs
 * and query parameters, console/network evidence, page metadata, and
 * source-hint text. Values under sensitive attribute names are default-denied
 * wholesale; every other string passes through the shared regex rules.
 *
 * The packet returned here IS the persisted representation — redaction
 * happens before persistence, never at read time.
 */
export function redactPacketForPersistence(packet: ContextPacket): {
  packet: ContextPacket;
  redactions: string[];
} {
  const redactions: string[] = [];
  const redacted = deepRedactValue(packet, { redactions, depth: 40 }) as ContextPacket;
  return { packet: redacted, redactions: [...new Set(redactions)] };
}

export { sanitizeErrorDetail };
