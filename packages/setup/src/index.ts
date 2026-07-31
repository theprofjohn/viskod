import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Result } from '@viskod/shared';
import { ok, err, ErrorCategory, ErrorSeverity, VISKOD_STORAGE_DIR } from '@viskod/shared';
import type {
  FirstRunSetupState,
  ProjectDetectionResult,
  WorkspaceInitResult,
  SetupCheckResult,
  SetupSmokeResult,
  SetupCapabilities,
  WizardState,
  WizardStep,
  LiveMcpVerification,
  AgentConfigInfo,
} from './types';
import { detectProject } from './detector';
import { initializeWorkspace, repairWorkspace } from './workspace';
import { runSetupChecks, verifyMcpToolsLive, validateAppUrl, checkAgentConfigReadiness } from './checks';
import { loadSetupState, saveSetupState, createInitialSetupState } from './persistence';
import { redactSetupState } from './redaction';
import { runBrowserSmoke, runCaptureSmoke } from './browser-smoke';
export { verifyMcpToolsRuntime } from './mcp-runtime';
export { validateAppUrl, checkAgentConfigReadiness } from './checks';

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

function deriveCapabilities(checks: SetupCheckResult[]): SetupCapabilities {
  const statusMap = new Map<string, SetupCheckResult['status']>();
  for (const c of checks) {
    statusMap.set(c.checkId, c.status);
  }

  const isPass = (id: string) => statusMap.get(id) === 'pass';
  const isAvailable = (id: string) => statusMap.get(id) === 'pass' || statusMap.get(id) === 'warning';

  return {
    captureContext: isAvailable('mcp-tools'),
    recaptureContext: isAvailable('mcp-tools'),
    exportContext: isAvailable('mcp-tools'),
    visualSelection: isAvailable('visual-selection'),
    visualIssue: isAvailable('visual-issue'),
    agentHandoff: isAvailable('agent-handoff'),
    visualReview: isAvailable('visual-review'),
    usageSiteSourceHints: isAvailable('usage-site-hints') || isAvailable('source-hints'),
    mcpServer: isAvailable('mcp-tools'),
    browserRuntime: isAvailable('browser-runtime'),
    appReachable: isAvailable('app-reachability'),
    agentConfigReady: false, // Set later during completeSetup
  };
}

// --- Public API ---

export function getSetupState(projectRoot: string): Result<FirstRunSetupState | null> {
  return loadSetupState(projectRoot);
}

export function detectAndConfigureProject(input?: { projectRoot?: string }): Result<ProjectDetectionResult> {
  return detectProject(input);
}

export function initializeProjectWorkspace(input: { projectRoot: string }): Result<WorkspaceInitResult> {
  return initializeWorkspace(input);
}

export async function runAllChecks(input: { projectRoot: string; includeOptional?: boolean; appUrl?: string }): Promise<SetupCheckResult[]> {
  return runSetupChecks(input);
}

export function verifyMcpTools(): LiveMcpVerification {
  return verifyMcpToolsLive();
}

export function completeSetup(input: {
  projectRoot: string;
  project: ProjectDetectionResult;
  checks: SetupCheckResult[];
  smoke?: SetupSmokeResult;
  warnings?: string[];
  limitedMode?: boolean;
  appUrl?: string;
}): Result<FirstRunSetupState> {
  const existing = loadSetupState(input.projectRoot);
  const baseState = existing.ok && existing.value
    ? existing.value
    : createInitialSetupState(input.projectRoot, input.project.rootFingerprint);

  const capabilities = deriveCapabilities(input.checks);

  // Required gates for full setup completion:
  // 1. No critical failures (node, package manager, workspace)
  // 2. MCP runtime tools/list must pass
  // 3. Browser runtime must pass
  // 4. Capture smoke must produce a packetId
  //
  // Limited mode bypasses gates 2-4 for environments where full setup can't complete.
  const hasCriticalFailure = input.checks.some(
    (c) => c.severity === 'required' && c.status === 'fail' &&
      c.checkId !== 'mcp-tools-runtime' && c.checkId !== 'browser-runtime',
  );

  const mcpRuntimeCheck = input.checks.find((c) => c.checkId === 'mcp-tools-runtime');
  const mcpRuntimePassed = mcpRuntimeCheck?.status === 'pass';

  const browserCheck = input.checks.find((c) => c.checkId === 'browser-runtime');
  const browserVerified = browserCheck?.status === 'pass';

  const captureSmokePassed = !!input.smoke?.packetId;

  const isFullCompletion = !hasCriticalFailure && mcpRuntimePassed && browserVerified && captureSmokePassed;
  const isLimitedCompletion = !hasCriticalFailure && (input.limitedMode || !mcpRuntimePassed || !captureSmokePassed);

  const completed = isFullCompletion || isLimitedCompletion;
  const limitedMode = input.limitedMode || !captureSmokePassed || !mcpRuntimePassed;

  // Check agent config readiness
  const agentConfig = checkAgentConfigReadiness(input.projectRoot);

  const now = new Date().toISOString();
  const state: FirstRunSetupState = {
    ...baseState,
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
    capabilities: {
      ...capabilities,
      agentConfigReady: agentConfig.verified,
    },
    smoke: input.smoke,
    agentConfig,
    completed,
    completedAt: completed ? now : undefined,
    updatedAt: now,
  };

  const saveResult = saveSetupState(input.projectRoot, state);
  if (!saveResult.ok) return err(saveResult.error);

  return ok(redactSetupState(state));
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
        status: captureResult.value.status === 'fail' ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
        packetId: captureResult.value.packetId,
        warnings,
      });
    } else {
      warnings.push(`Capture smoke: ${captureResult.error.message}`);
    }
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
  input?: { projectRoot?: string; appUrl?: string },
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
      return advanceFromFinish(state);

    case 'ready':
      return ok(state);

    default:
      return err(setupError('SETUP_INVALID_STEP', `Unknown wizard step: ${state.step}`));
  }
}

function advanceFromWelcome(state: WizardState, input?: { projectRoot?: string; appUrl?: string }): Result<WizardState> {
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
    return err(setupError('SETUP_NO_PROJECT', 'No project detected. Please select a project folder.'));
  }

  // Initialize workspace
  const initResult = initializeProjectWorkspace({ projectRoot: state.project.rootPath });
  const workspaceInit = initResult.ok ? initResult.value : undefined;

  if (!initResult.ok) {
    return ok({
      ...state,
      step: 'setup_checklist',
      workspaceInit,
      errors: [...state.errors, initResult.error.message],
    });
  }

  return ok({
    ...state,
    step: 'setup_checklist',
    workspaceInit,
    warnings: [...state.warnings, ...workspaceInit.warnings],
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
    (c) => c.severity === 'required' && c.status === 'fail' &&
      c.checkId !== 'mcp-tools-runtime' && c.checkId !== 'browser-runtime',
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
  // If capture smoke didn't produce a packetId, we're in limited mode
  const hasPacket = state.smoke?.packetId;
  return ok({
    ...state,
    step: 'finish',
    warnings: hasPacket ? state.warnings : [...state.warnings, 'Capture smoke did not produce a packetId — limited mode'],
  });
}

function advanceFromFinish(state: WizardState): Result<WizardState> {
  if (!state.project || !state.checks) {
    return err(setupError('SETUP_INCOMPLETE', 'Cannot finish setup without project and checks.'));
  }

  const hasCaptureSmoke = state.smoke?.packetId;
  const result = completeSetup({
    projectRoot: state.project.rootPath,
    project: state.project,
    checks: state.checks,
    smoke: state.smoke,
    warnings: state.warnings,
    limitedMode: !hasCaptureSmoke,
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
    case 'welcome': return 'Welcome to Viskod — detect your project';
    case 'project_confirmation': return 'Confirm project and initialize workspace';
    case 'setup_checklist': return 'Review setup checklist';
    case 'check_remediation': return 'Fix failed checks';
    case 'run_checks': return 'Run environment checks';
    case 'run_smoke': return 'Run first capture smoke';
    case 'finish': return 'Complete setup';
    case 'ready': return 'Viskod is ready to use';
    default: return 'Unknown step';
  }
}

export function isSetupComplete(projectRoot: string): boolean {
  const result = loadSetupState(projectRoot);
  return result.ok && result.value !== null && result.value.completed;
}
