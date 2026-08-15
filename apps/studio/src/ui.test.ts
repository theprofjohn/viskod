import { describe, expect, it } from 'vitest';
import { comparisonMessage, renderScreen, renderStudioHtml, sourceStatusHtml } from './ui';
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
    expect(html).toContain('data-action="prepare-handoff"');
    expect(html).toContain('Selected:');
    expect(html).toContain('Card');
  });

  it('describe exposes Reselect and Cancel recovery controls', () => {
    const html = renderScreen(
      baseState({
        stage: 'describe',
        selection: { label: 'Card', targetCount: 1, confidence: 0.9, resolutionStatus: 'resolved' },
      }),
    );
    expect(html).toContain('data-action="reselect"');
    expect(html).toContain('data-action="cancel"');
    expect(html).toContain('Reselect');
    expect(html).toContain('Cancel');
  });

  it('describe shows a compact, truthful source status (Phase 30)', () => {
    const html = renderScreen(
      baseState({
        stage: 'describe',
        selection: { label: 'Card', targetCount: 1, confidence: 0.9, resolutionStatus: 'resolved' },
        source: {
          resolution: 'ambiguous',
          status: 'collected',
          count: 2,
          candidates: [
            {
              path: 'src/features/a/Widget.jsx',
              qualification: 'weak',
              confidence: 0.34,
              reasons: ['visible text also appears in other files'],
            },
            {
              path: 'src/features/b/Widget.jsx',
              qualification: 'weak',
              confidence: 0.34,
              reasons: ['visible text also appears in other files'],
            },
          ],
        },
      }),
    );
    expect(html).toContain('Source: ambiguous — multiple candidates');
    expect(html).toContain('data-source-resolution="ambiguous"');
    expect(html).toContain('src/features/a/Widget.jsx');
    // Ambiguity is never presented as a confirmed first candidate.
    expect(html).not.toContain('confirmed');
    // No absolute paths.
    expect(html).not.toContain('C:\\');
  });

  it('handoff_ready surfaces resolved source candidates (Phase 30)', () => {
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
          whatAgentReceives: ['Issue title and summary'],
          whatAgentDoesNotReceive: ['Raw packet JSON'],
        },
        source: {
          resolution: 'resolved',
          status: 'collected',
          count: 1,
          candidates: [
            {
              path: 'src/components/TargetCard.jsx',
              qualification: 'possible',
              confidence: 0.48,
              reasons: ['visible text found only in this file'],
            },
          ],
        },
      }),
    );
    // Phase 30A: a possible candidate is NEVER labeled probable — the wording
    // derives from the top candidate's qualification.
    expect(html).toContain('Source: possible source');
    expect(html).not.toContain('Source: probable');
    expect(html).toContain('src/components/TargetCard.jsx');
    expect(html).toContain('possible');
  });

  it('resolved + exact is worded as exact source identified', () => {
    const html = sourceStatusHtml({
      stage: 'describe',
      selection: null,
      source: {
        resolution: 'resolved',
        status: 'collected',
        count: 1,
        candidates: [
          {
            path: 'src/features/settings/SaveButton.tsx',
            qualification: 'exact',
            confidence: 0.92,
            reasons: ['route + import + stable identifier'],
          },
        ],
      },
    });
    expect(html).toContain('Source: exact source identified');
    expect(html).not.toContain('Source: probable');
  });

  it('resolved + probable is worded as probable source', () => {
    const html = sourceStatusHtml({
      stage: 'describe',
      selection: null,
      source: {
        resolution: 'resolved',
        status: 'collected',
        count: 1,
        candidates: [
          {
            path: 'src/features/settings/SaveButton.tsx',
            qualification: 'probable',
            confidence: 0.71,
            reasons: ['unique visible text', 'imported by current route'],
          },
        ],
      },
    });
    expect(html).toContain('Source: probable source');
  });

  it('resolved + possible is worded as possible source, never probable', () => {
    const html = sourceStatusHtml({
      stage: 'describe',
      selection: null,
      source: {
        resolution: 'resolved',
        status: 'collected',
        count: 1,
        candidates: [
          {
            path: 'src/components/TargetCard.jsx',
            qualification: 'possible',
            confidence: 0.54,
            reasons: ['visible text found only in this file'],
          },
        ],
      },
    });
    expect(html).toContain('Source: possible source');
    // The possible regression: the word probable must NOT appear as the
    // status label.
    expect(html).not.toContain('Source: probable');
  });

  it('resolved + weak is worded as weak evidence, never promoted', () => {
    const html = sourceStatusHtml({
      stage: 'describe',
      selection: null,
      source: {
        resolution: 'resolved',
        status: 'collected',
        count: 1,
        candidates: [
          {
            path: 'src/components/Generic.jsx',
            qualification: 'weak',
            confidence: 0.32,
            reasons: ['generic class — weak evidence'],
          },
        ],
      },
    });
    expect(html).toContain('Source: weak source evidence');
    expect(html).not.toContain('Source: probable');
  });

  it('sourceStatusHtml shows ambiguous wording with both candidates', () => {
    const html = sourceStatusHtml({
      stage: 'describe',
      selection: null,
      source: {
        resolution: 'ambiguous',
        status: 'collected',
        count: 2,
        candidates: [
          {
            path: 'src/components/StatusWidgetA.jsx',
            qualification: 'weak',
            confidence: 0.34,
            reasons: ['visible text also appears in other files'],
          },
          {
            path: 'src/components/StatusWidgetB.jsx',
            qualification: 'weak',
            confidence: 0.34,
            reasons: ['visible text also appears in other files'],
          },
        ],
      },
    });
    expect(html).toContain('Source: ambiguous — multiple candidates');
    expect(html).toContain('data-source-resolution="ambiguous"');
  });

  it('sourceStatusHtml shows unavailable without fabricating a candidate', () => {
    const html = sourceStatusHtml({
      stage: 'describe',
      selection: null,
      source: { resolution: 'unavailable', status: 'unavailable', count: 0, candidates: [] },
    });
    expect(html).toContain('Source: unavailable');
    expect(html).not.toContain('<code>');
  });

  it('selecting exposes a Cancel control alongside Continue', () => {
    const html = renderScreen(baseState({ stage: 'selecting' }));
    expect(html).toContain('data-action="cancel"');
    expect(html).toContain('data-action="selection-accept"');
  });

  it('the served HTML drives prepare/reselect/cancel through the workflow routes', () => {
    const html = renderStudioHtml();
    expect(html).toContain('/workflow/prepare');
    expect(html).toContain('/workflow/reselect');
    expect(html).toContain('/workflow/cancel');
    expect(html).toContain('Preparing');
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

  it('review_ready evidence details report the Phase 30 source status, not obsolete high/medium/low', () => {
    const html = renderScreen(
      baseState({
        stage: 'review_ready',
        source: {
          resolution: 'resolved',
          status: 'collected',
          count: 1,
          candidates: [
            {
              path: 'src/components/TargetCard.jsx',
              qualification: 'possible',
              confidence: 0.54,
              reasons: ['visible text found only in this file'],
            },
          ],
        },
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
            status: 'changed',
            confidence: 0.95,
            summary: 'The selected target changed after recapture.',
            warnings: [],
          },
          warnings: [],
        },
      }),
    );
    expect(html).toContain('Source: possible source');
    // The obsolete confidence mapping is gone — a possible candidate must not
    // read as high/medium source confidence, and the target-resolution
    // confidence is never relabeled as source-hint confidence.
    expect(html).not.toContain('Source hints:');
    expect(html).not.toContain('Source: probable');
  });

  it('review_ready evidence details omit the source row when the capture carried no source status', () => {
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
            status: 'changed',
            confidence: 0.95,
            summary: 'changed',
            warnings: [],
          },
          warnings: [],
        },
      }),
    );
    expect(html).toContain('Evidence details');
    expect(html).not.toContain('Source hints:');
    expect(html).not.toContain('Source: probable');
    expect(html).not.toContain('Source: possible');
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
