import { ForbiddenException } from '@nestjs/common';
import { workspaceScope } from './workspace-scope.helper';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

describe('workspaceScope()', () => {
  const basePayload: JwtPayload = {
    sub: 'user-uuid-1',
    email: 'test@example.com',
    role: 'team_member',
    workspace_id: 'workspace-uuid-1',
  };

  it('should return workspace_id fragment when workspace_id is present', () => {
    const result = workspaceScope(basePayload);
    expect(result).toEqual({ workspace_id: 'workspace-uuid-1' });
  });

  it('should throw when workspace_id is null', () => {
    const payload = { ...basePayload, workspace_id: null };
    expect(() => workspaceScope(payload)).toThrow(
      'workspace_id is required for scoped queries but was null',
    );
  });

  it('should always return an object with exactly the workspace_id key', () => {
    const result = workspaceScope(basePayload);
    expect(Object.keys(result)).toEqual(['workspace_id']);
  });
});
