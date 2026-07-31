import type { EventBus } from '@viskod/event-bus';
import { type Result, type ViskodError, ErrorCategory, ErrorSeverity, err, ok } from '@viskod/shared';
import type {
  VisualSelection,
  VisualSelectionMode,
  VisualSelectionTarget,
  VisualSelectionSummary,
  VisualSelectionResolution,
  VisualSelectionConfig,
  Rect,
  PageInfo,
  ViewportInfo,
} from './types';
import { DEFAULT_VISUAL_SELECTION_CONFIG } from './types';
import { normalizeText } from './redaction';
import { redactSelectionData } from './redaction';
import { collectBoxCandidates, reduceBoxSelection, boxCandidateToTarget, deduplicateTargets } from './box-selection';
import type { BoxCandidate } from './box-selection';
import type { ResolvedElement, ResolvedTarget } from './resolver';
import { resolveTarget } from './resolver';

export interface VisualSelectionService {
  enterSelectionMode(pageId: string): Promise<Result<void>>;
  exitSelectionMode(pageId: string): Promise<Result<void>>;
  getActiveSelection(pageId: string): Promise<Result<VisualSelection | null>>;
  clearSelection(pageId: string): Promise<Result<void>>;
  resolveSelection(pageId: string, selectionId: string): Promise<Result<ResolvedTarget>>;
  health(): VisualSelectionServiceHealth;
}

export interface VisualSelectionServiceHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  activeSelections: number;
  totalSelections: number;
  failedSelections: number;
}

interface ActiveSession {
  pageId: string;
  sessionId: string;
  selectionMode: boolean;
  activeSelection: VisualSelection | null;
  createdAt: string;
}

export class VisualSelectionServiceImpl implements VisualSelectionService {
  private eventBus: EventBus;
  private sessions: Map<string, ActiveSession> = new Map();
  private config: VisualSelectionConfig;
  private totalSelections = 0;
  private failedSelections = 0;

  constructor(eventBus: EventBus, config: VisualSelectionConfig = DEFAULT_VISUAL_SELECTION_CONFIG) {
    this.eventBus = eventBus;
    this.config = config;
  }

  async enterSelectionMode(pageId: string): Promise<Result<void>> {
    const session = this.sessions.get(pageId);
    if (session?.selectionMode) {
      return err(this.seError('SELECTION_MODE_ALREADY_ACTIVE', 'Selection mode is already active'));
    }

    const now = new Date().toISOString();
    this.sessions.set(pageId, {
      pageId,
      sessionId: crypto.randomUUID(),
      selectionMode: true,
      activeSelection: null,
      createdAt: now,
    });

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VS_EVENT:SELECTION_MODE_ENTERED',
      timestamp: now,
      version: '1.0.0',
      source: 'visual-selection',
      correlationId: pageId,
      payload: { pageId },
    });

    return ok(undefined);
  }

  async exitSelectionMode(pageId: string): Promise<Result<void>> {
    const session = this.sessions.get(pageId);
    if (!session?.selectionMode) {
      return err(this.seError('SELECTION_MODE_NOT_ACTIVE', 'Selection mode is not active'));
    }

    session.selectionMode = false;
    session.activeSelection = null;

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VS_EVENT:SELECTION_MODE_EXITED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'visual-selection',
      correlationId: pageId,
      payload: { pageId },
    });

    return ok(undefined);
  }

  async getActiveSelection(pageId: string): Promise<Result<VisualSelection | null>> {
    const session = this.sessions.get(pageId);
    if (!session) {
      return err(this.seError('NO_ACTIVE_PAGE', 'No active page session'));
    }
    return ok(session.activeSelection);
  }

  async clearSelection(pageId: string): Promise<Result<void>> {
    const session = this.sessions.get(pageId);
    if (!session) {
      return err(this.seError('NO_ACTIVE_PAGE', 'No active page session'));
    }
    session.activeSelection = null;

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VS_EVENT:SELECTION_CLEARED',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      source: 'visual-selection',
      correlationId: pageId,
      payload: { pageId },
    });

    return ok(undefined);
  }

  async resolveSelection(pageId: string, _selectionId: string): Promise<Result<ResolvedTarget>> {
    const session = this.sessions.get(pageId);
    if (!session) {
      return err(this.seError('NO_ACTIVE_PAGE', 'No active page session'));
    }
    if (!session.activeSelection) {
      return err(this.seError('TARGET_MISSING', 'No active selection'));
    }

    const original = session.activeSelection.targets[0];
    if (!original) {
      return err(this.seError('TARGET_MISSING', 'No targets in active selection'));
    }

    const emptyCandidates: ResolvedElement[] = [];
    const result = resolveTarget(original, emptyCandidates);

    return ok(result);
  }

  createSingleSelection(
    pageId: string,
    target: VisualSelectionTarget,
    pageInfo: PageInfo,
    regionRect: Rect,
  ): Result<VisualSelection> {
    const session = this.sessions.get(pageId);
    if (!session) {
      return err(this.seError('NO_ACTIVE_PAGE', 'No active page session'));
    }
    if (!session.selectionMode) {
      return err(this.seError('SELECTION_MODE_NOT_ACTIVE', 'Selection mode is not active'));
    }

    const now = new Date().toISOString();
    const selectionId = crypto.randomUUID();

    const textPreview = normalizeText(target.semantics.textPreview ?? '', this.config.textPreviewMaxLength);

    const summary: VisualSelectionSummary = {
      label: textPreview || target.semantics.accessibleName || target.semantics.tagName,
      role: target.semantics.role,
      textPreview: textPreview || undefined,
      targetCount: 1,
    };

    const resolution: VisualSelectionResolution = {
      status: 'resolved',
      confidence: 0.9,
      resolvedAt: now,
    };

    const selection: VisualSelection = {
      schemaVersion: 1,
      selectionId,
      sessionId: session.sessionId,
      pageId,
      mode: 'single',
      createdAt: now,
      updatedAt: now,
      page: pageInfo,
      region: {
        viewportRect: regionRect,
      },
      targets: [target],
      summary,
      resolution,
    };

    const redacted = redactSelectionData(selection);
    session.activeSelection = redacted.selection;
    this.totalSelections++;

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VS_EVENT:SELECTION_CREATED',
      timestamp: now,
      version: '1.0.0',
      source: 'visual-selection',
      correlationId: selectionId,
      payload: { pageId, selectionId, mode: 'single', targetCount: 1 },
    });

    return ok(redacted.selection);
  }

  createBoxSelection(
    pageId: string,
    candidates: BoxCandidate[],
    dragRect: Rect,
    pageInfo: PageInfo,
  ): Result<VisualSelection> {
    const session = this.sessions.get(pageId);
    if (!session) {
      return err(this.seError('NO_ACTIVE_PAGE', 'No active page session'));
    }
    if (!session.selectionMode) {
      return err(this.seError('SELECTION_MODE_NOT_ACTIVE', 'Selection mode is not active'));
    }

    const { selected, warnings } = reduceBoxSelection(candidates, this.config);
    const targets = selected.map(boxCandidateToTarget);
    const deduplicated = deduplicateTargets(targets);

    if (deduplicated.length > this.config.maxSelectedTargets) {
      return err(this.seError('SELECTION_TARGET_LIMIT_EXCEEDED', 'This region contains too many elements. Select a smaller area.'));
    }

    let targetCount = deduplicated.length;
    let truncated = false;
    let finalTargets = deduplicated;

    if (finalTargets.length > this.config.maxSelectedTargets) {
      finalTargets = finalTargets.slice(0, this.config.maxSelectedTargets);
      truncated = true;
    }

    const now = new Date().toISOString();
    const selectionId = crypto.randomUUID();

    const summary: VisualSelectionSummary = {
      label: `${targetCount} element${targetCount !== 1 ? 's' : ''} selected`,
      targetCount: finalTargets.length,
    };

    if (truncated) {
      summary.label = `${summary.label} (truncated)`;
    }

    const resolution: VisualSelectionResolution = {
      status: 'resolved',
      confidence: 0.8,
      resolvedAt: now,
      warnings: warnings.length > 0 ? warnings : undefined,
    };

    const selection: VisualSelection = {
      schemaVersion: 1,
      selectionId,
      sessionId: session.sessionId,
      pageId,
      mode: 'box',
      createdAt: now,
      updatedAt: now,
      page: pageInfo,
      region: {
        viewportRect: dragRect,
      },
      targets: finalTargets,
      summary,
      resolution,
    };

    const redacted = redactSelectionData(selection);
    session.activeSelection = redacted.selection;
    this.totalSelections++;

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VS_EVENT:SELECTION_CREATED',
      timestamp: now,
      version: '1.0.0',
      source: 'visual-selection',
      correlationId: selectionId,
      payload: { pageId, selectionId, mode: 'box', targetCount: finalTargets.length },
    });

    return ok(redacted.selection);
  }

  health(): VisualSelectionServiceHealth {
    return {
      status: 'healthy',
      activeSelections: this.activeSessionCount(),
      totalSelections: this.totalSelections,
      failedSelections: this.failedSelections,
    };
  }

  private activeSessionCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.selectionMode) count++;
    }
    return count;
  }

  private seError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'visual-selection',
      timestamp: new Date().toISOString(),
    };
  }
}
