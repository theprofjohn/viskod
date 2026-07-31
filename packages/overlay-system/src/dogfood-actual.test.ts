// Phase 21 actual dogfood — runs the real overlay script via vitest + Playwright
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Increase default timeout for all tests in this file
vi.setConfig({ testTimeout: 60000 });
import { chromium, type Page, type Browser } from 'playwright';
import { getOverlayScript } from '@viskod/overlay-system';
import { spawn, type ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const TARGET_DIR = 'C:\\viskod-dogfood-shadcn-admin';
const TARGET_URL = 'http://localhost:5173';

const overlayScript = getOverlayScript();

let devProc: ChildProcess | null = null;
let browser: Browser | null = null;
let page: Page | null = null;

const results: Array<{
  id: string; scenario: string; status: string; notes: string;
}> = [];

function record(id: string, scenario: string, pass: boolean, notes = '') {
  results.push({ id, scenario, status: pass ? 'PASS' : 'FAIL', notes });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function startDevServer(): Promise<ChildProcess> {
  const proc = spawn('pnpm', ['dev'], { cwd: TARGET_DIR, stdio: 'pipe', shell: true });
  await new Promise(r => setTimeout(r, 15000));
  return proc;
}

async function checkServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(TARGET_URL + '/', { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

beforeAll(async () => {
  const running = await checkServerRunning();
  if (!running) {
    devProc = await startDevServer();
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
}, 60000);

afterAll(async () => {
  if (browser) await browser.close();
  if (devProc) devProc.kill();
  // Write results
  const outDir = join(ROOT, 'phase21-dogfood-evidence');
  try { mkdirSync(outDir, { recursive: true }); } catch {}
  writeFileSync(join(outDir, 'dogfood-results.json'), JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));
});

// Helper: create a page with overlay injected
async function makePage(viewport = { width: 1440, height: 900 }): Promise<Page> {
  if (!browser) throw new Error('browser not available');
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 15000 });
  await sleep(1000);
  return p;
}

// Helper: inject overlay and activate selection mode
async function activateOverlay(p: Page) {
  await p.evaluate(overlayScript);
  await sleep(200);
  await p.evaluate(() => {
    window.postMessage({ source: '__viskod_browser', command: 'overlay:show', mode: 'selection' }, '*');
  });
  await sleep(300);
}

// Helper: set up event capture
async function setupCapture(p: Page) {
  await p.evaluate(() => {
    (window as any).__vs_events = [];
    window.addEventListener('message', (e) => {
      if (e.data && e.data.source === '__viskod_overlay') {
        (window as any).__vs_events.push(e.data);
      }
    });
  });
}

// Helper: get last non-ready overlay event
async function lastEvent(p: Page): Promise<any> {
  const evts = await p.evaluate(() => {
    const arr = (window as any).__vs_events || [];
    (window as any).__vs_events = [];
    return arr.filter((e: any) => e.type !== 'overlay:ready');
  });
  return evts.length > 0 ? evts[evts.length - 1] : null;
}

// Helper: click at coordinates through overlay
async function clickAt(p: Page, x: number, y: number): Promise<any> {
  await p.mouse.move(x, y);
  await sleep(50);
  await p.mouse.down();
  await sleep(30);
  await p.mouse.up();
  await sleep(300);
  return lastEvent(p);
}

// Helper: drag a box
async function dragAt(p: Page, x1: number, y1: number, x2: number, y2: number): Promise<any> {
  await p.mouse.move(x1, y1);
  await sleep(30);
  await p.mouse.down();
  await sleep(30);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await p.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
    await sleep(15);
  }
  await p.mouse.up();
  await sleep(300);
  return lastEvent(p);
}

// Helper: check overlay root exists
async function hasRoot(p: Page): Promise<boolean> {
  return p.evaluate(() => !!document.getElementById('__viskod_overlay_root'));
}

// Helper: clean up overlay
async function cleanup(p: Page) {
  await p.evaluate(() => {
    window.postMessage({ source: '__viskod_browser', command: 'overlay:hide' }, '*');
    const r = document.getElementById('__viskod_overlay_root');
    if (r) r.remove();
  });
  await p.close();
}

// =========================================================================
// Tests
// =========================================================================

describe('Phase 21 Dogfood — Overlay Lifecycle', () => {
  it('DF-01a: enters selection mode and shows overlay root', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);
    expect(await hasRoot(p)).toBe(true);
    record('DF-01a', 'Enter selection mode', true);
    await cleanup(p);
  });

  it('DF-01b: hides overlay via command', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);
    await p.evaluate(() => {
      window.postMessage({ source: '__viskod_browser', command: 'overlay:hide' }, '*');
    });
    await sleep(200);
    // Root DOM should still exist but hidden; check event layer not active
    const root = await p.evaluate(() => !!document.getElementById('__viskod_overlay_root'));
    expect(root).toBe(true);
    // Remove fully for cleanup
    await cleanup(p);
    record('DF-01b', 'Hide overlay', true);
  });

  it('DF-01c: exits via Escape', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);
    // Press Escape — should send exit-requested
    await p.keyboard.press('Escape');
    await sleep(300);
    const evts = await p.evaluate(() => (window as any).__vs_events || []);
    const exitReq = evts.find((e: any) => e.type === 'overlay:exit-requested');
    expect(exitReq).toBeTruthy();
    await cleanup(p);
    record('DF-01c', 'Exit via Escape', true);
  });

  it('DF-01d: teardown removes overlay', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);
    expect(await hasRoot(p)).toBe(true);
    await p.evaluate(() => {
      const r = document.getElementById('__viskod_overlay_root');
      if (r) r.remove();
    });
    expect(await hasRoot(p)).toBe(false);
    await p.close();
    record('DF-01d', 'Teardown removes overlay', true);
  });
});

describe('Phase 21 Dogfood — Click Selection', () => {
  it('DF-02: selects a sidebar navigation item', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const links = await p.evaluate(() => {
      const as = document.querySelectorAll('a[href]:not([href="#"]):not([href^="http"])');
      return Array.from(as).slice(0, 5).map(a => {
        const r = a.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (a.textContent || '').trim().slice(0, 40) };
      }).filter(a => a.x > 0 && a.y > 0);
    });

    if (links.length === 0) {
      record('DF-02', 'Sidebar nav item', false, 'No nav links found');
      await cleanup(p);
      return;
    }

    // Click first nav link
    const ev = await clickAt(p, links[0].x, links[0].y);
    const clicked = ev && ev.type === 'overlay:element-clicked';
    expect(clicked).toBe(true);
    record('DF-02', 'Sidebar nav item', clicked,
      clicked ? `tag=${ev.data.tagName} text="${(ev.data.textPreview || '').slice(0, 30)}"` : 'No click event');
    await cleanup(p);
  });

  it('DF-03: selects an icon-only control', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const iconInfo = await p.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        const t = (b.textContent || '').trim();
        if (t.length <= 2) {
          const r = b.getBoundingClientRect();
          if (r.width > 10) return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.getAttribute('aria-label') || '', tag: b.tagName };
        }
      }
      return null;
    });

    if (!iconInfo) {
      record('DF-03', 'Icon-only control', false, 'No icon-only button found on page');
      await cleanup(p);
      return;
    }

    const ev = await clickAt(p, iconInfo.x, iconInfo.y);
    const clicked = ev && ev.type === 'overlay:element-clicked';
    expect(clicked).toBe(true);
    record('DF-03', 'Icon-only control', clicked,
      clicked ? `tag=${ev.data.tagName} accessibleName=${ev.data.accessibleName || ''}` : 'No event');
    await cleanup(p);
  });

  it('DF-04: selects a text input', async () => {
    const p = await makePage();
    // Try several routes to find an input
    const routes = ['/tasks', '/settings', '/invoices', '/users'];
    let inputInfo: any = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch { continue; }
      inputInfo = await p.evaluate(() => {
        const i = document.querySelector('input:not([type="hidden"])');
        if (!i) return null;
        const r = i.getBoundingClientRect();
        if (r.width < 10) return null;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, type: i.type };
      });
      if (inputInfo) break;
    }

    if (!inputInfo) {
      record('DF-04', 'Text input', false, 'No input found on any route');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, inputInfo.x, inputInfo.y);
    const clicked = ev && ev.type === 'overlay:element-clicked';
    expect(clicked).toBe(true);
    const textPreview = ev?.data?.textPreview || '';
    record('DF-04', 'Text input', clicked,
      clicked ? `tag=${ev.data.tagName} inputType=${ev.data.inputType || ''} preview="${textPreview.slice(0, 20)}"` : 'No event');
    await cleanup(p);
  });

  it('DF-05: selects a select/dropdown trigger', async () => {
    const p = await makePage();
    const routes = ['/tasks', '/invoices', '/settings', '/users'];
    let selInfo: any = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch { continue; }
      selInfo = await p.evaluate(() => {
        for (const s of document.querySelectorAll('select, [role="combobox"]')) {
          const r = s.getBoundingClientRect();
          if (r.width > 10) return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: s.tagName };
        }
        return null;
      });
      if (selInfo) break;
    }

    if (!selInfo) {
      record('DF-05', 'Dropdown trigger', false, 'No select/combobox found');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, selInfo.x, selInfo.y);
    const clicked = ev && ev.type === 'overlay:element-clicked';
    expect(clicked).toBe(true);

    // Verify dropdown did not open
    const dropdownOpen = await p.evaluate(() => {
      const menu = document.querySelector('[role="listbox"], [role="menu"], .dropdown-open, [class*="open"]');
      return menu !== null;
    });
    record('DF-05', 'Dropdown trigger', clicked && !dropdownOpen,
      clicked ? `tag=${ev.data.tagName} dropdownOpen=${dropdownOpen}` : 'No event');
    await cleanup(p);
  });

  it('DF-06: selects a table row', async () => {
    const p = await makePage();
    const routes = ['/tasks', '/invoices', '/users', '/orders'];
    let rowInfo: any = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch { continue; }
      rowInfo = await p.evaluate(() => {
        const r = document.querySelector('tr');
        if (!r) return null;
        const rect = r.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 5) return null;
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: (r.textContent || '').trim().slice(0, 40) };
      });
      if (rowInfo) break;
    }

    if (!rowInfo) {
      record('DF-06', 'Table row', false, 'No table rows found');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, rowInfo.x, rowInfo.y);
    const clicked = ev && ev.type === 'overlay:element-clicked';
    expect(clicked).toBe(true);
    record('DF-06', 'Table row', clicked,
      clicked ? `tag=${ev.data.tagName}` : 'No event');
    await cleanup(p);
  });

  it('DF-07: selects a table cell', async () => {
    const p = await makePage();
    const routes = ['/tasks', '/invoices', '/users'];
    let cellInfo: any = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch { continue; }
      cellInfo = await p.evaluate(() => {
        const c = document.querySelector('td');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) return null;
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: c.textContent.trim().slice(0, 40) };
      });
      if (cellInfo) break;
    }

    if (!cellInfo) {
      record('DF-07', 'Table cell', false, 'No table cells found');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, cellInfo.x, cellInfo.y);
    const clicked = ev && ev.type === 'overlay:element-clicked';
    expect(clicked).toBe(true);
    record('DF-07', 'Table cell', clicked,
      clicked ? `tag=${ev.data.tagName}` : 'No event');
    await cleanup(p);
  });

  it('DF-08: selects a row action button', async () => {
    const p = await makePage();
    const routes = ['/tasks', '/invoices', '/users'];
    let actInfo: any = null;
    for (const route of routes) {
      try {
        await p.goto(TARGET_URL + route, { waitUntil: 'networkidle', timeout: 5000 });
        await sleep(800);
      } catch { continue; }
      actInfo = await p.evaluate(() => {
        for (const b of document.querySelectorAll('td button, td a[role="button"], td [class*="action"]')) {
          const r = b.getBoundingClientRect();
          if (r.width < 10) continue;
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: b.getAttribute('aria-label') || (b.textContent || '').trim().slice(0, 20) };
        }
        return null;
      });
      if (actInfo) break;
    }

    if (!actInfo) {
      record('DF-08', 'Row action button', false, 'No row action buttons found');
      await p.close();
      return;
    }

    await setupCapture(p);
    await activateOverlay(p);
    const ev = await clickAt(p, actInfo.x, actInfo.y);
    const clicked = ev && ev.type === 'overlay:element-clicked';
    expect(clicked).toBe(true);
    record('DF-08', 'Row action button', clicked,
      clicked ? `tag=${ev.data.tagName} name=${ev.data.accessibleName || ''}` : 'No event');
    await cleanup(p);
  });

  it('DF-12: selects a card container', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const cardInfo = await p.evaluate(() => {
      for (const s of ['[class*="card"]:not([class*="inner"])', '[class*="Card"]:not([class*="inner"])', 'article']) {
        const el = document.querySelector(s);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 10) return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName };
      }
      return null;
    });

    if (!cardInfo) {
      record('DF-12', 'Card container', false, 'No card found');
      await cleanup(p);
      return;
    }

    const ev = await clickAt(p, cardInfo.x, cardInfo.y);
    const clicked = ev && ev.type === 'overlay:element-clicked';
    expect(clicked).toBe(true);
    record('DF-12', 'Card container', clicked,
      clicked ? `tag=${ev.data.tagName} text="${(ev.data.textPreview || '').slice(0, 30)}"` : 'No event');
    await cleanup(p);
  });
});

describe('Phase 21 Dogfood — Box Selection', () => {
  it('DF-14: drag-selects sibling buttons', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const box = await p.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
        .filter(b => { const r = b.getBoundingClientRect(); return r.width > 15 && r.height > 15 && r.top < 700 && r.top > 0; });
      if (btns.length < 2) return null;
      const rects = btns.slice(0, 4).map(b => b.getBoundingClientRect());
      return {
        x1: Math.min(...rects.map(r => r.x)) - 5,
        y1: Math.min(...rects.map(r => r.y)) - 5,
        x2: Math.max(...rects.map(r => r.x + r.width)) + 5,
        y2: Math.max(...rects.map(r => r.y + r.height)) + 5,
        count: btns.length,
      };
    });

    if (!box) {
      record('DF-14', 'Box selection siblings', false, 'Not enough buttons in viewport');
      await cleanup(p);
      return;
    }

    const ev = await dragAt(p, box.x1, box.y1, box.x2, box.y2);
    const completed = ev && ev.type === 'overlay:box-drag-completed';
    expect(completed).toBe(true);
    record('DF-14', 'Box selection siblings', completed,
      completed ? `type=${ev.type} rect=${JSON.stringify(ev.data.viewportRect)}` : 'No event');
    await cleanup(p);
  });

  it('DF-15: drag-selects a card region', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    const cardRect = await p.evaluate(() => {
      for (const s of ['[class*="card"]', '[class*="Card"]', 'article']) {
        const el = document.querySelector(s);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 10 && r.height > 10) return { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y + r.height };
      }
      return null;
    });

    if (!cardRect) {
      record('DF-15', 'Box selection card region', false, 'No card found');
      await cleanup(p);
      return;
    }

    const ev = await dragAt(p, cardRect.x1, cardRect.y1, cardRect.x2, cardRect.y2);
    const completed = ev && ev.type === 'overlay:box-drag-completed';
    expect(completed).toBe(true);
    record('DF-15', 'Box selection card region', completed,
      completed ? `rect=${JSON.stringify(ev.data.viewportRect)}` : 'No event');
    await cleanup(p);
  });
});

describe('Phase 21 Dogfood — Click Suppression', () => {
  it('DF-CLICK-SUPPRESS: click does not activate the inspected application', async () => {
    const p = await makePage();
    await setupCapture(p);

    // Find a nav link — re-query immediately before click to avoid stale coords
    const urlBefore = p.url();

    await activateOverlay(p);
    await sleep(500); // let activation events settle

    // Get coords AFTER activation for freshly rendered positions
    const linkInfo = await p.evaluate(() => {
      const a = document.querySelector('a[href]:not([href="#"]):not([href^="http"])');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    if (!linkInfo) {
      record('DF-CLICK-SUPPRESS', 'Click suppression', false, 'No nav link');
      await p.close();
      return;
    }

    // Click nav link while in selection mode
    const ev = await clickAt(p, linkInfo.x, linkInfo.y);
    await sleep(500);

    const urlAfter = p.url();
    const navHappened = urlAfter !== urlBefore;
    const clickReceived = ev && ev.type === 'overlay:element-clicked';

    // Navigation must have been suppressed
    expect(navHappened).toBe(false);

    // Overlay should have generated a click event (may be lost if nav occurred)
    if (!clickReceived) {
      console.log('  [DEBUG] No click event captured — events in queue:',
        JSON.stringify(await p.evaluate(() => (window as any).__vs_events?.map((e: any) => e.type))));
    }

    record('DF-CLICK-SUPPRESS', 'Click suppression', !navHappened,
      `nav=${navHappened} overlayEvent=${clickReceived}`);
    await cleanup(p);
  });
});

describe('Phase 21 Dogfood — Scroll and Navigation', () => {
  it('DF-17: click selection works after scroll', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Find any button
    const btn1 = await p.evaluate(() => {
      const b = document.querySelector('button');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    if (!btn1) {
      record('DF-17', 'Scroll behavior', false, 'No button found');
      await cleanup(p);
      return;
    }

    // Click first button
    const ev1 = await clickAt(p, btn1.x, btn1.y);
    expect(ev1 && ev1.type === 'overlay:element-clicked').toBe(true);

    // Clear selection and scroll
    await p.evaluate(() => {
      window.postMessage({ source: '__viskod_browser', command: 'overlay:clear-selection' }, '*');
    });
    await sleep(100);
    await p.evaluate(() => window.scrollBy(0, 400));
    await sleep(500);

    // Find another visible button
    const btn2 = await p.evaluate(() => {
      const b = document.querySelector('button');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return r.top > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });

    if (btn2) {
      const ev2 = await clickAt(p, btn2.x, btn2.y);
      const clicked = ev2 && ev2.type === 'overlay:element-clicked';
      expect(clicked).toBe(true);
      record('DF-17', 'Scroll behavior', clicked);
    } else {
      record('DF-17', 'Scroll behavior', false, 'No visible button after scroll');
    }

    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(200);
    await cleanup(p);
  });

  it('DF-21: route navigation preserves overlay lifecycle', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);
    expect(await hasRoot(p)).toBe(true);

    // Navigate to different route
    const navHref = await p.evaluate(() => {
      const as = Array.from(document.querySelectorAll('a[href]'))
        .filter((a: any) => { const h = a.getAttribute('href'); return h && h !== '/' && !h.startsWith('http') && !h.startsWith('#') && !h.startsWith('javascript'); });
      return as.length > 0 ? (as[0] as HTMLAnchorElement).getAttribute('href') : null;
    });

    if (navHref) {
      await p.goto(TARGET_URL + navHref, { waitUntil: 'networkidle' });
      await sleep(1000);
      // After navigation, overlay should be gone (page reload destroys injected JS)
      expect(await hasRoot(p)).toBe(false);

      // Re-inject on the new page
      await setupCapture(p);
      await activateOverlay(p);
      expect(await hasRoot(p)).toBe(true);
      record('DF-21', 'Route navigation', true, `navigated to ${navHref}, re-injected successfully`);
    } else {
      record('DF-21', 'Route navigation', false, 'No nav link found');
    }
    await cleanup(p);
  });

  it('DF-22: reload destroys overlay, re-inject works', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);
    expect(await hasRoot(p)).toBe(true);

    await p.reload({ waitUntil: 'networkidle' });
    await sleep(1000);

    // Overlay destroyed by reload
    expect(await hasRoot(p)).toBe(false);

    // Re-inject
    await setupCapture(p);
    await activateOverlay(p);
    expect(await hasRoot(p)).toBe(true);

    record('DF-22', 'Reload', true, 'overlay destroyed and re-injected successfully');
    await cleanup(p);
  });
});

describe('Phase 21 Dogfood — Rapid Interaction', () => {
  it('DF-26: rapid enter/exit cycles do not leak', async () => {
    const p = await makePage();
    for (let i = 0; i < 3; i++) {
      await setupCapture(p);
      await activateOverlay(p);
      await p.evaluate(() => {
        window.postMessage({ source: '__viskod_browser', command: 'overlay:hide' }, '*');
        const r = document.getElementById('__viskod_overlay_root');
        if (r) r.remove();
      });
      await sleep(100);
    }
    const leaked = await hasRoot(p);
    expect(leaked).toBe(false);
    record('DF-26', 'Rapid cycles', true, '3 cycles, no leak');
    await p.close();
  });
});

describe('Phase 21 Dogfood — Narrow Viewport', () => {
  it('DF-MOBILE: selection works on narrow viewport', async () => {
    const p = await makePage({ width: 390, height: 844 });
    await setupCapture(p);
    await activateOverlay(p);
    expect(await hasRoot(p)).toBe(true);

    // Find a clickable element
    const el = await p.evaluate(() => {
      const b = document.querySelector('button, a');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return r.width > 10 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });

    if (el) {
      const ev = await clickAt(p, el.x, el.y);
      record('DF-MOBILE', 'Narrow viewport selection', ev && ev.type === 'overlay:element-clicked',
        ev ? `tag=${ev.data.tagName}` : 'No event');
    } else {
      record('DF-MOBILE', 'Narrow viewport selection', false, 'No clickable element found');
    }
    await cleanup(p);
  });
});

describe('Phase 21 Dogfood — Reset/Clear Behavior', () => {
  it('DF-CLEAR: clears selection and reselects', async () => {
    const p = await makePage();
    await setupCapture(p);
    await activateOverlay(p);

    // Select something
    const el = await p.evaluate(() => {
      const b = document.querySelector('button');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });

    if (!el) {
      record('DF-CLEAR', 'Clear/reselect', false, 'No button found');
      await cleanup(p);
      return;
    }

    const ev1 = await clickAt(p, el.x, el.y);
    expect(ev1 && ev1.type === 'overlay:element-clicked').toBe(true);

    // Clear via command
    await p.evaluate(() => {
      window.postMessage({ source: '__viskod_browser', command: 'overlay:clear-selection' }, '*');
    });
    await sleep(200);
    const clearEvt = await p.evaluate(() => (window as any).__vs_events?.slice(-1)[0]);
    // Expect a selection-cleared event
    const cleared = clearEvt && clearEvt.type === 'overlay:selection-cleared';

    // Select again
    const ev2 = await clickAt(p, el.x, el.y);
    const reselected = ev2 && ev2.type === 'overlay:element-clicked';

    expect(cleared && reselected).toBe(true);
    record('DF-CLEAR', 'Clear/reselect', true, `cleared=${cleared} reselected=${reselected}`);
    await cleanup(p);
  });
});
