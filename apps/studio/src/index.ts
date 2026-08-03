import http from 'node:http';
import { VisualContextEngine } from '@viskod/context-engine';
import type { ContextPacket, SelectionTarget } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { getOverlayScript } from '@viskod/overlay-system';
import { WebSocket, WebSocketServer } from 'ws';

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: string;
  delivered: boolean;
}

export interface ViskodSettings {
  selectionMode: boolean;
  boxSelect: boolean;
  hoverHighlight: boolean;
  diagnosticsOverlay: boolean;
  spacingVisualization: boolean;
  screenshots: boolean;
  consoleLogs: boolean;
  networkRequests: boolean;
  computedStyles: boolean;
  autoRefresh: boolean;
  sourceHints: boolean;
  importGraph: boolean;
}

export const DEFAULT_SETTINGS: ViskodSettings = {
  selectionMode: false,
  boxSelect: true,
  hoverHighlight: true,
  diagnosticsOverlay: false,
  spacingVisualization: false,
  screenshots: true,
  consoleLogs: true,
  networkRequests: true,
  computedStyles: true,
  autoRefresh: false,
  sourceHints: true,
  importGraph: false,
};

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
  chatMessages: ChatMessage[];
  settings: ViskodSettings;
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
  private wss: WebSocketServer | null = null;
  private wsClients = new Set<WebSocket>();

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
      chatMessages: [],
      settings: { ...DEFAULT_SETTINGS },
    };
    this.syncCaptureProfile();

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
      } else if (url === '/chat/messages') {
        const undelivered = this.state.chatMessages.filter((m) => !m.delivered);
        for (const m of undelivered) {
          m.delivered = true;
        }
        res.end(JSON.stringify({ messages: undelivered }));
      } else if (url === '/chat/respond' && req.method === 'POST') {
        void this.handleChatRespond(req, res);
      } else if (url === '/chat/notify' && req.method === 'POST') {
        void this.handleChatNotify(req, res);
      } else if (url === '/settings' && req.method === 'GET') {
        res.end(JSON.stringify(this.state.settings));
      } else if (url === '/settings' && req.method === 'POST') {
        void this.handleSettingsUpdate(req, res);
      } else if (url === '/overlay/script') {
        // ponytail: serve overlay script to extension for re-injection after reload
        const script = getOverlayScript();
        res.setHeader('Content-Type', 'application/javascript');
        res.end(script);
      } else if (url === '/overlay/reload' && req.method === 'POST') {
        // ponytail: reload page via Playwright and re-inject overlay
        void this.handleOverlayReload(res);
      } else if (url.startsWith('/setup/mcp-config')) {
        // ponytail: return MCP config JSON for the user's IDE onboarding
        const query = req.url?.split('?')[1] ?? '';
        const ide =
          query
            .split('&')
            .find((p) => p.startsWith('ide='))
            ?.split('=')[1] ?? 'opencode';
        const config = this.buildMcpConfig(ide);
        res.end(JSON.stringify(config, null, 2));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.server.listen(3001, () => {
      console.log('Viskod Studio running on http://localhost:3001');
    });

    // ponytail: WebSocket server for Chrome extension chat — same port as HTTP
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => {
      this.wsClients.add(ws);
      ws.on('close', () => this.wsClients.delete(ws));
      ws.on('error', () => this.wsClients.delete(ws));
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as Record<string, unknown>;
          if (msg.type === 'chat:send' && typeof msg.text === 'string' && msg.text.trim()) {
            const chatMsg = this.addChatMessage('user', msg.text.trim());
            this.broadcastToWs({ type: 'chat:message', ...chatMsg });
          } else if (msg.type === 'overlay:event' && msg.data) {
            // ponytail: forward overlay events to event bus for capture pipeline
            const data = msg.data as Record<string, unknown>;
            this.eventBus.publish({
              eventId: crypto.randomUUID(),
              eventType: `OVERLAY_EVENT:${data.type ?? 'unknown'}`,
              timestamp: new Date().toISOString(),
              version: '1.0.0',
              source: 'studio-extension',
              correlationId: crypto.randomUUID(),
              payload: data.data ?? {},
            });
          } else if (msg.type === 'settings:update' && msg.settings) {
            // ponytail: update user toggle settings
            const updates = { ...(msg.settings as Record<string, unknown>) };
            updates.multiSelect = undefined;
            this.state.settings = {
              ...this.state.settings,
              ...(updates as Partial<ViskodSettings>),
            };
            this.syncCaptureProfile();
            this.broadcastToWs({ type: 'settings:updated', settings: this.state.settings });
          }
        } catch {
          /* ignore malformed messages */
        }
      });
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

  // ponytail: chat — agent ↔ extension message passing via HTTP + WebSocket
  private addChatMessage(role: 'user' | 'agent', text: string): ChatMessage {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role,
      text,
      timestamp: new Date().toISOString(),
      delivered: false,
    };
    this.state.chatMessages.push(msg);
    return msg;
  }

  private broadcastToWs(data: Record<string, unknown>): void {
    const payload = JSON.stringify(data);
    for (const client of this.wsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private async handleChatRespond(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    try {
      const { text } = JSON.parse(body) as { text?: string };
      if (!text) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'text is required' }));
        return;
      }
      const msg = this.addChatMessage('agent', text);
      this.broadcastToWs({ type: 'chat:status', status: 'ready' });
      this.broadcastToWs({ type: 'chat:message', ...msg });
      res.end(JSON.stringify({ ok: true, id: msg.id }));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
    }
  }

  private async handleChatNotify(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    try {
      const { action, selector } = JSON.parse(body) as { action?: string; selector?: string };
      if (action === 'refresh') {
        this.broadcastToWs({ type: 'chat:refresh' });
      } else if (action === 'inject-overlay') {
        this.broadcastToWs({ type: 'overlay:inject' });
      } else if (action === 'highlight' && selector) {
        this.broadcastToWs({ type: 'overlay:highlight', selector });
      } else if (action === 'agent-status') {
        const status = JSON.parse(body).status as string | undefined;
        if (status) this.broadcastToWs({ type: 'chat:status', status });
      }
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
    }
  }

  private async handleSettingsUpdate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    try {
      const updates = JSON.parse(body) as Record<string, unknown>;
      updates.multiSelect = undefined;
      this.state.settings = { ...this.state.settings, ...(updates as Partial<ViskodSettings>) };
      this.syncCaptureProfile();
      this.broadcastToWs({ type: 'settings:updated', settings: this.state.settings });
      res.end(JSON.stringify({ ok: true, settings: this.state.settings }));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
    }
  }

  private buildMcpConfig(ide: string): Record<string, unknown> {
    const mcp = {
      mcpServers: {
        viskod: {
          command: 'npx',
          args: [
            'tsx',
            'C:/Viskod/packages/cli/src/index.ts',
            'serve',
            '--url',
            'http://localhost:3000',
          ],
          env: {},
          disabled: false,
          autoApprove: [],
        },
      },
    };

    switch (ide) {
      case 'claude':
        return {
          mcpServers: mcp.mcpServers,
          claudeDesktop: {
            ...mcp,
          },
        };
      case 'cursor':
        return {
          mcp: mcp.mcpServers,
        };
      default:
        return {
          $schema: 'https://opencode.ai/config.json',
          ...mcp,
        };
    }
  }

  private syncCaptureProfile(): void {
    this.vce.setCaptureProfile({
      collectScreenshot: this.state.settings.screenshots,
      collectConsole: this.state.settings.consoleLogs,
      collectNetwork: this.state.settings.networkRequests,
      collectStyles: this.state.settings.computedStyles,
      collectSourceHints: this.state.settings.sourceHints,
    });
  }

  // ponytail: reload page via Playwright and re-inject overlay
  private async handleOverlayReload(res: http.ServerResponse): Promise<void> {
    try {
      const reloadResult = await this.vce.reloadPage();
      if (!reloadResult.ok) {
        res.end(JSON.stringify({ ok: false, error: reloadResult.error.message }));
        return;
      }
      // Re-inject overlay after reload
      const overlayScript = getOverlayScript();
      const injectResult = await this.vce
        .getBrowserRuntime()
        ?.injectOverlay({ contextId: 'default' }, overlayScript);
      this.broadcastToWs({ type: 'overlay:injected' });
      res.end(JSON.stringify({ ok: true, reInjected: injectResult?.ok ?? false }));
    } catch (error) {
      res.end(JSON.stringify({ ok: false, error: String(error) }));
    }
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
import type { SelectionEngine as SelectionEngineType } from '@viskod/selection-engine';
import { SelectionEngine } from '@viskod/selection-engine';

const eventBus = new EventBus({ enableHistory: true, historySize: 50 });
const browserRuntime = new BrowserRuntime(eventBus);
const capturePipeline = new CapturePipeline();
const selectionEngine: SelectionEngineType = new SelectionEngine(eventBus, browserRuntime);

const vce = new VisualContextEngine({
  browserRuntime,
  eventBus,
  capturePipeline,
  selectionEngine,
});

const studio = new Studio(vce, eventBus, selectionEngine);
void studio.start();
