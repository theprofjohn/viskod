import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBus } from '@viskod/event-bus';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceHintEngine } from './index';
import type { HintInput } from './types';

const roots: string[] = [];

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viskod-route-relevance-'));
  roots.push(root);
  for (const dir of [
    'src/app/(marketing)',
    'src/app/(app)/analytics',
    'src/app',
    'src/app/api/search',
    'components',
    'packages/ui/src',
  ]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, 'src/app/(marketing)/page.tsx'),
    'export default function Marketing() { return <h1>Welcome home</h1>; }',
  );
  fs.writeFileSync(
    path.join(root, 'src/app/(app)/analytics/page.tsx'),
    'export default function Analytics() { return <h1>Welcome home</h1>; }',
  );
  fs.writeFileSync(
    path.join(root, 'src/app/(marketing)/layout.tsx'),
    'export default function MarketingLayout({ children }: { children: React.ReactNode }) { return <>{children}</>; }',
  );
  fs.writeFileSync(
    path.join(root, 'src/app/page.tsx'),
    "import { HomeSearch } from '../../components/home-search'; export default function Home() { return <HomeSearch />; }",
  );
  fs.writeFileSync(
    path.join(root, 'components/home-search.tsx'),
    "export function HomeSearch() { return <input placeholder='Search the docs' />; }",
  );
  fs.writeFileSync(
    path.join(root, 'src/app/api/search/route.ts'),
    "export function GET() { return new Response('Welcome home'); }",
  );
  fs.writeFileSync(
    path.join(root, 'packages/ui/src/Shared.tsx'),
    'export function Shared() { return <span>Welcome home</span>; }',
  );
  return root;
}

function input(root: string, matchedRoutes: HintInput['route']['matchedRoutes']): HintInput {
  return {
    domContext: { tagName: 'h1', text: 'Welcome home' },
    route: {
      url: 'http://127.0.0.1/',
      pathname: '/',
      matchedRoute: matchedRoutes?.[0],
      matchedRoutes,
    },
    project: {
      metadata: {
        projectId: 'route-relevance',
        name: 'route-relevance',
        rootPath: root,
        packageManager: 'pnpm',
        language: 'typescript',
      },
      componentIndex: { directories: ['src/app', 'components', 'packages/ui/src'] },
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('current-route source relevance', () => {
  it('keeps page/layout candidates ahead of unrelated duplicate text and excludes API routes', async () => {
    const root = fixtureRoot();
    const engine = new SourceHintEngine(new EventBus());
    const result = await engine.generateHints(
      input(root, [
        { path: '/', file: 'src/app/(marketing)/page.tsx', type: 'page', isDynamic: false },
        { path: '/', file: 'src/app/(marketing)/layout.tsx', type: 'layout', isDynamic: false },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.map((hint) => hint.filePath);
    expect(paths).toContain('src/app/(marketing)/page.tsx');
    expect(paths).toContain('src/app/(marketing)/layout.tsx');
    expect(paths.indexOf('src/app/(marketing)/page.tsx')).toBeLessThan(
      paths.indexOf('src/app/(app)/analytics/page.tsx'),
    );
    const apiHint = result.value.find((hint) => hint.filePath === 'src/app/api/search/route.ts');
    expect(apiHint?.kind).not.toBe('route-owner');
    expect(result.value[0]?.qualification).not.toBe('exact');
    expect(result.value[0]?.confidence).toBeLessThan(0.9);
  });

  it('surfaces the current-route import closure without inflating confidence', async () => {
    const root = fixtureRoot();
    const engine = new SourceHintEngine(new EventBus());
    const result = await engine.generateHints(
      input(root, [{ path: '/', file: 'src/app/page.tsx', type: 'page', isDynamic: false }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.map((hint) => hint.filePath);
    expect(paths).toContain('components/home-search.tsx');
    const homeSearch = result.value.find((hint) => hint.filePath === 'components/home-search.tsx');
    expect((homeSearch?.reasons ?? []).some((reason) => reason.includes('imported'))).toBe(true);
    expect(homeSearch?.qualification).not.toBe('exact');
    expect(homeSearch?.confidence).toBeLessThan(0.65);
  });
});
