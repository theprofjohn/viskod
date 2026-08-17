export type Identifier = string;
export type Timestamp = string;
export type SemVer = `${number}.${number}.${number}`;
export type URLString = string;
export type FilePath = string;
export type Milliseconds = number;
export type Bytes = number;

export interface WithId {
  id: Identifier;
}

export interface WithTimestamp {
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WithVersion {
  version: SemVer;
}

export type DeepReadonly<T> = {
  readonly [P in keyof T]: DeepReadonly<T[P]>;
};

export type Maybe<T> = T | null;

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface WorkspacePackageMetadata {
  name: string;
  relativeRoot: string;
  packageJsonPath: string;
  sourceRoots: string[];
  workspaceDependencies: string[];
}

export interface WorkspaceMetadata {
  isWorkspace: boolean;
  workspaceType: 'single' | 'pnpm-workspace' | 'npm-workspace' | 'yarn-workspace' | 'unknown';
  packages: WorkspacePackageMetadata[];
  globs: string[];
}
