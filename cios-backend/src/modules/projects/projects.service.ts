import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '../../generated/prisma/client';
import { workspaceScope } from '../../common/helpers/workspace-scope.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateCustomPropertyDto } from './dto/create-custom-property.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { UpdateCustomPropertyDto } from './dto/update-custom-property.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

type AttachedProject = {
  id: string;
  owner_id: string;
  workspace_id: string;
};

type ProjectDetail = Prisma.ProjectGetPayload<{
  include: {
    owner: { select: { id: true; full_name: true; avatar_url: true } };
    project_members: {
      include: {
        user: { select: { id: true; full_name: true; email: true; avatar_url: true } };
      };
    };
    project_custom_properties: true;
  };
}>;

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  constructor(private readonly prisma: PrismaService) {}

  async listProjects(dto: ListProjectsDto, user: JwtPayload) {
    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const whereAnd: Prisma.ProjectWhereInput[] = [workspaceScope(user)];

    if (user.role !== 'admin') {
      whereAnd.push({
        OR: [
          { project_members: { some: { user_id: user.sub } } },
          { owner_id: user.sub },
        ],
      });
    }

    if (dto.status) {
      whereAnd.push({ status: dto.status });
    } else {
      whereAnd.push({ status: { not: 'archived' } });
    }

    if (dto.type) whereAnd.push({ type: dto.type });
    if (dto.owner_id) whereAnd.push({ owner_id: dto.owner_id });

    if (dto.date_from || dto.date_to) {
      whereAnd.push({
        created_at: {
          ...(dto.date_from ? { gte: new Date(dto.date_from) } : {}),
          ...(dto.date_to ? { lte: new Date(dto.date_to) } : {}),
        },
      });
    }

    if (dto.search) {
      whereAnd.push({
        OR: [
          { name: { contains: dto.search, mode: 'insensitive' } },
          { brief: { contains: dto.search, mode: 'insensitive' } },
        ],
      });
    }

    if (dto.has_linked_sources === true) {
      whereAnd.push({
        OR: [
          { clickup_link: { not: null } },
          { slack_channel_link: { not: null } },
          { fathom_links: { isEmpty: false } },
        ],
      });
    }

    if (dto.has_linked_sources === false) {
      whereAnd.push({
        AND: [
          {
            OR: [{ clickup_link: null }, { clickup_link: '' }],
          },
          {
            OR: [{ slack_channel_link: null }, { slack_channel_link: '' }],
          },
          { fathom_links: { isEmpty: true } },
        ],
      });
    }

    const projects = await this.prisma.project.findMany({
      where: { AND: whereAnd },
      include: {
        owner: { select: { id: true, full_name: true, avatar_url: true } },
        _count: { select: { threads: true, project_members: true } },
      },
    });

    if (projects.length === 0) return [];

    const projectIds = projects.map((project) => project.id);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const activityRows = await this.prisma.thread.groupBy({
      by: ['project_id'],
      _max: { last_active_at: true },
      where: {
        ...workspaceScope(user),
        project_id: { in: projectIds },
      },
    });

    const costRows = await this.prisma.usageEvent.groupBy({
      by: ['project_id'],
      _sum: { cost_usd: true },
      where: {
        ...workspaceScope(user),
        project_id: { in: projectIds },
        timestamp: { gte: monthStart },
      },
    });

    const lastActiveByProjectId = new Map(
      activityRows.map((row) => [row.project_id, row._max.last_active_at ?? null]),
    );
    const costByProjectId = new Map(
      costRows.map((row) => [row.project_id, Number(row._sum.cost_usd ?? 0)]),
    );

    const mapped = projects.map((project) => {
      const monthlyCost = costByProjectId.get(project.id) ?? 0;

      return {
        id: project.id,
        name: project.name,
        type: project.type,
        status: project.status,
        owner: project.owner,
        thread_count: project._count.threads,
        monthly_cost: monthlyCost.toFixed(2),
        last_active_at: lastActiveByProjectId.get(project.id) ?? null,
        linked_sources: {
          clickup: !!project.clickup_link,
          slack: !!project.slack_channel_link,
          fathom: project.fathom_links.length > 0,
        },
        member_count: project._count.project_members,
      };
    });

    if (dto.group_by === 'owner') {
      return [...mapped].sort((a, b) => {
        const left = a.owner?.full_name ?? '';
        const right = b.owner?.full_name ?? '';
        return left.localeCompare(right);
      });
    }

    const sortBy = dto.sort_by ?? 'last_active';
    const sorted = [...mapped];

    if (sortBy === 'name_asc') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'cost_high_low') {
      sorted.sort(
        (a, b) => Number(b.monthly_cost) - Number(a.monthly_cost),
      );
    } else if (sortBy === 'thread_count') {
      sorted.sort((a, b) => b.thread_count - a.thread_count);
    } else {
      sorted.sort((a, b) => {
        const left = a.last_active_at?.getTime() ?? 0;
        const right = b.last_active_at?.getTime() ?? 0;
        return right - left;
      });
    }

    return sorted;
  }

  async createProject(dto: CreateProjectDto, user: JwtPayload) {
    const workspaceId = user.workspace_id;
    if (!workspaceId) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    if (dto.members?.length) {
      const memberIds = dto.members.map((member) => member.user_id);
      const memberUsers = await this.prisma.user.findMany({
        where: { id: { in: memberIds } },
        select: { id: true, workspace_id: true },
      });

      const invalidMember = memberUsers.find(
        (member) => member.workspace_id !== workspaceId,
      );

      if (invalidMember) {
        throw new BadRequestException(
          `Member user_id ${invalidMember.id} does not belong to this workspace`,
        );
      }

      const foundIds = new Set(memberUsers.map((member) => member.id));
      const missingMember = dto.members.find(
        (member) => !foundIds.has(member.user_id),
      );

      if (missingMember) {
        throw new BadRequestException(
          `Member user_id ${missingMember.user_id} does not exist`,
        );
      }
    }

    const createdProject = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          workspace_id: workspaceId,
          name: dto.name,
          type: dto.type,
          status: dto.status ?? 'active',
          brief: dto.brief ?? null,
          system_instructions: dto.system_instructions ?? null,
          default_model: dto.default_model ?? null,
          owner_id: user.sub,
          clickup_link: dto.clickup_link ?? null,
          slack_channel_link: dto.slack_channel_link ?? null,
          fathom_links: dto.fathom_links ?? [],
          vault_drive_link: dto.vault_drive_link ?? null,
        },
      });

      if (dto.members?.length) {
        await tx.projectMember.createMany({
          data: dto.members.map((member) => ({
            project_id: project.id,
            user_id: member.user_id,
            access_level: member.access_level as AccessLevel,
            workspace_id: workspaceId,
            assigned_by: user.sub,
          })),
        });
      }

      await this.writeAuditLog(
        user,
        'project_created',
        {
          project_id: project.id,
          project_name: project.name,
          member_count: dto.members?.length ?? 0,
        },
        tx,
        project.id,
      );

      return project;
    });

    const detail = await this.prisma.project.findFirst({
      where: { ...workspaceScope(user), id: createdProject.id },
      include: {
        owner: { select: { id: true, full_name: true, avatar_url: true } },
        project_members: {
          include: {
            user: {
              select: { id: true, full_name: true, email: true, avatar_url: true },
            },
          },
        },
        project_custom_properties: true,
      },
    });

    if (!detail) throw new NotFoundException('Project not found');

    return this.mapProjectDetail(detail);
  }

  async getProjectById(id: string, user: JwtPayload) {
    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const project = await this.prisma.project.findFirst({
      where: { ...workspaceScope(user), id },
      include: {
        owner: { select: { id: true, full_name: true, avatar_url: true } },
        project_members: {
          include: {
            user: {
              select: { id: true, full_name: true, email: true, avatar_url: true },
            },
          },
        },
        project_custom_properties: { orderBy: { sort_order: 'asc' } },
      },
    });

    if (!project) throw new NotFoundException('Project not found');

    return this.mapProjectDetail(project);
  }

  async updateProject(
    id: string,
    dto: UpdateProjectDto,
    user: JwtPayload,
    attachedProject?: AttachedProject,
  ) {
    if (!attachedProject) {
      throw new ForbiddenException(
        'Project not resolved - ensure ProjectOwnerOrAdminGuard runs first',
      );
    }

    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const data: Prisma.ProjectUpdateManyMutationInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.brief !== undefined) data.brief = dto.brief;
    if (dto.system_instructions !== undefined)
      data.system_instructions = dto.system_instructions;
    if (dto.default_model !== undefined) data.default_model = dto.default_model;
    if (dto.clickup_link !== undefined) data.clickup_link = dto.clickup_link;
    if (dto.slack_channel_link !== undefined)
      data.slack_channel_link = dto.slack_channel_link;
    if (dto.fathom_links !== undefined) data.fathom_links = dto.fathom_links;
    if (dto.vault_drive_link !== undefined)
      data.vault_drive_link = dto.vault_drive_link;

    const changedFields = Object.keys(data);

    if (changedFields.length === 0) {
      return attachedProject;
    }

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.project.updateMany({
        where: { ...workspaceScope(user), id },
        data,
      });

      if (result.count === 0) throw new NotFoundException('Project not found');

      await this.writeAuditLog(
        user,
        'project_updated',
        { project_id: id, changed_fields: changedFields },
        tx,
        id,
      );
    });

    return { ...attachedProject, ...data };
  }

  async archiveProject(id: string, user: JwtPayload) {
    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.project.updateMany({
        where: { ...workspaceScope(user), id },
        data: { status: 'archived' },
      });

      if (result.count === 0) throw new NotFoundException('Project not found');

      await this.writeAuditLog(
        user,
        'project_archived',
        { project_id: id },
        tx,
        id,
      );
    });

    return { id, status: 'archived' };
  }

  async deleteProject(id: string, confirmHeader: string, user: JwtPayload) {
    if (confirmHeader !== 'true') {
      throw new BadRequestException(
        'Confirmation required: set header X-Confirm-Delete: true',
      );
    }

    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const project = await this.prisma.project.findFirst({
      where: { ...workspaceScope(user), id },
      select: { id: true, name: true },
    });

    if (!project) throw new NotFoundException('Project not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.project.deleteMany({ where: { ...workspaceScope(user), id } });

      await this.writeAuditLog(
        user,
        'project_deleted',
        { project_id: project.id, project_name: project.name, deleted_by: user.sub },
        tx,
        project.id,
      );
    });

    return { message: 'Project deleted' };
  }

  async addMember(id: string, dto: AddMemberDto, user: JwtPayload) {
    const workspaceId = user.workspace_id;
    if (!workspaceId) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const targetUser = await this.prisma.user.findFirst({
      where: { id: dto.user_id, ...workspaceScope(user) },
      select: { id: true },
    });

    if (!targetUser) {
      throw new BadRequestException(
        'The user you are adding does not belong to this workspace',
      );
    }

    const existingMembership = await this.prisma.projectMember.findUnique({
      where: {
        project_id_user_id: { project_id: id, user_id: dto.user_id },
      },
    });

    const member = await this.prisma.projectMember.upsert({
      where: {
        project_id_user_id: { project_id: id, user_id: dto.user_id },
      },
      update: {
        access_level: dto.access_level as AccessLevel,
      },
      create: {
        project_id: id,
        user_id: dto.user_id,
        access_level: dto.access_level as AccessLevel,
        workspace_id: workspaceId,
        assigned_by: user.sub,
      },
    });

    await this.writeAuditLog(
      user,
      existingMembership ? 'project_member_updated' : 'project_member_added',
      {
        project_id: id,
        user_id: dto.user_id,
        access_level: dto.access_level,
      },
      this.prisma,
      id,
    );

    return member;
  }

  async updateMemberAccess(
    id: string,
    userId: string,
    dto: UpdateMemberDto,
    user: JwtPayload,
  ) {
    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const membership = await this.prisma.projectMember.findFirst({
      where: { ...workspaceScope(user), project_id: id, user_id: userId },
      select: { project_id: true, user_id: true },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    const updated = await this.prisma.projectMember.update({
      where: {
        project_id_user_id: { project_id: id, user_id: userId },
      },
      data: { access_level: dto.access_level as AccessLevel },
    });

    await this.writeAuditLog(
      user,
      'project_member_updated',
      { project_id: id, user_id: userId, access_level: dto.access_level },
      this.prisma,
      id,
    );

    return updated;
  }

  async removeMember(
    id: string,
    userId: string,
    user: JwtPayload,
    attachedProject?: AttachedProject,
  ) {
    if (!attachedProject) {
      throw new ForbiddenException(
        'Project not resolved - ensure ProjectOwnerOrAdminGuard runs first',
      );
    }

    if (attachedProject.owner_id === userId) {
      throw new ForbiddenException(
        'Transfer ownership before removing the project owner',
      );
    }

    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const membership = await this.prisma.projectMember.findFirst({
      where: { ...workspaceScope(user), project_id: id, user_id: userId },
      select: { project_id: true, user_id: true },
    });

    if (!membership) throw new NotFoundException('Membership not found');

    await this.prisma.projectMember.delete({
      where: {
        project_id_user_id: { project_id: id, user_id: userId },
      },
    });

    await this.writeAuditLog(
      user,
      'project_member_removed',
      { project_id: id, user_id: userId },
      this.prisma,
      id,
    );

    return { message: 'Member removed' };
  }

  async transferOwnership(
    id: string,
    dto: TransferOwnershipDto,
    user: JwtPayload,
  ) {
    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const newOwner = await this.prisma.user.findFirst({
      where: { id: dto.new_owner_id, ...workspaceScope(user) },
      select: { id: true },
    });

    if (!newOwner) {
      throw new BadRequestException(
        'The new owner must be a member of this workspace',
      );
    }

    const project = await this.prisma.project.findFirst({
      where: { ...workspaceScope(user), id },
      select: { id: true, owner_id: true },
    });

    if (!project) throw new NotFoundException('Project not found');

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.project.updateMany({
        where: { ...workspaceScope(user), id },
        data: { owner_id: dto.new_owner_id },
      });

      if (result.count === 0) throw new NotFoundException('Project not found');

      await this.writeAuditLog(
        user,
        'project_ownership_transferred',
        {
          project_id: id,
          old_owner_id: project.owner_id,
          new_owner_id: dto.new_owner_id,
        },
        tx,
        id,
      );
    });

    return this.prisma.project.findFirst({
      where: { ...workspaceScope(user), id },
      include: {
        owner: { select: { id: true, full_name: true, avatar_url: true } },
      },
    });
  }

  async listCustomProperties(id: string, user: JwtPayload) {
    return this.prisma.projectCustomProperty.findMany({
      where: { ...workspaceScope(user), project_id: id },
      orderBy: { sort_order: 'asc' },
    });
  }

  async createCustomProperty(
    id: string,
    dto: CreateCustomPropertyDto,
    user: JwtPayload,
  ) {
    const workspaceId = user.workspace_id;
    if (!workspaceId) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    if (
      (dto.property_type === 'single_select' ||
        dto.property_type === 'multi_select') &&
      (!dto.options || dto.options.length === 0)
    ) {
      throw new BadRequestException(
        `options is required and must be non-empty for property_type '${dto.property_type}'`,
      );
    }

    const property = await this.prisma.projectCustomProperty.create({
      data: {
        project_id: id,
        workspace_id: workspaceId,
        created_by: user.sub,
        name: dto.name,
        property_type: dto.property_type,
        options: dto.options ?? [],
        sort_order: dto.sort_order ?? 0,
      },
    });

    await this.writeAuditLog(
      user,
      'custom_property_created',
      { project_id: id, property_id: property.id },
      this.prisma,
      id,
    );

    return property;
  }

  async updateCustomProperty(
    id: string,
    propertyId: string,
    dto: UpdateCustomPropertyDto,
    user: JwtPayload,
  ) {
    if (!user.workspace_id) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    const property = await this.prisma.projectCustomProperty.findFirst({
      where: { ...workspaceScope(user), project_id: id, id: propertyId },
      select: { id: true },
    });

    if (!property) throw new NotFoundException('Custom property not found');

    const data: Prisma.ProjectCustomPropertyUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.options !== undefined) data.options = dto.options;
    if (dto.sort_order !== undefined) data.sort_order = dto.sort_order;

    const updated = await this.prisma.projectCustomProperty.update({
      where: { id: propertyId },
      data,
    });

    await this.writeAuditLog(
      user,
      'custom_property_updated',
      { project_id: id, property_id: propertyId },
      this.prisma,
      id,
    );

    return updated;
  }

  async deleteCustomProperty(
    id: string,
    propertyId: string,
    user: JwtPayload,
  ) {
    const property = await this.prisma.projectCustomProperty.findFirst({
      where: { ...workspaceScope(user), id: propertyId, project_id: id },
      select: { id: true },
    });

    if (!property) throw new NotFoundException('Custom property not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.threadPropertyValue.deleteMany({
        where: { property_id: propertyId },
      });

      await tx.projectCustomProperty.delete({ where: { id: propertyId } });

      await this.writeAuditLog(
        user,
        'custom_property_deleted',
        { project_id: id, property_id: propertyId },
        tx,
        id,
      );
    });

    return { message: 'Property deleted' };
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

  private mapProjectDetail(project: ProjectDetail) {
    const { project_members, project_custom_properties, ...rest } = project;
    return {
      ...rest,
      members: project_members,
      custom_properties: project_custom_properties,
    };
  }
}