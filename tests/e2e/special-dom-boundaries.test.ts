import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getOverlayScript } from '../../packages/overlay-system/src/index';

let browser: Browser;
let page: Page;

async function installViskodOverlay(): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener(
      'message',
      (event) => {
        if (event.data?.source === '__viskod_overlay') {
          (window as Window & { __viskodBoundaryEvent?: unknown }).__viskodBoundaryEvent =
            event.data;
        }
      },
      { once: false },
    );
  });
  await page.addScriptTag({ content: getOverlayScript() });
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    window.postMessage(
      { source: '__viskod_browser', command: 'overlay:show', mode: 'selection' },
      '*',
    );
  });
  await page.waitForSelector('#__viskod_overlay_root', { state: 'attached', timeout: 5000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    (window as Window & { __viskodBoundaryEvent?: unknown }).__viskodBoundaryEvent = null;
  });
}

async function clickViskodTarget(selector: string): Promise<Record<string, unknown> | null> {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) return null;
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return page.evaluate(
    () =>
      (window as Window & { __viskodBoundaryEvent?: Record<string, unknown> })
        .__viskodBoundaryEvent ?? null,
  );
}

describe('special DOM browser boundaries', () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    await page.setContent(`
      <button id="regular">Regular</button>
      <div id="open-host"></div>
      <div id="closed-host"></div>
      <iframe id="same-origin" srcdoc="<button id='frame-button'>Frame</button>"></iframe>
      <iframe id="cross-origin" src="https://example.com"></iframe>
    `);
    await page.evaluate(() => {
      const openHost = document.querySelector('#open-host');
      openHost?.attachShadow({ mode: 'open' }).append(
        Object.assign(document.createElement('button'), {
          id: 'open-button',
          textContent: 'Open',
        }),
      );
      const closedHost = document.querySelector('#closed-host');
      const root = closedHost?.attachShadow({ mode: 'closed' });
      root?.append(
        Object.assign(document.createElement('button'), {
          id: 'closed-button',
          textContent: 'Closed',
        }),
      );
    });
  });
  it('uses the Viskod overlay path and preserves browser boundaries', async () => {
    await installViskodOverlay();

    const openEvent = await clickViskodTarget('#open-host');
    expect(openEvent?.type).toBe('overlay:element-clicked');
    expect((openEvent?.data as Record<string, unknown>)?.selector).toBe('[id="open-host"]');
    await page.evaluate(() => {
      window.postMessage({ source: '__viskod_browser', command: 'overlay:clear-selection' }, '*');
      (window as Window & { __viskodBoundaryEvent?: unknown }).__viskodBoundaryEvent = null;
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      (window as Window & { __viskodBoundaryEvent?: unknown }).__viskodBoundaryEvent = null;
    });
    const sameOriginEvent = await clickViskodTarget('#same-origin');
    const sameOriginSelector = (sameOriginEvent?.data as Record<string, unknown> | undefined)
      ?.selector;
    expect(sameOriginEvent === null || sameOriginSelector === '[id="same-origin"]').toBe(true);

    await page.evaluate(() => {
      window.postMessage({ source: '__viskod_browser', command: 'overlay:clear-selection' }, '*');
      (window as Window & { __viskodBoundaryEvent?: unknown }).__viskodBoundaryEvent = null;
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      (window as Window & { __viskodBoundaryEvent?: unknown }).__viskodBoundaryEvent = null;
    });
    const crossOriginEvent = await clickViskodTarget('#cross-origin');
    const crossOriginSelector = (crossOriginEvent?.data as Record<string, unknown> | undefined)
      ?.selector;
    expect(crossOriginEvent === null || crossOriginSelector === '[id="cross-origin"]').toBe(true);

    await page.waitForTimeout(50);
    await page.evaluate(() => {
      (window as Window & { __viskodBoundaryEvent?: unknown }).__viskodBoundaryEvent = null;
    });
    await page.evaluate(() => {
      window.postMessage({ source: '__viskod_browser', command: 'overlay:hide' }, '*');
      document.getElementById('__viskod_overlay_root')?.remove();
    });
    expect(await page.locator('[data-viskod-overlay]').count()).toBe(0);
    await installViskodOverlay();
    const closedEvent = await clickViskodTarget('#closed-host');
    expect(closedEvent?.type).toBe('overlay:element-clicked');
    expect((closedEvent?.data as Record<string, unknown>)?.selector).toBe('[id="closed-host"]');
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('resolves regular DOM pointer and keyboard identity', async () => {
    const pointer = await page.locator('#regular').evaluate((element) => element.id);
    await page.locator('#regular').focus();
    await page.keyboard.press('Enter');
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id);
    expect(pointer).toBe('regular');
    expect(focused).toBe('regular');
  });

  it('observes open and closed Shadow DOM host boundaries', async () => {
    const result = await page.evaluate(() => ({
      documentQuery: document.querySelector('#open-button'),
      openShadowQuery: document
        .querySelector('#open-host')
        ?.shadowRoot?.querySelector('#open-button')?.id,
      closedShadowRoot: (
        document.querySelector('#closed-host') as HTMLElement & { shadowRoot: ShadowRoot | null }
      )?.shadowRoot,
    }));
    expect(result.documentQuery).toBeNull();
    expect(result.openShadowQuery).toBe('open-button');
    expect(result.closedShadowRoot).toBeNull();
  });
  it('observes same-origin iframe as a separate document boundary', async () => {
    const sameOrigin = page.frameLocator('#same-origin');
    expect(await sameOrigin.locator('#frame-button').count()).toBe(1);
    expect(await page.locator('#frame-button').count()).toBe(0);
  });

  it('keeps cross-origin iframe as a host/frame boundary', async () => {
    const iframe = page.locator('#cross-origin');
    expect(await iframe.count()).toBe(1);
    expect(await page.locator('#cross-origin button').count()).toBe(0);
  });
});
