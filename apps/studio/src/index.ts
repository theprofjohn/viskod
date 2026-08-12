import http from 'node:http';
import { UserFacingHandoff } from '@viskod/agent-handoff';
import { HandoffServiceImpl } from '@viskod/agent-handoff';
import type { BrowserHandle } from '@viskod/browser-runtime';
import { VisualContextEngine } from '@viskod/context-engine';
import type { ContextPacket, SelectionTarget } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { getOverlayScript } from '@viskod/overlay-system';
import { ErrorCategory, ErrorSeverity, type Result, type ViskodError, err } from '@viskod/shared';
import { IssueServiceImpl } from '@viskod/visual-issue';
import type { RecaptureOptions, RecaptureResult } from '@viskod/visual-review';
import { ReviewServiceImpl } from '@viskod/visual-review';
import { UserFacingReview } from '@viskod/visual-review';
import { SelectionOverlayController, VisualSelectionServiceImpl } from '@viskod/visual-selection';
import type { BrowserIntegration } from '@viskod/visual-selection';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { renderStudioHtml } from './ui';
import { StudioWorkflow } from './workflow';
import type { StudioWorkflowState } from './workflow';

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

// Workflow request validation at the HTTP boundary.
const WorkflowIssueSchema = z.object({
  problem: z.string().min(1).max(2000),
  expected: z.string().min(1).max(2000),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});
const WorkflowHandoffSchema = z.object({
  issueId: z.string().min(1),
});
const WorkflowVerifyStartSchema = z.object({
  issueId: z.string().min(1),
  handoffId: z.string().optional(),
});
const WorkflowVerifyRecaptureSchema = z.object({
  reviewId: z.string().min(1),
});
const WorkflowDecisionSchema = z.object({
  reviewId: z.string().min(1),
  decision: z.enum(['accepted', 'rejected', 'needs_follow_up']),
  note: z.string().max(2000).optional(),
});

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
  /** Opaque page id for the current workflow page (never exposed raw). */
  pageId: string | null;
  pageUrl: string | null;
  /** Sanitized user-facing workflow state (never contains selectors/packets/paths). */
  workflow: StudioWorkflowState;
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

  // User-facing workflow services (same default local persistence as the
  // package services; no cloud storage).
  private visualSelectionService: VisualSelectionServiceImpl;
  private issueService: IssueServiceImpl;
  private handoffService: HandoffServiceImpl;
  private reviewService: ReviewServiceImpl;
  private userFacingHandoff: UserFacingHandoff;
  private userFacingReview: UserFacingReview;
  private controller: SelectionOverlayController | null = null;
  private workflow: StudioWorkflow | null = null;
  private browserHandle: BrowserHandle | null = null;
  private pageId: string | null = null;
  private sessionId = crypto.randomUUID();

  constructor(
    vce: VisualContextEngine,
    eventBus: EventBus,
    selectionEngine?: Studio['selectionEngine'],
  ) {
    this.vce = vce;
    this.eventBus = eventBus;
    this.selectionEngine = selectionEngine;

    this.visualSelectionService = new VisualSelectionServiceImpl(eventBus);
    this.issueService = new IssueServiceImpl(eventBus);
    this.handoffService = new HandoffServiceImpl(eventBus, this.issueService);
    this.reviewService = new ReviewServiceImpl(
      eventBus,
      this.issueService,
      this.handoffService,
      undefined,
      (options) => this.recaptureViaVce(options),
    );
    this.userFacingHandoff = new UserFacingHandoff(this.handoffService);
    this.userFacingReview = new UserFacingReview(this.reviewService);

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
      pageId: null,
      pageUrl: null,
      workflow: { stage: 'idle', selection: null },
    };
    this.syncCaptureProfile();

    this.eventBus.subscribe('BR_EVENT:BROWSER_STARTED', () => {
      this.state.browserConnected = true;
      this.broadcastStudioState();
    });

    this.eventBus.subscribe('VS_EVENT:SELECTION_CREATED', () => {
      void this.workflow?.refreshSelection().then(() => this.broadcastStudioState());
    });

    this.eventBus.subscribe('VS_EVENT:SELECTION_CLEARED', () => {
      this.broadcastStudioState();
    });

    this.eventBus.subscribe('VI_EVENT:ISSUE_CREATED', () => {
      this.broadcastStudioState();
    });

    this.eventBus.subscribe('AH_EVENT:HANDOFF_CREATED', () => {
      this.broadcastStudioState();
    });

    this.eventBus.subscribe('VR_EVENT:REVIEW_CREATED', () => {
      this.broadcastStudioState();
    });

    this.eventBus.subscribe('VR_EVENT:RECAPTURED', () => {
      this.broadcastStudioState();
    });

    this.eventBus.subscribe('VR_EVENT:DECISION_RECORDED', () => {
      this.broadcastStudioState();
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
      this.browserHandle = result.value;
    }

    this.server = this.createServer();
    this.server.listen(3001, () => {
      console.log('Viskod Studio running on http://localhost:3001');
    });

    // WebSocket server for Chrome extension chat — same port as HTTP
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on('connection', (ws) => {
      ws.send(
        JSON.stringify({
          type: 'studio:state',
          state: {
            browserConnected: this.browserConnected,
            pageId: this.pageId,
            pageUrl: this.state.pageUrl,
            workflow: this.getWorkflowState(),
          },
        }),
      );
      ws.on('close', () => this.wsClients.delete(ws));
      ws.on('error', () => this.wsClients.delete(ws));
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as Record<string, unknown>;
          if (msg.type === 'chat:send' && typeof msg.text === 'string' && msg.text.trim()) {
            const chatMsg = this.addChatMessage('user', msg.text.trim());
            this.broadcastToWs({ type: 'chat:message', ...chatMsg });
          } else if (msg.type === 'overlay:event' && msg.data) {
            // forward overlay events to event bus for capture pipeline
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
            // update user toggle settings
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

  /**
   * HTTP handler factory; extracted so route-level tests can serve without
   * launching a browser.
   */
  createServer(): http.Server {
    return http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url ?? '/';

      if (url === '/' && req.method === 'GET') {
        // Human-facing Studio UI
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(renderStudioHtml());
      } else if (url === '/state') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ...this.state, workflow: this.getWorkflowState() }));
      } else if (url === '/navigate' && req.method === 'POST') {
        void this.handleNavigate(req, res);
      } else if (url === '/workflow/report/start' && req.method === 'POST') {
        void this.handleWorkflowReportStart(res);
      } else if (url === '/workflow/state' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(this.getWorkflowState()));
      } else if (url === '/workflow/selection/accept' && req.method === 'POST') {
        void this.handleWorkflowSelectionAccept(res);
      } else if (url === '/workflow/issue' && req.method === 'POST') {
        void this.handleWorkflowIssue(req, res);
      } else if (url === '/workflow/handoff' && req.method === 'POST') {
        void this.handleWorkflowHandoff(req, res);
      } else if (url === '/workflow/verify/start' && req.method === 'POST') {
        void this.handleWorkflowVerifyStart(req, res);
      } else if (url === '/workflow/verify/recapture' && req.method === 'POST') {
        void this.handleWorkflowVerifyRecapture(req, res);
      } else if (url === '/workflow/decision' && req.method === 'POST') {
        void this.handleWorkflowDecision(req, res);
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
        // serve overlay script to extension for re-injection after reload
        const script = getOverlayScript();
        res.setHeader('Content-Type', 'application/javascript');
        res.end(script);
      } else if (url === '/overlay/reload' && req.method === 'POST') {
        // reload page via Playwright and re-inject overlay
        void this.handleOverlayReload(res);
      } else if (url.startsWith('/setup/mcp-config')) {
        // return MCP config JSON for the user's IDE onboarding
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
  }

  private async handleNavigate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    try {
      const { url } = JSON.parse(body);
      const result = await this.vce.navigate(url);
      if (result.ok) {
        this.setupPageWorkflow(url);
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify(
          result.ok
            ? { ok: true, pageId: this.pageId }
            : { ok: false, error: result.error.message },
        ),
      );
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
  }

  /** Create a fresh opaque pageId + overlay controller + workflow per navigation. */
  private setupPageWorkflow(url: string): void {
    if (this.controller) {
      void this.controller.exitSelectionMode().catch(() => undefined);
    }
    this.workflow?.reset();
    this.pageId = crypto.randomUUID();
    this.state.pageId = this.pageId;
    this.state.pageUrl = url;
    this.state.currentSelection = null;

    this.controller = new SelectionOverlayController({
      pageId: this.pageId,
      sessionId: this.sessionId,
      browser: this.createBrowserIntegration(),
      service: this.visualSelectionService,
      overlayScript: getOverlayScript(),
    });

    this.workflow = new StudioWorkflow({
      pageId: this.pageId,
      sessionId: this.sessionId,
      controller: this.controller,
      vce: this.vce,
      issueService: this.issueService,
      userFacingHandoff: this.userFacingHandoff,
      userFacingReview: this.userFacingReview,
      reviewService: this.reviewService,
    });
    this.vce.setOverlayEventsDelegated(true);
    this.broadcastStudioState();
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

  // ---------------------------------------------------------------------------
  // Workflow HTTP handlers (Zod-validated at the boundary; structured recovery)
  // ---------------------------------------------------------------------------

  private async handleWorkflowReportStart(res: http.ServerResponse): Promise<void> {
    const workflow = this.requireWorkflow(res);
    if (!workflow) return;
    await this.respondWorkflow(res, workflow.beginReport());
  }

  private async handleWorkflowSelectionAccept(res: http.ServerResponse): Promise<void> {
    const workflow = this.requireWorkflow(res);
    if (!workflow) return;
    await this.respondWorkflow(res, workflow.acceptSelection());
  }

  private async handleWorkflowIssue(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    let parsed: z.infer<typeof WorkflowIssueSchema>;
    try {
      const candidate = WorkflowIssueSchema.safeParse(JSON.parse(body));
      if (!candidate.success) {
        this.sendBadRequest(res, 'Both "What is wrong?" and "What should happen?" are required.');
        return;
      }
      parsed = candidate.data;
    } catch {
      this.sendBadRequest(res, 'Invalid request body');
      return;
    }
    const workflow = this.requireWorkflow(res);
    if (!workflow) return;
    await this.respondWorkflow(res, workflow.createIssue(parsed));
  }

  private async handleWorkflowHandoff(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    let issueId: string;
    try {
      const candidate = WorkflowHandoffSchema.safeParse(JSON.parse(body));
      if (!candidate.success) {
        this.sendBadRequest(res, 'issueId is required');
        return;
      }
      issueId = candidate.data.issueId;
    } catch {
      this.sendBadRequest(res, 'Invalid request body');
      return;
    }
    const workflow = this.requireWorkflow(res);
    if (!workflow) return;
    if (workflow.getState().issueId !== issueId) {
      this.sendConflict(res, 'Create the issue first.');
      return;
    }
    await this.respondWorkflow(res, workflow.prepareAgent());
  }

  private async handleWorkflowVerifyStart(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    let issueId: string;
    try {
      const candidate = WorkflowVerifyStartSchema.safeParse(JSON.parse(body));
      if (!candidate.success) {
        this.sendBadRequest(res, 'issueId is required');
        return;
      }
      issueId = candidate.data.issueId;
    } catch {
      this.sendBadRequest(res, 'Invalid request body');
      return;
    }
    const workflow = this.requireWorkflow(res);
    if (!workflow) return;
    if (workflow.getState().issueId !== issueId) {
      this.sendConflict(res, 'Create the issue first.');
      return;
    }
    await this.respondWorkflow(res, workflow.startVerification());
  }

  private async handleWorkflowVerifyRecapture(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    let reviewId: string;
    try {
      const candidate = WorkflowVerifyRecaptureSchema.safeParse(JSON.parse(body));
      if (!candidate.success) {
        this.sendBadRequest(res, 'reviewId is required');
        return;
      }
      reviewId = candidate.data.reviewId;
    } catch {
      this.sendBadRequest(res, 'Invalid request body');
      return;
    }
    const workflow = this.requireWorkflow(res);
    if (!workflow) return;
    if (workflow.getState().reviewId !== reviewId) {
      this.sendConflict(res, 'Start verification first.');
      return;
    }
    await this.respondWorkflow(res, workflow.recaptureVerification());
  }

  private async handleWorkflowDecision(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    let parsed: z.infer<typeof WorkflowDecisionSchema>;
    try {
      const candidate = WorkflowDecisionSchema.safeParse(JSON.parse(body));
      if (!candidate.success) {
        this.sendBadRequest(res, 'reviewId and decision are required');
        return;
      }
      parsed = candidate.data;
    } catch {
      this.sendBadRequest(res, 'Invalid request body');
      return;
    }
    const workflow = this.requireWorkflow(res);
    if (!workflow) return;
    if (workflow.getState().reviewId !== parsed.reviewId) {
      this.sendConflict(res, 'Start verification first.');
      return;
    }
    await this.respondWorkflow(res, workflow.decide(parsed.decision, parsed.note));
  }

  private requireWorkflow(res: http.ServerResponse): StudioWorkflow | null {
    if (!this.workflow) {
      this.sendConflict(res, 'Open the app first.');
      return null;
    }
    return this.workflow;
  }

  private async respondWorkflow(
    res: http.ServerResponse,
    promise: Promise<Result<StudioWorkflowState>>,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    const result = await promise;
    if (result.ok) {
      res.end(JSON.stringify({ ok: true, state: result.value }));
      this.broadcastStudioState();
      return;
    }
    this.sendConflict(res, result.error.message);
  }

  private sendBadRequest(res: http.ServerResponse, message: string): void {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: message }));
  }

  private sendConflict(res: http.ServerResponse, message: string): void {
    res.statusCode = 409;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: message }));
  }

  /** Sanitized workflow state for the UI — never selectors, packets, paths, or secrets. */
  getWorkflowState(): StudioWorkflowState {
    return this.workflow?.getState() ?? { stage: 'idle', selection: null };
  }

  private broadcastStudioState(): void {
    this.broadcastToWs({
      type: 'studio:state',
      state: {
        browserConnected: this.browserConnected,
        pageId: this.pageId,
        pageUrl: this.state.pageUrl,
        workflow: this.getWorkflowState(),
      },
    });
  }

  /**
   * BrowserIntegration adapter over the public BrowserRuntime methods using
   * the retained handle; overlay logic is never duplicated in Studio.
   */
  private createBrowserIntegration(): BrowserIntegration {
    const runtime = this.vce.getBrowserRuntime();
    const eventBus = this.eventBus;
    const getHandle = (): BrowserHandle | null => this.browserHandle;
    const noHandle = (): ViskodError => ({
      code: 'BR_HANDLE_INVALID',
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message: 'Browser not connected',
      correlationId: crypto.randomUUID(),
      subsystem: 'studio',
      timestamp: new Date().toISOString(),
    });
    return {
      async showOverlaySelectionMode(overlayScript) {
        const h = getHandle();
        if (!h) return err(noHandle());
        return runtime.showOverlaySelectionMode(h, overlayScript);
      },
      async hideOverlaySelectionMode() {
        const h = getHandle();
        if (!h) return err(noHandle());
        return runtime.hideOverlaySelectionMode(h);
      },
      async injectOverlay(overlayScript) {
        const h = getHandle();
        if (!h) return err(noHandle());
        return runtime.injectOverlay(h, overlayScript);
      },
      async removeOverlay() {
        const h = getHandle();
        if (!h) return err(noHandle());
        return runtime.removeOverlay(h);
      },
      async setupMessageListener() {
        const h = getHandle();
        if (!h) return err(noHandle());
        return runtime.setupOverlayMessageListener(h, eventBus);
      },
      async pollOverlayEvent() {
        const h = getHandle();
        if (!h) return err(noHandle());
        return runtime.pollOverlayEvent(h);
      },
      async getPageUrl() {
        const h = getHandle();
        return h ? runtime.getPageUrl(h) : '';
      },
      async getPageTitle() {
        const h = getHandle();
        return h ? runtime.getPageTitle(h) : '';
      },
      async getViewport() {
        const h = getHandle();
        if (!h) return { width: 0, height: 0, deviceScaleFactor: 1, scrollX: 0, scrollY: 0 };
        return runtime.getViewport(h);
      },
      async getElementInfoAtPoint(x, y) {
        const h = getHandle();
        if (!h) return err(noHandle());
        return runtime.getElementInfoAtPoint(h, x, y);
      },
      async evaluate(fn, arg) {
        const h = getHandle();
        if (!h) throw new Error('Browser not connected');
        return runtime.evaluate(h, fn, arg);
      },
    };
  }

  /**
   * Review recapture adapter: resolves the target from the persisted
   * selection snapshot (ReviewServiceImpl passes the resolved selector),
   * captures through VCE, and maps the packet into RecaptureResult. Returns
   * null when the target cannot be resolved so RECAPTURE_FAILED is exercised.
   */
  private async recaptureViaVce(options: RecaptureOptions): Promise<RecaptureResult | null> {
    if (!this.browserHandle) return null;

    if (options.reload || options.cacheBust) {
      if (options.cacheBust && options.url) {
        try {
          const target = new URL(options.url);
          target.searchParams.set('__viskod_cb', String(Date.now()));
          const nav = await this.vce.navigate(target.toString());
          if (!nav.ok) return null;
        } catch {
          return null;
        }
      } else {
        const reload = await this.vce.reloadPage();
        if (!reload.ok) return null;
      }
    }

    const selector = options.selector;
    if (!selector) return null;

    const capture = await this.vce.generatePacket({
      selector,
      boundingBox: options.boundingBox ?? { x: 0, y: 0, width: 100, height: 100 },
      source: 'studio',
    });
    if (!capture.ok) return null;

    const packet = capture.value;
    return {
      packetId: packet.packetId,
      selector,
      tagName: packet.dom.tagName,
      boundingBox: packet.selection.boundingBox,
      text: packet.selection.text,
      url: packet.browser.url,
      viewport: packet.browser.viewport,
      screenshotPath: packet.screenshots[0]?.path,
      sourceHints: packet.sourceHints.map((hint) => ({
        filePath: hint.filePath,
        confidence: hint.confidence,
        evidence: hint.evidence,
      })),
      consoleEvidence: packet.runtimeEvidence?.console?.map((e) => ({
        level: e.level,
        text: e.message,
      })),
      networkEvidence: packet.runtimeEvidence?.network?.map((e) => ({
        url: e.request.url,
        method: e.request.method,
        status: e.response?.status,
      })),
    };
  }

  // chat — agent ↔ extension message passing via HTTP + WebSocket
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

  // reload page via Playwright and re-inject overlay
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
    if (this.controller) {
      await this.controller.exitSelectionMode().catch(() => undefined);
    }
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
