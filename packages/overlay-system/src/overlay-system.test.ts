import { describe, expect, it } from 'vitest';
import { getOverlayScript, getOverlayCleanupScript, toSelectionTarget } from './index';

describe('OverlaySystem', () => {
  it('generates overlay script that is a valid IIFE', () => {
    const script = getOverlayScript();
    expect(script).toContain('(function()');
    expect(script).toContain('__viskod_overlay_root');
    expect(script).toContain('attachShadow');
    expect(script).toContain('postMessage');
  });

  it('overlay script is idempotent (checks for existing root)', () => {
    const script = getOverlayScript();
    expect(script).toContain('if (document.getElementById(\'__viskod_overlay_root\')) return;');
  });

  it('overlay script uses closed Shadow DOM', () => {
    const script = getOverlayScript();
    expect(script).toContain('attachShadow({ mode: \'closed\' })');
  });

  it('overlay script includes CSS prefix for all classes', () => {
    const script = getOverlayScript();
    const prefixMatches = script.match(/PREFIX/g);
    expect(prefixMatches).not.toBeNull();
    expect(prefixMatches!.length).toBeGreaterThan(5);
  });

  it('overlay script defines highlight-box styling with fixed positioning', () => {
    const script = getOverlayScript();
    expect(script).toContain('position: fixed');
    expect(script).toContain('pointer-events: none');
  });

  it('overlay script supports hover, selection modes', () => {
    const script = getOverlayScript();
    expect(script).toContain("mode === 'hover'");
    expect(script).toContain("mode === 'selection'");
  });

  it('overlay script handles pointer events', () => {
    const script = getOverlayScript();
    expect(script).toContain('pointermove');
    expect(script).toContain('pointerdown');
    expect(script).toContain('pointerup');
    expect(script).toContain('pointercancel');
  });

  it('overlay script handles Escape key', () => {
    const script = getOverlayScript();
    expect(script).toContain('keydown');
    expect(script).toContain('Escape');
  });

  it('overlay script has box-drag support', () => {
    const script = getOverlayScript();
    expect(script).toContain('drag-rect');
    expect(script).toContain('box-drag');
    expect(script).toContain('overlay:box-drag-completed');
  });

  it('overlay script has visual confirmation UI', () => {
    const script = getOverlayScript();
    expect(script).toContain('selection-badge');
    expect(script).toContain('confirmation');
    expect(script).toContain('selection-indicator');
  });

  it('overlay script has clear and exit controls', () => {
    const script = getOverlayScript();
    expect(script).toContain('Clear');
    expect(script).toContain('Exit');
    expect(script).toContain('overlay:exit-requested');
    expect(script).toContain('overlay:selection-cleared');
  });

  it('overlay script respects reduced-motion preference', () => {
    const script = getOverlayScript();
    expect(script).toContain('prefers-reduced-motion');
  });

  it('overlay script uses elementFromPoint for hit testing', () => {
    const script = getOverlayScript();
    expect(script).toContain('elementFromPoint');
  });

  it('overlay script excludes overlay-owned elements from selection', () => {
    const script = getOverlayScript();
    expect(script).toContain('host.contains(el)');
  });

  it('generates cleanup script', () => {
    const script = getOverlayCleanupScript();
    expect(script).toContain('__viskod_overlay_root');
    expect(script).toContain('root.remove');
  });

  it('converts overlay event data to selection target', () => {
    const result = toSelectionTarget({
      selector: '#my-button',
      boundingBox: { x: 10, y: 20, width: 100, height: 40 },
      tagName: 'button',
    });
    expect(result.selector).toBe('#my-button');
    expect(result.boundingBox.x).toBe(10);
    expect(result.tagName).toBe('button');
  });

  it('overlay script excludes application elements during hit testing', () => {
    const script = getOverlayScript();
    expect(script).toContain('getTargetElement');
    expect(script).toContain('data-viskod-overlay');
  });

  it('overlay script captures stable attributes and ancestor info', () => {
    const script = getOverlayScript();
    expect(script).toContain('data-testid');
    expect(script).toContain('ancestorTags');
    expect(script).toContain('stableAttributes');
  });

  it('overlay script determines interactivity', () => {
    const script = getOverlayScript();
    expect(script).toContain('isInteractive');
    expect(script).toContain('tabIndex >= 0');
  });

  it('overlay script sends overlay:ready on init', () => {
    const script = getOverlayScript();
    expect(script).toContain('overlay:ready');
  });

  it('overlay script responds to browser commands', () => {
    const script = getOverlayScript();
    expect(script).toContain('overlay:show');
    expect(script).toContain('overlay:hide');
    expect(script).toContain('overlay:highlight');
    expect(script).toContain('overlay:clear');
    expect(script).toContain('overlay:set-selection');
    expect(script).toContain('overlay:clear-selection');
  });
});
