export type PermissionScope = 'global' | 'plugin' | 'subsystem';

export interface Permission {
  id: string;
  name: string;
  description: string;
  scope: PermissionScope;
  granted: boolean;
  grantedAt?: string;
  grantee?: string;
}

export interface PermissionSet {
  grantee: string;
  scope: PermissionScope;
  permissions: Map<string, Permission>;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionsHealth {
  totalPermissions: number;
  grantedPermissions: number;
  permissionSets: number;
  status: 'healthy' | 'degraded';
}

const DEFAULT_PERMISSIONS = [
  { name: 'browser:launch', description: 'Launch browser instances', scope: 'subsystem' as const },
  { name: 'browser:navigate', description: 'Navigate browser pages', scope: 'subsystem' as const },
  { name: 'browser:screenshot', description: 'Capture screenshots', scope: 'subsystem' as const },
  { name: 'browser:dom', description: 'Access DOM snapshots', scope: 'subsystem' as const },
  { name: 'capture:persist', description: 'Persist capture data', scope: 'subsystem' as const },
  { name: 'capture:read', description: 'Read stored captures', scope: 'subsystem' as const },
  { name: 'capture:delete', description: 'Delete stored captures', scope: 'subsystem' as const },
  { name: 'project:scan', description: 'Scan project structure', scope: 'subsystem' as const },
  { name: 'project:read', description: 'Read project metadata', scope: 'subsystem' as const },
  {
    name: 'selection:resolve',
    description: 'Resolve element selections',
    scope: 'subsystem' as const,
  },
  { name: 'mcp:tools', description: 'Expose MCP tools', scope: 'subsystem' as const },
  { name: 'mcp:resources', description: 'Expose MCP resources', scope: 'subsystem' as const },
  { name: 'plugin:register', description: 'Register plugins', scope: 'subsystem' as const },
  { name: 'plugin:activate', description: 'Activate plugins', scope: 'subsystem' as const },
  { name: 'diag:read', description: 'Read diagnostic records', scope: 'subsystem' as const },
  { name: 'diag:write', description: 'Write diagnostic records', scope: 'subsystem' as const },
  {
    name: 'events:publish',
    description: 'Publish events to Event Bus',
    scope: 'subsystem' as const,
  },
  {
    name: 'events:subscribe',
    description: 'Subscribe to Event Bus events',
    scope: 'subsystem' as const,
  },
];

export class PermissionsEngine {
  private permissionRegistry = new Map<string, Permission>();
  private permissionSets = new Map<string, PermissionSet>();

  constructor() {
    for (const def of DEFAULT_PERMISSIONS) {
      const id = crypto.randomUUID();
      this.permissionRegistry.set(def.name, {
        id,
        name: def.name,
        description: def.description,
        scope: def.scope,
        granted: false,
      });
    }
  }

  registerPermission(
    name: string,
    description: string,
    scope: PermissionScope = 'subsystem',
  ): Permission {
    if (this.permissionRegistry.has(name)) {
      throw new Error(`Permission '${name}' is already registered`);
    }
    const permission: Permission = {
      id: crypto.randomUUID(),
      name,
      description,
      scope,
      granted: false,
    };
    this.permissionRegistry.set(name, permission);
    return permission;
  }

  grant(grantee: string, permissionName: string, scope: PermissionScope = 'plugin'): Permission {
    const permission = this.permissionRegistry.get(permissionName);
    if (!permission) throw new Error(`Permission '${permissionName}' not found`);

    const granted: Permission = {
      ...permission,
      granted: true,
      grantedAt: new Date().toISOString(),
      grantee,
      scope,
    };
    this.permissionRegistry.set(permissionName, granted);

    const set = this.permissionSets.get(grantee) ?? {
      grantee,
      scope,
      permissions: new Map(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set.permissions.set(permissionName, granted);
    set.updatedAt = new Date().toISOString();
    this.permissionSets.set(grantee, set);

    return granted;
  }

  revoke(grantee: string, permissionName: string): void {
    const permission = this.permissionRegistry.get(permissionName);
    if (!permission) throw new Error(`Permission '${permissionName}' not found`);

    const revoked: Permission = {
      ...permission,
      granted: false,
      grantee: undefined,
      grantedAt: undefined,
    };
    this.permissionRegistry.set(permissionName, revoked);

    const set = this.permissionSets.get(grantee);
    if (set) {
      set.permissions.delete(permissionName);
      set.updatedAt = new Date().toISOString();
    }
  }

  check(grantee: string, permissionName: string): boolean {
    const set = this.permissionSets.get(grantee);
    if (!set) return false;
    const permission = set.permissions.get(permissionName);
    return permission?.granted ?? false;
  }

  checkAny(grantee: string, permissionNames: string[]): boolean {
    return permissionNames.some((name) => this.check(grantee, name));
  }

  checkAll(grantee: string, permissionNames: string[]): boolean {
    return permissionNames.every((name) => this.check(grantee, name));
  }

  getPermissionSet(grantee: string): PermissionSet | undefined {
    return this.permissionSets.get(grantee);
  }

  getGrantedPermissions(grantee: string): Permission[] {
    const set = this.permissionSets.get(grantee);
    if (!set) return [];
    return Array.from(set.permissions.values()).filter((p) => p.granted);
  }

  getAllPermissions(): Permission[] {
    return Array.from(this.permissionRegistry.values());
  }

  health(): PermissionsHealth {
    let granted = 0;
    for (const perm of this.permissionRegistry.values()) {
      if (perm.granted) granted++;
    }
    return {
      totalPermissions: this.permissionRegistry.size,
      grantedPermissions: granted,
      permissionSets: this.permissionSets.size,
      status: 'healthy',
    };
  }
}
