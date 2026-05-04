import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { workspaceScope } from '../../common/helpers/workspace-scope.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateThreadGroupDto } from './dto/create-thread-group.dto';
import { UpdateThreadGroupDto } from './dto/update-thread-group.dto';

@Injectable()
export class ThreadGroupsService {
  private readonly logger = new Logger(ThreadGroupsService.name);
  constructor(private readonly prisma: PrismaService) {}

  async createThreadGroup(
    projectId: string,
    dto: CreateThreadGroupDto,
    user: JwtPayload,
  ) {
    const workspaceId = user.workspace_id;
    if (!workspaceId) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    return this.prisma.threadGroup.create({
      data: {
        project_id: projectId,
        workspace_id: workspaceId,
        created_by: user.sub,
        name: dto.name,
      },
    });
  }

  async listThreadGroups(projectId: string, user: JwtPayload) {
    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const groups = await this.prisma.threadGroup.findMany({
      where: { ...workspaceScope(user), project_id: projectId },
      orderBy: { created_at: 'asc' },
    });

    if (groups.length === 0) return [];

    const aggregates = await this.prisma.thread.groupBy({
      by: ['group_id'],
      _count: { _all: true },
      _sum: { total_cost: true },
      where: {
        ...workspaceScope(user),
        project_id: projectId,
        group_id: { not: null },
      },
    });

    const aggregateByGroupId = new Map(
      aggregates
        .filter((row) => row.group_id)
        .map((row) => [
          row.group_id as string,
          {
            total_cost: Number(row._sum.total_cost ?? 0),
            thread_count: row._count._all,
          },
        ]),
    );

    return groups.map((group) => {
      const aggregate = aggregateByGroupId.get(group.id);

      return {
        id: group.id,
        project_id: group.project_id,
        name: group.name,
        total_cost: (aggregate?.total_cost ?? 0).toFixed(2),
        thread_count: aggregate?.thread_count ?? 0,
      };
    });
  }

  async updateThreadGroup(
    id: string,
    dto: UpdateThreadGroupDto,
    user: JwtPayload,
  ) {
    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const group = await this.prisma.threadGroup.findFirst({
      where: { ...workspaceScope(user), id },
    });

    if (!group) throw new NotFoundException('Thread group not found');

    const data: Prisma.ThreadGroupUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;

    if (Object.keys(data).length === 0) return group;

    const updated = await this.prisma.threadGroup.update({ where: { id }, data });

    await this.writeAuditLog(
      user,
      'thread_group_renamed',
      { group_id: id, project_id: group.project_id },
      this.prisma,
      group.project_id,
    );

    return updated;
  }

  async deleteThreadGroup(id: string, user: JwtPayload) {
    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const group = await this.prisma.threadGroup.findFirst({
      where: { ...workspaceScope(user), id },
      select: { id: true, project_id: true },
    });

    if (!group) throw new NotFoundException('Thread group not found');

    return this.prisma.$transaction(async (tx) => {
      const { count: unassigned_thread_count } = await tx.thread.updateMany({
        where: { ...workspaceScope(user), group_id: id },
        data: { group_id: null },
      });

      await tx.threadGroup.delete({ where: { id } });

      await this.writeAuditLog(
        user,
        'thread_group_deleted',
        {
          group_id: id,
          project_id: group.project_id,
          unassigned_thread_count,
        },
        tx,
        group.project_id,
      );

      return { message: 'Group deleted', unassigned_thread_count };
    });
  }

  private async writeAuditLog(
    user: JwtPayload,
    eventType: string,
    eventDetail: Record<string, unknown>,
    prisma: Prisma.TransactionClient = this.prisma,
    projectId?: string | null,
  ): Promise<void> {
    const workspaceId = user.workspace_id;
    if (!workspaceId) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const resolvedProjectId =
      projectId ??
      (typeof eventDetail.project_id === 'string' ? eventDetail.project_id : null);

    await prisma.auditLog.create({
      data: {
        workspace_id: workspaceId,
        user_id: user.sub,
        project_id: resolvedProjectId ?? undefined,
        event_type: eventType,
        event_detail: eventDetail as Prisma.InputJsonValue,
      },
    });
  }
}