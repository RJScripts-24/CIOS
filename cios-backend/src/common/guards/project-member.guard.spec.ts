import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectMemberGuard } from './project-member.guard';

function makeContext(
  user: object,
  params: object = {},
  extra: object = {},
): ExecutionContext {
  const request = { user, params, ...extra };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

const mockPrisma = {
  project: { findFirst: jest.fn() },
  projectMember: { findUnique: jest.fn() },
};

describe('ProjectMemberGuard', () => {
  let guard: ProjectMemberGuard;

  beforeEach(() => {
    guard = new ProjectMemberGuard(mockPrisma as any);
    jest.clearAllMocks();
  });

  it('should return true when no projectId is present in params', async () => {
    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      {},
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockPrisma.project.findFirst).not.toHaveBeenCalled();
  });

  it('should return true immediately for admin users without querying DB', async () => {
    const ctx = makeContext(
      { sub: 'u1', role: 'admin', workspace_id: 'ws1' },
      { projectId: 'proj-1' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(mockPrisma.project.findFirst).not.toHaveBeenCalled();
  });

  it('should throw ForbiddenException when user has no workspace_id', async () => {
    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: null },
      { projectId: 'proj-1' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw NotFoundException when project does not exist in workspace', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      { projectId: 'proj-missing' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });

  it('should throw ForbiddenException when user is not a member of the project', async () => {
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'proj-1',
      workspace_id: 'ws1',
      owner_id: 'other-user',
    });
    mockPrisma.projectMember.findUnique.mockResolvedValue(null);

    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      { projectId: 'proj-1' },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should return true and attach projectMembership to request when user is a member', async () => {
    const membership = {
      project_id: 'proj-1',
      user_id: 'u1',
      access_level: 'edit',
      workspace_id: 'ws1',
    };
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'proj-1',
      workspace_id: 'ws1',
      owner_id: 'u1',
    });
    mockPrisma.projectMember.findUnique.mockResolvedValue(membership);

    const request = {
      user: { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      params: { projectId: 'proj-1' },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect((request as any).projectMembership).toEqual(membership);
  });

  it('should resolve projectId from params.id when params.projectId is absent', async () => {
    const membership = {
      project_id: 'proj-2',
      user_id: 'u1',
      access_level: 'read_only',
      workspace_id: 'ws1',
    };
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'proj-2',
      workspace_id: 'ws1',
      owner_id: 'other',
    });
    mockPrisma.projectMember.findUnique.mockResolvedValue(membership);

    const ctx = makeContext(
      { sub: 'u1', role: 'team_member', workspace_id: 'ws1' },
      { id: 'proj-2' },
    );
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
