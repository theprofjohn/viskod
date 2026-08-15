import { applyRedaction } from '@viskod/shared';
import type { AgentHandoff } from './types';

/**
 * Agent-handoff redaction, built on the shared redaction primitives
 * (`@viskod/shared`). Values under sensitive attribute names are
 * default-denied; every other string passes through the shared regex rules.
 */
export { deepRedactValue } from '@viskod/shared';

function applyTextRedaction(text: string): { text: string; redactions: string[] } {
  return applyRedaction(text);
}

export function redactAgentHandoff(handoff: AgentHandoff): {
  handoff: AgentHandoff;
  rules: string[];
  strippedFields: string[];
} {
  const allRules = new Set<string>();
  const strippedFields: string[] = [];

  const redactedTitle = applyTextRedaction(handoff.brief.title);
  for (const r of redactedTitle.redactions) allRules.add(r);

  const redactedSummary = applyTextRedaction(handoff.brief.summary);
  for (const r of redactedSummary.redactions) allRules.add(r);

  const redactedUserNote = handoff.brief.userNote
    ? applyTextRedaction(handoff.brief.userNote)
    : null;
  if (redactedUserNote) for (const r of redactedUserNote.redactions) allRules.add(r);

  const redactedTargetLabel = handoff.brief.selectedTarget.label
    ? applyTextRedaction(handoff.brief.selectedTarget.label)
    : null;
  if (redactedTargetLabel) for (const r of redactedTargetLabel.redactions) allRules.add(r);

  const redactedTargetPreview = handoff.brief.selectedTarget.textPreview
    ? applyTextRedaction(handoff.brief.selectedTarget.textPreview)
    : null;
  if (redactedTargetPreview) for (const r of redactedTargetPreview.redactions) allRules.add(r);

  const redactedPageTitle = handoff.brief.page.title
    ? applyTextRedaction(handoff.brief.page.title)
    : null;
  if (redactedPageTitle) for (const r of redactedPageTitle.redactions) allRules.add(r);

  const redactedPageUrl = handoff.brief.page.url
    ? applyTextRedaction(handoff.brief.page.url)
    : null;
  if (redactedPageUrl) for (const r of redactedPageUrl.redactions) allRules.add(r);

  const redactedSourceHints = handoff.brief.sourceHints?.topHints.map((h) => {
    const r = applyTextRedaction(h.displayName);
    for (const label of r.redactions) allRules.add(label);
    return { ...h, displayName: r.text };
  });

  const redactedLifecycle = handoff.lifecycle.map((evt) => {
    const r = applyTextRedaction(evt.summary);
    for (const label of r.redactions) allRules.add(label);
    return { ...evt, summary: r.text };
  });

  const redacted: AgentHandoff = {
    ...handoff,
    brief: {
      ...handoff.brief,
      title: redactedTitle.text,
      summary: redactedSummary.text,
      userNote: redactedUserNote?.text ?? handoff.brief.userNote,
      page: {
        ...handoff.brief.page,
        title: redactedPageTitle?.text ?? handoff.brief.page.title,
        url: redactedPageUrl?.text ?? handoff.brief.page.url,
      },
      selectedTarget: {
        ...handoff.brief.selectedTarget,
        label: redactedTargetLabel?.text ?? handoff.brief.selectedTarget.label,
        textPreview: redactedTargetPreview?.text ?? handoff.brief.selectedTarget.textPreview,
      },
      sourceHints: handoff.brief.sourceHints
        ? { ...handoff.brief.sourceHints, topHints: redactedSourceHints ?? [] }
        : undefined,
    },
    lifecycle: redactedLifecycle,
    redaction: {
      applied: allRules.size > 0,
      rules: [...allRules],
      strippedFields,
      warnings: [],
    },
  };

  return { handoff: redacted, rules: [...allRules], strippedFields };
}

export function redactBriefText(text: string): string {
  return applyTextRedaction(text).text;
}
