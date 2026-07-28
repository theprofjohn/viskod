export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';
export type WorkspaceType =
  | 'single'
  | 'pnpm-workspace'
  | 'turbo'
  | 'nx'
  | 'lerna'
  | 'rush'
  | 'unknown';
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

export interface ScannerHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  lastScanTimestamp: string | null;
  lastScanDurationMs: number;
  projectsScanned: number;
  scansFailed: number;
  cacheSize: number;
}
