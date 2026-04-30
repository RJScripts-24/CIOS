import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { workspaceScope } from '../helpers/workspace-scope.helper';
import { RequestWithUser } from '../interfaces/request-with-user.interface';

@Injectable()
export class ProjectOwnerOrAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (user.role === 'admin') return true;

    const projectId: string | undefined =
      (request.params as any)?.projectId ?? (request.params as any)?.id;

    if (!projectId) throw new ForbiddenException('Project ID missing');

    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const project = await this.resolveProjectForOwnershipCheck(projectId, user);

    if (!project) throw new NotFoundException('Project not found');

    if (project.owner_id !== user.sub) {
      throw new ForbiddenException(
        'Only the project owner or admin can perform this action',
      );
    }

    (request as any).project = project;
    return true;
  }

  private async resolveProjectForOwnershipCheck(
    projectOrGroupId: string,
    user: RequestWithUser['user'],
  ): Promise<{ id: string; owner_id: string; workspace_id: string } | null> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectOrGroupId, ...workspaceScope(user) },
      select: { id: true, owner_id: true, workspace_id: true },
    });

    if (project) {
      return project;
    }

    const threadGroup = await this.prisma.threadGroup.findFirst({
      where: { id: projectOrGroupId, ...workspaceScope(user) },
      select: {
        project: {
          select: {
            id: true,
            owner_id: true,
            workspace_id: true,
          },
        },
      },
    });

    return threadGroup?.project ?? null;
  }
}
