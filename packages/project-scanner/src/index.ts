import { createHash } from 'node:crypto';
import { type Dirent, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { dirname, join, resolve } from 'node:path';
import type { EventBus } from '@viskod/event-bus';
import type { Result, ViskodError } from '@viskod/shared';
import { createViskodError, err, ok } from '@viskod/shared';
import type {
  ComponentIndex,
  DesignSystemDetection,
  Framework,
  FrameworkDetection,
  FrameworkEvidence,
  PackageManager,
  ProjectConfig,
  ProjectMetadata,
  Route,
  RouteMap,
  ScanResult,
  ScannerDiagnostic,
  ScannerHealth,
  WorkspaceDiscovery,
  WorkspacePackage,
  WorkspaceType,
} from './types';

export type { ScannerHealth } from './types';

/** Map scanner-specific declarations to the supported public workspace model. */
export function mapWorkspaceType(detected: string): WorkspaceType | null {
  switch (detected) {
    case 'single':
    case 'pnpm-workspace':
    case 'npm-workspace':
    case 'yarn-workspace':
    case 'unknown':
      return detected;
    default:
      return null;
  }
}
export type {
  ScanResult,
  ProjectMetadata,
  RouteMap,
  ComponentIndex,
  FrameworkDetection,
  WorkspaceDiscovery,
  WorkspacePackage,
} from './types';

export class ProjectScanner {
  private eventBus: EventBus;
  private projectsScanned = 0;
  private scansFailed = 0;
  private lastScanTimestamp: string | null = null;
  private lastScanDurationMs = 0;
  private cacheSize = 0;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async scan(rootPath?: string): Promise<Result<ScanResult>> {
    const startTime = Date.now();

    try {
      const resolvedRoot = rootPath ?? this.discoverProjectRoot();
      if (!resolvedRoot) {
        return err(
          this.scannerError(
            'PS_NO_PROJECT_FOUND',
            'No project found. Could not locate package.json by walking up from cwd',
          ),
        );
      }

      const pkgJsonPath = join(resolvedRoot, 'package.json');
      let pkg: Record<string, unknown>;
      try {
        pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      } catch {
        return err(this.scannerError('PS_INVALID_PACKAGE_JSON', 'Failed to parse package.json'));
      }

      const name = String(pkg.name ?? 'unknown');
      const fingerprint = createHash('sha256')
        .update(`${name}:${resolvedRoot}`)
        .digest('hex')
        .slice(0, 16);

      const metadata = this.buildMetadata(resolvedRoot, pkg);
      const framework = this.detectFrameworkInternal(resolvedRoot, pkg);
      const routes = this.discoverRoutes(resolvedRoot, framework.primary);
      const components = this.discoverComponents(resolvedRoot);
      const designSystem = this.detectDesignSystemInternal(resolvedRoot, pkg);
      const configs = this.discoverConfigFiles(resolvedRoot);
      const diagnostics: ScannerDiagnostic[] = this.collectDiagnostics(framework);

      const duration = Date.now() - startTime;

      this.projectsScanned++;
      this.lastScanTimestamp = new Date().toISOString();
      this.lastScanDurationMs = duration;

      this.eventBus.publish({
        eventId: crypto.randomUUID(),
        eventType: 'PS_EVENT:PROJECT_SCANNED',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        source: 'project-scanner',
        correlationId: fingerprint,
        payload: {
          projectName: name,
          framework: framework.primary,
          scanDurationMs: duration,
        },
      });

      return ok({
        fingerprint,
        metadata,
        framework,
        routes,
        components,
        designSystem,
        configuration: configs,
        diagnostics,
        scanDurationMs: duration,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.scansFailed++;
      return err(this.scannerError('PS_SCAN_FAILED', `Scan failed: ${String(error)}`));
    }
  }

  async detectFramework(rootPath: string): Promise<Result<FrameworkDetection>> {
    try {
      const pkgJsonPath = join(rootPath, 'package.json');
      if (!existsSync(pkgJsonPath)) {
        return err(this.scannerError('PS_NO_PROJECT_FOUND', 'No package.json found at rootPath'));
      }

      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      return ok(this.detectFrameworkInternal(rootPath, pkg));
    } catch (error) {
      return err(
        this.scannerError('PS_SCAN_FAILED', `Framework detection failed: ${String(error)}`),
      );
    }
  }

  async getProjectMetadata(rootPath: string): Promise<Result<ProjectMetadata>> {
    try {
      const pkgJsonPath = join(rootPath, 'package.json');
      if (!existsSync(pkgJsonPath)) {
        return err(this.scannerError('PS_NO_PROJECT_FOUND', 'No package.json found at rootPath'));
      }

      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      return ok(this.buildMetadata(rootPath, pkg));
    } catch (error) {
      return err(
        this.scannerError('PS_SCAN_FAILED', `Metadata extraction failed: ${String(error)}`),
      );
    }
  }

  health(): ScannerHealth {
    const status: ScannerHealth['status'] = 'healthy';
    return {
      status,
      lastScanTimestamp: this.lastScanTimestamp,
      lastScanDurationMs: this.lastScanDurationMs,
      projectsScanned: this.projectsScanned,
      scansFailed: this.scansFailed,
      cacheSize: this.cacheSize,
    };
  }
  async discoverWorkspace(rootPath: string): Promise<Result<WorkspaceDiscovery>> {
    try {
      const unsupported = ['turbo.json', 'nx.json', 'lerna.json', 'rush.json'].find((file) =>
        existsSync(join(rootPath, file)),
      );
      if (unsupported)
        return err(
          this.scannerError(
            'PS_WORKSPACE_UNSUPPORTED',
            `Workspace format '${unsupported}' is unsupported; workspace metadata is unavailable.`,
          ),
        );
      const workspaceType = this.detectWorkspaceType(rootPath);
      if (workspaceType === 'single')
        return ok({ isWorkspace: false, workspaceType, packages: [], globs: [], diagnostics: [] });
      const globs =
        workspaceType === 'pnpm-workspace'
          ? await this.parsePnpmWorkspaceYamlAsync(rootPath)
          : await this.parsePackageJsonWorkspacesAsync(rootPath);
      const packageDirs = new Set<string>();
      for (const glob of globs)
        for (const relativeRoot of await this.expandWorkspaceGlobAsync(rootPath, glob))
          packageDirs.add(relativeRoot);
      const packages: WorkspacePackage[] = [];
      for (const relativeRoot of [...packageDirs].sort()) {
        const packageJsonPath = `${relativeRoot}/package.json`;
        try {
          const pkg = JSON.parse(
            await readFile(join(rootPath, packageJsonPath), 'utf-8'),
          ) as Record<string, unknown>;
          const sourceRoots: string[] = [];
          for (const candidate of ['src', 'lib', 'app']) {
            const relative = `${relativeRoot}/${candidate}`;
            try {
              if ((await stat(join(rootPath, relative))).isDirectory()) sourceRoots.push(relative);
            } catch {
              /* deleted during scan */
            }
          }
          packages.push({
            name: String(pkg.name ?? relativeRoot),
            relativeRoot,
            packageJsonPath,
            sourceRoots,
            workspaceDependencies: this.extractWorkspaceDependencies(rootPath, pkg),
          });
        } catch {
          /* deleted or invalid package during scan */
        }
      }
      return ok({ isWorkspace: true, workspaceType, packages, globs, diagnostics: [] });
    } catch (error) {
      try {
        return ok(this.discoverWorkspaceSync(rootPath));
      } catch {
        return err(
          this.scannerError(
            'PS_WORKSPACE_DISCOVERY_FAILED',
            `Workspace discovery failed: ${String(error)}`,
          ),
        );
      }
    }
  }

  private async parsePnpmWorkspaceYamlAsync(rootPath: string): Promise<string[]> {
    try {
      const content = await readFile(join(rootPath, 'pnpm-workspace.yaml'), 'utf-8');
      return content.split('\n').flatMap((line) => {
        const match = line.trim().match(/^[-]\s+['"]?([^'"]+)['"]?$/);
        return match?.[1] ? [match[1]] : [];
      });
    } catch {
      return [];
    }
  }

  private async parsePackageJsonWorkspacesAsync(rootPath: string): Promise<string[]> {
    try {
      const pkg = JSON.parse(await readFile(join(rootPath, 'package.json'), 'utf-8')) as Record<
        string,
        unknown
      >;
      const workspaces = pkg.workspaces;
      if (Array.isArray(workspaces))
        return workspaces.filter((value): value is string => typeof value === 'string');
      if (
        workspaces &&
        typeof workspaces === 'object' &&
        Array.isArray((workspaces as { packages?: unknown }).packages)
      )
        return (workspaces as { packages: unknown[] }).packages.filter(
          (value): value is string => typeof value === 'string',
        );
    } catch {
      /* invalid config */
    }
    return [];
  }

  private async expandWorkspaceGlobAsync(rootPath: string, pattern: string): Promise<string[]> {
    const parts = pattern.split('/').filter(Boolean);
    const results: string[] = [];
    const walk = async (dir: string, index: number): Promise<void> => {
      if (results.length >= 500 || index >= parts.length) return;
      let entries: Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const part = parts[index] ?? '';
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules')
          continue;
        if (!part.includes('*') && entry.name !== part) continue;
        if (part.includes('*') && !this.globMatches(entry.name, part)) continue;
        const child = join(dir, entry.name);
        if (index === parts.length - 1)
          results.push(path.relative(rootPath, child).replace(/\\/g, '/'));
        else await walk(child, index + 1);
      }
    };
    await walk(rootPath, 0);
    return results;
  }

  // ---- Private helpers ----

  private discoverProjectRoot(): string | null {
    let current = process.cwd();
    const root = resolve('/');

    while (current !== root) {
      if (existsSync(join(current, 'package.json'))) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    if (existsSync(join(root, 'package.json'))) {
      return root;
    }

    return null;
  }

  private buildMetadata(rootPath: string, pkg: Record<string, unknown>): ProjectMetadata {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const allDeps = { ...deps, ...devDeps };
    const name = String(pkg.name ?? 'unknown');

    const packageManager = this.detectPackageManager(rootPath);
    const workspaceType = this.detectWorkspaceType(rootPath);
    const language = this.detectLanguage(rootPath, allDeps);
    const runtime = allDeps.next ? 'nextjs' : allDeps['@nestjs/core'] ? 'nestjs' : 'node';
    const nodeVersion =
      (pkg.engines as Record<string, string> | undefined)?.node ??
      ((pkg as Record<string, unknown>).volta as string | undefined) ??
      undefined;

    return {
      projectId: createHash('sha256').update(`${name}:${rootPath}`).digest('hex').slice(0, 12),
      name,
      rootPath,
      packageManager,
      workspaceType,
      language,
      runtime,
      nodeVersion,
    };
  }

  private detectPackageManager(rootPath: string): PackageManager {
    if (existsSync(join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(rootPath, 'package-lock.json'))) return 'npm';
    if (existsSync(join(rootPath, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(rootPath, 'bun.lock')) || existsSync(join(rootPath, 'bun.lockb')))
      return 'bun';
    return 'npm';
  }

  private detectWorkspaceType(rootPath: string): WorkspaceType {
    if (existsSync(join(rootPath, 'pnpm-workspace.yaml'))) return 'pnpm-workspace';
    if (existsSync(join(rootPath, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(join(rootPath, 'package.json'), 'utf-8')) as Record<
          string,
          unknown
        >;
        const workspaces = pkg.workspaces;
        if (Array.isArray(workspaces) || (workspaces && typeof workspaces === 'object')) {
          return existsSync(join(rootPath, 'yarn.lock')) ? 'yarn-workspace' : 'npm-workspace';
        }
      } catch {
        // Invalid package metadata is reported by the scan boundary.
      }
    }
    return 'single';
  }

  private detectLanguage(
    rootPath: string,
    _allDeps: Record<string, string>,
  ): 'typescript' | 'javascript' | 'mixed' {
    const hasTsConfig = existsSync(join(rootPath, 'tsconfig.json'));
    const hasJsConfig = existsSync(join(rootPath, 'jsconfig.json'));

    if (hasTsConfig && hasJsConfig) return 'mixed';
    if (hasTsConfig) return 'typescript';
    if (hasJsConfig) return 'javascript';

    const hasTsFiles =
      this.hasFileExtension(rootPath, '.ts') || this.hasFileExtension(rootPath, '.tsx');
    const hasJsFiles =
      this.hasFileExtension(rootPath, '.js') || this.hasFileExtension(rootPath, '.jsx');

    if (hasTsFiles && hasJsFiles) return 'mixed';
    if (hasTsFiles) return 'typescript';
    return 'javascript';
  }

  private hasFileExtension(rootPath: string, ext: string): boolean {
    try {
      const srcDir = join(rootPath, 'src');
      const searchDir = existsSync(srcDir) ? srcDir : rootPath;
      return this.dirContainsExtension(searchDir, ext, 3);
    } catch {
      return false;
    }
  }

  private dirContainsExtension(dir: string, ext: string, depth: number): boolean {
    if (depth < 0) return false;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith(ext)) return true;
        if (entry.isDirectory() && this.dirContainsExtension(fullPath, ext, depth - 1)) return true;
      }
    } catch {
      // permission errors — skip
    }
    return false;
  }

  private detectFrameworkInternal(
    rootPath: string,
    pkg: Record<string, unknown>,
  ): FrameworkDetection {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const allDeps = { ...deps, ...devDeps };
    const evidence: FrameworkEvidence[] = [];

    // Dependency-based detection
    const depChecks: Array<[string, Framework]> = [
      ['next', 'nextjs'],
      ['react', 'react'],
      ['vue', 'vue'],
      ['nuxt', 'nuxt'],
      ['svelte', 'svelte'],
      ['@sveltejs/kit', 'sveltekit'],
      ['@angular/core', 'angular'],
      ['solid-js', 'solid'],
      ['astro', 'astro'],
      ['@remix-run/react', 'remix'],
      ['@builder.io/qwik', 'qwik'],
    ];

    for (const [dep, framework] of depChecks) {
      if (allDeps[dep]) {
        evidence.push({
          framework,
          method: 'dependency',
          detail: `Found "${dep}" in package.json dependencies`,
          confidence: 0.7,
        });
      }
    }

    // Config-file based detection
    if (
      existsSync(join(rootPath, 'next.config.js')) ||
      existsSync(join(rootPath, 'next.config.ts')) ||
      existsSync(join(rootPath, 'next.config.mjs'))
    ) {
      evidence.push({
        framework: 'nextjs',
        method: 'config-file',
        detail: 'Found next.config.* file',
        confidence: 0.9,
      });
    }
    if (existsSync(join(rootPath, 'svelte.config.js'))) {
      evidence.push({
        framework: 'sveltekit',
        method: 'config-file',
        detail: 'Found svelte.config.js',
        confidence: 0.9,
      });
    }
    if (
      existsSync(join(rootPath, 'astro.config.js')) ||
      existsSync(join(rootPath, 'astro.config.ts')) ||
      existsSync(join(rootPath, 'astro.config.mjs'))
    ) {
      evidence.push({
        framework: 'astro',
        method: 'config-file',
        detail: 'Found astro.config.* file',
        confidence: 0.9,
      });
    }
    if (
      existsSync(join(rootPath, 'remix.config.js')) ||
      existsSync(join(rootPath, 'remix.config.ts'))
    ) {
      evidence.push({
        framework: 'remix',
        method: 'config-file',
        detail: 'Found remix.config.* file',
        confidence: 0.9,
      });
    }
    if (
      existsSync(join(rootPath, 'nuxt.config.js')) ||
      existsSync(join(rootPath, 'nuxt.config.ts'))
    ) {
      evidence.push({
        framework: 'nuxt',
        method: 'config-file',
        detail: 'Found nuxt.config.* file',
        confidence: 0.9,
      });
    }
    if (existsSync(join(rootPath, 'angular.json'))) {
      evidence.push({
        framework: 'angular',
        method: 'config-file',
        detail: 'Found angular.json',
        confidence: 0.9,
      });
    }

    // Directory-convention detection
    if (
      existsSync(join(rootPath, 'app')) &&
      this.dirContainsFile(join(rootPath, 'app'), 'page.tsx', 2)
    ) {
      evidence.push({
        framework: 'nextjs',
        method: 'directory-convention',
        detail: 'Found app/ directory with page.tsx (Next.js App Router)',
        confidence: 0.95,
      });
    }
    if (existsSync(join(rootPath, 'pages')) && existsSync(join(rootPath, 'pages', '_app.tsx'))) {
      evidence.push({
        framework: 'nextjs',
        method: 'directory-convention',
        detail: 'Found pages/ directory with _app.tsx (Next.js Pages Router)',
        confidence: 0.9,
      });
    }
    if (existsSync(join(rootPath, 'src', 'routes'))) {
      evidence.push({
        framework: 'sveltekit',
        method: 'directory-convention',
        detail: 'Found src/routes/ directory (SvelteKit convention)',
        confidence: 0.85,
      });
    }
    if (
      existsSync(join(rootPath, 'pages')) &&
      this.dirContainsFile(join(rootPath, 'pages'), '.vue', 2)
    ) {
      evidence.push({
        framework: 'nuxt',
        method: 'directory-convention',
        detail: 'Found pages/ directory with .vue files (Nuxt convention)',
        confidence: 0.85,
      });
    }

    // Deduplicate and determine primary
    const detectedFrameworks = [...new Set(evidence.map((e) => e.framework))];
    const primary = this.resolvePrimaryFramework(detectedFrameworks);
    const confidence =
      evidence.length > 0
        ? evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
        : 0;

    return {
      primary,
      detected: detectedFrameworks,
      evidence,
      confidence,
    };
  }

  private dirContainsFile(dir: string, suffix: string, depth: number): boolean {
    if (depth < 0) return false;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith(suffix)) return true;
        if (entry.isDirectory() && this.dirContainsFile(fullPath, suffix, depth - 1)) return true;
      }
    } catch {
      // skip
    }
    return false;
  }

  private resolvePrimaryFramework(detected: Framework[]): Framework | null {
    if (detected.length === 0) return null;
    if (detected.length === 1) return detected[0] ?? null;

    const priority: Framework[] = [
      'nextjs',
      'sveltekit',
      'nuxt',
      'remix',
      'astro',
      'qwik',
      'angular',
      'react',
      'vue',
      'svelte',
      'solid',
    ];

    for (const fw of priority) {
      if (detected.includes(fw)) return fw;
    }
    return detected[0] ?? null;
  }

  private discoverRoutes(rootPath: string, framework: Framework | null): RouteMap {
    const routes: Route[] = [];
    let layoutPattern: string | undefined;
    let dynamicRoutePattern: string | undefined;

    if (framework === 'nextjs') {
      const appDir = join(rootPath, 'app');
      if (existsSync(appDir)) {
        layoutPattern = 'layout.tsx (per-segment)';
        dynamicRoutePattern = '[param]';
        this.walkRoutes(appDir, appDir, 'nextjs-app', routes);
      }
      const pagesDir = join(rootPath, 'pages');
      if (existsSync(pagesDir)) {
        layoutPattern = '_app.tsx';
        dynamicRoutePattern = '[param]';
        this.walkRoutes(pagesDir, pagesDir, 'nextjs-pages', routes);
      }
    } else if (framework === 'sveltekit') {
      const routesDir = join(rootPath, 'src', 'routes');
      if (existsSync(routesDir)) {
        layoutPattern = '+layout.svelte';
        dynamicRoutePattern = '[param]';
        this.walkRoutes(routesDir, routesDir, 'sveltekit', routes);
      }
    } else if (framework === 'nuxt') {
      const pagesDir = join(rootPath, 'pages');
      if (existsSync(pagesDir)) {
        dynamicRoutePattern = '_param';
        this.walkRoutes(pagesDir, pagesDir, 'nuxt', routes);
      }
    }

    return {
      framework: framework ?? 'unknown',
      routes,
      layoutPattern,
      dynamicRoutePattern,
      totalRoutes: routes.length,
    };
  }

  private walkRoutes(
    baseDir: string,
    currentDir: string,
    convention: 'nextjs-app' | 'nextjs-pages' | 'sveltekit' | 'nuxt',
    routes: Route[],
    _depth?: number,
  ): void {
    const depth = _depth ?? 0;
    if (depth > 15) return;

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
        const fullPath = join(currentDir, entry.name);
        const relativePath = fullPath.slice(baseDir.length).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (entry.name === 'api') {
            this.collectApiRoutes(fullPath, baseDir, routes);
          } else {
            this.walkRoutes(baseDir, fullPath, convention, routes, depth + 1);
          }
        } else if (entry.isFile()) {
          const route = this.classifyRouteFile(entry.name, relativePath, convention);
          if (route) routes.push(route);
        }
      }
    } catch {
      // skip
    }
  }

  private collectApiRoutes(dir: string, baseDir: string, routes: Route[]): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = fullPath.slice(baseDir.length).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          this.collectApiRoutes(fullPath, baseDir, routes);
        } else if (
          entry.isFile() &&
          (entry.name === 'route.ts' || entry.name === 'route.tsx' || entry.name === 'route.js')
        ) {
          routes.push({
            path: relativePath.replace(/\/route\.(ts|tsx|js)$/, ''),
            file: relativePath,
            type: 'api',
            isDynamic: relativePath.includes('[') || relativePath.includes('_'),
          });
        }
      }
    } catch {
      // skip
    }
  }

  private classifyRouteFile(
    name: string,
    relativePath: string,
    convention: 'nextjs-app' | 'nextjs-pages' | 'sveltekit' | 'nuxt',
  ): Route | null {
    const isDynamic = relativePath.includes('[') || relativePath.includes('_');
    const params = this.extractParams(relativePath);

    if (convention === 'nextjs-app') {
      if (name === 'page.tsx' || name === 'page.ts' || name === 'page.jsx' || name === 'page.js') {
        return {
          path: relativePath.replace(/\/page\.(tsx|ts|jsx|js)$/, '') || '/',
          file: relativePath,
          type: 'page',
          isDynamic,
          params,
        };
      }
      if (
        name === 'layout.tsx' ||
        name === 'layout.ts' ||
        name === 'layout.jsx' ||
        name === 'layout.js'
      ) {
        return {
          path: relativePath.replace(/\/layout\.(tsx|ts|jsx|js)$/, '') || '/',
          file: relativePath,
          type: 'layout',
          isDynamic,
          params,
        };
      }
      if (name === 'route.ts' || name === 'route.tsx' || name === 'route.js') {
        return {
          path: relativePath.replace(/\/route\.(ts|tsx|js)$/, ''),
          file: relativePath,
          type: 'api',
          isDynamic,
          params,
        };
      }
    } else if (convention === 'nextjs-pages') {
      if (name === '_app.tsx' || name === '_app.ts' || name === '_app.jsx' || name === '_app.js')
        return null;
      if (name === '_document.tsx' || name === '_document.ts') return null;
      if (
        name.endsWith('.tsx') ||
        name.endsWith('.ts') ||
        name.endsWith('.jsx') ||
        name.endsWith('.js')
      ) {
        const isApi = relativePath.startsWith('/api/');
        return {
          path: relativePath.replace(/\.(tsx|ts|jsx|js)$/, '').replace(/\/index$/, '') || '/',
          file: relativePath,
          type: isApi ? 'api' : 'page',
          isDynamic,
          params,
        };
      }
    } else if (convention === 'sveltekit') {
      if (name === '+page.svelte' || name === '+page.ts' || name === '+page.js') {
        return {
          path: relativePath.replace(/\/\+page\.(svelte|ts|js)$/, '') || '/',
          file: relativePath,
          type: 'page',
          isDynamic,
          params,
        };
      }
      if (name === '+layout.svelte' || name === '+layout.ts' || name === '+layout.js') {
        return {
          path: relativePath.replace(/\/\+layout\.(svelte|ts|js)$/, '') || '/',
          file: relativePath,
          type: 'layout',
          isDynamic,
          params,
        };
      }
      if (name === '+server.ts' || name === '+server.js') {
        return {
          path: relativePath.replace(/\/\+server\.(ts|js)$/, ''),
          file: relativePath,
          type: 'api',
          isDynamic,
          params,
        };
      }
    } else if (convention === 'nuxt') {
      if (name.endsWith('.vue')) {
        return {
          path: relativePath.replace(/\.vue$/, '').replace(/\/index$/, '') || '/',
          file: relativePath,
          type: 'page',
          isDynamic,
          params,
        };
      }
    }

    return null;
  }

  private extractParams(relativePath: string): string[] | undefined {
    const bracketMatches = relativePath.match(/\[([^\]]+)\]/g);
    const underscoreMatches = relativePath.match(/_(\w+)/g);

    const params = [
      ...(bracketMatches?.map((m) => m.slice(1, -1)) ?? []),
      ...(underscoreMatches?.map((m) => m.slice(1)) ?? []),
    ];

    return params.length > 0 ? params : undefined;
  }

  private discoverComponents(rootPath: string): ComponentIndex {
    const directories: string[] = [];
    const namingPatterns: string[] = [];
    let totalFiles = 0;

    const candidateDirs = [
      'src/components',
      'components',
      'src/ui',
      'ui',
      'app/components',
      'src/shared/components',
    ];

    for (const candidate of candidateDirs) {
      const fullPath = join(rootPath, candidate);
      if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
        directories.push(candidate);
        totalFiles += this.countFiles(fullPath, 3);
      }
    }

    if (directories.length > 0) {
      namingPatterns.push('PascalCase directories');
    }

    const patternDirs = ['src/hooks', 'src/lib', 'src/utils', 'src/stores'];
    for (const dir of patternDirs) {
      const fullPath = join(rootPath, dir);
      if (existsSync(fullPath)) {
        namingPatterns.push(`${dir}/ (hooks/utilities)`);
      }
    }

    return {
      directories,
      namingPatterns,
      totalFiles,
    };
  }

  private countFiles(dir: string, depth: number): number {
    if (depth < 0) return 0;
    let count = 0;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = join(dir, entry.name);
        if (entry.isFile()) {
          count++;
        } else if (entry.isDirectory()) {
          count += this.countFiles(fullPath, depth - 1);
        }
      }
    } catch {
      // skip
    }
    return count;
  }

  private detectDesignSystemInternal(
    rootPath: string,
    pkg: Record<string, unknown>,
  ): DesignSystemDetection {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const allDeps = { ...deps, ...devDeps };
    const evidence: string[] = [];

    let cssFramework: DesignSystemDetection['cssFramework'] = null;
    let uiLibrary: DesignSystemDetection['uiLibrary'] = null;

    if (
      existsSync(join(rootPath, 'tailwind.config.js')) ||
      existsSync(join(rootPath, 'tailwind.config.ts')) ||
      existsSync(join(rootPath, 'tailwind.config.mjs')) ||
      allDeps.tailwindcss
    ) {
      cssFramework = 'tailwind';
      evidence.push('Tailwind CSS detected via config file or dependency');
    }
    if (allDeps.unocss) {
      if (!cssFramework) cssFramework = 'unocss';
      evidence.push('UnoCSS detected via dependency');
    }
    if (allDeps['styled-components']) {
      if (!cssFramework) cssFramework = 'styled-components';
      evidence.push('styled-components detected via dependency');
    }
    if (allDeps['@vanilla-extract/css']) {
      if (!cssFramework) cssFramework = 'vanilla-extract';
      evidence.push('Vanilla Extract detected via dependency');
    }
    if (
      existsSync(join(rootPath, 'postcss.config.js')) ||
      existsSync(join(rootPath, 'postcss.config.mjs'))
    ) {
      evidence.push('PostCSS configuration found (CSS Modules possible)');
    }

    if (allDeps['@mui/material'] || allDeps['@mui/icons-material']) {
      uiLibrary = 'material-ui';
      evidence.push('Material UI detected via dependency (@mui/material)');
    }
    if (allDeps['@chakra-ui/react']) {
      if (!uiLibrary) uiLibrary = 'chakra-ui';
      evidence.push('Chakra UI detected via dependency (@chakra-ui/react)');
    }
    if (allDeps.daisyui) {
      if (!uiLibrary) uiLibrary = 'daisyui';
      evidence.push('DaisyUI detected via dependency');
    }
    if (allDeps.antd) {
      if (!uiLibrary) uiLibrary = 'ant-design';
      evidence.push('Ant Design detected via dependency');
    }
    if (
      allDeps['@radix-ui/react-dialog'] ||
      allDeps['@radix-ui/react-dropdown-menu'] ||
      allDeps['@radix-ui/react-popover'] ||
      allDeps['@radix-ui/react-select'] ||
      allDeps['@radix-ui/react-tooltip']
    ) {
      if (!uiLibrary) uiLibrary = 'radix-ui';
      evidence.push('Radix UI primitives detected via dependency');
    }
    if (
      allDeps['@shadcn/ui'] ||
      existsSync(join(rootPath, 'components.json')) ||
      (existsSync(join(rootPath, 'src', 'components', 'ui')) &&
        this.dirContainsFile(join(rootPath, 'src', 'components', 'ui'), '.tsx', 1))
    ) {
      if (!uiLibrary) uiLibrary = 'shadcn-ui';
      evidence.push('shadcn/ui detected via components.json or src/components/ui directory');
    }

    // animation library detection — from motion-design/framer-motion/genjutsu-gsap skills
    let animationLibrary: DesignSystemDetection['animationLibrary'] = null;

    if (allDeps['framer-motion'] || allDeps.motion) {
      animationLibrary = 'framer-motion';
      evidence.push('Framer Motion detected via dependency');
    }
    if (allDeps.gsap) {
      if (!animationLibrary) animationLibrary = 'gsap';
      evidence.push('GSAP detected via dependency');
    }
    if (allDeps.three || allDeps['@types/three']) {
      if (!animationLibrary) animationLibrary = 'three.js';
      evidence.push('Three.js detected via dependency');
    }
    if (allDeps['@react-three/fiber'] || allDeps['@react-three/drei']) {
      if (!animationLibrary) animationLibrary = 'react-three-fiber';
      evidence.push('React Three Fiber detected via dependency');
    }
    if (allDeps['lottie-web'] || allDeps['@lottiefiles/lottie-player']) {
      if (!animationLibrary) animationLibrary = 'lottie';
      evidence.push('Lottie detected via dependency');
    }

    return {
      cssFramework,
      uiLibrary,
      animationLibrary,
      evidence,
    };
  }

  private discoverConfigFiles(rootPath: string): ProjectConfig[] {
    const configs: ProjectConfig[] = [];

    const configEntries: Array<[string, ProjectConfig['type']]> = [
      ['tsconfig.json', 'typescript'],
      ['vite.config.ts', 'vite'],
      ['vite.config.js', 'vite'],
      ['vite.config.mjs', 'vite'],
      ['next.config.js', 'next'],
      ['next.config.ts', 'next'],
      ['next.config.mjs', 'next'],
      ['tailwind.config.js', 'tailwind'],
      ['tailwind.config.ts', 'tailwind'],
      ['tailwind.config.mjs', 'tailwind'],
      ['eslint.config.js', 'eslint'],
      ['eslint.config.mjs', 'eslint'],
      ['.eslintrc.js', 'eslint'],
      ['.eslintrc.json', 'eslint'],
      ['biome.json', 'biome'],
      ['biome.jsonc', 'biome'],
      ['postcss.config.js', 'postcss'],
      ['postcss.config.mjs', 'postcss'],
    ];

    for (const [file, type] of configEntries) {
      configs.push({
        file,
        type,
        exists: existsSync(join(rootPath, file)),
        path: join(rootPath, file),
      });
    }

    return configs;
  }

  private collectDiagnostics(framework: FrameworkDetection): ScannerDiagnostic[] {
    const diagnostics: ScannerDiagnostic[] = [];

    if (framework.confidence === 0) {
      diagnostics.push({
        level: 'warning',
        message: 'No framework detected — manual inspection may be required',
        stage: 'framework',
      });
    }

    if (framework.evidence.length > 1) {
      const frameworks = [...new Set(framework.evidence.map((e) => e.framework))];
      if (frameworks.length > 1) {
        diagnostics.push({
          level: 'warning',
          message: `Multiple frameworks detected: ${frameworks.join(', ')}`,
          stage: 'framework',
          detail: 'This may indicate a monorepo or migration in progress',
        });
      }
    }

    return diagnostics;
  }

  // ---- Workspace discovery ----

  private discoverWorkspaceSync(rootPath: string): WorkspaceDiscovery {
    const diagnostics: ScannerDiagnostic[] = [];
    const workspaceType = this.detectWorkspaceType(rootPath);

    // Single package: no workspace metadata found
    if (workspaceType === 'single') {
      return {
        isWorkspace: false,
        workspaceType: 'single',
        packages: [],
        globs: [],
        diagnostics,
      };
    }

    // Parse workspace globs from metadata
    let globs: string[] = [];
    try {
      globs = this.parseWorkspaceGlobs(rootPath, workspaceType);
    } catch (error) {
      diagnostics.push({
        level: 'warning',
        message: `Failed to parse workspace metadata: ${String(error)}`,
        stage: 'workspace',
      });
      return {
        isWorkspace: true,
        workspaceType,
        packages: [],
        globs: [],
        diagnostics,
      };
    }

    if (globs.length === 0) {
      return {
        isWorkspace: true,
        workspaceType,
        packages: [],
        globs: [],
        diagnostics,
      };
    }

    // Expand globs and discover packages
    const packages: WorkspacePackage[] = [];
    const seen = new Set<string>();

    for (const glob of globs) {
      const expanded = this.expandWorkspaceGlob(rootPath, glob);
      for (const relDir of expanded) {
        if (seen.has(relDir)) continue;
        seen.add(relDir);

        const pkgJsonPath = join(relDir, 'package.json');
        const fullPkgPath = join(rootPath, pkgJsonPath.replace(/\//g, path.sep));

        if (!existsSync(fullPkgPath)) continue;

        try {
          const pkgContent = JSON.parse(readFileSync(fullPkgPath, 'utf-8'));
          const name = String(pkgContent.name ?? relDir);
          const sourceRoots = this.detectPackageSourceRoots(rootPath, relDir, pkgContent);
          const workspaceDeps = this.extractWorkspaceDependencies(rootPath, pkgContent);

          packages.push({
            name,
            relativeRoot: relDir,
            packageJsonPath: pkgJsonPath,
            sourceRoots,
            workspaceDependencies: workspaceDeps,
          });
        } catch {
          diagnostics.push({
            level: 'warning',
            message: `Failed to read package.json in workspace package: ${relDir}`,
            stage: 'workspace',
          });
        }
      }
    }

    // Sort deterministically by name
    packages.sort((a, b) => a.name.localeCompare(b.name));

    return {
      isWorkspace: true,
      workspaceType,
      packages,
      globs,
      diagnostics,
    };
  }

  private parseWorkspaceGlobs(rootPath: string, workspaceType: WorkspaceType): string[] {
    if (workspaceType === 'pnpm-workspace') {
      return this.parsePnpmWorkspaceYaml(rootPath);
    }
    // For npm/yarn workspaces, read from package.json "workspaces" field
    return this.parsePackageJsonWorkspaces(rootPath);
  }

  private parsePnpmWorkspaceYaml(rootPath: string): string[] {
    const yamlPath = join(rootPath, 'pnpm-workspace.yaml');
    if (!existsSync(yamlPath)) return [];

    const content = readFileSync(yamlPath, 'utf-8');
    const globs: string[] = [];

    // Parse the packages: array from pnpm-workspace.yaml
    // Simple line-by-line parser: find "packages:" then collect indented list items
    const lines = content.split('\n');
    let inPackages = false;
    let indent = 0;

    for (const line of lines) {
      const trimmed = line.trimStart();

      // Detect "packages:" key
      if (/^packages\s*:/.test(trimmed)) {
        inPackages = true;
        indent = line.length - line.trimStart().length;
        continue;
      }

      if (inPackages) {
        const currentIndent = line.length - line.trimStart().length;

        // If we're back to same or lesser indent (and line is not blank/comment), we've left the packages block
        if (currentIndent <= indent && trimmed !== '' && !trimmed.startsWith('#')) {
          inPackages = false;
          continue;
        }

        // Collect glob entries (lines starting with -)
        const globMatch = trimmed.match(/^-\s+['"]?([^'"]+)['"]?$/);
        if (globMatch?.[1]) {
          globs.push(globMatch[1]);
        }
      }
    }

    return globs;
  }

  private parsePackageJsonWorkspaces(rootPath: string): string[] {
    const pkgPath = join(rootPath, 'package.json');
    if (!existsSync(pkgPath)) return [];

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const workspaces = pkg.workspaces;

      if (Array.isArray(workspaces)) {
        return workspaces.filter((w): w is string => typeof w === 'string');
      }
      if (workspaces && typeof workspaces === 'object' && Array.isArray(workspaces.packages)) {
        return (workspaces.packages as unknown[]).filter((w): w is string => typeof w === 'string');
      }
    } catch {
      // ignore parse errors
    }
    return [];
  }

  private expandWorkspaceGlob(rootPath: string, glob: string): string[] {
    // Simple glob expansion: handle * and ** patterns within root
    // No symlink following outside root boundary
    const results: string[] = [];

    // Convert glob to a regex pattern for matching
    // Handle: packages/*, apps/*, packages/*/src, etc.
    const parts = glob.split('/');
    this.walkGlob(rootPath, rootPath, parts, 0, results);

    return results;
  }

  private walkGlob(
    rootPath: string,
    currentDir: string,
    globParts: string[],
    partIndex: number,
    results: string[],
  ): void {
    if (partIndex >= globParts.length) return;
    if (results.length > 500) return; // safety bound

    const part = globParts[partIndex] ?? '';
    const isLast = partIndex === globParts.length - 1;

    // Check we haven't escaped the root
    const relCurrent = join(rootPath, path.relative(rootPath, currentDir)).replace(/\\/g, '/');
    if (relCurrent.startsWith('..')) return;

    if (part === '**') {
      // Match zero or more directories
      if (isLast) {
        // ** at end: match all directories
        this.collectDirsBfs(rootPath, currentDir, results);
      } else {
        // ** in middle: match current dir AND recurse
        this.walkGlob(rootPath, currentDir, globParts, partIndex + 1, results);
        this.walkDirsRecursive(rootPath, currentDir, globParts, partIndex, results);
      }
      return;
    }

    if (part.includes('*')) {
      // Single-level glob match
      try {
        const entries = readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          if (!entry.isDirectory()) continue;
          if (this.globMatches(entry.name, part)) {
            const childPath = join(currentDir, entry.name);
            if (isLast) {
              const rel = path.relative(rootPath, childPath).replace(/\\/g, '/');
              results.push(rel);
            } else {
              this.walkGlob(rootPath, childPath, globParts, partIndex + 1, results);
            }
          }
        }
      } catch {
        // skip
      }
    } else {
      // Literal directory name
      const childPath = join(currentDir, part);
      if (existsSync(childPath) && statSync(childPath).isDirectory()) {
        if (isLast) {
          const rel = path.relative(rootPath, childPath).replace(/\\/g, '/');
          results.push(rel);
        } else {
          this.walkGlob(rootPath, childPath, globParts, partIndex + 1, results);
        }
      }
    }
  }

  private collectDirsBfs(rootPath: string, startDir: string, results: string[]): void {
    const queue = [startDir];
    while (queue.length > 0 && results.length < 500) {
      const dir = queue.shift() ?? '';
      const rel = path.relative(rootPath, dir).replace(/\\/g, '/');
      if (rel !== '') results.push(rel);

      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          if (entry.isDirectory()) {
            queue.push(join(dir, entry.name));
          }
        }
      } catch {
        // skip
      }
    }
  }

  private walkDirsRecursive(
    rootPath: string,
    currentDir: string,
    globParts: string[],
    starStarIndex: number,
    results: string[],
  ): void {
    if (results.length > 500) return;
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        if (!entry.isDirectory()) continue;
        const childPath = join(currentDir, entry.name);
        this.walkGlob(rootPath, childPath, globParts, starStarIndex + 1, results);
        this.walkDirsRecursive(rootPath, childPath, globParts, starStarIndex, results);
      }
    } catch {
      // skip
    }
  }

  private globMatches(name: string, pattern: string): boolean {
    // Convert simple glob pattern to regex
    const regexStr = `^${pattern.replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`;
    return new RegExp(regexStr).test(name);
  }

  private detectPackageSourceRoots(
    _rootPath: string,
    relDir: string,
    _pkg: Record<string, unknown>,
  ): string[] {
    const roots: string[] = [];

    // Check common source roots
    const candidates = ['src', 'lib', 'app'];
    for (const c of candidates) {
      const fullPath = join(_rootPath, relDir, c);
      if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
        roots.push(`${relDir}/${c}`);
      }
    }

    // If no src/lib/app, use the package root itself
    if (roots.length === 0) {
      roots.push(relDir);
    }

    return roots;
  }

  private extractWorkspaceDependencies(_rootPath: string, pkg: Record<string, unknown>): string[] {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    const peerDeps = (pkg.peerDependencies ?? {}) as Record<string, string>;
    const allDeps = { ...deps, ...devDeps, ...peerDeps };

    // Workspace dependencies are those using workspace: protocol or
    // that we'll match against discovered package names
    const workspaceDeps: string[] = [];
    for (const [name, version] of Object.entries(allDeps)) {
      if (typeof version === 'string' && version.startsWith('workspace:')) {
        workspaceDeps.push(name);
      }
    }

    return workspaceDeps;
  }

  private scannerError(code: string, message: string): ViskodError {
    return createViskodError({
      code,
      category: 'runtime',
      severity: 'recoverable',
      message,
      subsystem: 'project-scanner',
    });
  }
}
