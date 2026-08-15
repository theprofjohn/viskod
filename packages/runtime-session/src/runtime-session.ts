import * as fs from 'node:fs';
import * as path from 'node:path';
import { type BrowserHandle, BrowserRuntime, type ProfileConfig } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import {
  type ContextPacket,
  type SelectionTarget,
  VisualContextEngine,
} from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { ProjectScanner } from '@viskod/project-scanner';
import { SelectionEngine } from '@viskod/selection-engine';
import { type Result, err, ok } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, type ViskodError } from '@viskod/shared';
import { SourceHintEngine } from '@viskod/source-hint-engine';
import { SESSION_FILE, STORAGE_DIR } from './constants';
import type { SessionInfo } from './types';

export class RuntimeSession {
  private eventBus: EventBus;
  private browserRuntime: BrowserRuntime;
  private capturePipeline: CapturePipeline;
  private selectionEngine: SelectionEngine;
  private projectScanner: ProjectScanner;
  private sourceHintEngine: SourceHintEngine;
  private vce: VisualContextEngine;
  private _info: SessionInfo | null = null;
  private storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir ?? path.join(process.cwd(), STORAGE_DIR);
    this.eventBus = new EventBus({ enableHistory: true, historySize: 100 });
    this.browserRuntime = new BrowserRuntime(this.eventBus);
    this.capturePipeline = new CapturePipeline(path.join(this.storageDir, 'captures'));
    this.selectionEngine = new SelectionEngine(this.eventBus);
    this.projectScanner = new ProjectScanner(this.eventBus);
    this.sourceHintEngine = new SourceHintEngine(this.eventBus);
    this.vce = new VisualContextEngine({
      browserRuntime: this.browserRuntime,
      eventBus: this.eventBus,
      capturePipeline: this.capturePipeline,
      selectionEngine: this.selectionEngine,
      sourceHintEngine: this.sourceHintEngine,
    });
  }

  get info(): SessionInfo | null {
    return this._info;
  }

  get handle(): BrowserHandle | null {
    return null; // VCE manages handles internally
  }

  async start(url?: string): Promise<Result<SessionInfo>> {
    if (this._info?.status === 'running') {
      return ok(this._info);
    }

    const startResult = await this.vce.start();
    if (!startResult.ok) {
      return err(
        this.sessionError(
          'SESSION_START_FAILED',
          `Failed to start browser: ${startResult.error.message}`,
        ),
      );
    }

    if (url) {
      const navResult = await this.vce.navigate(url);
      if (!navResult.ok) {
        await this.vce.stopBrowser();
        return err(
          this.sessionError('SESSION_NAV_FAILED', `Failed to navigate: ${navResult.error.message}`),
        );
      }
    }

    // Scan project for source hint context
    const scanResult = await this.projectScanner.scan();
    if (scanResult.ok) {
      const s = scanResult.value;
      this.vce.setProjectContext({
        rootPath: s.metadata.rootPath,
        projectId: s.metadata.projectId,
        name: s.metadata.name,
        directories: s.components.directories,
        primaryFramework: s.framework.primary,
        detectedFrameworks: s.framework.detected,
        frameworkConfidence: s.framework.confidence,
      });
    }

    const sessionId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const token = crypto.randomUUID();

    this._info = {
      sessionId,
      pid: process.pid,
      port: 0,
      token,
      status: 'running',
      browserUrl: url,
      startedAt,
      projectRoot: scanResult.ok ? scanResult.value.metadata.rootPath : process.cwd(),
    };

    return ok(this._info);
  }

  async stop(): Promise<Result<void>> {
    await this.vce.stopBrowser();
    this._info = null;
    return ok(undefined);
  }

  async capture(
    selector: string,
    targetUrl?: string,
    profile?: ProfileConfig,
    options?: { reload?: boolean; cacheBust?: boolean },
  ): Promise<Result<ContextPacket>> {
    if (this._info?.status !== 'running') {
      return err(
        this.sessionError('SESSION_NOT_STARTED', 'Session not running. Call start() first.'),
      );
    }

    const currentUrl = this._info.browserUrl;
    const effectiveUrl = targetUrl ?? currentUrl;

    if (effectiveUrl) {
      if (options?.cacheBust) {
        const urlObj = new URL(effectiveUrl);
        urlObj.searchParams.set('__viskod_cb', String(Date.now()));
        const bustUrl = urlObj.toString();
        const navResult = await this.vce.navigate(bustUrl);
        if (!navResult.ok) {
          return err(
            this.sessionError(
              'SESSION_NAV_FAILED',
              `Failed to navigate (cache bust): ${navResult.error.message}`,
            ),
          );
        }
        // Do not persist cacheBust URL in session info
      } else if (options?.reload && effectiveUrl === currentUrl) {
        const reloadResult = await this.vce.reloadPage();
        if (!reloadResult.ok) {
          return err(
            this.sessionError(
              'SESSION_RELOAD_FAILED',
              `Failed to reload page: ${reloadResult.error.message}`,
            ),
          );
        }
      } else if (targetUrl && targetUrl !== currentUrl) {
        const navResult = await this.vce.navigate(targetUrl);
        if (!navResult.ok) {
          return err(
            this.sessionError(
              'SESSION_NAV_FAILED',
              `Failed to navigate: ${navResult.error.message}`,
            ),
          );
        }
        this._info.browserUrl = targetUrl;
      }
    }

    const selection: SelectionTarget = {
      selector,
      source: 'mcp',
    };

    const result = await this.vce.generatePacket(selection, profile);
    if (!result.ok) {
      return err(
        this.sessionError('SESSION_CAPTURE_FAILED', `Capture failed: ${result.error.message}`),
      );
    }

    return ok(result.value);
  }

  getStatus(): SessionInfo | null {
    return this._info;
  }

  getVCE(): VisualContextEngine {
    return this.vce;
  }

  getProjectScanner(): ProjectScanner {
    return this.projectScanner;
  }

  getBrowserRuntime(): BrowserRuntime {
    return this.browserRuntime;
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  writeSessionFile(): void {
    if (!this._info) return;
    fs.mkdirSync(this.storageDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.storageDir, SESSION_FILE),
      JSON.stringify(this._info, null, 2),
      'utf-8',
    );
  }

  static readSessionFile(storageDir?: string): SessionInfo | null {
    const dir = storageDir ?? path.join(process.cwd(), STORAGE_DIR);
    const filePath = path.join(dir, SESSION_FILE);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as SessionInfo;
    } catch {
      return null;
    }
  }

  static clearSessionFile(storageDir?: string): void {
    const dir = storageDir ?? path.join(process.cwd(), STORAGE_DIR);
    const filePath = path.join(dir, SESSION_FILE);
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // best effort
    }
  }

  private sessionError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'runtime-session',
      timestamp: new Date().toISOString(),
    };
  }
}
