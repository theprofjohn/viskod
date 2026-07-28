import { describe, expect, it } from 'vitest';
import { WorkspaceManager } from './index';

describe('WorkspaceManager', () => {
  it('creates a workspace with owner', () => {
    const wm = new WorkspaceManager();
    const ws = wm.create('My Team', 'user-1', 'Alice', 'alice@example.com', 'Team workspace');
    expect(ws.id).toBeTruthy();
    expect(ws.name).toBe('My Team');
    expect(ws.ownerId).toBe('user-1');
    expect(ws.members.length).toBe(1);
    expect(ws.members[0]?.role).toBe('owner');
  });

  it('adds a member', () => {
    const wm = new WorkspaceManager();
    const ws = wm.create('Team', 'user-1', 'Alice', 'a@x.com');
    wm.addMember(ws.id, {
      id: 'user-2',
      name: 'Bob',
      email: 'b@x.com',
      role: 'member',
      joinedAt: new Date().toISOString(),
    });
    const updated = wm.get(ws.id);
    expect(updated?.members.length).toBe(2);
  });

  it('prevents duplicate members', () => {
    const wm = new WorkspaceManager();
    const ws = wm.create('Team', 'user-1', 'Alice', 'a@x.com');
    expect(() =>
      wm.addMember(ws.id, {
        id: 'user-1',
        name: 'Alice',
        email: 'a@x.com',
        role: 'member',
        joinedAt: new Date().toISOString(),
      }),
    ).toThrow('already in workspace');
  });

  it('removes a member', () => {
    const wm = new WorkspaceManager();
    const ws = wm.create('Team', 'user-1', 'Alice', 'a@x.com');
    wm.addMember(ws.id, {
      id: 'user-2',
      name: 'Bob',
      email: 'b@x.com',
      role: 'member',
      joinedAt: new Date().toISOString(),
    });
    wm.removeMember(ws.id, 'user-2');
    expect(wm.get(ws.id)?.members.length).toBe(1);
  });

  it('updates member role', () => {
    const wm = new WorkspaceManager();
    const ws = wm.create('Team', 'user-1', 'Alice', 'a@x.com');
    wm.addMember(ws.id, {
      id: 'user-2',
      name: 'Bob',
      email: 'b@x.com',
      role: 'member',
      joinedAt: new Date().toISOString(),
    });
    wm.updateMemberRole(ws.id, 'user-2', 'admin');
    const member = wm.get(ws.id)?.members.find((m) => m.id === 'user-2');
    expect(member?.role).toBe('admin');
  });

  it('adds project roots without duplicates', () => {
    const wm = new WorkspaceManager();
    const ws = wm.create('Team', 'user-1', 'Alice', 'a@x.com');
    wm.addProjectRoot(ws.id, '/projects/app');
    wm.addProjectRoot(ws.id, '/projects/app');
    wm.addProjectRoot(ws.id, '/projects/lib');
    expect(wm.get(ws.id)?.projectRoots).toEqual(['/projects/app', '/projects/lib']);
  });

  it('deletes a workspace', () => {
    const wm = new WorkspaceManager();
    const ws = wm.create('Team', 'user-1', 'Alice', 'a@x.com');
    wm.delete(ws.id);
    expect(wm.get(ws.id)).toBeUndefined();
  });

  it('manages sessions', () => {
    const wm = new WorkspaceManager();
    const ws = wm.create('Team', 'user-1', 'Alice', 'a@x.com');
    const session = wm.startSession(ws.id, 'user-1');
    expect(session.id).toBeTruthy();
    expect(session.active).toBe(true);
    expect(wm.getActiveSessions(ws.id).length).toBe(1);
    wm.endSession(session.id);
    expect(wm.getActiveSessions(ws.id).length).toBe(0);
  });

  it('deleting workspace ends sessions', () => {
    const wm = new WorkspaceManager();
    const ws = wm.create('Team', 'user-1', 'Alice', 'a@x.com');
    wm.startSession(ws.id, 'user-1');
    wm.delete(ws.id);
    expect(wm.getActiveSessions(ws.id).length).toBe(0);
  });

  it('lists all workspaces', () => {
    const wm = new WorkspaceManager();
    wm.create('Team A', 'u1', 'Alice', 'a@x.com');
    wm.create('Team B', 'u2', 'Bob', 'b@x.com');
    expect(wm.list().length).toBe(2);
  });

  it('reports health', () => {
    const wm = new WorkspaceManager();
    wm.create('Team', 'u1', 'Alice', 'a@x.com');
    wm.startSession(wm.list()[0]?.id ?? 'none', 'u1');
    const h = wm.health();
    expect(h.totalWorkspaces).toBe(1);
    expect(h.totalMembers).toBe(1);
    expect(h.activeSessions).toBe(1);
    expect(h.status).toBe('healthy');
  });

  it('throws on unknown workspace operations', () => {
    const wm = new WorkspaceManager();
    expect(() =>
      wm.addMember('unknown', {
        id: 'u2',
        name: 'X',
        email: 'x@x.com',
        role: 'member',
        joinedAt: new Date().toISOString(),
      }),
    ).toThrow('not found');
    expect(() => wm.startSession('unknown', 'u1')).toThrow('not found');
  });
});
