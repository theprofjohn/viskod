import { type Result, ok } from '@viskod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserIntegration } from './integration';
import { SelectionOverlayController } from './integration';
import type { VisualSelectionService } from './service';

/**
 * Phase 28 (VISKOD-AUDIT-013): overlay polling must be serialized (no
 * overlapping executions) and a late async completion after exit must never
 * mutate selection state.
 */

function makeFakeService() {
  const createSingleSelection = vi.fn();
  const createMultiSelection = vi.fn();
  const createBoxSelection = vi.fn();
  const clearSelection = vi.fn(async () => ok(undefined));
  const service = {
    enterSelectionMode: vi.fn(async () => ok(undefined)),
    exitSelectionMode: vi.fn(async () => ok(undefined)),
    getActiveSelection: vi.fn(async () => ok(null)),
    clearSelection,
    createSingleSelection,
    createMultiSelection,
    createBoxSelection,
    resolveSelection: vi.fn(),
    health: vi.fn(() => ({
      status: 'healthy',
      activeSelections: 0,
      totalSelections: 0,
      failedSelections: 0,
    })),
  } as unknown as VisualSelectionService;
  return service;
}

function makeFakeBrowser(pollImpl?: () => Promise<Result<unknown>>) {
  const browser = {
    showOverlaySelectionMode: vi.fn(async () => ok(undefined)),
    hideOverlaySelectionMode: vi.fn(async () => ok(undefined)),
    injectOverlay: vi.fn(async () => ok(undefined)),
    removeOverlay: vi.fn(async () => ok(undefined)),
    setupMessageListener: vi.fn(async () => ok(undefined)),
    pollOverlayEvent: pollImpl ?? vi.fn(async () => ok(null)),
    getPageUrl: vi.fn(async () => 'http://localhost:3000/'),
    getPageTitle: vi.fn(async () => 'Fixture'),
    getViewport: vi.fn(async () => ({
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      scrollX: 0,
      scrollY: 0,
    })),
    getElementInfoAtPoint: vi.fn(async () => ok(null)),
    evaluate: vi.fn(async () => []),
  } as unknown as BrowserIntegration;
  return browser;
}

function clickedEvent(targetId = 'btn-1'): Result<unknown> {
  return ok({
    type: 'overlay:element-clicked',
    data: {
      tagName: 'button',
      boundingBox: { x: 10, y: 20, width: 100, height: 40 },
      textPreview: 'Submit',
      selector: `[data-testid="${targetId}"]`,
      documentOrder: 1,
      selectionNumber: 1,
    },
  });
}

function makeController(
  overrides: {
    poll?: () => Promise<Result<unknown>>;
  } = {},
) {
  const service = makeFakeService();
  const browser = makeFakeBrowser(overrides.poll);
  const controller = new SelectionOverlayController({
    pageId: 'page-1',
    sessionId: 'session-1',
    browser,
    service,
    overlayScript: '(function(){})();',
  });
  return { controller, service, browser };
}

describe('SelectionOverlayController polling (VISKOD-AUDIT-013)', () => {
  it('processes a clicked event into a selection while active', async () => {
    vi.useFakeTimers();
    try {
      const poll = vi.fn().mockResolvedValueOnce(clickedEvent()).mockResolvedValue(ok(null));
      const { controller, service } = makeController({ poll });
      await controller.enterSelectionMode();
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(0);
      expect(poll).toHaveBeenCalledTimes(1);
      expect(service.createSingleSelection).toHaveBeenCalledTimes(1);
      // The next poll runs only after the first completed (serialized).
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(0);
      expect(poll).toHaveBeenCalledTimes(2);
      expect(service.createSingleSelection).toHaveBeenCalledTimes(1);
      expect(controller.isActive()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never runs overlapping polls: next poll is scheduled only after completion', async () => {
    vi.useFakeTimers();
    try {
      const gate: { resolve: ((v: Result<unknown>) => void) | null } = { resolve: null };
      let inFlight = 0;
      let maxInFlight = 0;
      const poll = vi.fn(() => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<Result<unknown>>((resolve) => {
          gate.resolve = (value: Result<unknown>) => {
            inFlight--;
            resolve(value);
          };
        });
      });
      const { controller } = makeController({ poll });
      await controller.enterSelectionMode();
      await vi.advanceTimersByTimeAsync(100); // poll 1 starts and blocks
      await vi.advanceTimersByTimeAsync(500); // timer would fire again but poll 1 is still pending
      expect(inFlight).toBe(1);
      expect(maxInFlight).toBe(1);
      // No re-entrancy while a poll is in flight: advancing time further does
      // not start a second poll.
      await vi.advanceTimersByTimeAsync(1000);
      expect(inFlight).toBe(1);
      expect(maxInFlight).toBe(1);
      // Complete poll 1: the next poll is scheduled only after completion,
      // so the steady state keeps exactly one poll in flight (never two).
      gate.resolve?.(ok(null));
      await vi.runAllTimersAsync();
      expect(maxInFlight).toBe(1);
      expect(inFlight).toBe(1);
      await controller.exitSelectionMode();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late poll completion after exit cannot mutate selection state', async () => {
    vi.useFakeTimers();
    try {
      const gate: { resolve: ((v: Result<unknown>) => void) | null } = { resolve: null };
      const poll = vi.fn(
        () =>
          new Promise<Result<unknown>>((resolve) => {
            gate.resolve = resolve;
          }),
      );
      const { controller, service } = makeController({ poll });
      await controller.enterSelectionMode();
      await vi.advanceTimersByTimeAsync(100); // poll starts, blocked on the browser
      await controller.exitSelectionMode(); // stop: generation bump + active=false
      gate.resolve?.(clickedEvent('late-event'));
      await vi.advanceTimersByTimeAsync(0);
      // The stale event must not create a selection or schedule more polls.
      expect(service.createSingleSelection).not.toHaveBeenCalled();
      expect(poll).toHaveBeenCalledTimes(1);
      expect(controller.isActive()).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(poll).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-entering selection mode restarts polling', async () => {
    vi.useFakeTimers();
    try {
      const poll = vi.fn().mockResolvedValue(ok(null));
      const { controller, service } = makeController({ poll });
      await controller.enterSelectionMode();
      await vi.advanceTimersByTimeAsync(100);
      expect(poll).toHaveBeenCalledTimes(1);
      await controller.exitSelectionMode();
      expect(controller.isActive()).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(poll).toHaveBeenCalledTimes(1);
      // Re-enter: polling resumes.
      await controller.enterSelectionMode();
      await vi.advanceTimersByTimeAsync(100);
      expect(poll).toHaveBeenCalledTimes(2);
      expect(controller.isActive()).toBe(true);
      expect(service.exitSelectionMode).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
