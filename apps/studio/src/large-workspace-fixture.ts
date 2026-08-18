import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceMetadata } from '@viskod/shared';

/**
 * Phase 33A — deterministic large-workspace fixture for the Studio
 * responsiveness test (Studio package cannot import the engine's internal
 * fixture helper, so this compact generator lives here).
 */
export interface LargeWorkspaceFixture {
  root: string;
  workspace: WorkspaceMetadata;
  appDirs: string[];
  cleanup: () => void;
}

export function createLargeWorkspaceFixture(fileCount: number): LargeWorkspaceFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-studio-scale-'));
  const web = path.join(root, 'apps/web/src');
  const ui = path.join(root, 'packages/ui/src');
  fs.mkdirSync(web, { recursive: true });
  fs.mkdirSync(ui, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"scale-root","private":true}');
  fs.writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - "apps/*"\n  - "packages/*"\n',
  );
  fs.writeFileSync(
    path.join(root, 'apps/web/package.json'),
    JSON.stringify({
      name: '@acme/web',
      version: '1.0.0',
      dependencies: { '@acme/ui': 'workspace:*' },
    }),
  );
  fs.writeFileSync(
    path.join(root, 'packages/ui/package.json'),
    JSON.stringify({ name: '@acme/ui', version: '1.0.0' }),
  );

  // Deterministic content: each file carries neutral text; the "target"
  // phrase appears in exactly one web file so resolution is deterministic.
  const TARGET = 'Order summary checkout widget status';
  for (let i = 0; i < fileCount; i++) {
    const dir = i % 4 === 3 ? ui : web;
    const name = `component${i}${i % 4 === 3 ? '.ts' : '.tsx'}`;
    const content =
      i === 0
        ? `// target\nexport function Target() {\n  return <div>${TARGET}</div>;\n}\n`
        : `// neutral component ${i}\nexport function Component${i}() {\n  return <div>neutral content ${i}</div>;\n}\n`;
    fs.writeFileSync(path.join(dir, name), content, 'utf-8');
  }

  return {
    root,
    workspace: {
      isWorkspace: true,
      workspaceType: 'pnpm-workspace',
      packages: [
        {
          name: '@acme/web',
          relativeRoot: 'apps/web',
          packageJsonPath: 'apps/web/package.json',
          sourceRoots: ['apps/web/src'],
          workspaceDependencies: ['@acme/ui'],
        },
        {
          name: '@acme/ui',
          relativeRoot: 'packages/ui',
          packageJsonPath: 'packages/ui/package.json',
          sourceRoots: ['packages/ui/src'],
          workspaceDependencies: [],
        },
      ],
      globs: ['apps/*', 'packages/*'],
    },
    appDirs: ['apps/web/src', 'packages/ui/src'],
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
