import http from 'node:http';
import { VisualContextEngine } from '@viskod/context-engine';
import type { ContextPacket, SelectionTarget } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';

interface StudioState {
  activePanel:
    | 'browser-session'
    | 'context-explorer'
    | 'selection-inspector'
    | 'diagnostics'
    | 'capture-history';
  currentPacket: ContextPacket | null;
  currentSelection: SelectionTarget | null;
  isSelecting: boolean;
  browserConnected: boolean;
  vceConnected: boolean;
  errors: Array<{ id: string; message: string; subsystem: string; dismissed: boolean }>;
}

export class Studio {
  private eventBus: EventBus;
  private vce: VisualContextEngine;
  private selectionEngine?: {
    resolveTarget: (event: {
      selector: string;
      boundingBox: { x: number; y: number; width: number; height: number };
      source: string;
      timestamp: string;
    }) => Promise<{ ok: boolean }>;
    validateSelection: (
      target: SelectionTarget,
    ) => Promise<{ ok: boolean; value?: { target: SelectionTarget } }>;
    clearSelection: () => Promise<{ ok: boolean }>;
    health: () => { status: string };
  };
  private state: StudioState;
  private browserConnected = false;
  private server: http.Server | null = null;

  constructor(
    vce: VisualContextEngine,
    eventBus: EventBus,
    selectionEngine?: Studio['selectionEngine'],
  ) {
    this.vce = vce;
    this.eventBus = eventBus;
    this.selectionEngine = selectionEngine;

    this.state = {
      activePanel: 'browser-session',
      currentPacket: null,
      currentSelection: null,
      isSelecting: false,
      browserConnected: false,
      vceConnected: true,
      errors: [],
    };

    this.eventBus.subscribe('BR_EVENT:BROWSER_STARTED', () => {
      this.state.browserConnected = true;
    });

    this.eventBus.subscribe('VCE_EVENT:CONTEXT_PACKET_GENERATED', (event) => {
      this.state.isSelecting = false;
      this.state.activePanel = 'context-explorer';
      const payload = event.payload as { packetId: string };
      if (payload.packetId) {
        this.state.errors = this.state.errors.filter(
          (e) => e.subsystem === 'visual-context-engine' && !e.dismissed,
        );
      }
    });

    this.eventBus.subscribe('VCE_EVENT:PROCESSING_FAILED', (event) => {
      this.state.isSelecting = false;
      const payload = event.payload as { error: unknown };
      this.state.errors.push({
        id: crypto.randomUUID(),
        message: String(payload.error ?? 'Unknown processing error'),
        subsystem: 'visual-context-engine',
        dismissed: false,
      });
    });

    this.eventBus.subscribe('SE_EVENT:SELECTION_CHANGED', (event) => {
      const payload = event.payload as { selectionId: string; selector: string };
      if (payload.selector) {
        this.state.activePanel = 'selection-inspector';
      }
    });

    this.eventBus.subscribe('SE_EVENT:SELECTION_FAILED', (event) => {
      const payload = event.payload as { error: string };
      this.state.errors.push({
        id: crypto.randomUUID(),
        message: payload.error ?? 'Selection failed',
        subsystem: 'selection-engine',
        dismissed: false,
      });
    });
  }

  async start(): Promise<void> {
    const result = await this.vce.start();
    if (result.ok) {
      this.browserConnected = true;
    }

    this.server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url ?? '/';

      if (url === '/state') {
        res.end(JSON.stringify(this.state));
      } else if (url === '/navigate' && req.method === 'POST') {
        void this.handleNavigate(req, res);
      } else if (url === '/select/start') {
        void this.startSelection().then((r) => res.end(JSON.stringify(r)));
      } else if (url === '/select/confirm' && req.method === 'POST') {
        void this.confirmSelection(req, res);
      } else if (url === '/select/element' && req.method === 'POST') {
        void this.selectElement(req, res);
      } else if (url === '/select/clear') {
        void this.clearSelection().then((r) => res.end(JSON.stringify(r)));
      } else if (url === '/capture') {
        void this.handleCapture(res);
      } else if (url === '/packet/latest') {
        res.end(JSON.stringify(this.state.currentPacket));
      } else if (url === '/errors') {
        res.end(JSON.stringify(this.state.errors));
      } else if (url === '/health') {
        const vceHealth = this.vce.health();
        const seHealth = this.selectionEngine?.health();
        res.end(
          JSON.stringify({
            studio: { status: 'running', panel: this.state.activePanel },
            vce: vceHealth,
            selectionEngine: seHealth ?? null,
            browserConnected: this.browserConnected,
          }),
        );
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.server.listen(3001, () => {
      console.log('Viskod Studio running on http://localhost:3001');
    });
  }

  private async handleNavigate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    try {
      const { url } = JSON.parse(body);
      const result = await this.vce.navigate(url);
      res.end(
        JSON.stringify(result.ok ? { ok: true } : { ok: false, error: result.error.message }),
      );
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
  }

  private async handleCapture(res: http.ServerResponse): Promise<void> {
    const result = await this.vce.generatePacket();
    if (result.ok) {
      this.state.currentPacket = result.value;
      this.state.activePanel = 'context-explorer';
      res.end(JSON.stringify({ ok: true, packetId: result.value.packetId }));
    } else {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: result.error.message }));
    }
  }

  async startSelection(): Promise<{ ok: boolean }> {
    this.state.isSelecting = true;
    this.state.activePanel = 'selection-inspector';
    return { ok: true };
  }

  private async confirmSelection(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!this.browserConnected) {
      res.end(JSON.stringify({ ok: false, error: 'Browser not connected' }));
      return;
    }

    const body = await this.readBody(req);
    try {
      const { selector } = JSON.parse(body);
      const selection: SelectionTarget = {
        selector: selector ?? 'body',
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
        source: 'studio',
      };
      this.state.currentSelection = selection;

      if (this.selectionEngine) {
        const resolved = await this.selectionEngine.resolveTarget({
          selector: selection.selector,
          boundingBox: selection.boundingBox,
          source: 'studio',
          timestamp: new Date().toISOString(),
        });
        if (resolved.ok) {
          const validated = await this.selectionEngine.validateSelection({
            selector: selection.selector,
            boundingBox: selection.boundingBox,
            source: 'studio',
          } as SelectionTarget);
          if (validated.ok && validated.value) {
            this.state.currentSelection = validated.value.target;
          }
        }
      }

      const result = await this.vce.processSelection(selection);
      if (result.ok) {
        this.state.currentPacket = result.value;
        this.state.activePanel = 'context-explorer';
        res.end(JSON.stringify({ ok: true, packetId: result.value.packetId }));
      } else {
        res.end(JSON.stringify({ ok: false, error: result.error.message }));
      }
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid selection body' }));
    }
  }

  private async selectElement(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    try {
      const { selector } = JSON.parse(body);
      const selection: SelectionTarget = {
        selector,
        boundingBox: { x: 0, y: 0, width: 100, height: 100 },
        source: 'studio',
      };
      this.state.currentSelection = selection;

      const result = await this.vce.processSelection(selection);
      if (result.ok) {
        this.state.currentPacket = result.value;
        this.state.activePanel = 'context-explorer';
        res.end(JSON.stringify({ ok: true, packetId: result.value.packetId }));
      } else {
        res.end(JSON.stringify({ ok: false, error: result.error.message }));
      }
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  }

  async clearSelection(): Promise<{ ok: boolean }> {
    this.state.currentSelection = null;
    this.state.isSelecting = false;
    if (this.selectionEngine) {
      await this.selectionEngine.clearSelection();
    }
    return { ok: true };
  }

  async shutdown(): Promise<void> {
    if (this.server) this.server.close();
    await this.vce.stopBrowser();
  }

  getState(): StudioState {
    return this.state;
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', () => resolve(body));
    });
  }
}

// Entry point — bootstrap wiring
import { BrowserRuntime } from '@viskod/browser-runtime';
import { CapturePipeline } from '@viskod/capture-pipeline';
import { ProjectScanner } from '@viskod/project-scanner';
import type { SelectionEngine as SelectionEngineType } from '@viskod/selection-engine';
import { SelectionEngine } from '@viskod/selection-engine';
import { SourceHintEngine } from '@viskod/source-hint-engine';

const eventBus = new EventBus({ enableHistory: true, historySize: 50 });
const browserRuntime = new BrowserRuntime(eventBus);
const capturePipeline = new CapturePipeline();
const selectionEngine: SelectionEngineType = new SelectionEngine(eventBus);
const projectScanner = new ProjectScanner(eventBus);
const sourceHintEngine = new SourceHintEngine(eventBus);

const vce = new VisualContextEngine({
  browserRuntime,
  eventBus,
  capturePipeline,
  selectionEngine,
  projectScanner,
  sourceHintEngine: {
    generateHints: (input: Record<string, unknown>) =>
      sourceHintEngine.generateHints(
        input as unknown as Parameters<typeof sourceHintEngine.generateHints>[0],
      ),
  },
});

const studio = new Studio(vce, eventBus, selectionEngine);
void studio.start();
