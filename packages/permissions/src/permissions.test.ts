import { describe, expect, it } from 'vitest';
import { PermissionsEngine } from './index';

describe('PermissionsEngine', () => {
  it('registers default permissions on construction', () => {
    const engine = new PermissionsEngine();
    const all = engine.getAllPermissions();
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((p) => p.name === 'browser:launch')).toBe(true);
    expect(all.some((p) => p.name === 'mcp:tools')).toBe(true);
    expect(all.some((p) => p.name === 'events:publish')).toBe(true);
  });

  it('registers a custom permission', () => {
    const engine = new PermissionsEngine();
    const perm = engine.registerPermission('custom:action', 'Custom action permission');
    expect(perm.name).toBe('custom:action');
    expect(perm.granted).toBe(false);
  });

  it('prevents duplicate permission registration', () => {
    const engine = new PermissionsEngine();
    engine.registerPermission('unique:perm', 'desc');
    expect(() => engine.registerPermission('unique:perm', 'desc2')).toThrow();
  });

  it('grants and checks permission', () => {
    const engine = new PermissionsEngine();
    engine.grant('plugin-abc', 'browser:launch');
    expect(engine.check('plugin-abc', 'browser:launch')).toBe(true);
  });

  it('revokes permission', () => {
    const engine = new PermissionsEngine();
    engine.grant('plugin-abc', 'browser:launch');
    engine.revoke('plugin-abc', 'browser:launch');
    expect(engine.check('plugin-abc', 'browser:launch')).toBe(false);
  });

  it('checkAny returns true if any permission is granted', () => {
    const engine = new PermissionsEngine();
    engine.grant('plugin-x', 'browser:launch');
    expect(engine.checkAny('plugin-x', ['browser:navigate', 'browser:launch'])).toBe(true);
  });

  it('checkAny returns false if none are granted', () => {
    const engine = new PermissionsEngine();
    expect(engine.checkAny('plugin-y', ['browser:launch', 'browser:navigate'])).toBe(false);
  });

  it('checkAll requires all permissions', () => {
    const engine = new PermissionsEngine();
    engine.grant('plugin-z', 'browser:launch');
    engine.grant('plugin-z', 'browser:navigate');
    expect(engine.checkAll('plugin-z', ['browser:launch', 'browser:navigate'])).toBe(true);
    expect(engine.checkAll('plugin-z', ['browser:launch', 'browser:screenshot'])).toBe(false);
  });

  it('gets granted permissions for grantee', () => {
    const engine = new PermissionsEngine();
    engine.grant('plugin-p', 'browser:launch');
    engine.grant('plugin-p', 'capture:read');
    const granted = engine.getGrantedPermissions('plugin-p');
    expect(granted.length).toBe(2);
  });

  it('returns empty for unknown grantee', () => {
    const engine = new PermissionsEngine();
    expect(engine.getGrantedPermissions('nonexistent')).toEqual([]);
    expect(engine.check('nonexistent', 'any:perm')).toBe(false);
  });

  it('reports health', () => {
    const engine = new PermissionsEngine();
    const h = engine.health();
    expect(h.totalPermissions).toBeGreaterThan(0);
    expect(h.status).toBe('healthy');
  });

  it('getPermissionSet returns undefined for unknown grantee', () => {
    const engine = new PermissionsEngine();
    expect(engine.getPermissionSet('unknown')).toBeUndefined();
  });
});
