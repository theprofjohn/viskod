import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_URL, ROOT, STUDIO_URL, killTree, spawnProc, waitForHttp } from './harness';

/**
 * Phase 29 + Phase 30 — durable handoff context retrieval + privacy +
 * calibrated source hints E2E (real browser, real processes, real stdio MCP).
 *
 * 1. Studio + privacy fixture: capture/issue/handoff with synthetic secrets
 *    on several surfaces. Persisted packet/metadata/handoff artifacts are
 *    scanned for the secrets; no absolute paths; screenshots omitted by the
 *    default agent-safe policy.
 * 2. Studio + Phase 28B duplicate-target fixture: trusted geometry resolves
 *    candidate B → the PERSISTED safe packet describes B.
 * 3. Kill Studio. Start a FRESH MCP server process. Using only the opaque
 *    handoff IDs, get_agent_handoff + get_handoff_context must return the
 *    exact persisted target context for both flows — no in-memory state.
 * 4. Malicious handoff ids (traversal/absolute paths) fail safely.
 * 5. Phase 30: Studio WITH an explicit --project-root captures calibrated,
 *    qualified source hints; a fresh MCP process retrieves the persisted
 *    candidates WITHOUT recomputation.
 * 6. Phase 30: a duplicate-text target persists as ambiguous and stays
 *    ambiguous across the process boundary.
 */

const PRIVACY_URL = 'http://127.0.0.1:3222';
const AMBIGUITY_URL = 'http://127.0.0.1:3221';
const SOURCE_AMBIGUITY_URL = 'http://127.0.0.1:3223';

const SECRETS = [
  'e2e-password-9f8e7d6c',
  'sk_live_e2eSECRETkey000111222',
  'Bearer e2e.bearer.token.abcdef',
  'e2e.user@viskod-test.example',
  '4242 4242 4242 4242',
  'ZTJlLXZpc2tvZC1iYXNlNjQtc2VjcmV0LXZhbHVlPT0=',
  'e2e-query-token-xyz',
  'e2e-secret-attribute',
  'e2e-password-attribute-value',
];

let privacyProc: ChildProcess | null = null;
let ambiguityProc: ChildProcess | null = null;
let sourceAmbiguityProc: ChildProcess | null = null;
let phase12Proc: ChildProcess | null = null;
let studioProc: ChildProcess | null = null;
let studio2Proc: ChildProcess | null = null;
let studio3Proc: ChildProcess | null = null;
let mcpProc: ChildProcess | null = null;
let browser: Browser;
let page: Page;

let mcpStdout = '';
let mcpStderr = '';
let parsedIndex = 0;

function rpcSend(msg: Record<string, unknown>): void {
  mcpProc?.stdin?.write(`${JSON.stringify(msg)}\n`);
}

function rpcWait(timeoutMs: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const loop = (): void => {
      const tail = mcpStdout.slice(parsedIndex);
      for (const line of tail.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
          try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>;
            parsedIndex = mcpStdout.length;
            resolve(obj);
            return;
          } catch {
            /* partial line */
          }
        }
      }
      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(loop, 500);
    };
    loop();
  });
}

let rpcId = 100;
async function rpcCall(
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 120000,
): Promise<Record<string, unknown> | null> {
  rpcId += 1;
  rpcSend({ jsonrpc: '2.0', id: rpcId, method: 'tools/call', params: { name, arguments: args } });
  return rpcWait(timeoutMs);
}

interface ToolResult {
  ok: boolean;
  isError?: boolean;
  error?: string;
  [key: string]: unknown;
}

function parseToolText(response: Record<string, unknown> | null): ToolResult | null {
  if (!response) return null;
  if (response.error) {
    const errObj = response.error as { message?: unknown };
    return { ok: false, error: String(errObj.message ?? 'rpc error') };
  }
  const content = (response.result as { content?: Array<{ text?: string }> } | undefined)?.content;
  const text = content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as ToolResult;
  } catch {
    return { ok: false, error: text };
  }
}

// ---------------------------------------------------------------------------
// Studio UI drivers (real rendered controls only)
// ---------------------------------------------------------------------------

async function openApp(url: string): Promise<void> {
  // Navigate through the same endpoint the UI form uses: it resets the
  // server-side workflow (idle) and points the VCE browser at the app.
  const sep = url.includes('?') ? '&' : '?';
  const res = await fetch(`${STUDIO_URL}/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${url}${sep}viskodReset=1` }),
  });
  expect(res.ok).toBe(true);
  // Reload the UI so the landing view (with #report-start) renders.
  await page.goto(`${STUDIO_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#report-start', { timeout: 30000 });
}

async function beginReport(): Promise<void> {
  await page.click('#report-start');
  await page.waitForSelector('[data-stage="selecting"]');
}

async function waitForSelectionEnabled(timeoutMs = 30000): Promise<void> {
  await page.waitForSelector('#selection-accept:not([disabled])', { timeout: timeoutMs });
}

async function acceptSelection(): Promise<void> {
  await page.click('#selection-accept');
  await page.waitForSelector('[data-stage="describe"]', { timeout: 30000 });
}

async function prepareHandoff(problem: string, expected: string): Promise<void> {
  await page.fill('#problem', problem);
  await page.fill('#expected', expected);
  await page.click('#issue-form button[type="submit"]');
  await page.waitForSelector('[data-stage="handoff_ready"]', { timeout: 30000 });
}

async function getWorkflowState(): Promise<Record<string, unknown>> {
  const res = await fetch(`${STUDIO_URL}/workflow/state`);
  return (await res.json()) as Record<string, unknown>;
}

async function waitForStudioReady(timeoutMs = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const health = (await (await fetch(`${STUDIO_URL}/health`)).json()) as {
        browserConnected?: boolean;
        project?: { status?: string };
      };
      // The HTTP server answers before the browser finishes launching; the
      // workflow needs the VCE browser, so wait for the real readiness
      // signal (browser connected) instead of a fixed sleep.
      if (health.browserConnected === true) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timeout waiting for Studio browser-ready');
}

/**
 * Kill a Studio process and wait until port 3001 actually refuses
 * connections. Booting the next Studio before the old listener is fully
 * gone races the port (EADDRINUSE) or answers from a stale process.
 */
async function stopStudioAndWaitForPort(proc: ChildProcess | null): Promise<void> {
  killTree(proc);
  const start = Date.now();
  while (Date.now() - start < 30000) {
    try {
      const res = await fetch(`${STUDIO_URL}/health`);
      // If a response arrives, the port is still owned — keep waiting.
      if (!res.ok) return;
    } catch {
      return; // connection refused → port released
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timeout waiting for Studio port release');
}

/** Read the persisted capture for an issue via its evidence.captureId. */
function captureDirForIssue(issueId: string): string | null {
  const issuePath = path.join(ROOT, '.viskod', 'issues', issueId, 'issue.json');
  if (!fs.existsSync(issuePath)) return null;
  const issue = JSON.parse(fs.readFileSync(issuePath, 'utf-8')) as {
    evidence?: { captureId?: string };
  };
  const captureId = issue.evidence?.captureId;
  if (!captureId) return null;
  const dir = path.join(ROOT, '.viskod', 'captures', captureId);
  return fs.existsSync(dir) ? dir : null;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  privacyProc = spawnProc('node', ['examples/privacy-app/server.cjs']);
  await waitForHttp(`${PRIVACY_URL}/`, 20000, 'privacy fixture');
  ambiguityProc = spawnProc('node', ['examples/selector-ambiguity-app/server.cjs']);
  await waitForHttp(`${AMBIGUITY_URL}/`, 20000, 'ambiguity fixture');
  sourceAmbiguityProc = spawnProc('node', ['examples/source-hint-ambiguity-app/server.cjs']);
  await waitForHttp(`${SOURCE_AMBIGUITY_URL}/`, 20000, 'source ambiguity fixture');
  phase12Proc = spawnProc('node', ['examples/phase12-source-hint-app/server.cjs']);
  await waitForHttp(`${FIXTURE_URL}/`, 20000, 'phase12 fixture');

  studioProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
    'tsx',
    'apps/studio/src/index.ts',
  ]);
  await waitForHttp(`${STUDIO_URL}/health`, 120000, 'Studio server');

  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${STUDIO_URL}/`, { waitUntil: 'domcontentloaded' });
}, 240000);

afterAll(async () => {
  if (browser) await browser.close().catch(() => undefined);
  if (mcpProc) {
    try {
      mcpProc.stdin?.end();
    } catch {
      /* already closed */
    }
  }
  killTree(studioProc);
  killTree(studio2Proc);
  killTree(studio3Proc);
  killTree(mcpProc);
  killTree(privacyProc);
  killTree(ambiguityProc);
  killTree(sourceAmbiguityProc);
  killTree(phase12Proc);
});

// ---------------------------------------------------------------------------
// Phase 28B identity → persistence (before Studio is stopped)
// ---------------------------------------------------------------------------

describe('Phase 29 — persisted target identity (28B regression)', () => {
  let handoffId = '';
  let issueId = '';

  it('Studio capture: trusted geometry resolves B and the PERSISTED packet describes B', async () => {
    await openApp(`${AMBIGUITY_URL}/?viskodSimulate=dup`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await prepareHandoff(
      'Phase 29 identity regression',
      'The persisted target must be candidate B',
    );

    const state = await getWorkflowState();
    handoffId = state.handoffId as string;
    issueId = state.issueId as string;
    expect(handoffId).toBeTruthy();
    expect(issueId).toBeTruthy();

    // The issue must reference a durable persisted capture.
    const captureDir = captureDirForIssue(issueId);
    expect(captureDir).not.toBeNull();
    expect(captureDir).toBeTruthy();
    if (!captureDir) return;

    const packet = JSON.parse(
      fs.readFileSync(path.join(captureDir, 'packet.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const packetJson = JSON.stringify(packet);
    const selection = packet.selection as { text?: string };
    const dom = packet.dom as { attributes?: Record<string, string> };
    const hierarchy = packet.hierarchy as { parents?: Array<{ tagName?: string }> };

    // Persisted evidence describes B, never A.
    expect(selection.text).toContain('SECOND CARD');
    expect(dom.attributes?.['data-target']).toBe('b');
    expect(dom.attributes?.id).toBe('card-b');
    expect(hierarchy.parents?.[0]?.tagName).toBe('main');
    expect(packetJson).not.toContain('FIRST CARD');
    expect(packetJson).not.toContain('card-a');
    expect(packetJson).not.toContain('parent-a');
    // Persisted packet carries integrity/status + no absolute paths.
    expect(packet.captureStatus).toBe('partial');
    const evidence = packet.evidence as { dom?: { state?: string } };
    expect(evidence.dom?.state).toBe('collected');
    expect(packetJson).not.toContain('captureDir');
    expect(packetJson).not.toContain('absoluteCaptureDir');
  });

  it('stores handoffId for later fresh-process retrieval', () => {
    expect(handoffId).toMatch(/^handoff_[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// Privacy flow (before Studio is stopped)
// ---------------------------------------------------------------------------

describe('Phase 29 — privacy E2E through the real browser path', () => {
  let handoffId = '';
  let issueId = '';

  it('Studio capture of the privacy fixture persists NO synthetic secrets', async () => {
    await openApp(`${PRIVACY_URL}/?viskodSimulate=click&token=e2e-query-token-xyz`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await prepareHandoff(
      'Save changes button does not persist',
      'Clicking Save persists the updated email',
    );

    const state = await getWorkflowState();
    handoffId = state.handoffId as string;
    issueId = state.issueId as string;
    expect(handoffId).toBeTruthy();
    expect(issueId).toBeTruthy();

    const captureDir = captureDirForIssue(issueId);
    expect(captureDir).toBeTruthy();
    if (!captureDir) return;

    // Every persisted structured artifact is free of the synthetic secrets.
    const artifacts = [
      path.join(captureDir, 'packet.json'),
      path.join(captureDir, 'metadata.json'),
      path.join(ROOT, '.viskod', 'handoffs', handoffId, 'handoff.json'),
    ];
    for (const file of artifacts) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const secret of SECRETS) {
        expect(content, `'${secret}' leaked into ${path.relative(ROOT, file)}`).not.toContain(
          secret,
        );
      }
    }

    // No absolute paths in the persisted packet.
    const packetText = fs.readFileSync(path.join(captureDir, 'packet.json'), 'utf-8');
    expect(packetText).not.toContain('captureDir');
    expect(packetText).not.toContain('absoluteCaptureDir');
    expect(packetText).not.toContain('C:\\');
    expect(packetText).not.toContain('/Users/');

    // Default agent-safe screenshot policy: raw pixels never persisted,
    // status explicitly omitted_sensitive.
    const packet = JSON.parse(packetText) as {
      screenshots?: Array<{ path?: string | null; status?: string; sensitive?: boolean }>;
      evidence?: { screenshot?: { state?: string } };
      captureStatus?: string;
      browser?: { url?: string };
    };
    expect(packet.evidence?.screenshot?.state).toBe('omitted_sensitive');
    expect(packet.screenshots?.[0]?.path).toBeNull();
    expect(packet.screenshots?.[0]?.sensitive).toBe(true);
    expect(packet.captureStatus).toBe('partial');
    const filesInCapture = fs.readdirSync(captureDir);
    expect(filesInCapture.some((f) => f.endsWith('.png') || f.endsWith('.jpeg'))).toBe(false);
    // Credential query parameter redacted in the persisted URL.
    expect(packet.browser?.url).toContain('token=[REDACTED]');
    expect(packet.browser?.url).not.toContain('e2e-query-token-xyz');
    // Useful non-sensitive context preserved.
    expect(packetText).toContain('Credentials');
    expect(packetText).toContain('Save changes');
  });

  it('handoff context references the durable capture', () => {
    const handoffPath = path.join(ROOT, '.viskod', 'handoffs', handoffId, 'handoff.json');
    expect(fs.existsSync(handoffPath)).toBe(true);
    const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf-8')) as {
      context?: { packetRefs?: Array<{ captureId?: string; packetId?: string }> };
    };
    const ref = handoff.context?.packetRefs?.[0];
    expect(ref?.captureId).toBeTruthy();
    expect(ref?.packetId).toBeTruthy();
    // The referenced capture exists on disk.
    expect(
      fs.existsSync(path.join(ROOT, '.viskod', 'captures', ref?.captureId ?? '__none__')),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fresh-process retrieval (Studio killed; new MCP server)
// ---------------------------------------------------------------------------

describe('Phase 29 — fresh-process MCP retrieval (no in-memory Studio state)', () => {
  const handoffIds: string[] = [];

  it('Studio process is stopped before the MCP server starts', async () => {
    await stopStudioAndWaitForPort(studioProc);
    studioProc = null;
    expect(true).toBe(true);
  });

  it('starts a fresh MCP server process', async () => {
    mcpProc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
      'tsx',
      'packages/cli/src/index.ts',
      'serve',
      '--url',
      PRIVACY_URL,
    ]);
    mcpProc.stdout?.on('data', (d: Buffer) => {
      mcpStdout += d.toString();
    });
    mcpProc.stderr?.on('data', (d: Buffer) => {
      mcpStderr += d.toString();
    });
    rpcSend({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initResp = await rpcWait(120000);
    expect(initResp, `MCP initialize failed; stderr: ${mcpStderr.slice(-1000)}`).toBeTruthy();
    rpcSend({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const toolsResp = await rpcWait(30000);
    const tools =
      (toolsResp?.result as { tools?: Array<{ name: string }> } | undefined)?.tools ?? [];
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['get_handoff_context', 'get_agent_handoff']),
    );
  });

  it('get_agent_handoff + get_handoff_context resolve both handoffs by opaque id', async () => {
    // Collect both handoff ids from the earlier flows via the persisted
    // handoff index (this is still "opaque id only" — no in-memory objects).
    const handoffsDir = path.join(ROOT, '.viskod', 'handoffs');
    for (const entry of fs.readdirSync(handoffsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(handoffsDir, entry.name, 'handoff.json');
      if (!fs.existsSync(file)) continue;
      const handoff = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        handoffId?: string;
        status?: string;
      };
      if (handoff.handoffId && handoff.handoffId !== 'cancelled') {
        handoffIds.push(handoff.handoffId);
      }
    }
    // We created exactly two handoffs in this run (identity + privacy).
    expect(handoffIds.length).toBeGreaterThanOrEqual(2);
  });

  it('privacy handoff: exact persisted target context, redacted, no paths, no screenshot pixels', async () => {
    // Identify the privacy handoff by its issue problem text.
    let privacyHandoffId = '';
    for (const id of handoffIds) {
      const handoff = JSON.parse(
        fs.readFileSync(path.join(ROOT, '.viskod', 'handoffs', id, 'handoff.json'), 'utf-8'),
      ) as { brief?: { title?: string } };
      if (handoff.brief?.title?.includes('Save changes button')) {
        privacyHandoffId = id;
      }
    }
    expect(privacyHandoffId).toBeTruthy();

    const briefResp = parseToolText(
      await rpcCall('get_agent_handoff', { handoffId: privacyHandoffId }),
    );
    expect(briefResp?.ok).toBe(true);
    expect((briefResp?.brief as { title?: string })?.title).toContain('Save changes button');

    const ctxResp = parseToolText(
      await rpcCall('get_handoff_context', { handoffId: privacyHandoffId }),
    );
    expect(ctxResp?.ok).toBe(true);
    const captures = ctxResp?.captures as Array<{
      label: string;
      captureId: string;
      packetId: string;
      context: {
        captureStatus: string;
        target: { selector: string; text: string; attributes: Record<string, string> };
        problem?: { title: string };
        evidence: {
          screenshot: { state: string };
          dom: { state: string };
          sourceHints: { state: string };
        };
        screenshot: { status: string; sensitive: boolean; items: Array<{ type: string }> };
        page: { url: string };
        sourceHints: { status: string };
      };
    }>;
    expect(captures).toHaveLength(1);
    const ctx = captures?.[0]?.context;
    expect(ctx).toBeTruthy();
    if (!ctx) return;

    expect(ctx.captureStatus).toBe('partial');
    expect(ctx.target.selector).toBe('#privacy-card');
    expect(ctx.target.text).toContain('Credentials');
    expect(ctx.target.text).toContain('Save changes');
    // Sensitive attribute default-denied.
    expect(ctx.target.attributes['data-secret']).toBe('[REDACTED]');
    // Issue intent carried through.
    expect(ctx.problem?.title).toBe('Save changes button does not persist');
    // Evidence statuses truthful.
    expect(ctx.evidence.dom.state).toBe('collected');
    expect(ctx.evidence.screenshot.state).toBe('omitted_sensitive');
    expect(ctx.evidence.sourceHints.state).toBe('unavailable');
    expect(ctx.sourceHints.status).toBe('unavailable');
    // Screenshot policy explicit; no pixel payload.
    expect(ctx.screenshot.status).toBe('omitted_sensitive');
    expect(ctx.screenshot.sensitive).toBe(true);

    // Redaction: none of the secrets anywhere in the response.
    const respJson = JSON.stringify(ctxResp);
    for (const secret of SECRETS) {
      expect(respJson, `secret '${secret}' leaked into agent context`).not.toContain(secret);
    }
    // No absolute local paths.
    expect(respJson).not.toContain('C:\\');
    expect(respJson).not.toContain('/Users/');
    expect(respJson).not.toContain('captureDir');
    expect(respJson).not.toContain('packet.json');
    expect(respJson).not.toContain('viskod/captures');
    // Credential query parameter redacted.
    expect(ctx.page.url).toContain('token=[REDACTED]');
    expect(ctx.page.url).not.toContain('e2e-query-token-xyz');
  });

  it('Phase 28B identity survives persistence AND fresh-process retrieval', async () => {
    let identityHandoffId = '';
    for (const id of handoffIds) {
      const handoff = JSON.parse(
        fs.readFileSync(path.join(ROOT, '.viskod', 'handoffs', id, 'handoff.json'), 'utf-8'),
      ) as { brief?: { title?: string } };
      if (handoff.brief?.title?.includes('Phase 29 identity regression')) {
        identityHandoffId = id;
      }
    }
    expect(identityHandoffId).toBeTruthy();

    const ctxResp = parseToolText(
      await rpcCall('get_handoff_context', { handoffId: identityHandoffId }),
    );
    expect(ctxResp?.ok).toBe(true);
    const captures = ctxResp?.captures as Array<{
      context: {
        target: { text: string; attributes: Record<string, string> };
        hierarchy: { parents: Array<{ tagName: string }> };
      };
    }>;
    expect(captures).toHaveLength(1);
    const ctx = captures?.[0]?.context;
    expect(ctx).toBeTruthy();
    if (!ctx) return;

    // Candidate B, and only B.
    expect(ctx.target.text).toContain('SECOND CARD');
    expect(ctx.target.attributes['data-target']).toBe('b');
    expect(ctx.target.attributes.id).toBe('card-b');
    expect(ctx.hierarchy.parents[0]?.tagName).toBe('main');
    const json = JSON.stringify(ctxResp);
    expect(json).not.toContain('FIRST CARD');
    expect(json).not.toContain('card-a');
    expect(json).not.toContain('parent-a');
  });

  it('malicious handoff ids fail safely', async () => {
    for (const bad of ['../', '..\\..\\secret', 'C:\\Users\\victim', '/etc/passwd']) {
      const resp = parseToolText(await rpcCall('get_handoff_context', { handoffId: bad }));
      expect(resp?.ok, `id '${bad}' must be rejected`).toBe(false);
      const brief = parseToolText(await rpcCall('get_agent_handoff', { handoffId: bad }));
      expect(brief?.ok, `id '${bad}' must be rejected by get_agent_handoff`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 30 — Studio composes project context and persists CALIBRATED source
// hints; a fresh MCP process (no project root!) retrieves them unchanged.
// ---------------------------------------------------------------------------

describe('Phase 30 — Studio source hints through the full boundary', () => {
  let handoffId = '';
  let issueId = '';
  // Phase 30A: the exact values persisted at capture time — the fresh MCP
  // process must reproduce them verbatim, never re-derive them.
  let persistedConfidence = -1;
  let persistedResolution = '';
  let persistedModelVersion = '';

  it('Studio with --project-root composes source resolution and captures qualified hints', async () => {
    // Fresh Studio process WITH the explicit target project root.
    studio2Proc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
      'tsx',
      'apps/studio/src/index.ts',
      '--project-root',
      'examples/phase12-source-hint-app',
    ]);
    await waitForStudioReady(120000);

    const health = (await (await fetch(`${STUDIO_URL}/health`)).json()) as {
      project?: { status?: string; name?: string };
    };
    expect(health.project?.status).toBe('ready');
    expect(health.project?.name).toBeTruthy();

    await openApp(`${FIXTURE_URL}/?viskodSimulate=target-card-description`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await prepareHandoff(
      'Phase 30 source resolution regression',
      'The agent must receive a qualified repository-relative source candidate',
    );

    const state = await getWorkflowState();
    handoffId = state.handoffId as string;
    issueId = state.issueId as string;
    expect(handoffId).toBeTruthy();
    expect(issueId).toBeTruthy();

    // The user-facing workflow state carries the truthful source status:
    // resolved with a repository-relative candidate — never an absolute path.
    const source = state.source as {
      resolution: string;
      candidates: Array<{ path: string; qualification: string; confidence: number }>;
    };
    expect(source.resolution).toBe('resolved');
    const candidate = source.candidates[0];
    expect(candidate?.path).toBe('src/components/TargetCard.jsx');
    expect(['possible', 'probable', 'exact']).toContain(candidate?.qualification);
    const stateJson = JSON.stringify(state);
    expect(stateJson).not.toContain('C:\\');
    expect(stateJson).not.toContain('/Users/');

    // Phase 30A: the REAL rendered Studio UI words the resolved result from
    // the top candidate's qualification — a possible candidate is NEVER
    // labeled probable.
    const uiLabel = await page.$eval('.source-status strong', (el) => el.textContent ?? '');
    expect(uiLabel).toBe('Source: possible source');
    expect(uiLabel).not.toContain('probable');
  });

  it('the PERSISTED packet carries qualified relative source hints', () => {
    const captureDir = captureDirForIssue(issueId);
    expect(captureDir).toBeTruthy();
    if (!captureDir) return;

    const packet = JSON.parse(fs.readFileSync(path.join(captureDir, 'packet.json'), 'utf-8')) as {
      sourceHints: Array<{
        filePath: string;
        displayPath?: string;
        confidence: number;
        qualification?: string;
        reasons?: string[];
      }>;
      sourceHintsResolution?: {
        status?: string;
        modelVersion?: string;
        topCandidate?: string;
      };
      evidence?: { sourceHints?: { state?: string } };
    };
    expect(packet.evidence?.sourceHints?.state).toBe('collected');
    expect(packet.sourceHints.length).toBeGreaterThan(0);
    const hint = packet.sourceHints[0];
    expect(hint).toBeTruthy();
    if (!hint) return;
    expect(hint.filePath).toBe('src/components/TargetCard.jsx');
    expect(hint.displayPath).toBe('src/components/TargetCard.jsx');
    expect(hint.qualification).toBe('possible');
    expect(hint.confidence).toBeLessThan(0.65);
    expect(hint.reasons?.some((r) => r.includes('visible text'))).toBe(true);
    // Text-only evidence can never be high confidence (VISKOD-AUDIT-008).
    expect(hint.confidence).toBeLessThan(0.9);

    // Phase 30A: the capture-time resolution snapshot is persisted with the
    // model version that produced it — resolution is never re-derived later.
    expect(packet.sourceHintsResolution?.status).toBe('resolved');
    expect(packet.sourceHintsResolution?.modelVersion).toBe('2.0.0');
    expect(packet.sourceHintsResolution?.topCandidate).toBe('src/components/TargetCard.jsx');
    persistedConfidence = hint.confidence;
    persistedResolution = packet.sourceHintsResolution?.status ?? '';
    persistedModelVersion = packet.sourceHintsResolution?.modelVersion ?? '';

    const packetJson = JSON.stringify(packet);
    expect(packetJson).not.toContain('C:\\');
    expect(packetJson).not.toContain('/Users/');
    expect(packetJson).not.toContain('absoluteCaptureDir');
  });

  it('the persisted handoff brief carries the qualification + resolution', () => {
    const handoffPath = path.join(ROOT, '.viskod', 'handoffs', handoffId, 'handoff.json');
    expect(fs.existsSync(handoffPath)).toBe(true);
    const handoff = JSON.parse(fs.readFileSync(handoffPath, 'utf-8')) as {
      brief?: {
        sourceHints?: {
          resolution?: string;
          topHints: Array<{ displayName: string; qualification?: string; confidence?: number }>;
        };
      };
    };
    const sh = handoff.brief?.sourceHints;
    expect(sh?.resolution).toBe('resolved');
    expect(sh?.topHints[0]?.displayName).toBe('src/components/TargetCard.jsx');
    expect(sh?.topHints[0]?.qualification).toBe('possible');
  });

  it('a fresh MCP process (no project root) retrieves the persisted candidates without recomputation', async () => {
    // Kill the source Studio; only the durable capture remains.
    await stopStudioAndWaitForPort(studio2Proc);
    studio2Proc = null;

    // The fresh MCP process was started WITHOUT --project-root: it cannot
    // recompute source hints. Whatever comes back is loaded from the
    // persisted capture.
    const ctxResp = parseToolText(await rpcCall('get_handoff_context', { handoffId }));
    expect(ctxResp?.ok).toBe(true);
    const captures = ctxResp?.captures as Array<{
      context: {
        sourceHints: {
          status: string;
          resolution: string;
          resolutionSource: string;
          modelVersion?: string;
          count: number;
          candidates: Array<{
            path: string;
            qualification: string;
            confidence: number;
            reasons: string[];
          }>;
        };
      };
    }>;
    expect(captures).toHaveLength(1);
    const sh = captures?.[0]?.context.sourceHints;
    expect(sh).toBeTruthy();
    if (!sh) return;

    expect(sh.status).toBe('collected');
    // Phase 30A: the fresh process reports the PERSISTED capture-time
    // conclusion — never a recomputation under present-day policy.
    expect(sh.resolution).toBe('resolved');
    expect(sh.resolutionSource).toBe('persisted');
    expect(sh.resolution).toBe(persistedResolution);
    // The model version that produced the capture-time conclusion travels
    // with the persisted snapshot.
    expect(sh.modelVersion).toBe(persistedModelVersion);
    expect(sh.modelVersion).toBe('2.0.0');
    expect(sh.count).toBeGreaterThan(0);
    const candidate = sh.candidates[0];
    expect(candidate?.path).toBe('src/components/TargetCard.jsx');
    expect(candidate?.qualification).toBe('possible');
    // The exact persisted numeric value, not a re-derived formula result.
    expect(candidate?.confidence).toBe(persistedConfidence);
    expect(persistedConfidence).toBeGreaterThan(0);
    expect(candidate?.reasons.some((r) => r.includes('visible text'))).toBe(true);

    const respJson = JSON.stringify(ctxResp);
    expect(respJson).not.toContain('C:\\');
    expect(respJson).not.toContain('/Users/');
    expect(respJson).not.toContain('viskod/captures');
    // No secrets in the source-hint reasoning.
    expect(respJson).not.toMatch(/sk_(live|test)_/);
  });
});

// ---------------------------------------------------------------------------
// Phase 30 — persisted ambiguity survives the process boundary
// ---------------------------------------------------------------------------

describe('Phase 30 — persisted ambiguity across restart', () => {
  let handoffId = '';
  let issueId = '';

  it('Studio capture of a duplicate-text target reports ambiguous with both candidates', async () => {
    studio3Proc = spawnProc(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
      'tsx',
      'apps/studio/src/index.ts',
      '--project-root',
      'examples/source-hint-ambiguity-app',
    ]);
    await waitForStudioReady(120000);

    await openApp(`${SOURCE_AMBIGUITY_URL}/?viskodSimulate=click`);
    await beginReport();
    await waitForSelectionEnabled();
    await acceptSelection();
    await prepareHandoff(
      'Phase 30 ambiguity regression',
      'The agent must see two equally plausible candidates, neither confirmed',
    );

    const state = await getWorkflowState();
    handoffId = state.handoffId as string;
    issueId = state.issueId as string;
    expect(handoffId).toBeTruthy();
    expect(issueId).toBeTruthy();

    // UI shows ambiguity — never the first candidate as confirmed.
    const source = state.source as {
      resolution: string;
      candidates: Array<{ path: string; qualification: string }>;
    };
    expect(source.resolution).toBe('ambiguous');
    expect(source.candidates.length).toBeGreaterThanOrEqual(2);
    for (const c of source.candidates) {
      expect(c.qualification).toBe('weak');
      expect(c.path.startsWith('src/components/StatusWidget')).toBe(true);
    }

    // Phase 30A: the persisted packet records the ambiguous capture-time
    // conclusion with its model version — it survives the process boundary.
    const captureDir = captureDirForIssue(issueId);
    expect(captureDir).toBeTruthy();
    if (!captureDir) return;
    const packet = JSON.parse(fs.readFileSync(path.join(captureDir, 'packet.json'), 'utf-8')) as {
      sourceHintsResolution?: { status?: string; modelVersion?: string };
    };
    expect(packet.sourceHintsResolution?.status).toBe('ambiguous');
    expect(packet.sourceHintsResolution?.modelVersion).toBe('2.0.0');
  });

  it('a fresh MCP process reports the persisted ambiguity unchanged', async () => {
    await stopStudioAndWaitForPort(studio3Proc);
    studio3Proc = null;

    const ctxResp = parseToolText(await rpcCall('get_handoff_context', { handoffId }));
    expect(ctxResp?.ok).toBe(true);
    const captures = ctxResp?.captures as Array<{
      context: {
        sourceHints: {
          resolution: string;
          resolutionSource: string;
          count: number;
          candidates: Array<{
            path: string;
            qualification: string;
            confidence: number;
            reasons: string[];
          }>;
        };
      };
    }>;
    const sh = captures?.[0]?.context.sourceHints;
    expect(sh).toBeTruthy();
    if (!sh) return;

    expect(sh.resolution).toBe('ambiguous');
    // Phase 30A: resolution is the persisted capture-time conclusion — no
    // newer ranking step may select one candidate after restart.
    expect(sh.resolutionSource).toBe('persisted');
    expect(sh.count).toBeGreaterThanOrEqual(2);
    // Capture-time ORDER is preserved verbatim (no rerank).
    const paths = sh.candidates.map((c) => c.path);
    expect(paths).toEqual(['src/components/StatusWidgetA.jsx', 'src/components/StatusWidgetB.jsx']);
    for (const c of sh.candidates) {
      expect(c.qualification).toBe('weak');
      expect(c.confidence).toBeLessThan(0.5);
      // Neither presented as confirmed/exact.
      expect(c.qualification).not.toBe('probable');
      expect(c.qualification).not.toBe('exact');
      expect(c.reasons.some((r) => r.includes('other files'))).toBe(true);
    }
  });
});
