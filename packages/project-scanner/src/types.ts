export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/** Workspace types supported by the public metadata contract. */
export type WorkspaceType =
  | 'single'
  | 'pnpm-workspace'
  | 'npm-workspace'
  | 'yarn-workspace'
  | 'unknown';

/** Workspace declarations detected by the scanner before boundary mapping. */
export type DetectedWorkspaceType = WorkspaceType | 'turbo' | 'nx' | 'lerna' | 'rush';
export type Framework =
  | 'react'
  | 'nextjs'
  | 'vue'
  | 'nuxt'
  | 'svelte'
  | 'sveltekit'
  | 'angular'
  | 'solid'
  | 'astro'
  | 'remix'
  | 'qwik'
  | 'unknown';
export type CssFramework =
  | 'tailwind'
  | 'unocss'
  | 'styled-components'
  | 'css-modules'
  | 'vanilla-extract'
  | 'unknown';
export type UILibrary =
  | 'shadcn-ui'
  | 'material-ui'
  | 'chakra-ui'
  | 'daisyui'
  | 'ant-design'
  | 'radix-ui'
  | 'unknown';

export type AnimationLibrary =
  | 'framer-motion'
  | 'gsap'
  | 'three.js'
  | 'react-three-fiber'
  | 'lottie'
  | 'css-animation'
  | 'unknown';

export interface ProjectMetadata {
  projectId: string;
  name: string;
  rootPath: string;
  packageManager: PackageManager;
  workspaceType: WorkspaceType;
  language: 'typescript' | 'javascript' | 'mixed';
  runtime: string;
  nodeVersion?: string;
}

export interface FrameworkEvidence {
  framework: Framework;
  method: 'dependency' | 'config-file' | 'file-pattern' | 'directory-convention';
  detail: string;
  confidence: number;
}

export interface FrameworkDetection {
  primary: Framework | null;
  detected: Framework[];
  evidence: FrameworkEvidence[];
  confidence: number;
}

export interface Route {
  path: string;
  file: string;
  type: 'page' | 'layout' | 'api' | 'middleware' | 'unknown';
  isDynamic: boolean;
  params?: string[];
}

export interface RouteMap {
  framework: Framework;
  routes: Route[];
  layoutPattern?: string;
  dynamicRoutePattern?: string;
  totalRoutes: number;
}

export interface ComponentIndex {
  directories: string[];
  namingPatterns: string[];
  frameworkComponents?: string[];
  totalFiles: number;
}

export interface DesignSystemDetection {
  cssFramework: CssFramework | null;
  uiLibrary: UILibrary | null;
  animationLibrary: AnimationLibrary | null;
  evidence: string[];
}

export interface ProjectConfig {
  file: string;
  type: 'typescript' | 'vite' | 'next' | 'tailwind' | 'eslint' | 'biome' | 'postcss' | 'other';
  exists: boolean;
  path: string;
}

export interface ScannerDiagnostic {
  level: 'warning' | 'error';
  message: string;
  stage: 'workspace' | 'framework' | 'routes' | 'components' | 'design-system' | 'configuration';
  detail?: string;
}

export interface ScanResult {
  fingerprint: string;
  metadata: ProjectMetadata;
  framework: FrameworkDetection;
  routes: RouteMap;
  components: ComponentIndex;
  designSystem: DesignSystemDetection;
  configuration: ProjectConfig[];
  diagnostics: ScannerDiagnostic[];
  scanDurationMs: number;
  timestamp: string;
}

/**
 * A workspace package discovered from declared metadata (pnpm-workspace.yaml
 * or package.json workspaces). All paths are repository-relative at external
 * boundaries; absolute paths are used only for internal filesystem operations.
 */
export interface WorkspacePackage {
  /** Package name from its package.json (e.g. "@acme/ui"). */
  name: string;
  /** Repository-relative path to the package directory. */
  relativeRoot: string;
  /** Repository-relative path to the package's package.json. */
  packageJsonPath: string;
  /** Repository-relative source root directories within this package. */
  sourceRoots: string[];
  /** Names of workspace dependencies this package declares. */
  workspaceDependencies: string[];
}

export interface WorkspaceDiscovery {
  /** Whether this is a workspace/monorepo or a single package. */
  isWorkspace: boolean;
  /** The declared workspace type. */
  workspaceType: WorkspaceType;
  /** All discovered workspace packages (empty for single-package repos). */
  packages: WorkspacePackage[];
  /** Repository-relative glob patterns from workspace metadata. */
  globs: string[];
  /** Diagnostics from workspace discovery. */
  diagnostics: ScannerDiagnostic[];
}

export interface ScannerHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  lastScanTimestamp: string | null;
  lastScanDurationMs: number;
  projectsScanned: number;
  scansFailed: number;
  cacheSize: number;
}
