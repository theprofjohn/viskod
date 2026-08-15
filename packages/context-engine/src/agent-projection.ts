import type { BoundingBox } from '@viskod/shared';
import { isSafeRelativeSourcePath } from '@viskod/shared';
import { computeSourceResolution } from '@viskod/source-hint-engine';
import type { EvidenceMap, EvidenceState } from './evidence-status';

/**
 * Structural slice of a ContextPacket consumed by the projection. Both the
 * in-memory packet and the schema-validated persisted packet satisfy it, so
 * the projection can run against either without exposing raw internals.
 */
export interface ProjectionPacketSource {
  captureId: string;
  packetId: string;
  captureStatus: 'complete' | 'partial';
  timestamp: string;
  selection: { selector: string; tagName: string; boundingBox: BoundingBox; text?: string };
  dom: { attributes: Record<string, string> };
  browser: {
    url: string;
    viewport: { width: number; height: number; deviceScaleFactor: number };
  };
  hierarchy: {
    selectedNode: { tagName: string; depth: number };
    parents: Array<{ tagName: string; depth: number; text?: string }>;
  };
  styles: { computed: Record<string, string> };
  screenshots: Array<{
    type: string;
    format: string;
    width: number;
    height: number;
    sizeBytes: number;
    sensitive?: boolean;
  }>;
  sourceHints: unknown[];
  /**
   * Phase 30A: the capture-time source-resolution snapshot persisted with the
   * packet. When present, the projection reports THIS conclusion verbatim —
   * historical captures are never re-resolved under present-day policy.
   */
  sourceHintsResolution?: {
    status: 'resolved' | 'ambiguous' | 'unavailable';
    modelVersion?: string;
    topCandidate?: string;
  };
  evidence: EvidenceMap;
  runtimeEvidence?: {
    console?: Array<{ level: string; message: string }>;
    network?: Array<{ request: { method: string; url: string }; response?: { status: number } }>;
    selectedElement?: {
      tagName: string;
      text?: string;
      attributes?: Record<string, string>;
    };
  };
  metadata: { redactions: string[] };
}

/**
 * Compact agent-safe context projection (Phase 29).
 *
 * Derived exclusively from the persisted SAFE capture (already redacted and
 * schema-validated on disk). The projection is a bounded, agent-useful slice
 * of the packet — never the whole raw packet, never absolute paths, never
 * raw screenshot pixels, never unbounded payloads.
 */

export interface AgentProjectionSourceHints {
  status: EvidenceState;
  /** Phase 30: resolved | ambiguous | unavailable — the capture-time
   * conclusion, never recomputed from the repo. */
  resolution: 'resolved' | 'ambiguous' | 'unavailable';
  /**
   * Phase 30A: provenance of `resolution`.
   * - `persisted`: loaded verbatim from the capture-time snapshot.
   * - `derived`: the packet predates the persisted-resolution snapshot
   *   (legacy capture); resolution was deterministically derived from the
   *   persisted candidates and is marked as a compatibility result, never
   *   presented as the original capture-time conclusion.
   */
  resolutionSource: 'persisted' | 'derived';
  /**
   * The source-hint model/schema version that produced the capture-time
   * conclusion (Phase 30A). Present when the packet carries a persisted
   * snapshot; absent for legacy derived results.
   */
  modelVersion?: string;
  count: number;
  /**
   * Phase 30: bounded qualified candidates. Repository-relative paths only;
   * never absolute filesystem paths, never raw source dumps, never
   * unsupported certainty.
   */
  candidates: Array<{
    path: string;
    qualification: 'exact' | 'probable' | 'possible' | 'weak';
    confidence: number;
    reasons: string[];
  }>;
}

export interface AgentProjectionRuntime {
  status: EvidenceState;
  console?: Array<{ level: string; count: number; sample: string }>;
  network?: Array<{ method: string; url: string; status: number }>;
  selectedElement?: {
    tagName: string;
    text?: string;
    attributes?: Record<string, string>;
  };
}

export interface AgentContextProjection {
  schemaVersion: '1.0.0';
  projectionVersion: 1;
  captureId: string;
  packetId: string;
  captureStatus: 'complete' | 'partial';
  timestamp: string;
  handoffId?: string;
  issueId?: string;
  problem?: { title: string; summary: string; userNote?: string };
  expectedResult?: string;
  target: {
    selector: string;
    tagName: string;
    boundingBox: BoundingBox;
    text: string;
    attributes: Record<string, string>;
    fingerprint?: { targetCount: number; confidence: number; resolutionStatus: string };
  };
  page: {
    url: string;
    title?: string;
    viewport: { width: number; height: number; deviceScaleFactor: number };
  };
  hierarchy: {
    selectedNode: { tagName: string; depth: number };
    parents: Array<{ tagName: string; depth: number; text?: string }>;
  };
  styles: {
    computed: Record<string, string>;
    status: EvidenceState;
  };
  evidence: EvidenceMap;
  runtime: AgentProjectionRuntime;
  sourceHints: AgentProjectionSourceHints;
  screenshot: {
    status: EvidenceState;
    count: number;
    sensitive: boolean;
    items: Array<{
      type: string;
      format: string;
      width: number;
      height: number;
      sizeBytes: number;
    }>;
  };
  redactions: string[];
}

export interface ProjectionBudget {
  maxTargetText: number;
  maxAttributes: number;
  maxAttributeValue: number;
  maxParents: number;
  maxStyleEntries: number;
  maxStyleValue: number;
  maxConsoleEntries: number;
  maxNetworkEntries: number;
  maxMessageLength: number;
  maxUrlLength: number;
  maxSourceHints: number;
}

export const DEFAULT_PROJECTION_BUDGET: ProjectionBudget = {
  maxTargetText: 500,
  maxAttributes: 20,
  maxAttributeValue: 200,
  maxParents: 8,
  maxStyleEntries: 40,
  maxStyleValue: 200,
  maxConsoleEntries: 10,
  maxNetworkEntries: 10,
  maxMessageLength: 200,
  maxUrlLength: 200,
  maxSourceHints: 5,
};

export interface ProjectionOptions {
  handoffId?: string;
  issueId?: string;
  problem?: { title: string; summary: string; userNote?: string };
  expectedResult?: string;
  pageTitle?: string;
  targetFingerprint?: { targetCount: number; confidence: number; resolutionStatus: string };
  budget?: Partial<ProjectionBudget>;
}

function truncate(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

interface SourceHintCandidate {
  path: string;
  qualification: 'exact' | 'probable' | 'possible' | 'weak';
  confidence: number;
  reasons: string[];
}

const QUALIFICATIONS = ['exact', 'probable', 'possible', 'weak'] as const;

/**
 * Extract a bounded, path-safe candidate from a persisted source-hint entry.
 * Absolute or escaping paths are rejected (repository-relative only) via the
 * shared load-side gate. The candidate's semantic fields are preserved
 * VERBATIM from the capture — qualification/confidence are never re-derived
 * from present-day rules (Phase 30A).
 */
function extractSourceHintCandidate(raw: unknown): SourceHintCandidate | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const rawPath = entry.displayPath ?? entry.filePath;
  if (typeof rawPath !== 'string' || rawPath.length === 0) return null;
  if (!isSafeRelativeSourcePath(rawPath)) return null;

  const confidence = typeof entry.confidence === 'number' ? entry.confidence : 0;
  const qualification = QUALIFICATIONS.includes(entry.qualification as never)
    ? (entry.qualification as 'exact' | 'probable' | 'possible' | 'weak')
    : null;
  if (!qualification) return null;
  const reasons = Array.isArray(entry.reasons)
    ? entry.reasons.filter((r): r is string => typeof r === 'string')
    : [];
  return { path: rawPath, qualification, confidence, reasons };
}

function budgetAttributes(
  attributes: Record<string, string> | undefined,
  budget: ProjectionBudget,
): Record<string, string> {
  if (!attributes) return {};
  const entries = Object.entries(attributes).slice(0, budget.maxAttributes);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) out[k] = truncate(v, budget.maxAttributeValue);
  return out;
}

function budgetStyles(
  computed: Record<string, string> | undefined,
  budget: ProjectionBudget,
): Record<string, string> {
  if (!computed) return {};
  const entries = Object.entries(computed).slice(0, budget.maxStyleEntries);
  const out: Record<string, string> = {};
  for (const [k, v] of entries) out[k] = truncate(v, budget.maxStyleValue);
  return out;
}

export function buildAgentContextProjection(
  packet: ProjectionPacketSource,
  options: ProjectionOptions = {},
): AgentContextProjection {
  const budget: ProjectionBudget = { ...DEFAULT_PROJECTION_BUDGET, ...options.budget };

  const consoleEntries = (packet.runtimeEvidence?.console ?? []).slice(-budget.maxConsoleEntries);
  const consoleGroups = new Map<string, { count: number; sample: string }>();
  for (const e of consoleEntries) {
    const g = consoleGroups.get(e.level);
    if (g) g.count++;
    else
      consoleGroups.set(e.level, {
        count: 1,
        sample: truncate(e.message, budget.maxMessageLength),
      });
  }
  const console = Array.from(consoleGroups.entries()).map(([level, v]) => ({
    level,
    count: v.count,
    sample: v.sample,
  }));

  const network = (packet.runtimeEvidence?.network ?? [])
    .slice(-budget.maxNetworkEntries)
    .map((e) => ({
      method: e.request.method,
      url: truncate(e.request.url, budget.maxUrlLength),
      status: e.response?.status ?? 0,
    }));

  const selectedElement = packet.runtimeEvidence?.selectedElement
    ? {
        tagName: packet.runtimeEvidence.selectedElement.tagName,
        text: truncate(packet.runtimeEvidence.selectedElement.text, budget.maxMessageLength),
        attributes: budgetAttributes(packet.runtimeEvidence.selectedElement.attributes, budget),
      }
    : undefined;

  const hierarchy = {
    selectedNode: packet.hierarchy.selectedNode,
    parents: packet.hierarchy.parents.slice(0, budget.maxParents).map((p) => ({
      tagName: p.tagName,
      depth: p.depth,
      text: truncate(p.text, budget.maxTargetText),
    })),
  };

  const screenshotItems = packet.screenshots.map((s) => ({
    type: s.type,
    format: s.format,
    width: s.width,
    height: s.height,
    sizeBytes: s.sizeBytes,
  }));

  const sourceHints = packet.sourceHints ?? [];

  // Phase 30/30A: bounded qualified candidates from the PERSISTED evidence,
  // preserved verbatim (order, qualification, confidence, reasons) — the
  // fresh agent process never recomputes or reranks source hints.
  const hintCandidates = sourceHints
    .map((raw) => extractSourceHintCandidate(raw))
    .filter((c): c is SourceHintCandidate => c !== null)
    .slice(0, budget.maxSourceHints);

  // Phase 30A: report the capture-time resolution snapshot verbatim when the
  // packet carries one. Only packets that PREDATE the snapshot (legacy
  // captures) fall back to a deterministic derivation, clearly marked as
  // such — never presented as the original capture-time conclusion.
  const persisted = packet.sourceHintsResolution;
  let resolution: 'resolved' | 'ambiguous' | 'unavailable';
  let resolutionSource: 'persisted' | 'derived';
  if (
    persisted &&
    (persisted.status === 'resolved' ||
      persisted.status === 'ambiguous' ||
      persisted.status === 'unavailable')
  ) {
    resolution = persisted.status;
    resolutionSource = 'persisted';
  } else {
    ({ resolution } = computeSourceResolution(
      hintCandidates.map((c) => ({
        confidence: c.confidence,
        qualification: c.qualification,
        path: c.path,
      })),
    ));
    resolutionSource = 'derived';
  }
  const candidates = hintCandidates.map((c) => ({
    path: c.path,
    qualification: c.qualification,
    confidence: Math.round(c.confidence * 10000) / 10000,
    reasons: c.reasons.slice(0, 3).map((r) => truncate(r, 120)),
  }));

  return {
    schemaVersion: '1.0.0',
    projectionVersion: 1,
    captureId: packet.captureId,
    packetId: packet.packetId,
    captureStatus: packet.captureStatus,
    timestamp: packet.timestamp,
    handoffId: options.handoffId,
    issueId: options.issueId,
    problem: options.problem,
    expectedResult: options.expectedResult,
    target: {
      selector: packet.selection.selector,
      tagName: packet.selection.tagName,
      boundingBox: packet.selection.boundingBox,
      text: truncate(packet.selection.text, budget.maxTargetText),
      attributes: budgetAttributes(packet.dom.attributes, budget),
      fingerprint: options.targetFingerprint,
    },
    page: {
      url: packet.browser.url,
      title: options.pageTitle,
      viewport: {
        width: packet.browser.viewport.width,
        height: packet.browser.viewport.height,
        deviceScaleFactor: packet.browser.viewport.deviceScaleFactor,
      },
    },
    hierarchy,
    styles: {
      computed: budgetStyles(packet.styles.computed, budget),
      status: packet.evidence.styles.state,
    },
    evidence: packet.evidence,
    runtime: {
      status: packet.evidence.runtime.state,
      ...(console.length > 0 ? { console } : {}),
      ...(network.length > 0 ? { network } : {}),
      ...(selectedElement ? { selectedElement } : {}),
    },
    sourceHints: {
      status: packet.evidence.sourceHints.state,
      resolution,
      resolutionSource,
      ...(resolutionSource === 'persisted' && persisted?.modelVersion
        ? { modelVersion: persisted.modelVersion }
        : {}),
      count: sourceHints.length,
      candidates,
    },
    screenshot: {
      status: packet.evidence.screenshot.state,
      count: packet.screenshots.length,
      sensitive: packet.screenshots.some((s) => s.sensitive === true),
      items: screenshotItems,
    },
    redactions: packet.metadata.redactions,
  };
}
