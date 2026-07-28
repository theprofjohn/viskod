import { type BrowserHandle, BrowserRuntime } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import {
  type ContextPacket,
  type SelectionTarget as VCESelectionTarget,
  VisualContextEngine,
} from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { ProjectScanner } from '@viskod/project-scanner';
import { SelectionEngine, type SelectionTarget } from '@viskod/selection-engine';
import { SourceHintEngine } from '@viskod/source-hint-engine';

export type { ContextPacket, SelectionTarget };

export interface ViskodOptions {
  headless?: boolean;
  defaultUrl?: string;
}

export class Viskod {
  private eventBus: EventBus;
  private browserRuntime: BrowserRuntime;
  private capturePipeline: CapturePipeline;
  private selectionEngine: SelectionEngine;
  private projectScanner: ProjectScanner;
  private sourceHintEngine: SourceHintEngine;
  private vce: VisualContextEngine;

  constructor(_options: ViskodOptions = {}) {
    this.eventBus = new EventBus({ enableHistory: true, historySize: 100 });
    this.browserRuntime = new BrowserRuntime(this.eventBus);
    this.capturePipeline = new CapturePipeline();
    this.selectionEngine = new SelectionEngine(this.eventBus);
    this.projectScanner = new ProjectScanner(this.eventBus);
    this.sourceHintEngine = new SourceHintEngine(this.eventBus);
    this.vce = new VisualContextEngine({
      browserRuntime: this.browserRuntime,
      eventBus: this.eventBus,
      capturePipeline: this.capturePipeline,
      selectionEngine: this.selectionEngine,
    });
  }

  async start(url?: string): Promise<BrowserHandle> {
    const result = await this.vce.start();
    if (!result.ok) throw new Error(`Failed to start: ${result.error.message}`);
    if (url) {
      const navResult = await this.vce.navigate(url);
      if (!navResult.ok) throw new Error(`Failed to navigate: ${navResult.error.message}`);
    }
    return result.value;
  }

  async navigate(url: string): Promise<void> {
    const result = await this.vce.navigate(url);
    if (!result.ok) throw new Error(`Navigation failed: ${result.error.message}`);
  }

  async selectElement(
    selector: string,
    boundingBox?: { x: number; y: number; width: number; height: number },
  ): Promise<SelectionTarget> {
    const resolved = await this.selectionEngine.resolveTarget({
      selector,
      boundingBox: boundingBox ?? { x: 0, y: 0, width: 100, height: 100 },
      source: 'mcp',
      timestamp: new Date().toISOString(),
    });
    if (!resolved.ok) throw new Error(`Selection failed: ${resolved.error.message}`);
    return resolved.value;
  }

  async capture(selector?: string): Promise<ContextPacket> {
    let target: VCESelectionTarget | undefined;
    if (selector) {
      const sel = await this.selectElement(selector);
      target = { selector: sel.selector, boundingBox: sel.boundingBox, source: 'mcp' };
    }
    const result = await this.vce.generatePacket(target);
    if (!result.ok) throw new Error(`Capture failed: ${result.error.message}`);
    return result.value;
  }

  async scanProject(rootPath?: string): Promise<{
    metadata: { name: string; rootPath: string; packageManager: string };
    framework: { primary: string | null; detected: string[] };
  }> {
    const result = await this.projectScanner.scan(rootPath);
    if (!result.ok) throw new Error(`Scan failed: ${result.error.message}`);
    return {
      metadata: {
        name: result.value.metadata.name,
        rootPath: result.value.metadata.rootPath,
        packageManager: result.value.metadata.packageManager,
      },
      framework: {
        primary: result.value.framework.primary,
        detected: result.value.framework.detected,
      },
    };
  }

  async health(): Promise<Record<string, { status: string }>> {
    return {
      'browser-runtime': { status: this.browserRuntime.health({ contextId: 'sdk' }).status },
      'visual-context-engine': { status: this.vce.health().status },
      'selection-engine': { status: this.selectionEngine.health().status },
      'project-scanner': { status: this.projectScanner.health().status },
      'source-hint-engine': { status: this.sourceHintEngine.health().status },
    };
  }

  async shutdown(): Promise<void> {
    await this.vce.stopBrowser();
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }
}
