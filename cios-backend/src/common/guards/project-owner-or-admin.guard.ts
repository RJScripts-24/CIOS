import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspace_id: user.workspace_id },
    });

    if (!project) throw new NotFoundException('Project not found');

    if (project.owner_id !== user.sub) {
      throw new ForbiddenException(
        'Only the project owner or admin can perform this action',
      );
    }

    (request as any).project = project;
    return true;
  }
}
