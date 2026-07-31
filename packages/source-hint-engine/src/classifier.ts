import * as path from 'node:path';
import type {
  SourceHintKind,
  HintEvidence,
  DiscoveryMethod,
  HintLocation,
  HintSymbol,
  HintRoute,
} from './types';

const GENERATED_DIRS = ['node_modules', 'dist', 'build', '.next', '.output', '.nuxt', 'coverage', '.cache'];

const TEST_PATTERNS = [/\.test\./, /\.spec\./, /\.stories?\./, /__tests__/, /__mocks__/];

const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.less', '.module.css', '.module.scss', '.styled.ts', '.styled.tsx']);

const COMPONENT_PRIMITIVES = new Set([
  'button', 'input', 'select', 'textarea', 'checkbox', 'radio',
  'label', 'form', 'dialog', 'menu', 'tooltip', 'popover',
  'card', 'badge', 'alert', 'tabs', 'accordion', 'modal',
  'dropdown', 'combobox', 'avatar', 'separator', 'spinner',
  'table', 'data-table', 'calendar', 'command', 'sheet',
]);

const ROUTE_DIR_PATTERNS = [
  /^app\//,
  /^pages\//,
  /^routes\//,
  /^src\/app\//,
  /^src\/pages\//,
  /^src\/routes\//,
  /^features\//,
  /^src\/features\//,
];

interface ClassifyInput {
  filePath: string;
  exists: boolean;
  matchType: string;
  evidence: HintEvidence[];
  discoveryMethod: DiscoveryMethod;
  routePath?: string;
  routeFile?: string;
  matchedRoute?: { path: string; file: string; type: string; isDynamic: boolean };
  domText?: string;
  domTestId?: string;
  domAriaLabel?: string;
  domClassName?: string;
  importGraph?: ImportGraphEntry[];
}

export interface ImportGraphEntry {
  sourceFile: string;
  importedFile: string;
  importedName: string;
  isDefault: boolean;
  isNamespace: boolean;
}

export function classifyHint(input: ClassifyInput): {
  kind: SourceHintKind;
  location?: HintLocation;
  symbol?: HintSymbol;
  route?: HintRoute;
} {
  const filePath = input.filePath;
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath, ext).toLowerCase();

  // Route context
  const route: HintRoute | undefined = input.routePath
    ? {
        routePath: input.routePath,
        routeFile: input.routeFile,
        isCurrentRoute: input.routeFile
          ? filePath === input.routeFile || filePath.includes(input.routeFile)
          : undefined,
      }
    : undefined;

  // Test/story files
  if (isTestFile(filePath)) {
    return { kind: 'test-owner', route };
  }

  // Style files
  if (STYLE_EXTENSIONS.has(ext) || filePath.includes('.module.')) {
    return { kind: 'style-owner', route };
  }

  // Generated/build output
  if (isGeneratedPath(filePath)) {
    return { kind: 'unknown', route };
  }

  // Route/page files
  if (isRouteFile(filePath)) {
    const symbol = extractSymbolFromContent(input);
    return { kind: 'route-owner', symbol, route };
  }

  // Usage-site detection via import graph
  if (input.importGraph && input.importGraph.length > 0) {
    if (isUsageSite(input)) {
      const symbol = extractSymbolFromContent(input);
      return { kind: 'usage-site', symbol, route };
    }
  }

  // Definition-site detection (reusable UI primitives)
  if (isDefinitionSite(filePath, basename)) {
    const symbol = extractSymbolFromContent(input);
    return { kind: 'definition-site', symbol, route };
  }

  // Component owner
  if (isComponentOwner(filePath)) {
    const symbol = extractSymbolFromContent(input);
    return { kind: 'component-owner', symbol, route };
  }

  // Usage-site from text/attribute matches
  if (hasTextMatchEvidence(input)) {
    const symbol = extractSymbolFromContent(input);
    return { kind: 'usage-site', symbol, route };
  }

  return { kind: 'unknown', route };
}

function isTestFile(filePath: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(filePath));
}

function isGeneratedPath(filePath: string): boolean {
  const parts = filePath.split(/[/\\]/);
  return parts.some((p) => GENERATED_DIRS.includes(p.toLowerCase()));
}

function isRouteFile(filePath: string): boolean {
  return ROUTE_DIR_PATTERNS.some((p) => p.test(filePath));
}

function isDefinitionSite(filePath: string, basename: string): boolean {
  // Check if the file name matches a known UI primitive
  if (COMPONENT_PRIMITIVES.has(basename)) return true;

  // Check if it's in a ui/ components directory
  const parts = filePath.split(/[/\\]/).map((p) => p.toLowerCase());
  if (parts.includes('ui') || parts.includes('primitives') || parts.includes('base')) {
    return true;
  }

  return false;
}

function isComponentOwner(filePath: string): boolean {
  const parts = filePath.split(/[/\\]/).map((p) => p.toLowerCase());
  return parts.includes('components') || parts.includes('widgets');
}

function isUsageSite(input: ClassifyInput): boolean {
  // Files that import and render components are usage sites
  if (input.importGraph && input.importGraph.length > 0) {
    const imports = input.importGraph.filter((e) => e.sourceFile === input.filePath);
    if (imports.length > 0) return true;
  }

  // Route files are usage sites
  if (isRouteFile(input.filePath)) return true;

  return false;
}

function hasTextMatchEvidence(input: ClassifyInput): boolean {
  const textEvidenceTypes = new Set([
    'text-content-match',
    'jsx-text-match',
    'aria-label-match',
    'testid-match',
    'nearby-text-match',
  ]);
  return input.evidence.some((e) => textEvidenceTypes.has(e.type));
}

function extractSymbolFromContent(input: ClassifyInput): HintSymbol | undefined {
  const symbol: HintSymbol = {};
  let hasSymbol = false;

  // Extract from evidence
  for (const ev of input.evidence) {
    if (ev.type === 'component-name-match') {
      const match = ev.detail.match(/"(.+?)"/);
      if (match) {
        symbol.componentName = match[1];
        hasSymbol = true;
      }
    }
    if (ev.type === 'jsx-text-match') {
      const match = ev.detail.match(/<(\w+)/);
      if (match) {
        symbol.jsxTag = match[1];
        hasSymbol = true;
      }
    }
  }

  // Extract from DOM
  if (input.domClassName) {
    const names = input.domClassName.split(/\s+/).filter(Boolean);
    if (names.length > 0) {
      symbol.componentName = names[0];
      hasSymbol = true;
    }
  }

  return hasSymbol ? symbol : undefined;
}

export function buildLocation(
  line?: number,
  column?: number,
  endLine?: number,
  endColumn?: number,
): HintLocation | undefined {
  if (line === undefined && column === undefined) return undefined;
  return { line, column, endLine, endColumn };
}

export function detectLanguage(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.tsx': 'typescript-react',
    '.jsx': 'javascript-react',
    '.ts': 'typescript',
    '.js': 'javascript',
    '.vue': 'vue',
    '.svelte': 'svelte',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
  };
  return langMap[ext];
}
