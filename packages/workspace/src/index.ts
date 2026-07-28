export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joinedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  members: WorkspaceMember[];
  projectRoots: string[];
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSession {
  id: string;
  workspaceId: string;
  userId: string;
  startedAt: string;
  active: boolean;
  metadata: Record<string, unknown>;
}

export interface WorkspaceHealth {
  totalWorkspaces: number;
  totalMembers: number;
  activeSessions: number;
  status: 'healthy' | 'degraded';
}

export class WorkspaceManager {
  private workspaces = new Map<string, Workspace>();
  private sessions = new Map<string, WorkspaceSession>();

  create(
    name: string,
    ownerId: string,
    ownerName: string,
    ownerEmail: string,
    description = '',
  ): Workspace {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const owner: WorkspaceMember = {
      id: ownerId,
      name: ownerName,
      email: ownerEmail,
      role: 'owner',
      joinedAt: now,
    };

    const workspace: Workspace = {
      id,
      name,
      description,
      ownerId,
      members: [owner],
      projectRoots: [],
      settings: {},
      createdAt: now,
      updatedAt: now,
    };

    this.workspaces.set(id, workspace);
    return workspace;
  }

  get(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  list(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  addMember(workspaceId: string, member: WorkspaceMember): Workspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace '${workspaceId}' not found`);

    if (workspace.members.some((m) => m.id === member.id)) {
      throw new Error(`Member '${member.id}' already in workspace`);
    }

    workspace.members.push(member);
    workspace.updatedAt = new Date().toISOString();
    return workspace;
  }

  removeMember(workspaceId: string, memberId: string): Workspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace '${workspaceId}' not found`);

    workspace.members = workspace.members.filter((m) => m.id !== memberId);
    workspace.updatedAt = new Date().toISOString();
    return workspace;
  }

  updateMemberRole(
    workspaceId: string,
    memberId: string,
    role: WorkspaceMember['role'],
  ): Workspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace '${workspaceId}' not found`);

    const member = workspace.members.find((m) => m.id === memberId);
    if (!member) throw new Error(`Member '${memberId}' not found`);

    member.role = role;
    workspace.updatedAt = new Date().toISOString();
    return workspace;
  }

  addProjectRoot(workspaceId: string, rootPath: string): Workspace {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace '${workspaceId}' not found`);
    if (!workspace.projectRoots.includes(rootPath)) {
      workspace.projectRoots.push(rootPath);
      workspace.updatedAt = new Date().toISOString();
    }
    return workspace;
  }

  delete(workspaceId: string): void {
    this.workspaces.delete(workspaceId);
    for (const [, session] of this.sessions) {
      if (session.workspaceId === workspaceId) {
        session.active = false;
      }
    }
  }

  startSession(workspaceId: string, userId: string): WorkspaceSession {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`Workspace '${workspaceId}' not found`);

    const id = crypto.randomUUID();
    const session: WorkspaceSession = {
      id,
      workspaceId,
      userId,
      startedAt: new Date().toISOString(),
      active: true,
      metadata: {},
    };

    this.sessions.set(id, session);
    return session;
  }

  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.active = false;
    }
  }

  getActiveSessions(workspaceId: string): WorkspaceSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.workspaceId === workspaceId && s.active,
    );
  }

  health(): WorkspaceHealth {
    let totalMembers = 0;
    for (const w of this.workspaces.values()) {
      totalMembers += w.members.length;
    }
    return {
      totalWorkspaces: this.workspaces.size,
      totalMembers,
      activeSessions: Array.from(this.sessions.values()).filter((s) => s.active).length,
      status: 'healthy',
    };
  }
}
