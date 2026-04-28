import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

/**
 * Returns a Prisma `where` fragment scoped to the user's workspace.
 * EVERY Prisma query in CIOS must include this as the base where clause.
 * Never query without workspace_id - it is the multi-tenant isolation boundary.
 *
 * Usage:
 *   this.prisma.project.findMany({
 *     where: { ...workspaceScope(user), status: 'active' }
 *   })
 */
export function workspaceScope(user: JwtPayload): { workspace_id: string } {
  if (!user.workspace_id) {
    throw new Error('workspace_id is required for scoped queries but was null');
  }
  return { workspace_id: user.workspace_id };
}
