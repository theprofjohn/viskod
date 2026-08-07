import { describe, expect, it } from 'vitest';
import { comparisonMessage, renderScreen, renderStudioHtml } from './ui';
import type { StudioUiState } from './ui';

function baseState(overrides: Partial<StudioUiState> = {}): StudioUiState {
  return { stage: 'idle', selection: null, browserConnected: true, ...overrides };
}

describe('renderStudioHtml', () => {
  it('contains the primary workflow labels', () => {
    const html = renderStudioHtml();
    expect(html).toContain('Report UI issue');
    expect(html).toContain('What is wrong?');
    expect(html).toContain('What should happen?');
    expect(html).toContain('Verify fix');
    expect(html).toContain('Open app');
    expect(html).toContain('Hover over the problem and click it');
    expect(html).toContain('Prepare agent handoff');
    expect(html).toContain('Accept fix');
    expect(html).toContain('Issue persists');
    expect(html).toContain('Needs follow-up');
    expect(html).toContain('Evidence details');
  });

  it('never renders selectors, packet JSON, or secret-bearing fields', () => {
    const html = renderStudioHtml();
    expect(html).not.toContain('packetJson');
    expect(html).not.toContain('absoluteCaptureDir');
    expect(html).not.toContain('sessionToken');
    expect(html).not.toContain('daemon-token');
    expect(html).not.toContain('captureDir');
  });
});

describe('renderScreen stage mapping', () => {
  it('idle shows Open your app and the report button once an app is open', () => {
    const idle = renderScreen(baseState());
    expect(idle).toContain('Open your app');
    expect(idle).not.toContain('data-action="report-start"');
    expect(idle).toContain('data-action="open-app"');
    const withApp = renderScreen(baseState({ pageUrl: 'http://localhost:3000' }));
    expect(withApp).toContain('Report UI issue');
    expect(withApp).toContain('data-action="report-start"');
  });

  it('selecting shows hover instruction and Continue, disabled without selection', () => {
    const selecting = renderScreen(baseState({ stage: 'selecting' }));
    expect(selecting).toContain('Hover over the problem and click it');
    expect(selecting).toContain('Continue');
    expect(selecting).toContain('disabled');
    const withSelection = renderScreen(
      baseState({
        stage: 'selecting',
        selection: {
          label: 'Submit button',
          role: 'button',
          targetCount: 1,
          confidence: 0.9,
          resolutionStatus: 'resolved',
        },
      }),
    );
    expect(withSelection).toContain('Submit button');
    expect(withSelection).not.toContain('data-action="selection-accept" disabled');
  });

  it('describe shows the problem/expected fields and prepare button', () => {
    const html = renderScreen(
      baseState({
        stage: 'describe',
        selection: { label: 'Card', targetCount: 1, confidence: 0.9, resolutionStatus: 'resolved' },
      }),
    );
    expect(html).toContain('What is wrong?');
    expect(html).toContain('What should happen?');
    expect(html).toContain('Prepare agent handoff');
    expect(html).toContain('Selected:');
    expect(html).toContain('Card');
  });

  it('handoff_ready shows Handoff ready, a copyable prompt, and Verify fix', () => {
    const html = renderScreen(
      baseState({
        stage: 'handoff_ready',
        handoffId: 'handoff_abc123',
        handoff: {
          handoffId: 'handoff_abc123',
          title: 'Broken layout',
          summary: 'summary',
          page: { title: 'Page' },
          selectedTarget: { mode: 'single', label: 'Card', targetCount: 1 },
          warnings: [],
          whatAgentReceives: ['Issue title and summary', 'Selected target summary'],
          whatAgentDoesNotReceive: ['Raw packet JSON'],
        },
      }),
    );
    expect(html).toContain('Handoff ready');
    expect(html).toContain('handoff_abc123');
    expect(html).toContain('data-action="copy-handoff"');
    expect(html).toContain('data-action="verify-start"');
    expect(html).not.toContain('selector');
    expect(html).not.toContain('packetId');
  });

  it('review_ready shows the changed-evidence message and human decision buttons', () => {
    const html = renderScreen(
      baseState({
        stage: 'review_ready',
        review: {
          reviewId: 'review_1',
          issueId: 'issue_1',
          status: 'ready',
          before: {
            targetSummary: {
              mode: 'single',
              label: 'Card',
              targetCount: 1,
              confidence: 0.9,
              resolutionStatus: 'resolved',
            },
            page: { url: 'http://localhost:3000/' },
            capturedAt: '2026-08-05T00:00:00.000Z',
          },
          after: {
            targetSummary: {
              mode: 'single',
              label: 'p',
              targetCount: 1,
              confidence: 0.95,
              resolutionStatus: 'resolved',
            },
            page: { url: 'http://localhost:3000/' },
            capturedAt: '2026-08-05T00:00:02.000Z',
          },
          comparison: {
            status: 'changed',
            confidence: 0.95,
            summary: 'The selected target changed after recapture.',
            warnings: [],
          },
          warnings: [],
        },
      }),
    );
    expect(html).toContain(
      'The rendered result changed; review whether it matches the expected result.',
    );
    expect(html).toContain('Accept fix');
    expect(html).toContain('Issue persists');
    expect(html).toContain('Needs follow-up');
    // Evidence, not truth: no auto-accept wording.
    expect(html).not.toContain('auto-accepted');
    expect(html).not.toContain('The issue is fixed');
  });

  it('review_ready shows the unchanged message', () => {
    const html = renderScreen(
      baseState({
        stage: 'review_ready',
        review: {
          reviewId: 'review_1',
          issueId: 'issue_1',
          status: 'ready',
          before: {
            targetSummary: {
              mode: 'single',
              label: 'Card',
              targetCount: 1,
              confidence: 0.9,
              resolutionStatus: 'resolved',
            },
            page: { url: 'http://localhost:3000/' },
            capturedAt: '2026-08-05T00:00:00.000Z',
          },
          comparison: {
            status: 'unchanged',
            confidence: 0.9,
            summary: 'The selected target appears unchanged after recapture.',
            warnings: [],
          },
          warnings: [],
        },
      }),
    );
    expect(html).toContain('No measurable change detected.');
  });

  it('review_ready uses the service recovery wording for failed statuses', () => {
    const html = renderScreen(
      baseState({
        stage: 'review_ready',
        review: {
          reviewId: 'review_1',
          issueId: 'issue_1',
          status: 'ready',
          before: {
            targetSummary: {
              mode: 'single',
              label: 'Card',
              targetCount: 1,
              confidence: 0.9,
              resolutionStatus: 'resolved',
            },
            page: { url: 'http://localhost:3000/' },
            capturedAt: '2026-08-05T00:00:00.000Z',
          },
          comparison: {
            status: 'missing_after',
            confidence: 0.3,
            summary:
              'The selected target is no longer visible in the current page. This may indicate the element was removed or the page changed.',
            warnings: ['Target disappeared after recapture.'],
          },
          warnings: ['Target disappeared after recapture.'],
        },
      }),
    );
    expect(html).toContain('The selected target is no longer visible in the current page.');
  });

  it('decided shows the decision result', () => {
    const html = renderScreen(
      baseState({
        stage: 'decided',
        review: {
          reviewId: 'review_1',
          issueId: 'issue_1',
          status: 'accepted',
          before: {
            targetSummary: {
              mode: 'single',
              label: 'Card',
              targetCount: 1,
              confidence: 0.9,
              resolutionStatus: 'resolved',
            },
            page: { url: 'http://localhost:3000/' },
            capturedAt: '2026-08-05T00:00:00.000Z',
          },
          decision: { decision: 'accepted', decidedAt: '2026-08-05T00:00:03.000Z' },
          warnings: [],
        },
      }),
    );
    expect(html).toContain('Review accepted');
    expect(html).toContain('Report another issue');
  });

  it('shows the browser-disconnected banner outside the idle stage', () => {
    const html = renderScreen(baseState({ stage: 'describe', browserConnected: false }));
    expect(html).toContain('Browser disconnected — reconnect or reopen the app');
  });

  it('surfaces workflow recovery errors', () => {
    const html = renderScreen(
      baseState({ stage: 'selecting', error: 'Select the element again.' }),
    );
    expect(html).toContain('Select the element again.');
  });
});

describe('comparisonMessage', () => {
  it('maps changed/unchanged to plain language', () => {
    expect(
      comparisonMessage({
        stage: 'review_ready',
        selection: null,
        review: {
          reviewId: 'r',
          issueId: 'i',
          status: 'ready',
          before: {
            targetSummary: {
              mode: 'single',
              label: 'x',
              targetCount: 1,
              confidence: 1,
              resolutionStatus: 'resolved',
            },
            page: {},
            capturedAt: '',
          },
          comparison: { status: 'changed', confidence: 1, summary: 's', warnings: [] },
          warnings: [],
        },
      }),
    ).toBe('The rendered result changed; review whether it matches the expected result.');
    expect(
      comparisonMessage({
        stage: 'review_ready',
        selection: null,
        review: {
          reviewId: 'r',
          issueId: 'i',
          status: 'ready',
          before: {
            targetSummary: {
              mode: 'single',
              label: 'x',
              targetCount: 1,
              confidence: 1,
              resolutionStatus: 'resolved',
            },
            page: {},
            capturedAt: '',
          },
          comparison: { status: 'unchanged', confidence: 1, summary: 's', warnings: [] },
          warnings: [],
        },
      }),
    ).toBe('No measurable change detected.');
  });
});
