// ─────────────────────────────────────────────────────────────────────────────
// [NEW FILE] workspace.controller.ts
// Purpose: Exposes workspace and invitation endpoints for authenticated users.
// This file is part of the Workspace Invitation feature added to support
// ClickUp-style email invite flow using Resend for transactional email.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  /**
   * Creates a new workspace for an authenticated admin user.
   *
   * @param req - HTTP request containing req.user.id from JWT strategy
   * @param dto - Workspace name and optional settings payload
   * @returns   The created workspace record
   * @throws    ForbiddenException when the caller is not an admin
   */
  @Post()
  async createWorkspace(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspaceService.createWorkspace(req.user.id, dto);
  }

  /**
   * Sends an invitation email to a target member for a workspace.
   *
   * @param req         - HTTP request containing req.user.id from JWT strategy
   * @param workspaceId - Workspace identifier from the route
   * @param dto         - Invite payload containing target email
   * @returns           Success message and invited email
   * @throws            ForbiddenException, NotFoundException, ConflictException
   */
  @Post(':workspaceId/invite')
  async inviteMember(
    @Request() req: { user: { id: string } },
    @Param('workspaceId') workspaceId: string,
    @Body() dto: InviteMemberDto,
  ) {
    return this.workspaceService.inviteMember(req.user.id, workspaceId, dto);
  }

  /**
   * Accepts an invitation token for an already-registered authenticated user.
   *
   * @param token - Invitation token submitted in the request body
   * @param req   - HTTP request containing req.user.id from JWT strategy
   * @returns     Success message and workspace ID joined by the user
   * @throws      NotFoundException, ConflictException, ForbiddenException
   */
  @Post('invitations/accept')
  async acceptInvitation(
    @Body('token') token: string,
    @Request() req: { user: { id: string } },
  ) {
    return this.workspaceService.acceptInvitation(token, req.user.id);
  }

  /**
   * Lists all members of a workspace for admin users in that workspace.
   *
   * @param req         - HTTP request containing req.user.id from JWT strategy
   * @param workspaceId - Workspace identifier from the route
   * @returns           Member list with profile and role fields
   * @throws            ForbiddenException when access rules are not satisfied
   */
  @Get(':workspaceId/members')
  async getMembers(
    @Request() req: { user: { id: string } },
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.workspaceService.getWorkspaceMembers(req.user.id, workspaceId);
  }

  /**
   * Lists pending workspace invitations for admin users in that workspace.
   *
   * @param req         - HTTP request containing req.user.id from JWT strategy
   * @param workspaceId - Workspace identifier from the route
   * @returns           Pending invitations ordered by newest first
   * @throws            ForbiddenException when access rules are not satisfied
   */
  @Get(':workspaceId/invitations/pending')
  async getPendingInvitations(
    @Request() req: { user: { id: string } },
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.workspaceService.getPendingInvitations(req.user.id, workspaceId);
  }
}
