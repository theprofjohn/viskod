import { EventBus } from '@viskod/event-bus';
import { BrowserRuntime } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { VisualContextEngine } from '@viskod/context-engine';
import type { SelectionTarget, ContextPacket } from '@viskod/context-engine';
import type { BrowserHandle } from '@viskod/browser-runtime';
import http from 'node:http';

// Studio is the graphical interface — NOT an IDE, NOT a code editor, NOT a coding agent.
// Studio owns UI state ONLY. Business state belongs to runtime packages.
// Studio consumes VCE output through Event Bus.

interface StudioState {
  activePanel: 'browser-session' | 'context-explorer' | 'selection-inspector' | 'diagnostics';
  currentPacket: ContextPacket | null;
  currentSelection: SelectionTarget | null;
  isSelecting: boolean;
  browserConnected: boolean;
  vceConnected: boolean;
  errors: Array<{ id: string; message: string; subsystem: string; dismissed: boolean }>;
}

export class Studio {
  private eventBus: EventBus;
  private browserRuntime: BrowserRuntime;
  private capturePipeline: CapturePipeline;
  private vce: VisualContextEngine;
  private state: StudioState;
  private browserHandle: BrowserHandle | null = null;
  private server: http.Server | null = null;

  constructor() {
    this.eventBus = new EventBus({ enableHistory: true, historySize: 50 });
    this.browserRuntime = new BrowserRuntime(this.eventBus);
    this.capturePipeline = new CapturePipeline();
    this.vce = new VisualContextEngine({
      browserRuntime: this.browserRuntime,
      eventBus: this.eventBus,
      capturePipeline: this.capturePipeline,
    });

    this.state = {
      activePanel: 'browser-session',
      currentPacket: null,
      currentSelection: null,
      isSelecting: false,
      browserConnected: false,
      vceConnected: true, // VCE is in-process, always connected
      errors: [],
    };

    // Studio subscribes to events through Event Bus (never queries BR directly)
    this.eventBus.subscribe('BR_EVENT:BROWSER_STARTED', () => {
      this.state.browserConnected = true;
    });

    this.eventBus.subscribe('VCE_EVENT:CONTEXT_PACKET_GENERATED', (_event) => {
      this.state.isSelecting = false;
      this.state.activePanel = 'context-explorer';
    });

    this.eventBus.subscribe('VCE_EVENT:PROCESSING_FAILED', (event) => {
      this.state.isSelecting = false;
      this.state.errors.push({
        id: crypto.randomUUID(),
        message: String((event.payload as { error: string }).error),
        subsystem: 'visual-context-engine',
        dismissed: false,
      });
    });

    this.eventBus.subscribe('BR_EVENT:BROWSER_DISCONNECTED', () => {
      this.state.browserConnected = false;
    });
  }

  async start(): Promise<void> {
    const result = await this.browserRuntime.launch();
    if (result.ok) {
      this.browserHandle = result.value;
    }

    this.server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');

      if (req.url === '/state') {
        res.end(JSON.stringify(this.state));
      } else if (req.url === '/select/start') {
        void this.startSelection().then((r) => res.end(JSON.stringify(r)));
      } else if (req.url === '/select/confirm' && req.method === 'POST') {
        void this.confirmSelection().then((r) => res.end(JSON.stringify(r)));
      } else if (req.url === '/select/clear') {
        void this.clearSelection().then((r) => res.end(JSON.stringify(r)));
      } else if (req.url === '/packet/latest') {
        res.end(JSON.stringify(this.state.currentPacket));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.server.listen(3001, () => {
      console.log('Viskod Studio running on http://localhost:3001');
    });
  }

  async startSelection(): Promise<{ ok: boolean }> {
    this.state.isSelecting = true;
    this.state.activePanel = 'selection-inspector';
    return { ok: true };
  }

  async confirmSelection(): Promise<{ ok: boolean }> {
    if (!this.browserHandle) return { ok: false };

    // Simulated selection for P0 demo
    const selection: SelectionTarget = {
      selector: 'div',
      boundingBox: { x: 0, y: 0, width: 100, height: 100 },
    };
    this.state.currentSelection = selection;

    // Studio calls VCE (command flow)
    const result = await this.vce.processSelection(this.browserHandle, selection);
    if (result.ok) {
      this.state.currentPacket = result.value;
      this.state.activePanel = 'context-explorer';
      return { ok: true };
    }

    this.state.errors.push({
      id: crypto.randomUUID(),
      message: result.error.message,
      subsystem: result.error.subsystem,
      dismissed: false,
    });
    return { ok: false };
  }

  async clearSelection(): Promise<{ ok: boolean }> {
    this.state.currentSelection = null;
    this.state.isSelecting = false;
    this.state.activePanel = 'browser-session';
    return { ok: true };
  }

  async shutdown(): Promise<void> {
    if (this.server) this.server.close();
    if (this.browserHandle) {
      await this.browserRuntime.shutdown(this.browserHandle);
    }
  }

  getState(): StudioState {
    return this.state;
  }
}

// Entry point
const studio = new Studio();
void studio.start();
