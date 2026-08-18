export type SetupCheckStatus = 'pass' | 'warning' | 'fail' | 'skipped';
export type SetupCheckSeverity = 'required' | 'recommended' | 'optional';

export type WizardStep =
  | 'welcome'
  | 'project_confirmation'
  | 'setup_checklist'
  | 'check_remediation'
  | 'run_checks'
  | 'run_smoke'
  | 'finish'
  | 'ready';

/**
 * v2 setup state machine. `complete` requires every full gate to pass;
 * `limited` is only ever entered through explicit user consent; `incomplete`
 * records a failed attempt (still persisted).
 */
export type SetupStateKind = 'complete' | 'limited' | 'incomplete';

/** Per-capability verification outcome, recorded in `capabilityStatus`. */
export type CapabilityStatus = 'verified' | 'unavailable' | 'failed' | 'skipped';

export interface SetupRemediation {
  actionId: string;
  label: string;
  kind:
    | 'retry'
    | 'open_settings'
    | 'manual_command'
    | 'repair_workspace'
    | 'choose_project'
    | 'start_browser'
    | 'restart_mcp';
  commandPreview?: string;
  safe: boolean;
}

export interface SetupCheckResult {
  checkId: string;
  name: string;
  status: SetupCheckStatus;
  severity: SetupCheckSeverity;
  summary: string;
  details?: string;
  remediation?: SetupRemediation;
  durationMs?: number;
}

export interface WorkspaceDirInfo {
  key: string;
  path: string;
  exists: boolean;
  writable: boolean;
}

export interface SetupCapabilities {
  captureContext: boolean;
  recaptureContext: boolean;
  exportContext: boolean;
  visualSelection: boolean;
  visualIssue: boolean;
  agentHandoff: boolean;
  visualReview: boolean;
  usageSiteSourceHints: boolean;
  mcpServer: boolean;
  browserRuntime: boolean;
  appReachable: boolean;
  agentConfigReady: boolean;
}

export interface AgentConfigInfo {
  detected: boolean;
  kind: 'opencode' | 'cursor' | 'claude-desktop' | 'unknown';
  configPath?: string;
  commandPreview?: string;
  verified: boolean;
}

export interface SetupSmokeResult {
  lastRunAt: string;
  status: 'pass' | 'warning' | 'fail';
  packetId?: string;
  issueId?: string;
  handoffId?: string;
  reviewId?: string;
  sourceHintStatus?: string;
  warnings: string[];
}

export interface WizardState {
  step: WizardStep;
  project?: ProjectDetectionResult;
  appUrl?: string;
  workspaceInit?: WorkspaceInitResult;
  checks?: SetupCheckResult[];
  smoke?: SetupSmokeResult;
  setupState?: FirstRunSetupState;
  warnings: string[];
  errors: string[];
}

export interface FirstRunSetupState {
  schemaVersion: 2;
  setupId: string;
  /**
   * v2 verdict: 'complete' (all gates pass), 'limited' (explicit consent
   * only), or 'incomplete' (failed attempt, still persisted).
   */
  state: SetupStateKind;
  /** True iff the user explicitly consented to a partial setup. */
  limitedMode: boolean;
  /** Capability names (never paths) explaining why setup is limited. */
  limitedReasons: string[];
  /** Viskod version that produced this state (default '0.0.0-dev'). */
  setupVersion: string;
  /** When the gates were last verified (complete/limited only). */
  verifiedAt?: string;
  /** Explicit configured project root (internal local config path). */
  projectRoot?: string;
  /** Source-resolution readiness derived from the configured root. */
  sourceResolution: 'ready' | 'unavailable' | 'invalid';
  /** Per-capability outcome; keys are capability ids. */
  capabilityStatus: Record<string, CapabilityStatus>;
  project: {
    rootDisplayName: string;
    rootFingerprint: string;
    packageManager?: string;
    framework?: string;
    workspaceType?: string;
  };
  appUrl?: string;
  workspace: {
    initialized: boolean;
    directories: WorkspaceDirInfo[];
  };
  checks: SetupCheckResult[];
  capabilities: SetupCapabilities;
  smoke?: SetupSmokeResult;
  agentConfig?: AgentConfigInfo;
  /** Legacy compat: true iff state !== 'incomplete'. */
  completed: boolean;
  completedAt?: string;
  updatedAt: string;
  redaction: {
    applied: boolean;
    rules: string[];
  };
}

export interface ProjectDetectionResult {
  rootPath: string;
  rootDisplayName: string;
  rootFingerprint: string;
  name: string;
  packageManager?: string;
  framework?: string;
  workspaceType?: string;
  language?: string;
  hasExistingViskodDir: boolean;
}

export interface WorkspaceInitResult {
  initialized: boolean;
  directories: WorkspaceDirInfo[];
  warnings: string[];
}

export interface McpToolVerification {
  toolName: string;
  found: boolean;
  hasInputSchema: boolean;
}

export interface LiveMcpVerification {
  serverReachable: boolean;
  toolsFound: McpToolVerification[];
  requiredToolsPresent: boolean;
  missingRequiredTools: string[];
  /** Runtime mode of the verified serve command. */
  mode: 'installed' | 'dev';
  /** Monotonic timings recorded by the runtime verification. */
  timing?: {
    spawnMs: number;
    initializeMs: number;
    toolsListMs: number;
    totalMs: number;
  };
}

export interface AppUrlValidation {
  valid: boolean;
  url: string;
  hostname: string;
  port?: number;
  reason?: string;
}
