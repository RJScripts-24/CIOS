// ─────────────────────────────────────────────────────────────────────────────
// [NEW FILE] workspace.service.ts
// Purpose: Handles all workspace creation and member invitation logic for CIOS.
// This file is part of the Workspace Invitation feature added to support
// ClickUp-style email invite flow using Resend for transactional email.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Injectable,
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from 'nestjs-resend';
import * as crypto from 'crypto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resend: ResendService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Creates a new workspace. Only callable by users with role = admin.
   *
   * @param userId - The ID of the calling user (must be admin)
   * @param dto    - Contains workspace name and optional settings
   * @returns      The newly created Workspace record
   * @throws       ForbiddenException if the calling user is not an admin
   */
  async createWorkspace(userId: string, dto: CreateWorkspaceDto) {
    // Resolve the caller first so we can enforce role-based permissions.
    const caller = await this.runPrisma(
      () =>
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true },
        }),
      'Failed to validate workspace creator',
    );

    // Only admins are allowed to create workspaces.
    if (!caller || caller.role !== 'admin') {
      throw new ForbiddenException('Only admins can create workspaces');
    }

    // Persist the new workspace and immediately attach the admin to it.
    const workspace = await this.runPrisma(
      () =>
        this.prisma.workspace.create({
          data: {
            name: dto.name,
            settings: dto.settings,
          },
        }),
      'Failed to create workspace',
    );

    // Keep tenancy consistent by moving the creating admin into the new workspace.
    await this.runPrisma(
      () =>
        this.prisma.user.update({
          where: { id: userId },
          data: { workspace_id: workspace.id },
        }),
      'Failed to assign workspace to admin user',
    );

    return workspace;
  }

  /**
   * Sends an invitation email to an address to join a workspace.
   *
   * @param adminUserId - The ID of the calling admin user
   * @param workspaceId - Workspace to invite the target email into
   * @param dto         - Contains the invitee email address
   * @returns           Success message payload with target email
   * @throws            ForbiddenException, NotFoundException, ConflictException
   */
  async inviteMember(
    adminUserId: string,
    workspaceId: string,
    dto: InviteMemberDto,
  ) {
    // Normalize email once to avoid duplicate invites caused by case variations.
    const normalizedEmail = dto.email.toLowerCase().trim();

    // Load inviter identity for authorization and email template personalization.
    const inviterUser = await this.runPrisma(
      () =>
        this.prisma.user.findUnique({
          where: { id: adminUserId },
          select: {
            id: true,
            role: true,
            workspace_id: true,
            full_name: true,
            email: true,
          },
        }),
      'Failed to validate inviter user',
    );

    // Only admins are allowed to invite members. Verify role and workspace match
    // before proceeding — do not leak workspace existence to non-admins.
    if (
      !inviterUser ||
      inviterUser.role !== 'admin' ||
      inviterUser.workspace_id !== workspaceId
    ) {
      throw new ForbiddenException(
        'Only admins can invite members to this workspace',
      );
    }

    // Confirm workspace exists so invitation email can reference a valid tenant.
    const workspace = await this.runPrisma(
      () =>
        this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { id: true, name: true },
        }),
      'Failed to fetch workspace for invitation',
    );

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    // Prevent duplicate membership assignment for users already in this workspace.
    const existingMember = await this.runPrisma(
      () =>
        this.prisma.user.findFirst({
          where: {
            email: normalizedEmail,
            workspace_id: workspaceId,
          },
          select: { id: true },
        }),
      'Failed to verify current workspace membership',
    );

    if (existingMember) {
      throw new ConflictException(
        'This user is already a member of this workspace',
      );
    }

    // Prevent sending duplicate pending invitations to the same email/workspace pair.
    const existingPendingInvitation = await this.runPrisma(
      () =>
        this.prisma.workspaceInvitation.findFirst({
          where: {
            email: normalizedEmail,
            workspace_id: workspaceId,
            status: 'pending',
          },
          select: { id: true },
        }),
      'Failed to check for existing pending invitation',
    );

    if (existingPendingInvitation) {
      throw new ConflictException(
        'An invitation has already been sent to this email',
      );
    }

    // Check whether the invitee already has an account to determine invite flow.
    const existingUser = await this.runPrisma(
      () =>
        this.prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: { id: true },
        }),
      'Failed to resolve invitee account status',
    );

    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL')
      ?.trim()
      .replace(/\/+$/, '');
    const fromEmail = this.getRequiredConfig('RESEND_FROM_EMAIL');

    // Generate a cryptographically secure invitation token for the magic link.
    // crypto.randomBytes(32) yields 32 bytes = 64 hex chars of high entropy.
    const generatedToken = crypto.randomBytes(32).toString('hex');

    // Save the invitation record before sending email so acceptance can be tracked.
    // If the provider rejects the email, the record is deleted below so retries are
    // not blocked by a pending invite that was never actually sent.
    const invitation = await this.runPrisma(
      () =>
        this.prisma.workspaceInvitation.create({
          data: {
            workspace_id: workspaceId,
            invited_by: adminUserId,
            email: normalizedEmail,
            token: generatedToken,
            status: 'pending',
          },
        }),
      'Failed to create workspace invitation',
    );

    // Determine the correct magic link based on whether the invitee already has
    // a CIOS account. New users are sent to /register to create an account first;
    // existing users are sent to /invitations/accept where they are added directly
    // after login verification.
    const magicLink = frontendUrl
      ? existingUser
        ? `${frontendUrl}/invitations/accept?token=${encodeURIComponent(invitation.token)}`
        : `${frontendUrl}/register?token=${encodeURIComponent(invitation.token)}`
      : null;
    const workspaceName = this.escapeHtml(workspace.name);
    const inviterName = this.escapeHtml(
      inviterUser.full_name ?? inviterUser.email,
    );
    const actionHtml = magicLink
      ? `
            <p>Click the button below to ${existingUser ? 'accept your invitation' : 'create your account and join'}:</p>
            <a href="${magicLink}" style="
              display: inline-block;
              background-color: #0ea5e9;
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              text-decoration: none;
              font-weight: bold;
              margin: 16px 0;
            ">
              ${existingUser ? 'Accept Invitation' : 'Create Account & Join'}
            </a>
        `
      : `
            <p>Use this invitation token to ${existingUser ? 'accept your invitation' : 'create your account and join'}:</p>
            <pre style="
              background-color: #f3f4f6;
              border-radius: 6px;
              color: #111827;
              font-size: 14px;
              overflow-wrap: anywhere;
              padding: 12px;
              white-space: pre-wrap;
            ">${invitation.token}</pre>
        `;

    try {
      // Send a transactional email with the role-aware call-to-action button.
      const sendResult = await this.resend.send({
        from: fromEmail,
        to: normalizedEmail,
        subject: `You've been invited to join ${workspace.name} on CIOS`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>You've been invited to join <strong>${workspaceName}</strong></h2>
            <p>You have been invited by <strong>${inviterName}</strong> to join their workspace on CIOS.</p>
            ${actionHtml}
            <p style="color: #6b7280; font-size: 14px;">
              If you did not expect this invitation, you can safely ignore this email.
            </p>
          </div>
        `,
      });

      if (sendResult.error || !sendResult.data?.id) {
        throw new Error(
          sendResult.error?.message ??
            'Email provider did not return a send id',
        );
      }
    } catch (error) {
      await this.prisma.workspaceInvitation
        .delete({ where: { id: invitation.id } })
        .catch(() => undefined);

      const providerMessage =
        error instanceof Error ? error.message : 'Unknown email provider error';
      this.logger.error(
        `Workspace invitation email failed for ${normalizedEmail}: ${providerMessage}`,
      );

      throw new BadGatewayException(
        `Email provider rejected invitation: ${providerMessage}`,
      );
    }

    return {
      message: 'Invitation sent successfully',
      email: normalizedEmail,
    };
  }

  /**
   * Accepts a pending invitation for an already-registered authenticated user.
   *
   * @param token  - Invitation token from the magic link
   * @param userId - Authenticated user ID attempting to accept invitation
   * @returns      Success payload including joined workspace ID
   * @throws       NotFoundException, ConflictException, ForbiddenException
   */
  async acceptInvitation(token: string, userId: string) {
    // Resolve invitation by token; unknown tokens are treated as not found.
    const invitation = await this.runPrisma(
      () =>
        this.prisma.workspaceInvitation.findUnique({
          where: { token },
        }),
      'Failed to validate invitation token',
    );

    if (!invitation) {
      throw new NotFoundException('Invalid invitation token');
    }

    // Block token replay by refusing invitations that were already accepted.
    if (invitation.status === 'accepted') {
      throw new ConflictException('This invitation has already been used');
    }

    // Verify the caller's identity matches the invited email to prevent takeover.
    const user = await this.runPrisma(
      () =>
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true },
        }),
      'Failed to validate invitation recipient',
    );

    // Invitation acceptance is strictly bound to the exact target email address.
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was not sent to your email address',
      );
    }

    // Apply workspace join and invitation status flip atomically for consistency.
    await this.runPrisma(
      () =>
        this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: user.id },
            data: {
              workspace_id: invitation.workspace_id,
              role: 'team_member',
            },
          }),
          this.prisma.workspaceInvitation.update({
            where: { id: invitation.id },
            data: { status: 'accepted' },
          }),
        ]),
      'Failed to accept workspace invitation',
    );

    return {
      message: 'Successfully joined workspace',
      workspace_id: invitation.workspace_id,
    };
  }

  /**
   * Accepts an invitation right after a brand-new account registration.
   *
   * @param token     - Invitation token passed during registration
   * @param newUserId - Newly created user ID
   * @returns         The updated user or null when token is absent/already used
   * @throws          InternalServerErrorException only for unexpected DB failures
   */
  async acceptInvitationOnRegister(token: string, newUserId: string) {
    // Lookup is intentionally tolerant; invalid tokens should not break signup.
    const invitation = await this.runPrisma(
      () =>
        this.prisma.workspaceInvitation.findUnique({
          where: { token },
        }),
      'Failed to process registration invitation token',
    );

    // If token is unknown, return silently because registration already succeeded.
    if (!invitation) {
      return null;
    }

    // If token was consumed previously, do not fail registration flow.
    if (invitation.status === 'accepted') {
      return null;
    }

    // Link user to workspace and mark invitation accepted in one transaction.
    const [updatedUser] = await this.runPrisma(
      () =>
        this.prisma.$transaction([
          this.prisma.user.update({
            where: { id: newUserId },
            data: {
              workspace_id: invitation.workspace_id,
              role: 'team_member',
            },
          }),
          this.prisma.workspaceInvitation.update({
            where: { id: invitation.id },
            data: { status: 'accepted' },
          }),
        ]),
      'Failed to attach registered user to invited workspace',
    );

    return updatedUser;
  }

  /**
   * Returns all members in a workspace for an authorized admin.
   *
   * @param adminUserId - Calling admin user ID
   * @param workspaceId - Workspace identifier from route
   * @returns           Array of workspace member records
   * @throws            ForbiddenException when access rules are not met
   */
  async getWorkspaceMembers(adminUserId: string, workspaceId: string) {
    // Enforce admin-only workspace scope checks before exposing membership data.
    await this.ensureWorkspaceAdmin(adminUserId, workspaceId);

    // Return a minimal member payload needed by admin management views.
    return this.runPrisma(
      () =>
        this.prisma.user.findMany({
          where: { workspace_id: workspaceId },
          select: {
            id: true,
            email: true,
            full_name: true,
            avatar_url: true,
            role: true,
            is_active: true,
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
        }),
      'Failed to fetch workspace members',
    );
  }

  /**
   * Returns all pending invitations for a workspace admin view.
   *
   * @param adminUserId - Calling admin user ID
   * @param workspaceId - Workspace identifier from route
   * @returns           Array of pending invitation records
   * @throws            ForbiddenException when access rules are not met
   */
  async getPendingInvitations(adminUserId: string, workspaceId: string) {
    // Enforce admin-only workspace scope checks before exposing invite metadata.
    await this.ensureWorkspaceAdmin(adminUserId, workspaceId);

    // Return pending invites in reverse chronological order for operational triage.
    return this.runPrisma(
      () =>
        this.prisma.workspaceInvitation.findMany({
          where: {
            workspace_id: workspaceId,
            status: 'pending',
          },
          orderBy: { created_at: 'desc' },
        }),
      'Failed to fetch pending workspace invitations',
    );
  }

  /**
   * Verifies that the caller is an admin in the target workspace.
   *
   * @param adminUserId - Calling user ID to validate
   * @param workspaceId - Workspace expected to match the caller tenancy
   * @returns           Promise that resolves when the caller is authorized
   * @throws            ForbiddenException if caller is not a workspace admin
   */
  private async ensureWorkspaceAdmin(
    adminUserId: string,
    workspaceId: string,
  ): Promise<void> {
    // Fetch caller role and workspace to enforce role + tenancy checks together.
    const adminUser = await this.runPrisma(
      () =>
        this.prisma.user.findUnique({
          where: { id: adminUserId },
          select: { role: true, workspace_id: true },
        }),
      'Failed to validate workspace admin access',
    );

    // Allow access only for admins that belong to the exact workspace context.
    if (
      !adminUser ||
      adminUser.role !== 'admin' ||
      adminUser.workspace_id !== workspaceId
    ) {
      throw new ForbiddenException(
        'Only admins can invite members to this workspace',
      );
    }
  }

  /**
   * Executes a Prisma operation and converts Prisma-specific failures to safe
   * internal server exceptions.
   *
   * @param operation   - Deferred Prisma call to execute
   * @param safeMessage - Client-safe error message for Prisma failures
   * @returns           The successful Prisma operation result
   * @throws            InternalServerErrorException for Prisma-origin errors
   */
  private async runPrisma<T>(
    operation: () => Promise<T>,
    safeMessage: string,
  ): Promise<T> {
    try {
      // Execute database operation in a centralized wrapper to keep service
      // methods focused on business rules while standardizing error hygiene.
      return await operation();
    } catch (error) {
      // Map only Prisma-originated errors to safe InternalServer responses;
      // pass through domain exceptions (Forbidden/Conflict/NotFound) unchanged.
      if (this.isPrismaError(error)) {
        throw new InternalServerErrorException(safeMessage);
      }

      throw error;
    }
  }

  /**
   * Determines whether an unknown error was thrown by Prisma Client.
   *
   * @param error - Unknown runtime error from a catch block
   * @returns     True when the error belongs to a Prisma error class
   */
  private isPrismaError(error: unknown): boolean {
    // Cover all primary Prisma error classes so DB internals are never leaked.
    return (
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError ||
      error instanceof Prisma.PrismaClientRustPanicError ||
      error instanceof Prisma.PrismaClientValidationError
    );
  }

  private getRequiredConfig(key: string): string {
    try {
      const value = this.configService.getOrThrow<string>(key).trim();
      if (!value) {
        throw new Error(`${key} is empty`);
      }

      return value;
    } catch {
      throw new InternalServerErrorException(`${key} is not configured`);
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
