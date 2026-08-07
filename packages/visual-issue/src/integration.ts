import type { VisualSelection } from '@viskod/visual-selection';
import type { IssueService, IssueUpdate } from './service';
import type { IssueEvidenceSummary, VisualIssue, VisualIssueSeverity } from './types';

export interface IssueIntegration {
  createIssueFromSelection(
    selection: VisualSelection,
    sessionId: string,
    pageId: string,
    title?: string,
    description?: string,
    severity?: VisualIssueSeverity,
    evidence?: IssueEvidenceSummary,
  ): Promise<{ ok: true; issue: VisualIssue } | { ok: false; error: string }>;

  listIssues(): Promise<{ ok: true; issues: VisualIssue[] } | { ok: false; error: string }>;

  getIssue(
    issueId: string,
  ): Promise<{ ok: true; issue: VisualIssue } | { ok: false; error: string }>;

  updateIssue(
    issueId: string,
    updates: IssueUpdate,
  ): Promise<{ ok: true; issue: VisualIssue } | { ok: false; error: string }>;

  archiveIssue(
    issueId: string,
  ): Promise<{ ok: true; issue: VisualIssue } | { ok: false; error: string }>;

  reopenIssue(
    issueId: string,
  ): Promise<{ ok: true; issue: VisualIssue } | { ok: false; error: string }>;

  deleteIssue(
    issueId: string,
  ): Promise<{ ok: true; issue: VisualIssue } | { ok: false; error: string }>;
}

export function createIssueIntegration(service: IssueService): IssueIntegration {
  return {
    async createIssueFromSelection(
      selection,
      sessionId,
      pageId,
      title,
      description,
      severity,
      evidence,
    ) {
      const result = await service.createIssue(
        selection,
        sessionId,
        pageId,
        title,
        description,
        severity,
        evidence,
      );
      if (!result.ok) return { ok: false, error: result.error.message };
      return { ok: true, issue: result.value };
    },

    async listIssues() {
      const result = await service.listIssues();
      if (!result.ok) return { ok: false, error: result.error.message };
      return { ok: true, issues: result.value };
    },

    async getIssue(issueId) {
      const result = await service.getIssue(issueId);
      if (!result.ok) return { ok: false, error: result.error.message };
      return { ok: true, issue: result.value };
    },

    async updateIssue(issueId, updates) {
      const result = await service.updateIssue(issueId, updates);
      if (!result.ok) return { ok: false, error: result.error.message };
      return { ok: true, issue: result.value };
    },

    async archiveIssue(issueId) {
      const result = await service.archiveIssue(issueId);
      if (!result.ok) return { ok: false, error: result.error.message };
      return { ok: true, issue: result.value };
    },

    async reopenIssue(issueId) {
      const result = await service.reopenIssue(issueId);
      if (!result.ok) return { ok: false, error: result.error.message };
      return { ok: true, issue: result.value };
    },

    async deleteIssue(issueId) {
      const result = await service.deleteIssue(issueId);
      if (!result.ok) return { ok: false, error: result.error.message };
      return { ok: true, issue: result.value };
    },
  };
}
