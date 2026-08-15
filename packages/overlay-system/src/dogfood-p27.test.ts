import { type Browser, type Page, chromium } from 'playwright';
// Phase 27 dogfood — documentOrder regression (VISKOD-AUDIT-012).
// Real overlay script in real Chromium: three sibling elements plus a nested
// descendant must receive valid, monotonically ordered documentOrder values
// (never -1). Previously the TreeWalker used the SHOW_TEXT mask, so no
// element ever matched and every connected element returned -1.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getOverlayScript } from './index';

const overlayScript = getOverlayScript();
let browser: Browser | null = null;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
}, 30000);

afterAll(async () => {
  if (browser) await browser.close();
});

async function makeSelectionPage(): Promise<Page> {
  if (!browser) throw new Error('browser not available');
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();
  await page.setContent(`
    <div id="s1" style="height:40px">First sibling</div>
    <div id="s2" style="height:60px">
      <div id="n2" style="height:20px">Nested descendant</div>
    </div>
    <div id="s3" style="height:40px">Third sibling</div>
  `);
  await page.evaluate(overlayScript);
  await page.evaluate(() => {
    window.postMessage(
      { source: '__viskod_browser', command: 'overlay:show', mode: 'selection' },
      '*',
    );
  });
  return page;
}

/** Clicks the element center and returns its documentOrder from the bridge. */
async function clickDocumentOrder(page: Page, id: string): Promise<number> {
  const point = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, `#${id}`);
  await page.mouse.click(point.x, point.y);
  // Wait for the element-clicked event carrying this element's stable
  // selector; hover messages carry no selector, so this cannot race.
  await page.waitForFunction(
    (sel) => {
      const bridge = document.getElementById('__viskod_bridge');
      if (!bridge || !bridge.textContent) return false;
      try {
        const last = JSON.parse(bridge.textContent) as {
          type?: string;
          data?: { selector?: string };
        };
        return last.type === 'overlay:element-clicked' && last.data?.selector === sel;
      } catch {
        return false;
      }
    },
    `[id="${id}"]`,
    { timeout: 5000 },
  );
  return page.evaluate(() => {
    const bridge = document.getElementById('__viskod_bridge');
    const last = JSON.parse(bridge?.textContent ?? '{}') as { data?: { documentOrder?: number } };
    return last.data?.documentOrder ?? -1;
  });
}

describe('Phase 27 — documentOrder regression', () => {
  it('assigns valid, monotonically ordered documentOrder to siblings and descendants', async () => {
    const page = await makeSelectionPage();
    const orderS1 = await clickDocumentOrder(page, 's1');
    const orderS2 = await clickDocumentOrder(page, 's2');
    const orderN2 = await clickDocumentOrder(page, 'n2');
    const orderS3 = await clickDocumentOrder(page, 's3');

    // Every connected element must have a real order — never -1.
    expect(orderS1).toBeGreaterThanOrEqual(0);
    expect(orderS2).toBeGreaterThanOrEqual(0);
    expect(orderN2).toBeGreaterThanOrEqual(0);
    expect(orderS3).toBeGreaterThanOrEqual(0);

    // Strictly increasing in document order: s1 < s2 < nested(n2) < s3.
    expect(orderS2).toBeGreaterThan(orderS1);
    expect(orderN2).toBeGreaterThan(orderS2);
    expect(orderS3).toBeGreaterThan(orderN2);

    await page.context().close();
  });
});
