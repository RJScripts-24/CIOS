import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ProjectEditAccessGuard } from './project-edit-access.guard';

function makeContext(
  user: object,
  projectMembership?: object,
): ExecutionContext {
  const request: any = { user, params: {} };
  if (projectMembership !== undefined) {
    request.projectMembership = projectMembership;
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ProjectEditAccessGuard', () => {
  let guard: ProjectEditAccessGuard;

  beforeEach(() => {
    guard = new ProjectEditAccessGuard();
  });

  it('should return true for admin users regardless of membership', () => {
    const ctx = makeContext({ role: 'admin', sub: 'u1' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when projectMembership is not on request', () => {
    const ctx = makeContext({ role: 'team_member', sub: 'u1' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when access_level is read_only', () => {
    const ctx = makeContext(
      { role: 'team_member', sub: 'u1' },
      { access_level: 'read_only', project_id: 'p1', user_id: 'u1' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException with correct message for read_only user', () => {
    const ctx = makeContext(
      { role: 'team_member', sub: 'u1' },
      { access_level: 'read_only', project_id: 'p1', user_id: 'u1' },
    );
    expect(() => guard.canActivate(ctx)).toThrow(
      'You have read-only access to this project',
    );
  });

  it('should return true when access_level is edit', () => {
    const ctx = makeContext(
      { role: 'team_member', sub: 'u1' },
      { access_level: 'edit', project_id: 'p1', user_id: 'u1' },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw the "membership not resolved" error when projectMembership is null', () => {
    const request: any = {
      user: { role: 'team_member', sub: 'u1' },
      params: {},
      projectMembership: null,
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    expect(() => guard.canActivate(ctx)).toThrow(
      'Project membership not resolved',
    );
  });
});
