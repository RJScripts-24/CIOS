import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectOwnerOrAdminGuard } from './project-owner-or-admin.guard';

function makeContext(user: object, params: object = {}): ExecutionContext {
  const request = { user, params };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const mockPrisma = {
  project: { findFirst: jest.fn() },
};

describe('ProjectOwnerOrAdminGuard', () => {
  let guard: ProjectOwnerOrAdminGuard;

  beforeEach(() => {
    guard = new ProjectOwnerOrAdminGuard(mockPrisma as any);
    jest.clearAllMocks();
  });

  it('should return true immediately for admin users', async () => {
    const ctx = makeContext(
      { sub: 'u1', role: 'admin', workspace_id: 'ws1' },
      { projectId: 'proj-1' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockPrisma.project.findFirst).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when projectId is missing', async () => {
    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      {},
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Project ID missing');
  });

  it('should throw ForbiddenException when user has no workspace_id', async () => {
    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: null },
      { projectId: 'proj-1' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw NotFoundException when project not found in workspace', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      { projectId: 'proj-missing' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });

  it('should throw ForbiddenException when user is not the project owner', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'proj-1',
      owner_id: 'different-user',
      workspace_id: 'ws1',
    });
    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      { projectId: 'proj-1' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Only the project owner or admin can perform this action',
    );
  });

  it('should return true and attach project to request when user is the owner', async () => {
    const project = { id: 'proj-1', owner_id: 'u1', workspace_id: 'ws1' };
    mockPrisma.project.findFirst.mockResolvedValue(project);

    const request: any = {
      user: { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      params: { projectId: 'proj-1' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(request.project).toEqual(project);
  });

  it('should resolve projectId from params.id when params.projectId is absent', async () => {
    const project = { id: 'proj-2', owner_id: 'u1', workspace_id: 'ws1' };
    mockPrisma.project.findFirst.mockResolvedValue(project);

    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      { id: 'proj-2' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
