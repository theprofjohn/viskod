import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Result } from '@viskod/shared';
import { ErrorCategory, ErrorSeverity, VISKOD_STORAGE_DIR, err, ok } from '@viskod/shared';
import { checkAgentConfigReadiness as resolveAgentConfigReadiness } from './agent-config';
import { runBrowserSmoke, runCaptureSmoke } from './browser-smoke';
import { runSetupChecks, verifyMcpToolsLive } from './checks';
import { detectProject } from './detector';
import { createInitialSetupState, loadSetupState, saveSetupState } from './persistence';
import { redactSetupState } from './redaction';
import type { AgentConfigInfo } from './types';
import type {
  CapabilityStatus,
  FirstRunSetupState,
  LiveMcpVerification,
  ProjectDetectionResult,
  SetupCapabilities,
  SetupCheckResult,
  SetupSmokeResult,
  SetupStateKind,
  WizardState,
  WizardStep,
  WorkspaceInitResult,
} from './types';
import { initializeWorkspace } from './workspace';
export { verifyMcpToolsRuntime } from './mcp-runtime';
export { validateAppUrl } from './checks';
export {
  detectRuntimeMode,
  findViskodCheckoutRoot,
  getMcpServeCommand,
  type McpServeCommand,
  type RuntimeMode,
} from './command-factory';
export {
  checkAgentConfigReadiness,
  installAgentConfig,
  readAgentConfig,
  resolveAgentConfigPath,
  type AgentKind,
  type InstallAgentConfigInput,
} from './agent-config';
export { runDoctor, type DoctorReport } from './doctor';
export type {
  AgentConfigInfo,
  CapabilityStatus,
  FirstRunSetupState,
  LiveMcpVerification,
  McpToolVerification,
  ProjectDetectionResult,
  SetupCapabilities,
  SetupCheckResult,
  SetupCheckSeverity,
  SetupSmokeResult,
  SetupStateKind,
} from './types';

function setupError(code: string, message: string) {
  return {
    code,
    category: ErrorCategory.CONFIGURATION,
    severity: ErrorSeverity.RECOVERABLE,
    message,
    correlationId: crypto.randomUUID(),
    subsystem: 'setup',
    timestamp: new Date().toISOString(),
  };
}

const CAPABILITY_IDS: Array<keyof SetupCapabilities> = [
  'captureContext',
  'recaptureContext',
  'exportContext',
  'visualSelection',
  'visualIssue',
  'agentHandoff',
  'visualReview',
  'usageSiteSourceHints',
  'mcpServer',
  'browserRuntime',
  'appReachable',
  'agentConfigReady',
];

/**
 * v2 capability model: every capability gets an explicit status. 'skipped'
 * is reserved for explicit user choice (consented limited mode with no smoke
 * attempt). captureContext/recaptureContext/exportContext derive from the
 * capture smoke packetId, NOT from the mcp-tools check.
 */
function deriveCapabilityStatuses(input: {
  checks: SetupCheckResult[];
  smoke?: SetupSmokeResult;
  agentConfig: AgentConfigInfo;
  limitedMode: boolean;
}): Record<string, CapabilityStatus> {
  const statusOf = (checkId: string): CapabilityStatus => {
    const check = input.checks.find((c) => c.checkId === checkId);
    if (!check) return 'unavailable';
    if (check.status === 'pass' || check.status === 'warning') return 'verified';
    if (check.status === 'skipped') return 'skipped';
    return 'failed';
  };

  const bestStatus = (...ids: string[]): CapabilityStatus => {
    const statuses = ids.map(statusOf);
    if (statuses.includes('verified')) return 'verified';
    if (statuses.includes('failed')) return 'failed';
    if (statuses.includes('skipped')) return 'skipped';
    return 'unavailable';
  };

  const captureContext: CapabilityStatus = (() => {
    if (input.limitedMode && !input.smoke) return 'skipped';
    if (input.smoke?.packetId) return 'verified';
    if (input.smoke) return 'failed';
    return 'unavailable';
  })();

  return {
    captureContext,
    recaptureContext: captureContext,
    exportContext: captureContext,
    visualSelection: statusOf('visual-selection'),
    visualIssue: statusOf('visual-issue'),
    agentHandoff: statusOf('agent-handoff'),
    visualReview: statusOf('visual-review'),
    usageSiteSourceHints: bestStatus('usage-site-hints', 'source-hints'),
    mcpServer: statusOf('mcp-tools-runtime'),
    browserRuntime: statusOf('browser-runtime'),
    appReachable: statusOf('app-reachability'),
    agentConfigReady: input.agentConfig.detected
      ? input.agentConfig.verified
        ? 'verified'
        : 'failed'
      : 'unavailable',
  };
}

function capabilityMap(statuses: Record<string, CapabilityStatus>): SetupCapabilities {
  const result = {} as SetupCapabilities;
  for (const id of CAPABILITY_IDS) {
    result[id] = statuses[id] === 'verified';
  }
  return result;
}

function deriveLimitedReasons(gates: {
  mcpRuntimePassed: boolean;
  browserVerified: boolean;
  captureSmokePassed: boolean;
}): string[] {
  const reasons: string[] = [];
  if (!gates.mcpRuntimePassed) reasons.push('mcpServer');
  if (!gates.browserVerified) reasons.push('browserRuntime');
  if (!gates.captureSmokePassed) reasons.push('captureContext');
  return reasons;
}

function deriveSourceResolution(
  projectRoot: string | undefined,
): 'ready' | 'unavailable' | 'invalid' {
  if (projectRoot === undefined || projectRoot.length === 0) return 'unavailable';
  return fs.existsSync(projectRoot) ? 'ready' : 'invalid';
}

// --- Public API ---

export function getSetupState(projectRoot: string): Result<FirstRunSetupState | null> {
  return loadSetupState(projectRoot);
}

export function detectAndConfigureProject(input?: {
  projectRoot?: string;
}): Result<ProjectDetectionResult> {
  return detectProject(input);
}

export function initializeProjectWorkspace(input: {
  projectRoot: string;
}): Result<WorkspaceInitResult> {
  return initializeWorkspace(input);
}

export async function runAllChecks(input: {
  projectRoot: string;
  includeOptional?: boolean;
  appUrl?: string;
  limitedMode?: boolean;
}): Promise<SetupCheckResult[]> {
  return runSetupChecks(input);
}

export function verifyMcpTools(): LiveMcpVerification {
  return verifyMcpToolsLive();
}

/**
 * v2 setup completion semantics:
 *
 * - full:      !hasCriticalFailure && mcpRuntimePassed && browserVerified &&
 *              captureSmokePassed  -> state 'complete', limitedMode false,
 *              verifiedAt = now.
 * - explicit:  input.limitedMode === true && !hasCriticalFailure -> state
 *              'limited', limitedMode true, limitedReasons recorded (caller-
 *              provided or derived from failed gates). NEVER implicit.
 * - otherwise: state 'incomplete', completed false, completedAt undefined —
 *              STILL PERSISTED so the failed attempt and per-capability
 *              failures are recorded.
 *
 * A later successful verification naturally overwrites the state (including
 * clearing limited mode) — recovery is a re-run.
 */
export function completeSetup(input: {
  projectRoot: string;
  project: ProjectDetectionResult;
  checks: SetupCheckResult[];
  smoke?: SetupSmokeResult;
  warnings?: string[];
  limitedMode?: boolean;
  limitedReasons?: string[];
  appUrl?: string;
  setupVersion?: string;
}): Result<FirstRunSetupState> {
  const existing = loadSetupState(input.projectRoot);
  const baseState =
    existing.ok && existing.value
      ? existing.value
      : createInitialSetupState(input.projectRoot, input.project.rootFingerprint);

  // Required gates for full setup completion:
  // 1. No critical failures (node, package manager, workspace, ...)
  // 2. MCP runtime tools/list must pass
  // 3. Browser runtime must pass
  // 4. Capture smoke must produce a packetId
  const hasCriticalFailure = input.checks.some(
    (c) =>
      c.severity === 'required' &&
      c.status === 'fail' &&
      c.checkId !== 'mcp-tools-runtime' &&
      c.checkId !== 'browser-runtime',
  );

  const mcpRuntimePassed =
    input.checks.find((c) => c.checkId === 'mcp-tools-runtime')?.status === 'pass';
  const browserVerified =
    input.checks.find((c) => c.checkId === 'browser-runtime')?.status === 'pass';
  const captureSmokePassed = !!input.smoke?.packetId;

  const isFullCompletion =
    !hasCriticalFailure && mcpRuntimePassed && browserVerified && captureSmokePassed;
  const isExplicitLimited = input.limitedMode === true && !hasCriticalFailure;

  const failedGates = { mcpRuntimePassed, browserVerified, captureSmokePassed };

  let state: SetupStateKind;
  let limitedMode: boolean;
  let limitedReasons: string[];
  let verifiedAt: string | undefined;

  const now = new Date().toISOString();

  if (isFullCompletion) {
    state = 'complete';
    limitedMode = false;
    limitedReasons = [];
    verifiedAt = now;
  } else if (isExplicitLimited) {
    state = 'limited';
    limitedMode = true;
    limitedReasons = input.limitedReasons ?? deriveLimitedReasons(failedGates);
    verifiedAt = now;
  } else {
    state = 'incomplete';
    limitedMode = false;
    limitedReasons = input.limitedReasons ?? deriveLimitedReasons(failedGates);
    verifiedAt = undefined;
  }

  const completed = state !== 'incomplete';

  // Check agent config readiness (home/cwd based detection)
  const agentConfig = resolveAgentConfigReadiness({ cwd: input.projectRoot });
  const capabilityStatus = deriveCapabilityStatuses({
    checks: input.checks,
    smoke: input.smoke,
    agentConfig,
    limitedMode: input.limitedMode === true,
  });

  const nextState: FirstRunSetupState = {
    ...baseState,
    state,
    limitedMode,
    limitedReasons,
    setupVersion: input.setupVersion ?? baseState.setupVersion,
    verifiedAt,
    projectRoot: input.projectRoot,
    sourceResolution: deriveSourceResolution(input.projectRoot),
    capabilityStatus,
    project: {
      rootDisplayName: input.project.rootDisplayName,
      rootFingerprint: input.project.rootFingerprint,
      packageManager: input.project.packageManager,
      framework: input.project.framework,
      workspaceType: input.project.workspaceType,
    },
    appUrl: input.appUrl,
    workspace: {
      initialized: true,
      directories: baseState.workspace.directories,
    },
    checks: input.checks,
    capabilities: capabilityMap(capabilityStatus),
    smoke: input.smoke,
    agentConfig,
    completed,
    completedAt: completed ? now : undefined,
    updatedAt: now,
  };

  const saveResult = saveSetupState(input.projectRoot, nextState);
  if (!saveResult.ok) return err(saveResult.error);

  return ok(redactSetupState(nextState));
}

export async function repairSetup(input: {
  projectRoot: string;
  actionId: string;
}): Promise<Result<SetupCheckResult[]>> {
  if (input.actionId === 'init-workspace' || input.actionId === 'repair_workspace') {
    const initResult = initializeWorkspace({ projectRoot: input.projectRoot });
    if (!initResult.ok) {
      return err(setupError('SETUP_REPAIR_FAILED', initResult.error.message));
    }
  }

  return ok(await runSetupChecks({ projectRoot: input.projectRoot }));
}

export async function runSmoke(input: {
  projectRoot: string;
  limitedMode?: boolean;
  url?: string;
}): Promise<Result<SetupSmokeResult>> {
  const warnings: string[] = [];
  const now = new Date().toISOString();

  // Step 1: Filesystem smoke
  try {
    const testDir = path.join(input.projectRoot, VISKOD_STORAGE_DIR, '.smoke-test');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'test.json'), JSON.stringify({ test: true }), 'utf-8');
    const content = JSON.parse(fs.readFileSync(path.join(testDir, 'test.json'), 'utf-8'));
    fs.rmSync(testDir, { recursive: true, force: true });

    if (content.test !== true) {
      return ok({ lastRunAt: now, status: 'fail', warnings: ['Filesystem smoke test failed'] });
    }
  } catch (e) {
    return ok({
      lastRunAt: now,
      status: 'fail',
      warnings: [`Filesystem smoke failed: ${e instanceof Error ? e.message : String(e)}`],
    });
  }

  // Verify workspace directories
  const requiredDirs = ['captures', 'issues', 'handoffs', 'reviews', 'setup'];
  for (const dir of requiredDirs) {
    const dirPath = path.join(input.projectRoot, VISKOD_STORAGE_DIR, dir);
    if (!fs.existsSync(dirPath)) {
      warnings.push(`Directory ${VISKOD_STORAGE_DIR}/${dir} missing`);
    }
  }

  // Step 2: Browser smoke (if not limited mode)
  if (!input.limitedMode) {
    const browserResult = await runBrowserSmoke({ projectRoot: input.projectRoot, url: input.url });
    if (browserResult.ok) {
      warnings.push(...browserResult.value.warnings);
    } else {
      warnings.push(`Browser smoke: ${browserResult.error.message}`);
    }

    // Step 3: Capture smoke
    const captureResult = await runCaptureSmoke({ projectRoot: input.projectRoot, url: input.url });
    if (captureResult.ok) {
      warnings.push(...captureResult.value.warnings);
      return ok({
        lastRunAt: now,
        status:
          captureResult.value.status === 'fail' ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
        packetId: captureResult.value.packetId,
        warnings,
      });
    }
    warnings.push(`Capture smoke: ${captureResult.error.message}`);
  }

  return ok({
    lastRunAt: now,
    status: warnings.length > 0 ? 'warning' : 'pass',
    warnings,
  });
}

// --- Wizard Flow ---

export function createWizardState(): WizardState {
  return {
    step: 'welcome',
    warnings: [],
    errors: [],
  };
}

export async function advanceWizard(
  state: WizardState,
  input?: { projectRoot?: string; appUrl?: string; limitedMode?: boolean },
): Promise<Result<WizardState>> {
  switch (state.step) {
    case 'welcome':
      return advanceFromWelcome(state, input);

    case 'project_confirmation':
      return advanceFromProjectConfirmation(state);

    case 'setup_checklist':
      return advanceFromChecklist(state);

    case 'check_remediation':
      return advanceFromRemediation(state);

    case 'run_checks':
      return advanceFromChecks(state);

    case 'run_smoke':
      return advanceFromSmoke(state);

    case 'finish':
      return advanceFromFinish(state, input);

    case 'ready':
      return ok(state);

    default:
      return err(setupError('SETUP_INVALID_STEP', `Unknown wizard step: ${state.step}`));
  }
}

function advanceFromWelcome(
  state: WizardState,
  input?: { projectRoot?: string; appUrl?: string },
): Result<WizardState> {
  const projectResult = detectAndConfigureProject(input);
  if (!projectResult.ok) {
    return ok({
      ...state,
      step: 'project_confirmation',
      errors: [...state.errors, projectResult.error.message],
    });
  }

  return ok({
    ...state,
    step: 'project_confirmation',
    project: projectResult.value,
    appUrl: input?.appUrl,
  });
}

function advanceFromProjectConfirmation(state: WizardState): Result<WizardState> {
  if (!state.project) {
    return err(
      setupError('SETUP_NO_PROJECT', 'No project detected. Please select a project folder.'),
    );
  }

  // Initialize workspace
  const initResult = initializeProjectWorkspace({ projectRoot: state.project.rootPath });
  if (!initResult.ok) {
    return ok({
      ...state,
      step: 'setup_checklist',
      workspaceInit: undefined,
      errors: [...state.errors, initResult.error.message],
    });
  }

  return ok({
    ...state,
    step: 'setup_checklist',
    workspaceInit: initResult.value,
    warnings: [...state.warnings, ...initResult.value.warnings],
  });
}

async function advanceFromChecklist(state: WizardState): Promise<Result<WizardState>> {
  if (!state.project) {
    return err(setupError('SETUP_NO_PROJECT', 'No project detected.'));
  }

  const checks = await runAllChecks({ projectRoot: state.project.rootPath, includeOptional: true });

  // For the wizard: only block on critical failures (node, package manager, workspace)
  // Runtime MCP and browser checks are required for full completion but not for wizard progression
  const criticalFailures = checks.filter(
    (c) =>
      c.severity === 'required' &&
      c.status === 'fail' &&
      c.checkId !== 'mcp-tools-runtime' &&
      c.checkId !== 'browser-runtime',
  );

  if (criticalFailures.length > 0) {
    return ok({
      ...state,
      step: 'check_remediation',
      checks,
    });
  }

  return ok({
    ...state,
    step: 'run_checks',
    checks,
  });
}

async function advanceFromRemediation(state: WizardState): Promise<Result<WizardState>> {
  if (!state.project) {
    return err(setupError('SETUP_NO_PROJECT', 'No project detected.'));
  }

  const checks = await runAllChecks({ projectRoot: state.project.rootPath, includeOptional: true });
  const failedRequired = checks.filter((c) => c.severity === 'required' && c.status === 'fail');

  if (failedRequired.length > 0) {
    return ok({
      ...state,
      checks,
      errors: [...state.errors, `${failedRequired.length} required check(s) still failing`],
    });
  }

  return ok({
    ...state,
    step: 'run_checks',
    checks,
  });
}

async function advanceFromChecks(state: WizardState): Promise<Result<WizardState>> {
  if (!state.project) {
    return err(setupError('SETUP_NO_PROJECT', 'No project detected.'));
  }

  const smokeResult = await runSmoke({ projectRoot: state.project.rootPath, url: state.appUrl });

  return ok({
    ...state,
    step: 'run_smoke',
    smoke: smokeResult.ok ? smokeResult.value : undefined,
  });
}

function advanceFromSmoke(state: WizardState): Result<WizardState> {
  // No implicit limited mode: advancing to finish never auto-selects it.
  // The explicit-consent decision belongs to advanceFromFinish.
  return ok({
    ...state,
    step: 'finish',
  });
}

function advanceFromFinish(
  state: WizardState,
  input?: { limitedMode?: boolean },
): Result<WizardState> {
  if (!state.project || !state.checks) {
    return err(setupError('SETUP_INCOMPLETE', 'Cannot finish setup without project and checks.'));
  }

  const hasCriticalFailure = state.checks.some(
    (c) =>
      c.severity === 'required' &&
      c.status === 'fail' &&
      c.checkId !== 'mcp-tools-runtime' &&
      c.checkId !== 'browser-runtime',
  );
  const mcpRuntimePassed =
    state.checks.find((c) => c.checkId === 'mcp-tools-runtime')?.status === 'pass';
  const browserVerified =
    state.checks.find((c) => c.checkId === 'browser-runtime')?.status === 'pass';
  const captureSmokePassed = !!state.smoke?.packetId;

  const isFullCompletion =
    !hasCriticalFailure && mcpRuntimePassed && browserVerified && captureSmokePassed;

  // Explicit consent is REQUIRED for anything short of a full completion.
  // advanceWizard(state, { limitedMode: true }) is the only consent path.
  if (!isFullCompletion && input?.limitedMode !== true) {
    return err(
      setupError(
        'SETUP_LIMITED_CONSENT_REQUIRED',
        'Full setup could not be verified. To continue, explicitly accept limited mode (capture, browser, and MCP runtime guarantees will be disabled).',
      ),
    );
  }

  const result = completeSetup({
    projectRoot: state.project.rootPath,
    project: state.project,
    checks: state.checks,
    smoke: state.smoke,
    warnings: state.warnings,
    limitedMode: input?.limitedMode ?? false,
    appUrl: state.appUrl,
  });

  if (!result.ok) {
    return err(result.error);
  }

  return ok({
    ...state,
    step: 'ready',
    setupState: result.value,
  });
}

export function getWizardStepDescription(step: WizardStep): string {
  switch (step) {
    case 'welcome':
      return 'Welcome to Viskod — detect your project';
    case 'project_confirmation':
      return 'Confirm project and initialize workspace';
    case 'setup_checklist':
      return 'Review setup checklist';
    case 'check_remediation':
      return 'Fix failed checks';
    case 'run_checks':
      return 'Run environment checks';
    case 'run_smoke':
      return 'Run first capture smoke';
    case 'finish':
      return 'Complete setup';
    case 'ready':
      return 'Viskod is ready to use';
    default:
      return 'Unknown step';
  }
}

export function isSetupComplete(projectRoot: string): boolean {
  const result = loadSetupState(projectRoot);
  return result.ok && result.value !== null && result.value.state !== 'incomplete';
}
