import * as fs from 'node:fs';
import http from 'node:http';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UserFacingHandoff } from '@viskod/agent-handoff';
import { HandoffServiceImpl } from '@viskod/agent-handoff';
import type { BrowserHandle } from '@viskod/browser-runtime';
import { VisualContextEngine } from '@viskod/context-engine';
import type { ContextPacket, SelectionTarget } from '@viskod/context-engine';
import { EventBus } from '@viskod/event-bus';
import { getOverlayScript } from '@viskod/overlay-system';
import { getMcpServeCommand, getSetupState } from '@viskod/setup';
import {
  FeedbackPersistence,
  collectFeedback,
  createDiagnosticSummary,
  generateFeedbackMarkdownReport,
} from '@viskod/shared';
import {
  ErrorCategory,
  ErrorSeverity,
  type Result,
  SETTINGS_FILE,
  VISKOD_STORAGE_DIR,
  type ViskodError,
  err,
  ok,
  sanitizeErrorDetail,
} from '@viskod/shared';
import { IssueServiceImpl } from '@viskod/visual-issue';
import type { RecaptureOptions, RecaptureResult } from '@viskod/visual-review';
import {
  ARTIFACT_ID_PATTERN,
  ReviewArtifactStore,
  ReviewServiceImpl,
  UserFacingReview,
} from '@viskod/visual-review';
import type { VisualArtifactPolicy } from '@viskod/visual-review';

declare const __VISKOD_VERSION__: string | undefined;
const VISKOD_VERSION = typeof __VISKOD_VERSION__ !== 'undefined' ? __VISKOD_VERSION__ : '0.0.0-dev';
import { SelectionOverlayController, VisualSelectionServiceImpl } from '@viskod/visual-selection';
import type { BrowserIntegration } from '@viskod/visual-selection';
import { chromium } from 'playwright';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import {
  MAX_STUDIO_JSON_BODY_BYTES,
  isAllowedStudioOrigin,
  rejectOversizedBody,
} from './request-security';
import { renderStudioHtml } from './ui';
import type { StudioSetupStatus } from './ui';
import { StudioWorkflow } from './workflow';
export {
  MAX_STUDIO_JSON_BODY_BYTES,
  MAX_STUDIO_TEXT_BODY_BYTES,
  isAllowedStudioOrigin,
} from './request-security';
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
  /**
   * Phase 31: local-sensitive visual review artifact policy. Default
   * `disabled` follows the Phase 29 privacy stance — target screenshots are
   * only stored after explicit Studio-level opt-in, and even then they are
   * NEVER part of the agent-safe packet or handoff context.
   */
  visualReviewArtifacts: 'disabled' | 'local-sensitive-target-crop';
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
  visualReviewArtifacts: 'disabled',
};

/** Studio is a local developer tool: always loopback, never all interfaces. */
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;
export interface StudioOptions {
  /** Loopback bind host. Defaults to 127.0.0.1. */
  host?: string;
  /** Listen port. Defaults to 3001. */
  port?: number;
}

const WorkflowIssueSchema = z.object({
  problem: z.string().trim().min(1),
  expected: z.string().trim().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
});
const WorkflowHandoffSchema = z.object({
  issueId: z.string().min(1),
});
const WorkflowVerifyStartSchema = z.object({
  issueId: z.string().min(1),
  handoffId: z.string().min(1).optional(),
});
const WorkflowVerifyRecaptureSchema = z.object({
  reviewId: z.string().min(1),
});
const WorkflowDecisionSchema = z.object({
  reviewId: z.string().min(1),
  decision: z.enum(['accepted', 'rejected', 'needs_follow_up']),
  note: z.string().max(2000).optional(),
});
const FeedbackRequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  category: z.enum([
    'workflow',
    'target-selection',
    'source-resolution',
    'agent-handoff',
    'verification',
    'setup-runtime',
    'accessibility',
    'documentation',
    'feature-request',
    'other',
  ]),
  usefulness: z.enum(['yes', 'partly', 'no']).optional(),
  reasons: z
    .array(
      z.enum([
        'wrong-target',
        'source-hint-not-useful',
        'missing-context',
        'agent-misunderstood-handoff',
        'verification-not-useful',
        'workflow-confusing',
        'other',
      ]),
    )
    .max(7)
    .optional(),
  note: z.string().max(4000).default(''),
  diagnosticsIncluded: z.boolean().default(false),
});
const IssueEditSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(4000).optional(),
  expectedResult: z.string().max(4000).optional(),
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
  /**
   * Phase 30 project status: source resolution is available only when the
   * project root was EXPLICITLY configured and scanned. Never guessed.
   * User-facing: project name/framework, never the absolute root path.
   *
   * Phase 33A status additions (minimal safe surface):
   * - `workspace`: single-package vs workspace + workspace package count
   * - `scan`: source scan ready / refreshing / unavailable
   * - `budgetExceeded`: true when the last source resolution hit its budget
   * No absolute paths and no repository explorer are ever exposed.
   */
  project: {
    status: 'ready' | 'invalid' | 'unknown';
    name?: string;
    framework?: string;
    routeCount?: number;
    reason?: string;
    workspace?: { isWorkspace: boolean; packageCount: number } | null;
    scan?: 'ready' | 'refreshing' | 'unavailable';
    budgetExceeded?: boolean;
  };
  /**
   * Phase 32: truthful first-run/setup status. Loaded from the persisted
   * @viskod/setup state at startup and re-loaded on demand (/setup/status);
   * never absolute paths. `stale` marks a persisted complete/limited state
   * whose live light health check (Chromium present) is currently failing.
   */
  setup: StudioSetupStatus;
}

export type StudioProjectStatus = StudioState['project'];

export interface StudioSourceStatus {
  resolution: 'resolved' | 'ambiguous' | 'unavailable';
  status: string;
  count: number;
  candidates: Array<{
    path: string;
    qualification: 'exact' | 'probable' | 'possible' | 'weak';
    confidence: number;
    reasons: string[];
  }>;
}

export class Studio {
  private eventBus: EventBus;
  private vce: VisualContextEngine;
  private selectionEngine?: {
    resolveTarget: (event: {
      selector: string;
      boundingBox?: { x: number; y: number; width: number; height: number };
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
  private host: string;
  private port: number;
  private shuttingDown = false;

  // User-facing workflow services (same default local persistence as the
  // package services; no cloud storage).
  private visualSelectionService: VisualSelectionServiceImpl;
  private issueService: IssueServiceImpl;
  private handoffService: HandoffServiceImpl;
  private reviewService: ReviewServiceImpl;
  private artifactStore: ReviewArtifactStore;
  /** True once the one-time visual-review consent was answered (settings file exists). */
  private visualReviewPolicyAsked = false;
  private userFacingHandoff: UserFacingHandoff;
  private userFacingReview: UserFacingReview;
  private controller: SelectionOverlayController | null = null;
  private controllerTeardown: Promise<void> | null = null;
  private workflow: StudioWorkflow | null = null;
  private browserHandle: BrowserHandle | null = null;
  private feedbackPersistence: FeedbackPersistence;
  private pageId: string | null = null;
  private sessionId = crypto.randomUUID();
  private pendingResumeIssueId?: string;
  private navigationInFlight: Promise<Result<void>> | null = null;
  private captureInFlight: Promise<Result<ContextPacket>> | null = null;
  private recaptureInFlight: Promise<RecaptureResult | null> | null = null;

  constructor(
    vce: VisualContextEngine,
    eventBus: EventBus,
    selectionEngine?: Studio['selectionEngine'],
    options: StudioOptions = {},
  ) {
    this.vce = vce;
    this.eventBus = eventBus;
    this.selectionEngine = selectionEngine;
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;

    this.visualSelectionService = new VisualSelectionServiceImpl(eventBus);
    this.issueService = new IssueServiceImpl(eventBus);
    this.handoffService = new HandoffServiceImpl(eventBus, this.issueService);
    // Phase 31: local-sensitive review artifacts. The policy is persisted in
    // `.viskod/settings.json` (smallest settings mechanism) and defaults to
    // disabled — the Phase 29 privacy stance. Artifacts never enter the
    // agent-safe packet or handoff context.
    this.artifactStore = new ReviewArtifactStore();
    const persistedPolicy = loadVisualReviewPolicy();
    this.artifactStore.setPolicy(persistedPolicy);
    this.visualReviewPolicyAsked = fs.existsSync(visualReviewPolicyFilePath());
    this.reviewService = new ReviewServiceImpl(
      eventBus,
      this.issueService,
      this.handoffService,
      undefined,
      (options) => this.recaptureViaVce(options),
      this.artifactStore,
    );
    this.userFacingHandoff = new UserFacingHandoff(this.handoffService);
    this.userFacingReview = new UserFacingReview(this.reviewService);
    this.feedbackPersistence = new FeedbackPersistence(resolveStudioProjectRoot() ?? process.cwd());

    this.state = {
      activePanel: 'browser-session',
      currentPacket: null,
      currentSelection: null,
      isSelecting: false,
      browserConnected: false,
      vceConnected: true,
      errors: [],
      chatMessages: [],
      settings: { ...DEFAULT_SETTINGS, visualReviewArtifacts: persistedPolicy },
      pageId: null,
      pageUrl: null,
      workflow: { stage: 'idle', selection: null },
      project: { status: 'unknown' },
      setup: { status: 'never', browserVerified: false, stale: false },
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
    this.eventBus.subscribe('VI_EVENT:ISSUE_UPDATED', () => {
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

  /**
   * Start the browser and bind the HTTP + WebSocket servers on loopback.
   * Resolves only after both listeners are actually accepting connections.
   * Listen failures (e.g. EADDRINUSE) release the browser and return a
   * controlled error instead of crashing with an unhandled 'error' event.
   */
  async start(): Promise<Result<void>> {
    const result = await this.vce.start();
    if (result.ok) {
      this.browserConnected = true;
      this.browserHandle = result.value;
    }

    this.server = this.createServer();
    this.wss = new WebSocketServer({
      server: this.server,
      maxPayload: MAX_STUDIO_JSON_BODY_BYTES,
    });
    this.wss.on('connection', (ws, req) => this.handleWsConnection(ws, req));
    // The WebSocketServer re-emits HTTP server errors (including EADDRINUSE)
    // on itself; a permanent handler keeps them from becoming unhandled
    // 'error' crashes. The start-time rejection comes from the listeners
    this.wss.on('error', (error) => {
      console.error(`Viskod Studio WebSocket error: ${error.message}`);
    });
    // Keep a permanent error handler: post-startup server socket errors must
    // not become unhandled 'error' crashes.
    this.server.on('error', (error) => {
      console.error(`Viskod Studio server error: ${error.message}`);
    });

    const listeningServer = this.server;
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (error: Error): void => {
          listeningServer.off('listening', onListening);
          rejectListen(error);
        };
        const onListening = (): void => {
          listeningServer.off('error', onError);
          resolveListen();
        };
        listeningServer.once('error', onError);
        listeningServer.once('listening', onListening);
        listeningServer.listen(this.port, this.host);
      });
    } catch (error) {
      await this.releaseStartupResources();
      return err(this.listenError(error));
    }

    const address = listeningServer.address();
    const boundPort = address && typeof address === 'object' ? address.port : this.port;
    console.log(`Viskod Studio running on http://${this.host}:${boundPort}`);
    return ok(undefined);
  }

  /** Navigate the managed browser and initialize the selection workflow. */
  async navigate(url: string): Promise<Result<void>> {
    const result = await this.vce.navigate(url);
    if (result.ok) this.setupPageWorkflow(url);
    return result;
  }

  /** Close sockets created by a failed start so nothing leaks on EADDRINUSE. */
  private async releaseStartupResources(): Promise<void> {
    if (this.wss) {
      await new Promise<void>((resolveClose) => {
        this.wss?.close(() => resolveClose());
      });
      this.wss = null;
    }
    await this.closeHttpServer();
    await this.vce.stopBrowser();
  }

  private listenError(error: unknown): ViskodError {
    const code =
      error instanceof Error && error.message.includes('EADDRINUSE')
        ? 'STUDIO_PORT_IN_USE'
        : 'STUDIO_LISTEN_FAILED';
    const message =
      code === 'STUDIO_PORT_IN_USE'
        ? `Port ${this.port} is already in use. Stop the process using it, or configure Studio to use another port, then restart.`
        : `Studio failed to listen on ${this.host}:${this.port}: ${
            error instanceof Error ? error.message : String(error)
          }`;
    return {
      code,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.FATAL,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'studio',
      timestamp: new Date().toISOString(),
    };
  }

  private handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const origin = req.headers.origin;
    if (!isAllowedStudioOrigin(origin)) {
      // Foreign web pages must not be able to drive Studio over WebSocket.
      ws.close(1008, 'Origin not allowed');
      return;
    }
    this.wsClients.add(ws);
    ws.send(
      JSON.stringify({
        type: 'studio:state',
        state: {
          browserConnected: this.browserConnected,
          pageId: this.pageId,
          pageUrl: this.state.pageUrl,
          workflow: this.getWorkflowState(),
          setup: this.state.setup,
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
  }

  /**
   * HTTP handler factory; extracted so route-level tests can serve without
   * launching a browser.
   */
  createServer(): http.Server {
    return http.createServer((req, res) => {
      // Local control boundary: arbitrary web origins must never drive
      // Studio. Non-browser local clients (no Origin) and loopback or
      // extension origins pass; everything else is refused before routing.
      const origin = req.headers.origin;
      if (!isAllowedStudioOrigin(origin)) {
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Forbidden origin' }));
        return;
      }

      // CORS only for allowed origins (loopback pages and the extension);
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      }
      if (rejectOversizedBody(req, res)) return;

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      this.routeHttpRequest(req, res);
    });
  }

  private routeHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/';
    const pathname = new URL(url, 'http://127.0.0.1').pathname;
    if (url === '/feedback' && req.method === 'POST') {
      void this.handleFeedback(req, res);
    } else if (url === '/feedback/preview' && req.method === 'POST') {
      void this.handleFeedbackPreview(req, res);
    } else if (url === '/feedback' && req.method === 'GET') {
      void this.handleFeedbackHistory(res);
    } else if (url === '/' && req.method === 'GET') {
      // Human-facing Studio UI
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderStudioHtml());
    } else if (url === '/state') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...this.state, workflow: this.getWorkflowState() }));
    } else if (pathname === '/issues' && req.method === 'GET') {
      void this.handleIssueHistory(req, res);
    } else if (pathname.startsWith('/issues/') && req.method === 'GET') {
      void this.handleIssueDetail(pathname, res);
    } else if (
      pathname.startsWith('/issues/') &&
      pathname.endsWith('/edit') &&
      req.method === 'POST'
    ) {
      void this.handleIssueEdit(pathname, req, res);
    } else if (
      pathname.startsWith('/issues/') &&
      pathname.endsWith('/archive') &&
      req.method === 'POST'
    ) {
      void this.handleIssueLifecycle(pathname, 'archive', res);
    } else if (
      pathname.startsWith('/issues/') &&
      pathname.endsWith('/reopen') &&
      req.method === 'POST'
    ) {
      void this.handleIssueLifecycle(pathname, 'reopen', res);
    } else if (
      pathname.startsWith('/issues/') &&
      pathname.endsWith('/fork') &&
      req.method === 'POST'
    ) {
      void this.handleIssueFork(pathname, req, res);
    } else if (
      pathname.startsWith('/issues/') &&
      pathname.endsWith('/open') &&
      req.method === 'POST'
    ) {
      void this.handleIssueOpen(pathname, res);
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
    } else if (url === '/workflow/prepare' && req.method === 'POST') {
      void this.handleWorkflowPrepare(req, res);
    } else if (url === '/workflow/reselect' && req.method === 'POST') {
      void this.handleWorkflowReselect(res);
    } else if (url === '/workflow/cancel' && req.method === 'POST') {
      void this.handleWorkflowCancel(res);
    } else if (url === '/workflow/handoff' && req.method === 'POST') {
      void this.handleWorkflowHandoff(req, res);
    } else if (url === '/workflow/verify/start' && req.method === 'POST') {
      void this.handleWorkflowVerifyStart(req, res);
    } else if (url === '/workflow/verify/recapture' && req.method === 'POST') {
      void this.handleWorkflowVerifyRecapture(req, res);
    } else if (url === '/workflow/decision' && req.method === 'POST') {
      void this.handleWorkflowDecision(req, res);
    } else if (url === '/settings/visual-review-policy' && req.method === 'POST') {
      void this.handleVisualReviewPolicy(req, res);
    } else if (url.startsWith('/review/artifact/') && req.method === 'GET') {
      void this.handleReviewArtifact(req, res);
    } else if (url.startsWith('/review/') && req.method === 'GET') {
      void this.handleReviewGet(req, res);
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
    } else if (url === '/project/status') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(this.state.project));
    } else if (url === '/source/status') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(this.getSourceStatus()));
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
          project: this.state.project,
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
    } else if (url === '/setup/status') {
      // Phase 32 light health: cheap enough for polling. Re-loads the
      // persisted setup state on demand; never runs full setup validation
      // and never launches a browser.
      this.refreshSetupStatus(resolveStudioProjectRoot());
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(this.setupStatusPayload()));
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
  }
  private feedbackDiagnostics() {
    const workflow = this.getWorkflowState();
    const source = workflow.source;
    const setup = this.state.setup;
    return createDiagnosticSummary({
      viskodVersion: VISKOD_VERSION,
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      setupState:
        setup.status === 'complete'
          ? 'complete'
          : setup.status === 'limited'
            ? 'limited'
            : setup.status === 'incomplete'
              ? 'failed'
              : 'unknown',
      mcpRuntime: 'unknown' as const,
      browserRuntime: this.browserConnected ? ('verified' as const) : ('unavailable' as const),
      projectMode: this.state.project.workspace?.isWorkspace
        ? ('workspace' as const)
        : this.state.project.status === 'ready'
          ? ('single-package' as const)
          : ('unavailable' as const),
      workspacePackageCount: this.state.project.workspace?.packageCount ?? 0,
      workflowStage: workflow.stage,
      sourceResolutionStatus: source?.resolution ?? 'unavailable',
      topSourceQualification: source?.candidates[0]?.qualification ?? 'unavailable',
      visualReviewStatus: workflow.review?.decision ? ('resolved' as const) : ('unknown' as const),
      errorCodes: this.state.errors
        .slice(-20)
        .map((error) => error.subsystem)
        .filter(Boolean),
      studioHealth: 'running' as const,
    });
  }

  private async handleFeedback(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const parsed = FeedbackRequestSchema.parse(JSON.parse(await this.readBody(req)));
      const artifact = collectFeedback({
        ...parsed,
        requestId: parsed.requestId ?? crypto.randomUUID(),
        diagnosticsIncluded: parsed.diagnosticsIncluded,
        ...(parsed.diagnosticsIncluded ? { diagnostics: this.feedbackDiagnostics() } : {}),
        ...(this.workflow?.getState().issueId ? { issueId: this.workflow.getState().issueId } : {}),
        ...(this.workflow?.getState().handoffId
          ? { handoffId: this.workflow.getState().handoffId }
          : {}),
        ...(this.workflow?.getState().reviewId
          ? { reviewId: this.workflow.getState().reviewId }
          : {}),
      });
      const saved = await this.feedbackPersistence.save(artifact);
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          ok: true,
          artifact: saved,
          markdown: generateFeedbackMarkdownReport(saved),
        }),
      );
    } catch (error) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'Invalid feedback',
        }),
      );
    }
  }

  private async handleFeedbackPreview(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const parsed = FeedbackRequestSchema.parse(JSON.parse(await this.readBody(req)));
      const artifact = collectFeedback({
        ...parsed,
        requestId: parsed.requestId ?? crypto.randomUUID(),
        ...(parsed.diagnosticsIncluded ? { diagnostics: this.feedbackDiagnostics() } : {}),
      });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, markdown: generateFeedbackMarkdownReport(artifact) }));
    } catch (error) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : 'Invalid feedback',
        }),
      );
    }
  }
  private async handleFeedbackHistory(res: http.ServerResponse): Promise<void> {
    const records = await this.feedbackPersistence.list();
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        feedback: records.slice(0, 50).map((item) => ({
          feedbackId: item.feedbackId,
          createdAt: item.createdAt,
          category: item.category,
          usefulness: item.usefulness,
        })),
      }),
    );
  }

  private issueIdFromRoute(route: string, suffix = ''): string | null {
    const value = route.slice('/issues/'.length, suffix ? -suffix.length : undefined);
    return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
  }

  private async handleIssueHistory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const query = new URL(req.url ?? '/issues', 'http://127.0.0.1').searchParams;
    const includeArchived = query.get('archived') === 'true';
    const rawLimit = Number.parseInt(query.get('limit') ?? '50', 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
    const [issuesResult, handoffsResult, reviewsResult] = await Promise.all([
      this.issueService.listIssues(includeArchived, limit),
      this.handoffService.listHandoffs(),
      this.reviewService.listReviews(),
    ]);
    if (!issuesResult.ok || !handoffsResult.ok || !reviewsResult.ok) {
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, error: 'Issue history is temporarily unavailable.' }));
      return;
    }
    const handoffByIssue = new Map(handoffsResult.value.map((item) => [item.issueId, item]));
    const reviewByIssue = new Map(
      reviewsResult.value
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((item) => [item.issueId, item]),
    );
    const issues = issuesResult.value.map((issue) => ({
      issueId: issue.issueId,
      parentIssueId: issue.parentIssueId,
      rootIssueId: issue.rootIssueId ?? issue.issueId,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      severity: issue.severity,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      handoff: handoffByIssue.get(issue.issueId)
        ? { status: handoffByIssue.get(issue.issueId)?.status }
        : null,
      review: reviewByIssue.get(issue.issueId)
        ? {
            status: reviewByIssue.get(issue.issueId)?.status,
            comparisonStatus: reviewByIssue.get(issue.issueId)?.comparisonStatus,
          }
        : null,
    }));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, issues, limit }));
  }

  private async handleIssueDetail(route: string, res: http.ServerResponse): Promise<void> {
    const issueId = this.issueIdFromRoute(route);
    if (!issueId) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Issue not found' }));
      return;
    }
    const issueResult = await this.issueService.getIssue(issueId);
    if (!issueResult.ok) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Issue not found' }));
      return;
    }
    const [handoffs, reviews, baseline] = await Promise.all([
      this.handoffService.listHandoffs(),
      this.reviewService.listReviews(),
      this.artifactStore.loadBaseline(issueId),
    ]);
    const issue = issueResult.value;
    const detail = {
      issue: {
        issueId: issue.issueId,
        parentIssueId: issue.parentIssueId,
        rootIssueId: issue.rootIssueId ?? issue.issueId,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        severity: issue.severity,
        createdAt: issue.createdAt,
        expectedResult: issue.expectedResult,
        updatedAt: issue.updatedAt,
        archivedAt: issue.archivedAt,
        targetSummary: issue.targetSummary,
        page: { title: issue.page.title, route: issue.page.route },
        evidence: issue.evidence,
        lifecycle: issue.lifecycle.slice(-20),
      },
      handoffs: handoffs.ok
        ? handoffs.value.filter((item) => item.issueId === issueId).slice(0, 10)
        : [],
      reviews: reviews.ok
        ? reviews.value.filter((item) => item.issueId === issueId).slice(0, 10)
        : [],
      baselineAvailable: baseline.ok && baseline.value !== null,
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, ...detail }));
  }

  private async handleIssueEdit(
    route: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const issueId = this.issueIdFromRoute(route, '/edit');
    if (!issueId) return this.sendBadRequest(res, 'Invalid issue ID');
    const body = await this.readBody(req);
    let parsed: z.infer<typeof IssueEditSchema>;
    try {
      const candidate = IssueEditSchema.safeParse(JSON.parse(body));
      if (!candidate.success) return this.sendBadRequest(res, 'Invalid editable issue fields');
      parsed = candidate.data;
    } catch {
      return this.sendBadRequest(res, 'Invalid request body');
    }
    const result = await this.issueService.updateIssue(issueId, parsed);
    if (!result.ok) {
      res.statusCode = 409;
      res.end(JSON.stringify({ ok: false, error: result.error.message }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, issueId: result.value.issueId }));
  }

  private async handleIssueLifecycle(
    route: string,
    action: 'archive' | 'reopen',
    res: http.ServerResponse,
  ): Promise<void> {
    const issueId = this.issueIdFromRoute(route, `/${action}`);
    if (!issueId) return this.sendBadRequest(res, 'Invalid issue ID');
    const result =
      action === 'archive'
        ? await this.issueService.archiveIssue(issueId)
        : await this.issueService.reopenIssue(issueId);
    if (!result.ok) {
      res.statusCode = 409;
      res.end(JSON.stringify({ ok: false, error: result.error.message }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, issueId }));
  }

  private async handleIssueFork(
    route: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const issueId = this.issueIdFromRoute(route, '/fork');
    if (!issueId || !this.issueService.forkIssue) {
      this.sendBadRequest(res, 'Invalid issue ID');
      return;
    }
    const body = await this.readBody(req);
    let title: string | undefined;
    let requestId: string | undefined;
    try {
      const parsed = body ? (JSON.parse(body) as { title?: unknown; requestId?: unknown }) : {};
      if (parsed.title !== undefined && typeof parsed.title !== 'string') {
        this.sendBadRequest(res, 'Invalid fork title');
        return;
      }
      if (parsed.requestId !== undefined && typeof parsed.requestId !== 'string') {
        this.sendBadRequest(res, 'Invalid fork request ID');
        return;
      }
      title = parsed.title;
      requestId = parsed.requestId;
    } catch {
      this.sendBadRequest(res, 'Invalid request body');
      return;
    }
    const result = await this.issueService.forkIssue(issueId, title, requestId);
    if (!result.ok) {
      res.statusCode = 409;
      res.end(JSON.stringify({ ok: false, error: result.error.message }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        ok: true,
        issueId: result.value.issueId,
        parentIssueId: result.value.parentIssueId,
        rootIssueId: result.value.rootIssueId,
      }),
    );
  }

  private async handleIssueOpen(route: string, res: http.ServerResponse): Promise<void> {
    const issueId = this.issueIdFromRoute(route, '/open');
    if (!issueId) {
      this.sendBadRequest(res, 'Invalid issue ID');
      return;
    }
    if (!this.workflow) {
      const issue = await this.issueService.getIssue(issueId);
      if (!issue.ok) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'Issue not found' }));
        return;
      }
      this.pendingResumeIssueId = issueId;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, issueId, resumePending: true }));
      return;
    }
    const [handoffs, reviews] = await Promise.all([
      this.handoffService.listHandoffs(),
      this.reviewService.listReviews(),
    ]);
    const handoffId = handoffs.ok
      ? handoffs.value.find((item) => item.issueId === issueId)?.handoffId
      : undefined;
    const reviewId = reviews.ok
      ? reviews.value
          .filter((item) => item.issueId === issueId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.reviewId
      : undefined;
    const result = await this.workflow.resumeIssue(issueId, handoffId, reviewId);
    await this.respondWorkflow(res, Promise.resolve(result));
  }
  private async resumePendingIssue(issueId: string): Promise<void> {
    if (!this.workflow) return;
    const [handoffs, reviews] = await Promise.all([
      this.handoffService.listHandoffs(),
      this.reviewService.listReviews(),
    ]);
    const handoffId = handoffs.ok
      ? handoffs.value.find((item) => item.issueId === issueId)?.handoffId
      : undefined;
    const reviewId = reviews.ok
      ? reviews.value
          .filter((item) => item.issueId === issueId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.reviewId
      : undefined;
    await this.workflow.resumeIssue(issueId, handoffId, reviewId);
    this.broadcastStudioState();
  }

  private async handleNavigate(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    try {
      const { url } = JSON.parse(body);
      let navigation = this.navigationInFlight;
      if (!navigation) {
        navigation = this.vce.navigate(url).finally(() => {
          this.navigationInFlight = null;
        });
        this.navigationInFlight = navigation;
      }
      const result = await navigation;
      if (result.ok) this.setupPageWorkflow(url);
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
    if (this.controller?.isActive() || this.controller?.isTeardownPending()) {
      const teardown = this.controller.exitSelectionMode().then(
        () => undefined,
        () => undefined,
      );
      this.controllerTeardown = teardown;
      void teardown.finally(() => {
        if (this.controllerTeardown === teardown) this.controllerTeardown = null;
      });
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
      captureBaselineArtifact: (input) => this.captureBaselineArtifact(input),
      visualReviewPolicy: this.state.settings.visualReviewArtifacts,
      visualReviewPolicyAsked: this.visualReviewPolicyAsked,
    });
    if (this.pendingResumeIssueId) {
      const issueId = this.pendingResumeIssueId;
      this.pendingResumeIssueId = undefined;
      void this.resumePendingIssue(issueId);
    }
    this.vce.setOverlayEventsDelegated(true);
    this.broadcastStudioState();
  }

  /**
   * Phase 33A: `budgetExceeded` mirrors the current packet's source-hint
   * diagnostic. Truthful and minimal — derived, never guessed.
   */
  private syncProjectBudgetFlag(): void {
    const diagnostic = this.state.currentPacket?.evidence?.sourceHints?.diagnostic;
    this.state.project.budgetExceeded =
      diagnostic?.code === 'SH_BUDGET_EXCEEDED' || diagnostic?.code === 'SH_SCAN_CANCELLED';
  }
  private async handleCapture(res: http.ServerResponse): Promise<void> {
    let capture = this.captureInFlight;
    if (!capture) {
      capture = this.vce.generatePacket().finally(() => {
        this.captureInFlight = null;
      });
      this.captureInFlight = capture;
    }
    const result = await capture;
    if (result.ok) {
      this.state.currentPacket = result.value;
      this.syncProjectBudgetFlag();
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
      // Phase 28A: bare selector, no trusted geometry. Multi-match selectors
      // fail closed as ambiguous instead of being disambiguated by a
      // synthetic default box.
      const selection: SelectionTarget = {
        selector: selector ?? 'body',
        source: 'studio',
      };
      this.state.currentSelection = selection;

      this.vce.setSelectionEventsDelegated(true);
      try {
        if (this.selectionEngine) {
          const resolved = await this.selectionEngine.resolveTarget({
            selector: selection.selector,
            source: 'studio',
            timestamp: new Date().toISOString(),
          });
          if (resolved.ok) {
            const validated = await this.selectionEngine.validateSelection({
              selector: selection.selector,
              source: 'studio',
            } as SelectionTarget);
            if (validated.ok && validated.value) {
              this.state.currentSelection = validated.value.target;
            }
          }
        }
      } finally {
        this.vce.setSelectionEventsDelegated(false);
      }

      const result = await this.vce.processSelection(selection);
      if (result.ok) {
        this.state.currentPacket = result.value;
        this.syncProjectBudgetFlag();
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
      // Phase 28A: bare selector, no trusted geometry — multi-match selectors
      // fail closed as ambiguous.
      const selection: SelectionTarget = {
        selector,
        source: 'studio',
      };
      this.state.currentSelection = selection;

      const result = await this.vce.processSelection(selection);
      if (result.ok) {
        this.state.currentPacket = result.value;
        this.syncProjectBudgetFlag();
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
    if (this.controllerTeardown) await this.controllerTeardown;
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

  /**
   * The single "Prepare agent handoff" action (VISKOD-AUDIT-001): coordinates
   * create-issue (idempotent) → prepare-handoff → handoff_ready inside the
   * workflow. Same Zod boundary as the issue endpoint.
   */
  private async handleWorkflowPrepare(
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
    await this.respondWorkflow(res, workflow.prepareAgentHandoffFromDescription(parsed));
  }

  private async handleWorkflowReselect(res: http.ServerResponse): Promise<void> {
    const workflow = this.requireWorkflow(res);
    if (!workflow) return;
    await this.respondWorkflow(res, workflow.reselect());
  }

  private async handleWorkflowCancel(res: http.ServerResponse): Promise<void> {
    const workflow = this.requireWorkflow(res);
    if (!workflow) return;
    await this.respondWorkflow(res, workflow.cancel());
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

  /**
   * Phase 31: explicit user opt-in/opt-out for local-sensitive visual review
   * artifacts. Persisted once; the normal report flow never re-asks.
   */
  private async handleVisualReviewPolicy(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await this.readBody(req);
    let policy: VisualArtifactPolicy;
    try {
      const parsed = JSON.parse(body) as { policy?: unknown };
      if (parsed.policy !== 'disabled' && parsed.policy !== 'local-sensitive-target-crop') {
        this.sendBadRequest(res, 'policy must be disabled or local-sensitive-target-crop');
        return;
      }
      policy = parsed.policy;
    } catch {
      this.sendBadRequest(res, 'Invalid request body');
      return;
    }
    this.state.settings.visualReviewArtifacts = policy;
    this.artifactStore.setPolicy(policy);
    this.reviewService.setArtifactPolicy(policy);
    saveVisualReviewPolicy(policy);
    this.visualReviewPolicyAsked = true;
    // Reflect the answered consent in the live workflow so the banner
    // disappears immediately (Phase 31A).
    this.workflow?.setVisualReviewPolicy(policy, true);
    this.broadcastToWs({ type: 'settings:updated', settings: this.state.settings });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, policy }));
  }

  /**
   * Phase 31: serve a local-sensitive review artifact by opaque id. Never
   * accepts filesystem paths; traversal/malformed ids are rejected before
   * any file access. Only the review's own manifest can map the id to a
   * committed artifact file.
   */
  private async handleReviewArtifact(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = req.url ?? '';
    const artifactId = url.slice('/review/artifact/'.length);
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Artifact not found' }));
      return;
    }
    // The artifact id alone is opaque: find the owning review via the
    // artifact index (review dirs that reference this id).
    const owner = this.findArtifactOwner(artifactId);
    if (!owner) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Artifact not found' }));
      return;
    }
    const buffer = await this.artifactStore.readArtifact(owner, artifactId);
    if (!buffer.ok) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: buffer.error.message }));
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.end(buffer.value);
  }

  /** Sanitized review payload for deep-link/reload (opaque ids only). */
  private async handleReviewGet(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = req.url ?? '';
    const reviewId = url.slice('/review/'.length);
    if (!reviewId || !/^review_[a-f0-9]{16}$/.test(reviewId)) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Review not found' }));
      return;
    }
    const preview = await this.userFacingReview.getPreview(reviewId);
    if (!preview) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Review not found' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, review: preview }));
  }

  /**
   * Phase 31: locate the review whose manifest references an artifact id.
   * Directory listing is bounded to `.viskod/reviews/<reviewId>/manifest.json`
   * files; the result is an opaque review id, never a path.
   */
  private findArtifactOwner(artifactId: string): string | null {
    try {
      const base = this.artifactStore.getBaseDir();
      if (!fs.existsSync(base)) return null;
      for (const name of fs.readdirSync(base, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        if (name.name === 'baselines') continue;
        const manifestPath = join(base, name.name, 'manifest.json');
        if (!fs.existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
            pairing?: {
              beforeArtifactId?: string;
              afterArtifactId?: string;
              diffArtifactId?: string;
            };
          };
          if (
            manifest.pairing?.beforeArtifactId === artifactId ||
            manifest.pairing?.afterArtifactId === artifactId ||
            manifest.pairing?.diffArtifactId === artifactId
          ) {
            return name.name;
          }
        } catch {
          /* skip unreadable manifests */
        }
      }
    } catch {
      /* no artifact store access */
    }
    return null;
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
        setup: this.state.setup,
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
   * Review recapture adapter with a single active operation per Studio.
   * Duplicate requests are rejected rather than queued without a bound.
   */
  private async recaptureViaVce(options: RecaptureOptions): Promise<RecaptureResult | null> {
    if (this.recaptureInFlight) return null;
    const operation = this.performRecaptureViaVce(options);
    this.recaptureInFlight = operation.finally(() => {
      this.recaptureInFlight = null;
    });
    return operation;
  }

  private async performRecaptureViaVce(options: RecaptureOptions): Promise<RecaptureResult | null> {
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
      ...(options.boundingBox ? { boundingBox: options.boundingBox } : {}),
      source: 'studio',
    });
    if (!capture.ok) return null;

    const packet = capture.value;

    // Phase 31: local-sensitive target crop through the Phase 28B exact
    // target pipeline. Persisted only when the review artifact policy is
    // enabled; never part of the agent-safe packet.
    let elementScreenshot: RecaptureResult['elementScreenshot'];
    const runtime = this.vce.getBrowserRuntime();
    if (runtime && this.browserHandle) {
      const shot = await runtime.captureElementScreenshot(
        this.browserHandle,
        selector,
        options.boundingBox,
      );
      if (shot.ok && shot.value.resolutionStatus === 'resolved') {
        const buffer = shot.value.buffer;
        if (buffer) {
          elementScreenshot = { ...shot.value, buffer };
        }
      }
    }

    return {
      packetId: packet.packetId,
      selector,
      tagName: packet.dom.tagName,
      boundingBox: packet.selection.boundingBox,
      text: packet.selection.text,
      url: packet.browser.url,
      viewport: packet.browser.viewport,
      screenshotPath: packet.screenshots[0]?.path ?? undefined,
      elementScreenshot,
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

  /**
   * Phase 31: capture the pre-change target crop for an issue and persist it
   * as the local-sensitive review baseline. Called when the handoff is
   * prepared — the last moment before the coding agent modifies the UI.
   * A missing/failed baseline is recoverable: the review later reports
   * visual comparison unavailable instead of fabricating one post-change.
   */
  private async captureBaselineArtifact(input: {
    issueId: string;
    selector: string;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }): Promise<Result<{ baselineStored: boolean }>> {
    if (!this.artifactStore.isEnabled()) {
      return ok({ baselineStored: false });
    }
    if (!this.browserHandle) {
      return err(
        this.studioError(
          'STUDIO_BROWSER_UNAVAILABLE',
          'No browser session — visual baseline cannot be captured.',
        ),
      );
    }
    const runtime = this.vce.getBrowserRuntime();
    if (!runtime) {
      return err(
        this.studioError(
          'STUDIO_BROWSER_UNAVAILABLE',
          'No browser runtime — visual baseline cannot be captured.',
        ),
      );
    }
    const shot = await runtime.captureElementScreenshot(
      this.browserHandle,
      input.selector,
      input.boundingBox,
    );
    if (!shot.ok) {
      return err(this.studioError('STUDIO_BASELINE_CAPTURE_FAILED', shot.error.message));
    }
    if (shot.value.resolutionStatus !== 'resolved' || !shot.value.buffer) {
      return err(
        this.studioError(
          'STUDIO_BASELINE_TARGET_MISSING',
          `Visual baseline target could not be resolved (${shot.value.resolutionStatus}).`,
        ),
      );
    }
    const buffer = shot.value.buffer;
    const saved = await this.artifactStore.saveBaseline(input.issueId, {
      ...shot.value,
      buffer,
    });
    if (!saved.ok) return saved;
    return ok({ baselineStored: saved.value.status === 'collected' });
  }

  private studioError(code: string, message: string): ViskodError {
    return {
      code,
      category: ErrorCategory.RUNTIME,
      severity: ErrorSeverity.RECOVERABLE,
      message,
      correlationId: crypto.randomUUID(),
      subsystem: 'studio',
      timestamp: new Date().toISOString(),
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
      if (this.state.settings.visualReviewArtifacts === 'local-sensitive-target-crop') {
        this.artifactStore.setPolicy('local-sensitive-target-crop');
        this.reviewService.setArtifactPolicy('local-sensitive-target-crop');
      } else if (this.state.settings.visualReviewArtifacts === 'disabled') {
        this.artifactStore.setPolicy('disabled');
        this.reviewService.setArtifactPolicy('disabled');
      }
      this.syncCaptureProfile();
      this.broadcastToWs({ type: 'settings:updated', settings: this.state.settings });
      res.end(JSON.stringify({ ok: true, settings: this.state.settings }));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: 'Invalid request body' }));
    }
  }

  /**
   * Phase 32: portable per-IDE MCP onboarding config. The serve command comes
   * from @viskod/setup (no checkout-specific or hardcoded Windows paths);
   * opencode takes a `command` array, cursor/claude take `command` + `args`.
   */
  private buildMcpConfig(ide: string): Record<string, unknown> {
    const projectRoot = resolveStudioProjectRoot() ?? undefined;
    const serve = getMcpServeCommand({ projectRoot, url: 'http://localhost:3000' });
    const serverEntry = {
      command: serve.command,
      args: serve.args,
      env: {},
      disabled: false,
      autoApprove: [],
    };

    switch (ide) {
      case 'claude':
      case 'cursor':
        return {
          mcpServers: {
            viskod: serverEntry,
          },
        };
      default:
        return {
          $schema: 'https://opencode.ai/config.json',
          mcp: {
            viskod: { type: 'local', command: [serve.command, ...serve.args], enabled: true },
          },
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

  /**
   * Idempotent shutdown: closes WebSocket clients, the WebSocket server, the
   * HTTP server, selection mode, and the browser. Safe to call repeatedly
   * (e.g. SIGINT then SIGTERM, or double Ctrl+C).
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    try {
      for (const client of this.wsClients) {
        if (client.readyState === WebSocket.OPEN) client.close(1001, 'Studio shutting down');
      }
      if (this.wss) {
        await new Promise<void>((resolveClose) => {
          this.wss?.close(() => resolveClose());
        });
      }
      await this.closeHttpServer();
      if (this.controller) {
        await this.controller.exitSelectionMode().catch(() => undefined);
      }
      await this.vce.stopBrowser();
    } finally {
      this.wss = null;
      this.server = null;
    }
  }

  private closeHttpServer(): Promise<void> {
    return new Promise((resolveClose) => {
      const server = this.server;
      if (!server) {
        resolveClose();
        return;
      }
      // If the server is not listening (already closed or never started),
      // close() invokes the callback with ERR_SERVER_NOT_RUNNING; resolve
      // regardless so shutdown is idempotent.
      server.close(() => resolveClose());
    });
  }

  getState(): StudioState {
    return this.state;
  }

  /** Phase 30: record the established/invalid/unknown project status. */
  setProjectStatus(status: StudioProjectStatus): void {
    this.state.project = status;
    this.broadcastStudioState();
  }

  /**
   * Phase 32: (re)load the persisted @viskod/setup state for the configured
   * project root and publish the redacted Studio setup status. Cheap — a
   * single state-file read plus a filesystem existence check; never runs
   * setup validation and never launches a browser. `root: null` (no project
   * root configured) yields a truthful 'never' status.
   */
  refreshSetupStatus(root: string | null): void {
    let setup: StudioSetupStatus;
    if (!root) {
      setup = { status: 'never', browserVerified: false, stale: false };
    } else {
      const result = getSetupState(root);
      if (!result.ok) {
        // Unreadable/corrupt persisted state: never claim readiness.
        setup = {
          status: 'incomplete',
          browserVerified: false,
          projectName: this.projectDisplayName(root),
          stale: false,
        };
      } else if (!result.value) {
        setup = {
          status: 'never',
          browserVerified: false,
          projectName: this.projectDisplayName(root),
          stale: false,
        };
      } else {
        const persisted = result.value;
        setup = {
          status: persisted.state,
          limitedReasons: persisted.limitedReasons,
          verifiedAt: persisted.verifiedAt,
          setupVersion: persisted.setupVersion,
          sourceResolution: persisted.sourceResolution,
          agentConfig: persisted.agentConfig
            ? { detected: persisted.agentConfig.detected, kind: persisted.agentConfig.kind }
            : null,
          browserVerified: persisted.capabilities?.browserRuntime ?? false,
          projectName: this.projectDisplayName(root),
          stale: false,
        };
        if ((setup.status === 'complete' || setup.status === 'limited') && !isChromiumAvailable()) {
          setup.stale = true;
          setup.staleReason = 'Chromium missing';
        }
      }
    }
    this.state.setup = setup;
    this.broadcastStudioState();
  }

  /**
   * Redacted /setup/status payload: persisted setup status (state kind +
   * capability booleans, never absolute paths) plus Studio's own live facts.
   */
  private setupStatusPayload(): Record<string, unknown> {
    return {
      setup: this.state.setup,
      browserConnected: this.browserConnected,
      project: this.state.project,
      chromiumAvailable: isChromiumAvailable(),
      stale: this.state.setup.stale,
      staleReason: this.state.setup.staleReason,
    };
  }

  /** User-facing project display name for banner instructions; never a path. */
  private projectDisplayName(root: string): string | undefined {
    return this.state.project.name ?? basename(root);
  }

  /**
   * Phase 30: compact user-facing source status for the current packet.
   * Repository-relative paths only; ambiguity is presented as ambiguity —
   * the first candidate is never displayed as confirmed.
   */
  getSourceStatus(): StudioSourceStatus | null {
    const packet = this.state.currentPacket;
    if (!packet) return null;
    const hints = packet.sourceHints ?? [];
    const resolution = packet.sourceHintsResolution?.status ?? 'unavailable';
    return {
      resolution,
      status: packet.evidence.sourceHints.state,
      count: hints.length,
      candidates: hints.slice(0, 5).map((h) => ({
        path: h.displayPath ?? h.filePath,
        qualification: h.qualification ?? 'weak',
        confidence: h.confidence,
        reasons: (h.reasons ?? []).slice(0, 3),
      })),
    };
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = '';
      let tooLarge = false;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve(tooLarge ? '{"__viskodBodyTooLarge":true}' : body);
      };
      req.on('data', (chunk: Buffer) => {
        if (tooLarge) return;
        body += chunk.toString();
        if (Buffer.byteLength(body, 'utf8') > MAX_STUDIO_JSON_BODY_BYTES) {
          tooLarge = true;
          body = '';
        }
      });
      req.on('end', finish);
      req.on('aborted', finish);
      req.on('error', finish);
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
const selectionEngine: SelectionEngineType = new SelectionEngine(eventBus, browserRuntime);
const projectScanner = new ProjectScanner(eventBus);
const sourceHintEngine = new SourceHintEngine(eventBus);

const vce = new VisualContextEngine({
  browserRuntime,
  eventBus,
  capturePipeline,
  selectionEngine,
  sourceHintEngine,
});

const studio = new Studio(vce, eventBus, selectionEngine, {
  port: resolveStudioPort(),
});

/**
 * Phase 30 project-root contract: Studio NEVER guesses the target project
 * from `process.cwd()`. The only trusted sources are the explicit
 * `--project-root <path>` CLI argument or the `VISKOD_PROJECT_ROOT`
 * environment variable, both resolved and validated against the filesystem
 * (must contain a package.json). Without an explicit root, source
 * resolution is truthfully `unavailable` — never a cwd-walk guess.
 */
function resolveStudioProjectRoot(): string | null {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf('--project-root');
  const fromArg = flagIdx >= 0 ? args[flagIdx + 1] : undefined;
  const raw = fromArg ?? process.env.VISKOD_PROJECT_ROOT;
  if (!raw || !raw.trim()) return null;
  return resolve(raw.trim());
}

function resolveStudioPort(): number {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf('--port');
  const raw = flagIdx >= 0 ? args[flagIdx + 1] : undefined;
  if (!raw) return DEFAULT_PORT;
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

function resolveStudioUrl(): string | undefined {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf('--url');
  const raw = flagIdx >= 0 ? args[flagIdx + 1] : undefined;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Phase 32 light health check: the Playwright Chromium executable exists on
 * disk. Never launches a browser; a failed/throwing lookup just means the
 * runtime check currently fails.
 */
function isChromiumAvailable(): boolean {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

async function establishProjectContext(): Promise<void> {
  const rootPath = resolveStudioProjectRoot();
  if (!rootPath) {
    studio.setProjectStatus({
      status: 'unknown',
      scan: 'unavailable',
      reason:
        'No project root configured. Start Studio with --project-root <path> (or VISKOD_PROJECT_ROOT) to enable source resolution.',
    });
    studio.refreshSetupStatus(null);
    return;
  }
  // Phase 33A: the source scan is refreshing while establishProjectContext
  // runs — observable through /state, never guessed.
  studio.setProjectStatus({
    status: 'unknown',
    scan: 'refreshing',
    reason: 'Scanning the configured project root…',
  });
  const scanResult = await projectScanner.scan(rootPath);
  if (!scanResult.ok) {
    studio.setProjectStatus({
      status: 'invalid',
      scan: 'unavailable',
      reason: `The configured project root could not be scanned: ${sanitizeErrorDetail(scanResult.error.message)}`,
    });
    studio.refreshSetupStatus(rootPath);
    return;
  }
  const scan = scanResult.value;

  // Discover workspace metadata
  const workspaceResult = await projectScanner.discoverWorkspace(rootPath);
  const workspace = workspaceResult.ok
    ? {
        isWorkspace: workspaceResult.value.isWorkspace,
        workspaceType: workspaceResult.value.workspaceType,
        packages: workspaceResult.value.packages,
        globs: workspaceResult.value.globs,
      }
    : undefined;

  vce.setProjectContext({
    rootPath: scan.metadata.rootPath,
    projectId: scan.metadata.projectId,
    name: scan.metadata.name,
    directories: scan.components.directories,
    primaryFramework: scan.framework.primary,
    detectedFrameworks: scan.framework.detected,
    frameworkConfidence: scan.framework.confidence,
    routeMap: { routes: scan.routes.routes },
    workspace,
  });

  sourceHintEngine.invalidateCache(rootPath);

  // Phase 33A minimal safe status: single-package vs workspace + package
  // count + scan readiness. Never absolute paths, never a repository
  // explorer.
  studio.setProjectStatus({
    status: 'ready',
    scan: 'ready',
    name: scan.metadata.name,
    framework: scan.framework.primary ?? undefined,
    routeCount: scan.routes.totalRoutes,
    workspace:
      workspaceResult.ok && workspaceResult.value.isWorkspace
        ? { isWorkspace: true, packageCount: workspaceResult.value.packages.length }
        : { isWorkspace: false, packageCount: 0 },
  });
  studio.refreshSetupStatus(rootPath);
}

/**
 * Entry bootstrap: only run when this module is the executed program (tsx
 * apps/studio/src/index.ts), never when imported by tests or other packages.
 * On listen failure the process exits with an actionable message; on success
 * SIGINT/SIGTERM trigger the idempotent shutdown path.
 */
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

// ---------------------------------------------------------------------------
// Phase 31: local-sensitive visual review artifact policy persistence.
// Smallest settings mechanism: a single persisted value in .viskod/settings.json.
// Absent file = never asked → the UI asks once; behavior stays disabled until
// the user explicitly opts in.
// ---------------------------------------------------------------------------

function visualReviewPolicyFilePath(): string {
  return join(process.cwd(), VISKOD_STORAGE_DIR, SETTINGS_FILE);
}

function loadVisualReviewPolicy(): 'disabled' | 'local-sensitive-target-crop' {
  try {
    const raw = fs.readFileSync(visualReviewPolicyFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.visualReviewArtifacts === 'local-sensitive-target-crop') {
      return 'local-sensitive-target-crop';
    }
    if (parsed.visualReviewArtifacts === 'disabled') {
      return 'disabled';
    }
  } catch {
    /* absent or unreadable → never asked → disabled */
  }
  return 'disabled';
}

function saveVisualReviewPolicy(policy: VisualArtifactPolicy): void {
  try {
    const filePath = visualReviewPolicyFilePath();
    fs.mkdirSync(join(process.cwd(), VISKOD_STORAGE_DIR), { recursive: true });
    const existing: Record<string, unknown> = {};
    try {
      existing.visualReviewArtifacts = JSON.parse(
        fs.readFileSync(filePath, 'utf-8'),
      ).visualReviewArtifacts;
    } catch {
      /* start fresh */
    }
    const next = { ...existing, visualReviewArtifacts: policy };
    const temp = `${filePath}.tmp-${crypto.randomUUID().slice(0, 8)}`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf-8');
    // Windows can transiently lock the destination right after a rename
    // (antivirus/indexer); retry briefly so a consent answer is never
    // silently dropped from persistence.
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        fs.renameSync(temp, filePath);
        return;
      } catch (error) {
        lastError = error;
        const delayMs = 50 * (attempt + 1);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
      }
    }
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      /* best effort */
    }
    throw lastError;
  } catch {
    /* best effort — policy stays in-memory for the session */
  }
}

async function main(): Promise<void> {
  await establishProjectContext();
  const started = await studio.start();
  if (!started.ok) {
    console.error(`Viskod Studio failed to start: ${started.error.message}`);
    process.exitCode = 1;
    return;
  }
  const targetUrl = resolveStudioUrl();
  if (targetUrl) {
    const navigated = await studio.navigate(targetUrl);
    if (!navigated.ok) {
      console.error(`Viskod Studio could not navigate to ${targetUrl}: ${navigated.error.message}`);
      await studio.shutdown();
      process.exitCode = 1;
      return;
    }
  }
  const shutdown = (): void => {
    void studio.shutdown().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (isEntryPoint) {
  void main();
}
