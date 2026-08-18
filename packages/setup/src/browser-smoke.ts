import type { Result } from '@viskod/shared';
import { ok } from '@viskod/shared';
import type { SetupSmokeResult } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isOpaquePacketId(packetId: string): boolean {
  return typeof packetId === 'string' && UUID_PATTERN.test(packetId);
}

export async function runBrowserSmoke(input: {
  projectRoot: string;
  url?: string;
}): Promise<Result<SetupSmokeResult>> {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, timeout: 15000 });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    const targetUrl =
      input.url ?? 'data:text/html,<html><body><h1>Viskod Setup</h1><p>Test page</p></body></html>';
    await page.setContent(
      targetUrl.startsWith('data:') ? targetUrl : '<html><body><h1>Viskod Setup</h1></body></html>',
      { timeout: 5000 },
    );
    await page.waitForSelector('body', { timeout: 5000 });

    await page.close();
    await context.close();
    await browser.close();

    return ok({ lastRunAt: now, status: 'pass', warnings });
  } catch (e) {
    return ok({
      lastRunAt: now,
      status: 'fail',
      warnings: [`Browser smoke failed: ${e instanceof Error ? e.message : String(e)}`],
    });
  }
}

export async function runCaptureSmoke(input: {
  projectRoot: string;
  url?: string;
}): Promise<Result<SetupSmokeResult>> {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  try {
    // Use VCE generatePacket for real capture — proves the full capture pipeline works
    const { EventBus } = await import('@viskod/event-bus');
    const { BrowserRuntime } = await import('@viskod/browser-runtime');
    const { CapturePipeline } = await import('@viskod/capture-pipeline');
    const { SelectionEngine } = await import('@viskod/selection-engine');
    const { SourceHintEngine } = await import('@viskod/source-hint-engine');
    const { VisualContextEngine } = await import('@viskod/context-engine');

    const eventBus = new EventBus();
    const browserRuntime = new BrowserRuntime(eventBus);
    const capturePipeline = new CapturePipeline();
    const selectionEngine = new SelectionEngine(eventBus);
    const sourceHintEngine = new SourceHintEngine(eventBus);

    const vce = new VisualContextEngine({
      browserRuntime,
      eventBus,
      capturePipeline,
      selectionEngine,
      sourceHintEngine,
    });

    // Step 1: Start browser via VCE
    const startResult = await vce.start();
    if (!startResult.ok) {
      return ok({
        lastRunAt: now,
        status: 'fail',
        warnings: [`Browser start failed: ${startResult.error.message}`],
      });
    }

    // A configured app URL is a real target and must pass the same navigation
    // policy as production. Without one, keep the browser's blank page: the
    // smoke proves browser/capture wiring without bypassing URL policy with a
    // data: navigation.
    const targetUrl = input.url;
    if (targetUrl) {
      const navResult = await vce.navigate(targetUrl);
      if (!navResult.ok) {
        warnings.push(`Navigation failed for the configured target: ${navResult.error.message}`);
      }
    }

    // Step 3: Generate a real context packet via VCE generatePacket
    const packetResult = await vce.generatePacket();

    // Step 4: Stop browser
    const stopResult = await vce.stopBrowser();
    if (!stopResult.ok) {
      warnings.push(`Browser stop: ${stopResult.error.message}`);
    }

    if (!packetResult.ok) {
      return ok({
        lastRunAt: now,
        status: 'fail',
        warnings: [`Capture failed: ${packetResult.error.message}`, ...warnings],
      });
    }

    const packet = packetResult.value;

    // Step 5: Assert opaque packetId exists and is UUID
    if (!packet.packetId || !isOpaquePacketId(packet.packetId)) {
      return ok({
        lastRunAt: now,
        status: 'fail',
        warnings: ['Packet missing valid opaque packetId', ...warnings],
      });
    }

    // Step 6: Verify no raw paths or JSON in output
    const packetJson = JSON.stringify(packet);
    if (packetJson.includes('C:\\') || packetJson.includes('/home/')) {
      warnings.push('Packet contains absolute paths');
    }

    // Step 7: Return only opaque packetId (truncated for display)
    return ok({
      lastRunAt: now,
      status: 'pass',
      packetId: packet.packetId,
      warnings,
    });
  } catch (e) {
    return ok({
      lastRunAt: now,
      status: 'fail',
      warnings: [`Capture smoke failed: ${e instanceof Error ? e.message : String(e)}`],
    });
  }
}
