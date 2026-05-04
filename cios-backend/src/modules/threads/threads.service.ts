import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { workspaceScope } from '../../common/helpers/workspace-scope.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateThreadDto } from './dto/create-thread.dto';
import { ListThreadsDto } from './dto/list-threads.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { UpsertPropertyValuesDto } from './dto/upsert-property-values.dto';
import { ThreadResponse } from './interfaces/thread-response.interface';

type ThreadWithPropertyValues = Prisma.ThreadGetPayload<{
  include: {
    thread_property_values: {
      select: { property_id: true; value: true };
    };
  };
}>;

@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async writeAuditLog(
    user: JwtPayload,
    eventType: string,
    eventDetail: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        workspace_id: user.workspace_id!,
        user_id: user.sub,
        event_type: eventType,
        event_detail: eventDetail,
      },
    });
  }

  private mapThreadResponse(thread: ThreadWithPropertyValues): ThreadResponse {
    const property_values: Record<string, unknown> = {};

    for (const threadPropertyValue of thread.thread_property_values ?? []) {
      property_values[threadPropertyValue.property_id] = threadPropertyValue.value;
    }

    return {
      id: thread.id,
      project_id: thread.project_id,
      workspace_id: thread.workspace_id,
      group_id: thread.group_id ?? null,
      title: thread.title,
      purpose_tag: thread.purpose_tag ?? null,
      status: thread.status ?? null,
      access_level: thread.access_level ?? 'team',
      system_prompt: thread.system_prompt ?? null,
      last_model_used: thread.last_model_used ?? null,
      created_by: thread.created_by,
      last_active_at: thread.last_active_at ?? null,
      total_cost:
        thread.total_cost !== null && thread.total_cost !== undefined
          ? Number(thread.total_cost).toFixed(6)
          : '0.000000',
      created_at: thread.created_at,
      updated_at: thread.updated_at,
      property_values,
    };
  }

  private async requireWorkspace(user: JwtPayload): Promise<string> {
    const workspaceId = user.workspace_id;

    if (!workspaceId) {
      throw new ForbiddenException('User has no workspace assigned');
    }

    return workspaceId;
  }

  private async loadThreadWithAccess(
    id: string,
    user: JwtPayload,
  ): Promise<ThreadWithPropertyValues> {
    await this.requireWorkspace(user);

    const thread = await this.prisma.thread.findFirst({
      where: { ...workspaceScope(user), id },
      include: {
        thread_property_values: {
          select: { property_id: true, value: true },
        },
      },
    });

    if (!thread) {
      throw new NotFoundException('Thread not found');
    }

    if (
      thread.access_level === 'private' &&
      user.role !== 'admin' &&
      thread.created_by !== user.sub
    ) {
      throw new ForbiddenException('You do not have access to this thread');
    }

    return thread;
  }

  private async loadThreadSummaryWithAccess(
    id: string,
    user: JwtPayload,
  ): Promise<{ id: string; project_id: string }> {
    await this.requireWorkspace(user);

    const thread = await this.prisma.thread.findFirst({
      where: { ...workspaceScope(user), id },
      select: { id: true, project_id: true },
    });

    if (!thread) {
      throw new NotFoundException('Thread not found');
    }

    return thread;
  }

  async listThreads(
    projectId: string,
    dto: ListThreadsDto,
    user: JwtPayload,
  ): Promise<{ groups: unknown[]; ungrouped_threads: ThreadResponse[] }> {
    await this.requireWorkspace(user);

    const where: Prisma.ThreadWhereInput = {
      ...workspaceScope(user),
      project_id: projectId,
    };

    if (dto.search) {
      where.title = { contains: dto.search, mode: 'insensitive' };
    }

    if (dto.purpose_tag && dto.purpose_tag.length > 0) {
      where.purpose_tag = { in: dto.purpose_tag };
    }

    if (dto.created_by) {
      where.created_by = dto.created_by;
    }

    if (dto.model) {
      where.last_model_used = dto.model;
    }

    if (dto.status) {
      where.status = dto.status;
    }

    if (dto.date_from || dto.date_to) {
      where.created_at = {
        ...(dto.date_from ? { gte: new Date(dto.date_from) } : {}),
        ...(dto.date_to ? { lte: new Date(dto.date_to) } : {}),
      };
    }

    if (dto.cost_min !== undefined || dto.cost_max !== undefined) {
      where.total_cost = {
        ...(dto.cost_min !== undefined ? { gte: dto.cost_min } : {}),
        ...(dto.cost_max !== undefined ? { lte: dto.cost_max } : {}),
      };
    }

    if (dto.group_id) {
      where.group_id = dto.group_id;
    }

    const accessFilter: Prisma.ThreadWhereInput =
      user.role === 'admin'
        ? {}
        : {
            OR: [
              { access_level: 'team' },
              { access_level: 'private', created_by: user.sub },
            ],
          };

    Object.assign(where, accessFilter);

    const sortMap: Record<string, Prisma.ThreadOrderByWithRelationInput> = {
      last_active: { last_active_at: 'desc' },
      title_asc: { title: 'asc' },
      cost_desc: { total_cost: 'desc' },
      created_at: { created_at: 'desc' },
    };

    const threads = await this.prisma.thread.findMany({
      where,
      orderBy: sortMap[dto.sort_by ?? 'last_active'],
      include: {
        thread_property_values: {
          select: { property_id: true, value: true },
        },
      },
    });

    const mapped = threads.map((thread) => this.mapThreadResponse(thread));
    const groupIds = Array.from(
      new Set(
        mapped
          .map((thread) => thread.group_id)
          .filter((groupId): groupId is string => Boolean(groupId)),
      ),
    );

    let groups: unknown[] = [];

    if (groupIds.length > 0) {
      const groupRecords = await this.prisma.threadGroup.findMany({
        where: { ...workspaceScope(user), id: { in: groupIds } },
        orderBy: { created_at: 'asc' },
      });

      groups = groupRecords.map((group) => {
        const groupThreads = mapped.filter((thread) => thread.group_id === group.id);
        const total_cost = groupThreads
          .reduce((sum, thread) => sum + Number(thread.total_cost), 0)
          .toFixed(6);

        return {
          id: group.id,
          name: group.name,
          total_cost,
          threads: groupThreads,
        };
      });
    }

    return {
      groups,
      ungrouped_threads: mapped.filter((thread) => !thread.group_id),
    };
  }

  async createThread(
    projectId: string,
    dto: CreateThreadDto,
    user: JwtPayload,
  ): Promise<ThreadResponse> {
    const workspaceId = await this.requireWorkspace(user);

    if (dto.group_id) {
      const group = await this.prisma.threadGroup.findFirst({
        where: {
          ...workspaceScope(user),
          id: dto.group_id,
          project_id: projectId,
        },
        select: { id: true },
      });

      if (!group) {
        throw new NotFoundException(
          `Thread group ${dto.group_id} not found in this project`,
        );
      }
    }

    const thread = await this.prisma.$transaction(async (tx) => {
      const created = await tx.thread.create({
        data: {
          project_id: projectId,
          workspace_id: workspaceId,
          created_by: user.sub,
          title: dto.title,
          purpose_tag: dto.purpose_tag,
          last_model_used: dto.model,
          system_prompt: dto.system_prompt,
          group_id: dto.group_id ?? null,
          status: 'active',
          access_level: dto.access_level ?? 'team',
        },
        include: {
          thread_property_values: {
            select: { property_id: true, value: true },
          },
        },
      });

      if (dto.skill_ids && dto.skill_ids.length > 0) {
        await tx.threadActiveSkill.createMany({
          data: dto.skill_ids.map((skillId) => ({
            thread_id: created.id,
            skill_id: skillId,
            workspace_id: workspaceId,
            invocation_type: 'manual',
            injected_at: new Date(),
          })),
          skipDuplicates: true,
        });
      }

      return created as ThreadWithPropertyValues;
    });

    await this.writeAuditLog(user, 'thread_created', {
      thread_id: thread.id,
      project_id: projectId,
      title: thread.title,
    });

    return this.mapThreadResponse(thread);
  }

  async getThreadById(id: string, user: JwtPayload): Promise<ThreadResponse> {
    const thread = await this.loadThreadWithAccess(id, user);
    return this.mapThreadResponse(thread);
  }

  async updateThread(
    id: string,
    dto: UpdateThreadDto,
    user: JwtPayload,
  ): Promise<ThreadResponse> {
    const current = await this.loadThreadWithAccess(id, user);

    if (dto.group_id) {
      const group = await this.prisma.threadGroup.findFirst({
        where: {
          ...workspaceScope(user),
          id: dto.group_id,
          project_id: current.project_id,
        },
        select: { id: true },
      });

      if (!group) {
        throw new NotFoundException(
          `Thread group ${dto.group_id} not found in this project`,
        );
      }
    }

    const data: Prisma.ThreadUncheckedUpdateInput = {};

    if (dto.title !== undefined) data.title = dto.title;
    if (dto.purpose_tag !== undefined) data.purpose_tag = dto.purpose_tag;
    if (dto.status !== undefined) data.status = dto.status;
    if ('group_id' in dto) data.group_id = dto.group_id ?? null;
    if (dto.system_prompt !== undefined) data.system_prompt = dto.system_prompt;
    if (dto.access_level !== undefined) data.access_level = dto.access_level;

    if (Object.keys(data).length === 0) {
      return this.mapThreadResponse(current);
    }

    const updated = await this.prisma.thread.update({
      where: { id },
      data,
      include: {
        thread_property_values: {
          select: { property_id: true, value: true },
        },
      },
    });

    return this.mapThreadResponse(updated as ThreadWithPropertyValues);
  }

  async upsertPropertyValues(
    threadId: string,
    dto: UpsertPropertyValuesDto,
    user: JwtPayload,
  ): Promise<{ thread_id: string; updated_values: unknown[] }> {
    const thread = await this.loadThreadWithAccess(threadId, user);

    const propertyIds = dto.values.map((value) => value.property_id);
    const properties = await this.prisma.projectCustomProperty.findMany({
      where: {
        ...workspaceScope(user),
        project_id: thread.project_id,
        id: { in: propertyIds },
      },
      select: { id: true, property_type: true },
    });

    const propertyMap = new Map(properties.map((property) => [property.id, property]));

    for (const item of dto.values) {
      if (!propertyMap.has(item.property_id)) {
        throw new NotFoundException(
          `Custom property ${item.property_id} not found on this project`,
        );
      }
    }

    for (const item of dto.values) {
      const property = propertyMap.get(item.property_id);

      if (!property) {
        throw new NotFoundException(
          `Custom property ${item.property_id} not found on this project`,
        );
      }

      const valid = validatePropertyValue(property.property_type, item.value);

      if (!valid) {
        throw new UnprocessableEntityException(
          `Value for property ${item.property_id} does not match expected type "${property.property_type}"`,
        );
      }
    }

    const updated_values = await this.prisma.$transaction(
      dto.values.map((item) =>
        this.prisma.threadPropertyValue.upsert({
          where: {
            thread_id_property_id: {
              thread_id: threadId,
              property_id: item.property_id,
            },
          },
          create: {
            thread_id: threadId,
            property_id: item.property_id,
            value: item.value as Prisma.InputJsonValue,
          },
          update: {
            value: item.value as Prisma.InputJsonValue,
          },
          select: { property_id: true, value: true },
        }),
      ),
    );

    return { thread_id: threadId, updated_values };
  }
}

function validatePropertyValue(propertyType: string, value: unknown): boolean {
  if (value === null || value === undefined) return true;

  switch (propertyType) {
    case 'text':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'checkbox':
      return typeof value === 'boolean';
    case 'single_select':
      return typeof value === 'string';
    case 'multi_select':
    case 'person':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    default:
      return false;
  }
}