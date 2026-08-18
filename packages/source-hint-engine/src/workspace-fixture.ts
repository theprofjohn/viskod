import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceMetadata } from '@viskod/shared';
import type { HintInput } from './types';

/**
 * Build a HintInput for the fixture with default DOM evidence targeting the
 * distinctive phrase; overrides let tests target other files/ids.
 */
export function hintInputFor(
  fixture: WorkspaceFixture,
  overrides?: {
    text?: string;
    id?: string;
    testId?: string;
    className?: string;
    dataAttributes?: Record<string, string>;
    routeFile?: string;
    directories?: string[];
  },
): HintInput {
  return {
    domContext: {
      tagName: 'div',
      text: overrides?.text ?? TARGET_PHRASE,
      id: overrides?.id,
      testId: overrides?.testId,
      className: overrides?.className,
      dataAttributes: overrides?.dataAttributes,
    },
    route: {
      url: 'http://127.0.0.1:3000/',
      pathname: '/',
      matchedRoute: overrides?.routeFile
        ? { path: '/', file: overrides.routeFile, type: 'exact', isDynamic: false }
        : undefined,
    },
    project: {
      metadata: {
        projectId: 'phase33a-fixture',
        name: 'phase33a-fixture',
        rootPath: fixture.root,
        packageManager: 'pnpm',
        language: 'ts',
      },
      componentIndex: { directories: overrides?.directories ?? fixture.appDirs },
      workspace: fixture.workspace,
    },
  };
}

/**
 * Phase 33A — deterministic workspace fixture generator (test support).
 *
 * Creates a pnpm workspace at runtime with a seeded PRNG so file names and
 * content are reproducible across runs. The fixture layout mirrors a real
 * product workspace:
 *
 *   <root>/
 *     package.json
 *     pnpm-workspace.yaml
 *     apps/web/src/            (app pages)
 *     apps/admin/src/          (second app — ambiguity scenarios)
 *     packages/ui/src/         (shared package)
 *     packages/utils/src/      (shared package)
 *
 * `fileCount` distributes files across these dirs deterministically. One
 * designated "target" component file carries a distinctive phrase used by the
 * source-resolution tests; every other file carries neutral content plus a
 * small import graph so import resolution exercises real paths.
 */

export interface WorkspaceFixture {
  root: string;
  /** WorkspaceMetadata to pass into HintInput.project.workspace. */
  workspace: WorkspaceMetadata;
  /** Repository-relative path of the distinctive target file (packages/ui). */
  targetFile: string;
  /** Repository-relative path of the web app page sharing the target phrase. */
  webFile: string;
  /** Repository-relative path of the admin app page sharing the target phrase. */
  adminFile: string;
  /** Scanned app directories for HintInput.project.componentIndex.directories. */
  appDirs: string[];
  /** Absolute path to the file that contains the distinctive phrase. */
  targetAbsolute: string;
  cleanup: () => void;
}

interface FixtureOptions {
  fileCount: number;
  seed?: number;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const TARGET_PHRASE = 'Order summary checkout widget status';

const CODE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;

export function createWorkspaceFixture(options: FixtureOptions): WorkspaceFixture {
  const { fileCount } = options;
  if (fileCount < 4 || fileCount > 10000) {
    throw new Error(`fileCount must be in [4, 10000], got ${fileCount}`);
  }
  const rand = seededRandom(options.seed ?? 0x33a33a);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-phase33a-'));
  const dirs = {
    web: 'apps/web/src',
    admin: 'apps/admin/src',
    ui: 'packages/ui/src',
    utils: 'packages/utils/src',
  };

  const mkdirs = [...new Set(Object.values(dirs))].map((d) => path.join(root, d));
  for (const dir of mkdirs) fs.mkdirSync(dir, { recursive: true });

  const relPaths: string[] = [];
  const pickDir = (): string => {
    const r = rand();
    if (r < 0.35) return dirs.web;
    if (r < 0.6) return dirs.admin;
    if (r < 0.85) return dirs.ui;
    return dirs.utils;
  };
  const pickExt = (): (typeof CODE_EXTENSIONS)[number] =>
    CODE_EXTENSIONS[Math.floor(rand() * CODE_EXTENSIONS.length)] ?? '.ts';
  const pickName = (): string => {
    const syllables = [
      'card',
      'panel',
      'widget',
      'form',
      'table',
      'modal',
      'nav',
      'grid',
      'list',
      'hero',
    ];
    const n = 2 + Math.floor(rand() * 2);
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      parts.push(syllables[Math.floor(rand() * syllables.length)] ?? 'card');
    }
    return parts.join('') + (rand() < 0.3 ? 'Item' : 'View');
  };

  const used = new Set<string>();
  for (let i = 0; i < fileCount; i++) {
    const dir = pickDir();
    const name = `${pickName()}${i}${pickExt()}`;
    const rel = `${dir}/${name}`;
    if (used.has(rel)) continue;
    used.add(rel);
    relPaths.push(rel);
  }
  // Guarantee the target + ambiguity files exist regardless of the draw.
  const targetRel = 'packages/ui/src/CheckoutWidget.tsx';
  const webRel = 'apps/web/src/CheckoutPage.tsx';
  const adminRel = 'apps/admin/src/DashboardPage.tsx';
  for (const rel of [targetRel, webRel, adminRel]) {
    if (!used.has(rel)) {
      used.add(rel);
      relPaths.push(rel);
    }
  }
  relPaths.sort((a, b) => a.localeCompare(b));

  // Workspace metadata (root-level manifests).
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'phase33a-root', private: true, version: '1.0.0' }, null, 2),
  );
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - "apps/*"\n  - "packages/*"\n',
  );

  const packageManifests: Array<{ name: string; relRoot: string; deps: string[] }> = [
    { name: '@acme/web', relRoot: 'apps/web', deps: ['@acme/ui', '@acme/utils'] },
    { name: '@acme/admin', relRoot: 'apps/admin', deps: ['@acme/ui', '@acme/utils'] },
    { name: '@acme/ui', relRoot: 'packages/ui', deps: ['@acme/utils'] },
    { name: '@acme/utils', relRoot: 'packages/utils', deps: [] },
  ];
  for (const pkg of packageManifests) {
    fs.mkdirSync(path.join(root, pkg.relRoot), { recursive: true });
    fs.writeFileSync(
      path.join(root, pkg.relRoot, 'package.json'),
      JSON.stringify(
        {
          name: pkg.name,
          version: '1.0.0',
          dependencies: Object.fromEntries(pkg.deps.map((d) => [d, 'workspace:*'])),
        },
        null,
        2,
      ),
    );
  }

  // Content: neutral component text per file; the target carries the phrase.
  for (const rel of relPaths) {
    const abs = path.join(root, rel);
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(rel, path.extname(rel));
    const isTarget = rel === targetRel;
    const isWeb = rel === webRel;
    const isAdmin = rel === adminRel;
    const importLines =
      rel.startsWith('apps/') && rand() < 0.8
        ? rel.startsWith('apps/web')
          ? "import { CheckoutWidget } from '@acme/ui/CheckoutWidget';\n"
          : "import { MetricWidget } from '@acme/ui/MetricWidget';\n"
        : '';
    const body =
      isTarget || isWeb || isAdmin
        ? TARGET_PHRASE
        : `neutral dashboard content ${base} ${i18nToken(rel)}`;
    fs.writeFileSync(
      abs,
      `${importLines}// deterministic fixture component ${base}\nexport function ${base}() {\n  return <div className="${base}-surface">${body}</div>;\n}\n`,
    );
  }
  // The ambiguity twins must exist even if the random draw skipped them.
  fs.writeFileSync(
    path.join(root, webRel),
    `import { CheckoutWidget } from '@acme/ui/CheckoutWidget';\n// deterministic fixture component CheckoutPage\nexport function CheckoutPage() {\n  return <div className="CheckoutPage-surface">${TARGET_PHRASE}</div>;\n}\n`,
  );
  fs.writeFileSync(
    path.join(root, adminRel),
    `import { CheckoutWidget } from '@acme/ui/CheckoutWidget';\n// deterministic fixture component DashboardPage\nexport function DashboardPage() {\n  return <div className="DashboardPage-surface">${TARGET_PHRASE}</div>;\n}\n`,
  );
  // The shared package target defines the phrase plus an export used by apps.
  fs.writeFileSync(
    path.join(root, targetRel),
    `// deterministic fixture component CheckoutWidget\nexport function CheckoutWidget() {\n  return <div className="CheckoutWidget-surface">${TARGET_PHRASE}</div>;\n}\n`,
  );

  const workspace: WorkspaceMetadata = {
    isWorkspace: true,
    workspaceType: 'pnpm-workspace',
    packages: packageManifests.map((pkg) => ({
      name: pkg.name,
      relativeRoot: pkg.relRoot,
      packageJsonPath: `${pkg.relRoot}/package.json`,
      sourceRoots: [`${pkg.relRoot}/src`],
      workspaceDependencies: pkg.deps,
    })),
    globs: ['apps/*', 'packages/*'],
  };

  return {
    root,
    workspace,
    targetFile: targetRel,
    webFile: webRel,
    adminFile: adminRel,
    appDirs: [dirs.web, dirs.admin],
    targetAbsolute: path.join(root, targetRel),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function i18nToken(rel: string): string {
  // Deterministic pseudo-token so content differs across files.
  let hash = 5381;
  for (let i = 0; i < rel.length; i++) hash = ((hash << 5) + hash + rel.charCodeAt(i)) | 0;
  return `k${(hash >>> 0).toString(36)}`;
}
