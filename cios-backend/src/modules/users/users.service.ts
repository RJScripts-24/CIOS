import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { Prisma, UserRole } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { EmailService } from './email/email.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async listUsers(filters: ListUsersDto, user: JwtPayload) {
    const workspaceId = this.getWorkspaceId(user);
    const where: Prisma.UserWhereInput = {
      workspace_id: workspaceId,
    };

    if (filters.search) {
      where.OR = [
        { full_name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.role !== undefined) {
      where.role = filters.role as UserRole;
    }

    if (filters.is_active !== undefined) {
      where.is_active = filters.is_active;
    }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        full_name: true,
        email: true,
        role: true,
        is_active: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async createUser(dto: CreateUserDto, requestingAdmin: JwtPayload) {
    const workspaceId = this.getWorkspaceId(requestingAdmin);
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        full_name: dto.full_name,
        role: 'team_member',
        workspace_id: workspaceId,
        is_active: false,
      },
      select: { id: true, email: true, full_name: true, role: true },
    });

    const token = crypto.randomUUID();

    await this.prisma.workspaceInvitation.create({
      data: {
        workspace_id: workspaceId,
        invited_by: requestingAdmin.sub,
        email,
        token,
        status: 'pending',
      },
    });

    const frontendUrl = this.configService
      .getOrThrow('FRONTEND_URL')
      .trim()
      .replace(/\/+$/, '');

    await this.emailService.sendInvite({
      to: dto.email,
      inviterName: requestingAdmin.email,
      magicLink: `${frontendUrl}/set-password?token=${token}`,
    });

    return user;
  }

  async promoteUser(targetUserId: string, requestingAdmin: JwtPayload) {
    const workspaceId = this.getWorkspaceId(requestingAdmin);
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, workspace_id: workspaceId },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        is_active: true,
        created_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found in this workspace');
    }

    await this.writeAuditLog(workspaceId, requestingAdmin.sub, 'permission_change', {
      action: 'promote_intent',
      target_user_id: targetUserId,
      note: 'project_owner role removed from schema v4.1 — ownership is managed via projects.owner_id',
    });

    return user;
  }

  async demoteUser(targetUserId: string, requestingAdmin: JwtPayload) {
    const workspaceId = this.getWorkspaceId(requestingAdmin);
    const targetUser = await this.prisma.user.findFirst({
      where: { id: targetUserId, workspace_id: workspaceId },
      select: { id: true },
    });

    if (!targetUser) {
      throw new NotFoundException('User not found in this workspace');
    }

    const ownedProjects = await this.prisma.project.findMany({
      where: {
        owner_id: targetUserId,
        workspace_id: workspaceId,
      },
      select: { id: true, name: true },
    });

    if (ownedProjects.length > 0) {
      await this.prisma.project.updateMany({
        where: {
          owner_id: targetUserId,
          workspace_id: workspaceId,
        },
        data: { owner_id: requestingAdmin.sub },
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { role: 'team_member' },
      select: { id: true, email: true, full_name: true, role: true },
    });

    await this.writeAuditLog(workspaceId, requestingAdmin.sub, 'permission_change', {
      action: 'demote',
      target_user_id: targetUserId,
      transferred_projects: ownedProjects.map((project) => project.id),
    });

    return {
      ...updated,
      transferred_projects: ownedProjects.map((project) => project.id),
    };
  }

  async deactivateUser(targetUserId: string, requestingAdmin: JwtPayload) {
    if (targetUserId === requestingAdmin.sub) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    const workspaceId = this.getWorkspaceId(requestingAdmin);
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, workspace_id: workspaceId },
    });

    if (!user) {
      throw new NotFoundException('User not found in this workspace');
    }

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { is_active: false },
      select: { id: true, email: true, is_active: true },
    });
  }

  async activateUser(targetUserId: string, requestingAdmin: JwtPayload) {
    const workspaceId = this.getWorkspaceId(requestingAdmin);
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, workspace_id: workspaceId },
    });

    if (!user) {
      throw new NotFoundException('User not found in this workspace');
    }

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { is_active: true },
      select: { id: true, email: true, is_active: true },
    });
  }

  private async writeAuditLog(
    workspaceId: string,
    userId: string,
    eventType: string,
    eventDetail: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        workspace_id: workspaceId,
        user_id: userId,
        event_type: eventType,
        event_detail: eventDetail as Prisma.InputJsonValue,
      },
    });
  }

  private getWorkspaceId(user: JwtPayload): string {
    if (!user.workspace_id) {
      throw new ForbiddenException('Admin user must belong to a workspace');
    }

    return user.workspace_id;
  }
}
