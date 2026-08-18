import type { EventBus } from '@viskod/event-bus';
import { type Result, type ViskodError, createViskodError, err, ok } from '@viskod/shared';
import type { VisualSelection } from '@viskod/visual-selection';
import {
  createLifecycleEvent,
  isValidTransition,
  makeArchiveEvent,
  makeCreatedEvent,
  makeDeleteEvent,
  makeForkEvent,
  makeReopenEvent,
  makeSeverityChangeEvent,
  makeStatusChangeEvent,
} from './lifecycle';
import { IssuePersistence } from './persistence';
import { generateDefaultTitle, redactIssue } from './redaction';
import type {
  IssueErrorCode,
  IssueEvidenceSummary,
  RedactedTargetSummary,
  VisualIssue,
  VisualIssueEvent,
  VisualIssueSeverity,
  VisualIssueStatus,
} from './types';
export interface IssueService {
  createIssue(
    selection: VisualSelection,
    sessionId: string,
    pageId: string,
    title?: string,
    description?: string,
    severity?: VisualIssueSeverity,
    evidence?: IssueEvidenceSummary,
    expectedResult?: string,
  ): Promise<Result<VisualIssue>>;

  getIssue(issueId: string): Promise<Result<VisualIssue>>;
  updateIssue(issueId: string, updates: IssueUpdate): Promise<Result<VisualIssue>>;
  listIssues(includeArchived?: boolean, limit?: number): Promise<Result<VisualIssue[]>>;
  archiveIssue(issueId: string): Promise<Result<VisualIssue>>;
  reopenIssue(issueId: string): Promise<Result<VisualIssue>>;
  deleteIssue(issueId: string): Promise<Result<VisualIssue>>;
  /** Explicit user action; requestId makes retries of one accepted action safe. */
  forkIssue?(issueId: string, title?: string, requestId?: string): Promise<Result<VisualIssue>>;
  health(): Promise<IssueServiceHealth>;
}
export interface IssueUpdate {
  title?: string;
  description?: string;
  expectedResult?: string;
  status?: VisualIssueStatus;
  severity?: VisualIssueSeverity;
  tags?: string[];
}

export interface IssueServiceHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  totalIssues: number;
  issuesByStatus: Partial<Record<VisualIssueStatus, number>>;
}

export class IssueServiceImpl implements IssueService {
  private persistence: IssuePersistence;
  private eventBus: EventBus;
  private forkRequests = new Map<string, Promise<Result<VisualIssue>>>();

  constructor(eventBus: EventBus, persistence?: IssuePersistence) {
    this.eventBus = eventBus;
    this.persistence = persistence ?? new IssuePersistence();
  }

  async createIssue(
    selection: VisualSelection,
    sessionId: string,
    pageId: string,
    title?: string,
    description?: string,
    severity?: VisualIssueSeverity,
    evidence?: IssueEvidenceSummary,
    expectedResult?: string,
  ): Promise<Result<VisualIssue>> {
    const validation = this.validateCreateSelection(selection);
    if (!validation.ok) return err(validation.error);

    const issue = this.buildIssue(
      selection,
      sessionId,
      pageId,
      title,
      description,
      severity,
      evidence,
      expectedResult,
    );

    return this.persistCreatedIssue(issue, selection.summary.targetCount);
  }

  private validateCreateSelection(selection: VisualSelection): Result<void> {
    if (selection.resolution.status === 'missing' || selection.resolution.status === 'stale') {
      return err(
        this.ieError(
          'STALE_SELECTION',
          'The page changed. Reselect the element before creating an issue.',
        ),
      );
    }
    if (!selection.targets || selection.targets.length === 0) {
      return err(this.ieError('NO_ACTIVE_SELECTION', 'Select an element or region first.'));
    }
    return ok(undefined);
  }

  private buildIssue(
    selection: VisualSelection,
    sessionId: string,
    pageId: string,
    title?: string,
    description?: string,
    severity?: VisualIssueSeverity,
    evidence?: IssueEvidenceSummary,
    expectedResult?: string,
  ): VisualIssue {
    const now = new Date().toISOString();
    const issueId = crypto.randomUUID();
    const effectiveTitle =
      title ||
      generateDefaultTitle(
        selection.mode,
        selection.summary.label,
        selection.summary.role,
        selection.summary.textPreview,
        selection.page.title,
      );

    const targetSummary: RedactedTargetSummary = {
      mode: selection.mode,
      label: selection.summary.label,
      role: selection.summary.role,
      textPreview: selection.summary.textPreview,
      targetCount: selection.summary.targetCount,
      confidence: selection.resolution.confidence,
      resolutionStatus: selection.resolution.status,
    };

    return {
      schemaVersion: 1 as const,
      issueId,
      rootIssueId: issueId,
      sessionId,
      pageId,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      severity: severity ?? 'medium',
      title: effectiveTitle,
      description,
      expectedResult,
      source: {
        createdFrom: 'visual-selection',
        selectionId: selection.selectionId,
        selectionSnapshot: JSON.parse(JSON.stringify(selection)),
      },
      page: {
        url: selection.page.url,
        title: selection.page.title,
        viewport: {
          width: selection.page.viewport.width,
          height: selection.page.viewport.height,
          deviceScaleFactor: selection.page.viewport.deviceScaleFactor,
        },
      },
      targetSummary,
      evidence,
      tags: [],
      lifecycle: [makeCreatedEvent()],
      redaction: { applied: false, rules: [], strippedFields: [], warnings: [] },
    };
  }

  private async persistCreatedIssue(
    issue: VisualIssue,
    targetCount: number,
  ): Promise<Result<VisualIssue>> {
    const redacted = redactIssue(issue);
    const result = await this.persistence.saveIssue(redacted.issue);
    if (!result.ok) return err(result.error);

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VI_EVENT:ISSUE_CREATED',
      timestamp: issue.createdAt,
      version: '1.0.0',
      source: 'visual-issue',
      correlationId: issue.issueId,
      payload: { issueId: issue.issueId, title: redacted.issue.title, targetCount },
    });

    return ok(redacted.issue);
  }

  async getIssue(issueId: string): Promise<Result<VisualIssue>> {
    if (!issueId || typeof issueId !== 'string') {
      return err(this.ieError('INVALID_ISSUE_ID', 'Invalid issue ID'));
    }
    const result = await this.persistence.loadIssue(issueId);
    if (!result.ok) return result;

    const redacted = redactIssue(result.value);
    return ok(redacted.issue);
  }

  async updateIssue(issueId: string, updates: IssueUpdate): Promise<Result<VisualIssue>> {
    const result = await this.persistence.loadIssue(issueId);
    if (!result.ok) return result;

    const issue = result.value;
    if (issue.deletedAt) {
      return err(this.ieError('ISSUE_NOT_FOUND', 'Issue has been deleted'));
    }

    const events: VisualIssueEvent[] = [...issue.lifecycle];
    let changed = false;

    if (updates.title !== undefined && updates.title !== issue.title) {
      events.push(
        createLifecycleEvent('updated', `Title updated to: ${updates.title}`, 'local-user', {
          title: { before: issue.title, after: updates.title },
        }),
      );
      issue.title = updates.title;
      changed = true;
    }
    if (updates.description !== undefined && updates.description !== issue.description) {
      events.push(createLifecycleEvent('updated', 'Description updated', 'local-user'));
      issue.description = updates.description;
      changed = true;
    }
    if (updates.severity !== undefined && updates.severity !== issue.severity) {
      events.push(makeSeverityChangeEvent(issue.severity, updates.severity));
      issue.severity = updates.severity;
      changed = true;
    }
    if (updates.expectedResult !== undefined && updates.expectedResult !== issue.expectedResult) {
      events.push(createLifecycleEvent('updated', 'Expected result updated', 'local-user'));
      issue.expectedResult = updates.expectedResult;
      changed = true;
    }
    if (updates.status !== undefined && updates.status !== issue.status) {
      if (!isValidTransition(issue.status, updates.status)) {
        return err(
          this.ieError(
            'INVALID_LIFECYCLE_TRANSITION',
            `Cannot transition from ${issue.status} to ${updates.status}`,
          ),
        );
      }
      events.push(makeStatusChangeEvent(issue.status, updates.status));
      issue.status = updates.status;
      if (updates.status === 'archived') {
        issue.archivedAt = new Date().toISOString();
      }
      changed = true;
    }
    if (updates.tags !== undefined) {
      issue.tags = updates.tags;
      changed = true;
    }

    if (!changed) {
      return ok(issue);
    }

    const updatedAt = new Date();
    const previousUpdatedAt = Date.parse(issue.updatedAt);
    if (Number.isFinite(previousUpdatedAt) && updatedAt.getTime() <= previousUpdatedAt) {
      updatedAt.setTime(previousUpdatedAt + 1);
    }
    issue.updatedAt = updatedAt.toISOString();
    issue.lifecycle = events;

    const redacted = redactIssue(issue);
    const saveResult = await this.persistence.saveIssue(redacted.issue);
    if (!saveResult.ok) return saveResult;

    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VI_EVENT:ISSUE_UPDATED',
      timestamp: issue.updatedAt,
      version: '1.0.0',
      source: 'visual-issue',
      correlationId: issueId,
      payload: { issueId, status: issue.status, severity: issue.severity },
    });
    return ok(redacted.issue);
  }

  async listIssues(includeArchived = false, limit = 100): Promise<Result<VisualIssue[]>> {
    const result = await this.persistence.listIssues(includeArchived, false);
    if (!result.ok) return result;

    const redacted = result.value
      .map((issue) => redactIssue(issue).issue)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.issueId.localeCompare(b.issueId))
      .slice(0, Math.max(1, Math.min(limit, 500)));
    return ok(redacted);
  }

  async forkIssue(
    issueId: string,
    title?: string,
    requestId?: string,
  ): Promise<Result<VisualIssue>> {
    if (!requestId) return this.doForkIssue(issueId, title);
    const existing = this.forkRequests.get(requestId);
    if (existing) return existing;
    const operation = this.doForkIssue(issueId, title).finally(() => {
      this.forkRequests.delete(requestId);
    });
    this.forkRequests.set(requestId, operation);
    return operation;
  }

  private async doForkIssue(issueId: string, title?: string): Promise<Result<VisualIssue>> {
    const parentResult = await this.persistence.loadIssue(issueId);
    if (!parentResult.ok) return parentResult;
    const parent = parentResult.value;
    if (parent.deletedAt) return err(this.ieError('ISSUE_NOT_FOUND', 'Issue has been deleted'));

    const now = new Date().toISOString();
    const childId = crypto.randomUUID();
    const rootIssueId = parent.rootIssueId ?? parent.issueId;
    const child: VisualIssue = {
      ...parent,
      issueId: childId,
      parentIssueId: parent.issueId,
      rootIssueId,
      forkedAt: now,
      createdAt: now,
      updatedAt: now,
      archivedAt: undefined,
      deletedAt: undefined,
      status: 'open',
      title: title?.trim() || `Follow-up: ${parent.title}`.slice(0, 80),
      lifecycle: [makeCreatedEvent(), makeForkEvent(parent.issueId, childId)],
    };
    const saved = await this.persistence.saveIssue(redactIssue(child).issue);
    if (!saved.ok) return saved;
    return ok(redactIssue(child).issue);
  }

  async archiveIssue(issueId: string): Promise<Result<VisualIssue>> {
    return this.lifecycleAction(issueId, 'archived', [makeArchiveEvent()]);
  }

  async reopenIssue(issueId: string): Promise<Result<VisualIssue>> {
    const result = await this.persistence.loadIssue(issueId);
    if (!result.ok) return result;

    const issue = result.value;
    if (issue.status !== 'archived') {
      return err(this.ieError('REOPEN_NON_ARCHIVED', 'Only archived issues can be reopened'));
    }

    const events = [...issue.lifecycle, makeReopenEvent()];
    const redacted = redactIssue({
      ...issue,
      status: 'open',
      archivedAt: undefined,
      updatedAt: new Date().toISOString(),
      lifecycle: events,
    });

    const saveResult = await this.persistence.saveIssue(redacted.issue);
    if (!saveResult.ok) return saveResult;

    return ok(redacted.issue);
  }

  async deleteIssue(issueId: string): Promise<Result<VisualIssue>> {
    const result = await this.persistence.loadIssue(issueId);
    if (!result.ok) return result;

    if (result.value.deletedAt) {
      return err(this.ieError('ALREADY_DELETED', 'Issue is already deleted'));
    }

    const redacted = redactIssue({
      ...result.value,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lifecycle: [...result.value.lifecycle, makeDeleteEvent()],
    });
    const saveResult = await this.persistence.saveIssue(redacted.issue);
    if (!saveResult.ok) return saveResult;
    this.eventBus.publish({
      eventId: crypto.randomUUID(),
      eventType: 'VI_EVENT:ISSUE_UPDATED',
      timestamp: redacted.issue.updatedAt,
      version: '1.0.0',
      source: 'visual-issue',
      correlationId: issueId,
      payload: { issueId, status: redacted.issue.status },
    });
    return ok(redacted.issue);
  }

  async health(): Promise<IssueServiceHealth> {
    const result = await this.persistence.listIssues(true, true);
    const issues = result.ok ? result.value : [];

    const byStatus: Partial<Record<VisualIssueStatus, number>> = {};
    for (const issue of issues) {
      byStatus[issue.status] = (byStatus[issue.status] ?? 0) + 1;
    }

    return {
      status: 'healthy',
      totalIssues: issues.length,
      issuesByStatus: byStatus,
    };
  }

  private async lifecycleAction(
    issueId: string,
    targetStatus: VisualIssueStatus,
    newEvents: VisualIssueEvent[],
  ): Promise<Result<VisualIssue>> {
    const result = await this.persistence.loadIssue(issueId);
    if (!result.ok) return result;

    const issue = result.value;
    if (issue.status === targetStatus && targetStatus === 'archived') {
      return err(this.ieError('ALREADY_ARCHIVED', 'Issue is already archived'));
    }
    if (issue.deletedAt && targetStatus !== 'open') {
      return err(this.ieError('ISSUE_NOT_FOUND', 'Issue has been deleted'));
    }

    if (!isValidTransition(issue.status, targetStatus)) {
      return err(
        this.ieError(
          'INVALID_LIFECYCLE_TRANSITION',
          `Cannot transition from ${issue.status} to ${targetStatus}`,
        ),
      );
    }

    const events = [...issue.lifecycle, ...newEvents];
    const updated: VisualIssue = {
      ...issue,
      status: targetStatus,
      archivedAt: targetStatus === 'archived' ? new Date().toISOString() : issue.archivedAt,
      updatedAt: new Date().toISOString(),
      lifecycle: events,
    };

    const redacted = redactIssue(updated);
    const saveResult = await this.persistence.saveIssue(redacted.issue);
    if (!saveResult.ok) return saveResult;

    return ok(redacted.issue);
  }

  private ieError(code: IssueErrorCode | string, message: string): ViskodError {
    return createViskodError({
      code,
      category: 'runtime',
      severity: 'recoverable',
      message,
      subsystem: 'visual-issue',
    });
  }
}
