import { describe, expect, it } from 'vitest';
import { classifyHint, detectLanguage } from './classifier';

describe('classifyHint', () => {
  it('classifies test files as test-owner', () => {
    const result = classifyHint({
      filePath: 'src/components/Button.test.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
    });
    expect(result.kind).toBe('test-owner');
  });

  it('classifies story files as test-owner', () => {
    const result = classifyHint({
      filePath: 'src/components/Button.stories.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
    });
    expect(result.kind).toBe('test-owner');
  });

  it('classifies CSS files as style-owner', () => {
    const result = classifyHint({
      filePath: 'src/components/Button.css',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'style-adjacent',
    });
    expect(result.kind).toBe('style-owner');
  });

  it('classifies module CSS files as style-owner', () => {
    const result = classifyHint({
      filePath: 'src/components/Button.module.css',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'style-adjacent',
    });
    expect(result.kind).toBe('style-owner');
  });

  it('classifies route files as route-owner', () => {
    const result = classifyHint({
      filePath: 'app/settings/page.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
    });
    expect(result.kind).toBe('route-owner');
  });

  it('classifies pages directory files as route-owner', () => {
    const result = classifyHint({
      filePath: 'pages/dashboard/index.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
    });
    expect(result.kind).toBe('route-owner');
  });

  it('classifies UI primitives as definition-site', () => {
    const result = classifyHint({
      filePath: 'src/components/button.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
    });
    expect(result.kind).toBe('definition-site');
  });

  it('classifies files in ui/ directory as definition-site', () => {
    const result = classifyHint({
      filePath: 'src/components/ui/card.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
    });
    expect(result.kind).toBe('definition-site');
  });

  it('classifies files with text match evidence as usage-site', () => {
    const result = classifyHint({
      filePath: 'lib/settings-form.tsx',
      exists: true,
      matchType: 'usage-site',
      evidence: [
        {
          type: 'text-content-match',
          weight: 0.7,
          detail: 'Found "Save changes"',
          confidence: 0.8,
        },
      ],
      discoveryMethod: 'usage-site',
    });
    expect(result.kind).toBe('usage-site');
  });

  it('classifies generated paths as unknown', () => {
    const result = classifyHint({
      filePath: 'node_modules/@radix-ui/button.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
    });
    expect(result.kind).toBe('unknown');
  });

  it('classifies dist/build paths as unknown', () => {
    const result = classifyHint({
      filePath: 'dist/components/Button.js',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
    });
    expect(result.kind).toBe('unknown');
  });

  it('classifies components directory files as component-owner', () => {
    const result = classifyHint({
      filePath: 'src/components/DataTable.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
    });
    expect(result.kind).toBe('component-owner');
  });

  it('sets route context when routePath is provided', () => {
    const result = classifyHint({
      filePath: 'src/features/settings/page.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
      routePath: '/settings',
      routeFile: 'src/features/settings/page.tsx',
    });
    expect(result.route).toBeDefined();
    expect(result.route?.routePath).toBe('/settings');
    expect(result.route?.isCurrentRoute).toBe(true);
  });

  it('marks isCurrentRoute false when file does not match', () => {
    const result = classifyHint({
      filePath: 'src/components/Button.tsx',
      exists: true,
      matchType: 'exact',
      evidence: [],
      discoveryMethod: 'file-exists',
      routePath: '/settings',
      routeFile: 'src/features/settings/page.tsx',
    });
    expect(result.route?.isCurrentRoute).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('detects TypeScript React', () => {
    expect(detectLanguage('Button.tsx')).toBe('typescript-react');
  });

  it('detects JavaScript React', () => {
    expect(detectLanguage('Button.jsx')).toBe('javascript-react');
  });

  it('detects TypeScript', () => {
    expect(detectLanguage('utils.ts')).toBe('typescript');
  });

  it('detects Vue', () => {
    expect(detectLanguage('App.vue')).toBe('vue');
  });

  it('detects Svelte', () => {
    expect(detectLanguage('App.svelte')).toBe('svelte');
  });

  it('returns undefined for unknown extensions', () => {
    expect(detectLanguage('README.md')).toBeUndefined();
  });
});
