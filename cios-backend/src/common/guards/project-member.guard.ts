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
export class ProjectMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    const projectId: string | undefined =
      (request.params as any)?.projectId ?? (request.params as any)?.id;

    if (!projectId) return true;

    if (user.role === 'admin') return true;

    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ...workspaceScope(user) },
      select: { id: true, workspace_id: true, owner_id: true },
    });

    if (!project) throw new NotFoundException('Project not found');

    const membership = await this.prisma.projectMember.findUnique({
      where: {
        project_id_user_id: { project_id: projectId, user_id: user.sub },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this project');
    }

    (request as any).projectMembership = membership;
    return true;
  }
}
