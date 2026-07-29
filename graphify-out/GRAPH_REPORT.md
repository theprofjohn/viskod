# Graph Report - .  (2026-07-29)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1161 nodes · 1967 edges · 83 communities (80 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `17062e7a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Result
- browser-runtime/src/index.ts
- config/src/index.ts
- cli/src/index.ts
- ProjectScanner
- entry.ts
- source-hint-engine/src/index.ts
- scripts
- EventBus
- VisualContextEngine
- compilerOptions
- biome.json
- gortex
- PluginSystem
- @viskod/shared
- PermissionsEngine
- selection-engine/src/index.ts
- WorkspaceManager
- DiagnosticsEngine
- extension-bridge.ts
- AuditEngine
- shared/package.json
- workspace/package.json
- audit/package.json
- capture-pipeline/package.json
- cli/package.json
- config/package.json
- event-bus/package.json
- overlay-system/package.json
- permissions/package.json
- studio/package.json
- dependencies
- browser-runtime/package.json
- context-engine/package.json
- diagnostics/package.json
- mcp-server/package.json
- plugin-system/package.json
- project-scanner/package.json
- runtime-session/package.json
- sdk/package.json
- selection-engine/package.json
- source-hint-engine/package.json
- dependencies
- dependencies
- dependencies
- capture-pipeline/tsconfig.json
- dependencies
- Viskod
- studio/src/index.ts
- studio/tsconfig.json
- compilerOptions
- audit/tsconfig.json
- browser-runtime/tsconfig.json
- cli/tsconfig.json
- config/tsconfig.json
- context-engine/tsconfig.json
- diagnostics/tsconfig.json
- event-bus/tsconfig.json
- mcp-server/tsconfig.json
- ../../tsconfig.json
- permissions/tsconfig.json
- plugin-system/tsconfig.json
- project-scanner/tsconfig.json
- runtime-session/tsconfig.json
- sdk/tsconfig.json
- selection-engine/tsconfig.json
- shared/tsconfig.json
- source-hint-engine/tsconfig.json
- workspace/tsconfig.json
- dependencies
- overlay-system/src/index.ts
- @viskod/selection-engine
- phase12-agent-loop-app/server.cjs
- phase12-source-hint-app/server.cjs
- dependencies
- phase12-source-hint-app/package.json
- vitest.config.ts

## God Nodes (most connected - your core abstractions)
1. `Result` - 59 edges
2. `ok()` - 57 edges
3. `err()` - 51 edges
4. `EventBus` - 49 edges
5. `ProjectScanner` - 36 edges
6. `BrowserRuntime` - 35 edges
7. `VisualContextEngine` - 32 edges
8. `RuntimeSession` - 30 edges
9. `SelectionEngine` - 27 edges
10. `CapturePipeline` - 25 edges

## Surprising Connections (you probably didn't know these)
- `StudioState` --references--> `SelectionTarget`  [EXTRACTED]
  apps/studio/src/index.ts → packages/selection-engine/src/types.ts
- `Studio` --references--> `EventBus`  [EXTRACTED]
  apps/studio/src/index.ts → packages/event-bus/src/index.ts
- `Studio` --references--> `SelectionTarget`  [EXTRACTED]
  apps/studio/src/index.ts → packages/selection-engine/src/types.ts
- `StudioState` --references--> `ContextPacket`  [EXTRACTED]
  apps/studio/src/index.ts → packages/context-engine/src/index.ts
- `Studio` --references--> `VisualContextEngine`  [EXTRACTED]
  apps/studio/src/index.ts → packages/context-engine/src/index.ts

## Import Cycles
- None detected.

## Communities (83 total, 3 thin omitted)

### Community 0 - "Result"
Cohesion: 0.08
Nodes (13): BrowserRuntime, TEST_DIR, CaptureFilter, CaptureMetadata, CapturePipeline, CaptureStorageStats, Screenshot, StoredCapture (+5 more)

### Community 1 - "browser-runtime/src/index.ts"
Cohesion: 0.09
Nodes (38): applyRedaction(), collectConsoleEntries(), ConsoleEntry, DEFAULT_RULES, DEFAULT_TRUNCATION, NetworkEntry, NetworkRequest, NetworkResponse (+30 more)

### Community 2 - "config/src/index.ts"
Cohesion: 0.06
Nodes (38): BrowserConfig, CaptureConfig, createConfigError(), DEFAULT_CONFIG, DiagnosticsConfig, GeneralConfig, mergeConfigs(), mergeInto() (+30 more)

### Community 3 - "cli/src/index.ts"
Cohesion: 0.12
Nodes (19): resolveProfile(), args, cmdCapture(), cmdHealth(), cmdScan(), cmdServe(), cmdStart(), cmdStatus() (+11 more)

### Community 4 - "ProjectScanner"
Cohesion: 0.11
Nodes (17): ProjectScanner, ComponentIndex, CssFramework, DesignSystemDetection, Framework, FrameworkDetection, FrameworkEvidence, PackageManager (+9 more)

### Community 5 - "entry.ts"
Cohesion: 0.09
Nodes (25): browserRuntime, captureContextTool, capturePipeline, eventBus, getDiagnosticsTool, getProjectInfoTool, navigateTool, projectScanner (+17 more)

### Community 6 - "source-hint-engine/src/index.ts"
Cohesion: 0.13
Nodes (25): buildCacheKey(), buildHintId(), clamp(), collectResolvedCandidates(), dirBasename(), djb2(), EXTENSION_PATTERNS, findAdjacentStyleFiles() (+17 more)

### Community 7 - "scripts"
Cohesion: 0.07
Nodes (26): @biomejs/biome, devDependencies, @biomejs/biome, @types/node, typescript, vitest, engines, node (+18 more)

### Community 8 - "EventBus"
Cohesion: 0.10
Nodes (9): VCECreationOptions, EventBus, EventBusDiagnostics, EventBusOptions, EventHandler, SubscriberEntry, Subscription, ViskodOptions (+1 more)

### Community 9 - "VisualContextEngine"
Cohesion: 0.14
Nodes (3): Studio, BrowserHandle, VisualContextEngine

### Community 10 - "compilerOptions"
Cohesion: 0.08
Nodes (24): compilerOptions, baseUrl, composite, declaration, declarationMap, esModuleInterop, exactOptionalPropertyTypes, forceConsistentCasingInFileNames (+16 more)

### Community 11 - "biome.json"
Cohesion: 0.09
Nodes (22): formatter, enabled, indentStyle, indentWidth, lineWidth, quoteStyle, trailingCommas, javascript (+14 more)

### Community 12 - "gortex"
Cohesion: 0.10
Nodes (20): enabled, type, url, GORTEX_INDEX_WORKERS, command, enabled, environment, type (+12 more)

### Community 13 - "PluginSystem"
Cohesion: 0.10
Nodes (8): PluginCapability, PluginContext, PluginHealth, PluginHook, PluginInstance, PluginManifest, PluginStatus, PluginSystem

### Community 14 - "@viskod/shared"
Cohesion: 0.12
Nodes (20): @viskod/event-bus, @viskod/shared, @viskod/shared, @viskod/event-bus, dependencies, @viskod/event-bus, @viskod/shared, dependencies (+12 more)

### Community 15 - "PermissionsEngine"
Cohesion: 0.12
Nodes (6): DEFAULT_PERMISSIONS, Permission, PermissionScope, PermissionsEngine, PermissionSet, PermissionsHealth

### Community 16 - "selection-engine/src/index.ts"
Cohesion: 0.24
Nodes (9): SelectionEngine, AccessibilityInfo, HierarchyNode, HierarchyRoot, SelectionEngineHealth, SelectionGeometry, SelectionSnapshot, SelectionTarget (+1 more)

### Community 17 - "WorkspaceManager"
Cohesion: 0.11
Nodes (5): Workspace, WorkspaceHealth, WorkspaceManager, WorkspaceMember, WorkspaceSession

### Community 18 - "DiagnosticsEngine"
Cohesion: 0.12
Nodes (5): DiagnosticHealth, DiagnosticRecord, DiagnosticReport, DiagnosticsEngine, SubsystemHealth

### Community 19 - "extension-bridge.ts"
Cohesion: 0.15
Nodes (11): BridgeError, BridgeStatusMessage, ConsoleCaptureMessage, ExtensionAdapter, ExtensionBridgeMessage, NetworkCaptureMessage, ScreenshotBridgeMessage, SelectedElementMessage (+3 more)

### Community 20 - "AuditEngine"
Cohesion: 0.14
Nodes (5): AuditAction, AuditEngine, AuditEntry, AuditFilter, AuditHealth

### Community 21 - "shared/package.json"
Cohesion: 0.13
Nodes (14): dependencies, zod, exports, main, name, private, scripts, build (+6 more)

### Community 22 - "workspace/package.json"
Cohesion: 0.13
Nodes (14): dependencies, @viskod/shared, description, exports, main, name, private, scripts (+6 more)

### Community 23 - "audit/package.json"
Cohesion: 0.14
Nodes (13): dependencies, description, exports, main, name, private, scripts, build (+5 more)

### Community 24 - "capture-pipeline/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @viskod/shared, exports, main, name, private, scripts, build (+5 more)

### Community 25 - "cli/package.json"
Cohesion: 0.14
Nodes (13): bin, viskod, exports, main, name, private, scripts, build (+5 more)

### Community 26 - "config/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @viskod/shared, exports, main, name, private, scripts, build (+5 more)

### Community 27 - "event-bus/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @viskod/shared, exports, main, name, private, scripts, build (+5 more)

### Community 28 - "overlay-system/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @viskod/shared, exports, main, name, private, scripts, build (+5 more)

### Community 29 - "permissions/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @viskod/shared, exports, main, name, private, scripts, build (+5 more)

### Community 30 - "studio/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 31 - "dependencies"
Cohesion: 0.17
Nodes (12): @viskod/browser-runtime, dependencies, @viskod/browser-runtime, @viskod/mcp-server, @viskod/runtime-session, @viskod/selection-engine, @viskod/shared, @viskod/browser-runtime (+4 more)

### Community 32 - "browser-runtime/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 33 - "context-engine/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 34 - "diagnostics/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 35 - "mcp-server/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 36 - "plugin-system/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 37 - "project-scanner/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 38 - "runtime-session/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 39 - "sdk/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 40 - "selection-engine/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 41 - "source-hint-engine/package.json"
Cohesion: 0.17
Nodes (11): exports, main, name, private, scripts, build, test, typecheck (+3 more)

### Community 42 - "dependencies"
Cohesion: 0.20
Nodes (10): dependencies, @viskod/browser-runtime, @viskod/capture-pipeline, @viskod/context-engine, @viskod/event-bus, @viskod/shared, @viskod/capture-pipeline, @viskod/capture-pipeline (+2 more)

### Community 43 - "dependencies"
Cohesion: 0.20
Nodes (10): @viskod/source-hint-engine, @viskod/source-hint-engine, dependencies, @viskod/event-bus, @viskod/selection-engine, @viskod/shared, @viskod/source-hint-engine, @viskod/source-hint-engine (+2 more)

### Community 44 - "dependencies"
Cohesion: 0.22
Nodes (9): @viskod/context-engine, @viskod/context-engine, @viskod/context-engine, @viskod/context-engine, dependencies, @viskod/browser-runtime, @viskod/capture-pipeline, @viskod/context-engine (+1 more)

### Community 45 - "capture-pipeline/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 46 - "dependencies"
Cohesion: 0.22
Nodes (9): @viskod/project-scanner, @viskod/project-scanner, @viskod/project-scanner, dependencies, @viskod/capture-pipeline, @viskod/event-bus, @viskod/project-scanner, @viskod/shared (+1 more)

### Community 48 - "studio/src/index.ts"
Cohesion: 0.29
Nodes (7): browserRuntime, capturePipeline, eventBus, selectionEngine, StudioState, vce, ContextPacket

### Community 49 - "studio/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 50 - "compilerOptions"
Cohesion: 0.25
Nodes (7): compilerOptions, jsx, module, strict, target, include, src

### Community 51 - "audit/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 52 - "browser-runtime/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 53 - "cli/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 54 - "config/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 55 - "context-engine/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 56 - "diagnostics/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 57 - "event-bus/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 58 - "mcp-server/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 59 - "../../tsconfig.json"
Cohesion: 0.22
Nodes (8): ../../tsconfig.json, compilerOptions, outDir, rootDir, extends, include, src, references

### Community 60 - "permissions/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 61 - "plugin-system/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 62 - "project-scanner/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 63 - "runtime-session/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 64 - "sdk/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 65 - "selection-engine/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 66 - "shared/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 67 - "source-hint-engine/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 68 - "workspace/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, outDir, rootDir, extends, include, src, references

### Community 69 - "dependencies"
Cohesion: 0.29
Nodes (7): @viskod/config, @viskod/config, @viskod/config, dependencies, @viskod/config, @viskod/event-bus, @viskod/shared

### Community 71 - "@viskod/selection-engine"
Cohesion: 0.40
Nodes (5): @viskod/selection-engine, @viskod/selection-engine, @viskod/selection-engine, @viskod/selection-engine, @viskod/selection-engine

### Community 72 - "phase12-agent-loop-app/server.cjs"
Cohesion: 0.40
Nodes (4): fs, http, MIME, path

### Community 73 - "phase12-source-hint-app/server.cjs"
Cohesion: 0.40
Nodes (4): fs, http, MIME, path

### Community 74 - "dependencies"
Cohesion: 0.40
Nodes (5): dependencies, playwright, @viskod/event-bus, @viskod/shared, playwright

### Community 75 - "phase12-source-hint-app/package.json"
Cohesion: 0.50
Nodes (3): name, private, version

## Knowledge Gaps
- **500 isolated node(s):** `type`, `main`, `version`, `name`, `types` (+495 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `@viskod/shared` connect `@viskod/shared` to `dependencies`, `dependencies`, `dependencies`, `dependencies`, `dependencies`, `dependencies`, `workspace/package.json`, `capture-pipeline/package.json`, `config/package.json`, `event-bus/package.json`, `overlay-system/package.json`, `permissions/package.json`, `dependencies`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `EventBus` connect `EventBus` to `Result`, `browser-runtime/src/index.ts`, `config/src/index.ts`, `cli/src/index.ts`, `ProjectScanner`, `entry.ts`, `source-hint-engine/src/index.ts`, `VisualContextEngine`, `PluginSystem`, `Viskod`, `studio/src/index.ts`, `selection-engine/src/index.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `ProjectScanner` connect `ProjectScanner` to `Result`, `cli/src/index.ts`, `entry.ts`, `EventBus`, `Viskod`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `type`, `main`, `version` to the rest of the system?**
  _500 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Result` be split into smaller, more focused modules?**
  _Cohesion score 0.08145131432802666 - nodes in this community are weakly interconnected._
- **Should `browser-runtime/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09065679925994449 - nodes in this community are weakly interconnected._
- **Should `config/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0647342995169082 - nodes in this community are weakly interconnected._