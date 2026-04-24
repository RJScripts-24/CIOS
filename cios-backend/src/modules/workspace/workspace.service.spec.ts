// ─────────────────────────────────────────────────────────────────────────────
// [TEST FILE] workspace.service.spec.ts
// Purpose: Unit tests for WorkspaceService — all dependencies fully mocked.
//          Covers all 7 service methods across 21 test cases.
//          Run: npx jest workspace.service.spec.ts --verbose
// ─────────────────────────────────────────────────────────────────────────────

import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ResendService } from 'nestjs-resend';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from './workspace.service';

// Mock admin user — role = admin, has workspace
const mockAdminUser = {
  id: 'admin-uuid-001',
  email: 'admin@cios.com',
  full_name: 'CIOS Admin',
  role: 'admin',
  workspace_id: 'workspace-uuid-001',
  is_active: true,
  password_hash: 'hashed',
  avatar_url: null,
  default_model: null,
  created_at: new Date(),
  updated_at: new Date(),
};

// Mock non-admin user — role = team_member
const mockTeamMember = {
  ...mockAdminUser,
  id: 'member-uuid-001',
  email: 'member@cios.com',
  role: 'team_member',
};

// Mock workspace
const mockWorkspace = {
  id: 'workspace-uuid-001',
  name: 'CIOS Internal',
  settings: null,
  created_at: new Date(),
  updated_at: new Date(),
};

// Mock invitation — pending state
const mockInvitation = {
  id: 'invite-uuid-001',
  workspace_id: 'workspace-uuid-001',
  invited_by: 'admin-uuid-001',
  email: 'rishabh.kr.jha@gmail.com',
  token: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  status: 'pending',
  created_at: new Date(),
  updated_at: new Date(),
};

// Mock PrismaService — includes all methods touched by WorkspaceService
const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  workspace: {
    create: jest.fn(),
    findUnique: jest.fn(),
  },
  workspaceInvitation: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

// Mock ResendService — mock the send() method
const mockResendService = {
  send: jest.fn().mockResolvedValue({
    data: { id: 'resend-email-id-001' },
    error: null,
    headers: null,
  }),
};

// Mock ConfigService — returns env vars needed by WorkspaceService
const mockConfigService = {
  get: jest.fn((key: string): string | undefined => {
    const config: Record<string, string> = {
      FRONTEND_URL: 'http://localhost:3000',
      RESEND_FROM_EMAIL: 'CIOS <noreply@cios.com>',
    };
    return config[key];
  }),
  getOrThrow: jest.fn((key: string): string => {
    const config: Record<string, string> = {
      FRONTEND_URL: 'http://localhost:3000',
      RESEND_FROM_EMAIL: 'CIOS <noreply@cios.com>',
    };
    if (!config[key]) throw new Error(`Config key ${key} not found`);
    return config[key];
  }),
};

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ResendService, useValue: mockResendService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
    jest.clearAllMocks();

    mockConfigService.get.mockImplementation(
      (key: string): string | undefined => {
        const config: Record<string, string> = {
          FRONTEND_URL: 'http://localhost:3000',
          RESEND_FROM_EMAIL: 'CIOS <noreply@cios.com>',
        };
        return config[key];
      },
    );
    mockConfigService.getOrThrow.mockImplementation((key: string): string => {
      const config: Record<string, string> = {
        FRONTEND_URL: 'http://localhost:3000',
        RESEND_FROM_EMAIL: 'CIOS <noreply@cios.com>',
      };
      if (!config[key]) throw new Error(`Config key ${key} not found`);
      return config[key];
    });
    mockResendService.send.mockResolvedValue({
      data: { id: 'resend-email-id-001' },
      error: null,
      headers: null,
    });

    mockPrismaService.$transaction.mockImplementation(async (ops: unknown[]) =>
      Promise.all(ops as Promise<unknown>[]),
    );
    mockPrismaService.workspaceInvitation.delete.mockResolvedValue(
      mockInvitation,
    );
  });

  describe('createWorkspace()', () => {
    // [TEST] Ensures RBAC blocks non-admin callers from creating tenant workspaces.
    it('should throw ForbiddenException when calling user is not admin', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockTeamMember,
      });

      await expect(
        service.createWorkspace('member-uuid-001', { name: 'Test WS' }),
      ).rejects.toThrow(ForbiddenException);
    });

    // [TEST] Confirms admin workspace creation persists workspace and links creator workspace_id.
    it('should create workspace and update creator workspace_id when called by admin', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockAdminUser,
        workspace_id: null,
      });
      mockPrismaService.workspace.create.mockResolvedValue(mockWorkspace);
      mockPrismaService.user.update.mockResolvedValue({
        ...mockAdminUser,
        workspace_id: 'workspace-uuid-001',
      });

      await expect(
        service.createWorkspace('admin-uuid-001', { name: 'CIOS Internal' }),
      ).resolves.toEqual(mockWorkspace);

      expect(mockPrismaService.workspace.create).toHaveBeenCalledWith({
        data: { name: 'CIOS Internal', settings: undefined },
      });
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'admin-uuid-001' },
        data: { workspace_id: 'workspace-uuid-001' },
      });
    });

    // [TEST] Verifies unknown users are denied so nonexistent principals cannot create workspaces.
    it('should throw ForbiddenException when calling user does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.createWorkspace('nonexistent-id', { name: 'Test WS' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('inviteMember()', () => {
    // [TEST] Ensures only admins can trigger workspace invitations.
    it('should throw ForbiddenException when calling user is not admin', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockTeamMember,
      });

      await expect(
        service.inviteMember('member-uuid-001', 'workspace-uuid-001', {
          email: 'rishabh.kr.jha@gmail.com',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    // [TEST] Ensures inviter must belong to the same workspace to avoid cross-tenant invites.
    it('should throw ForbiddenException when admin workspace_id does not match workspaceId param', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockAdminUser,
        workspace_id: 'different-workspace-id',
      });

      await expect(
        service.inviteMember('admin-uuid-001', 'workspace-uuid-001', {
          email: 'rishabh.kr.jha@gmail.com',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    // [TEST] Ensures invite flow returns NotFound for invalid workspace targets.
    it('should throw NotFoundException when workspace does not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockAdminUser);
      mockPrismaService.workspace.findUnique.mockResolvedValue(null);

      await expect(
        service.inviteMember('admin-uuid-001', 'workspace-uuid-001', {
          email: 'rishabh.kr.jha@gmail.com',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    // [TEST] Ensures existing members are not re-invited, preventing duplicate membership flows.
    it('should throw ConflictException when email is already a workspace member', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockAdminUser);
      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'member-uuid-001',
      });

      await expect(
        service.inviteMember('admin-uuid-001', 'workspace-uuid-001', {
          email: 'member@cios.com',
        }),
      ).rejects.toThrow(ConflictException);
    });

    // [TEST] Ensures only one pending invite exists per email/workspace pair.
    it('should throw ConflictException when pending invitation already exists for this email', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockAdminUser);
      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.workspaceInvitation.findFirst.mockResolvedValue(
        mockInvitation,
      );

      await expect(
        service.inviteMember('admin-uuid-001', 'workspace-uuid-001', {
          email: 'rishabh.kr.jha@gmail.com',
        }),
      ).rejects.toThrow(ConflictException);
    });

    // [TEST] Confirms unregistered invitees get the register-link email path.
    it('should create invitation and send email with /register link for new (unregistered) user', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(mockAdminUser)
        .mockResolvedValueOnce(null);
      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.workspaceInvitation.findFirst.mockResolvedValue(null);
      mockPrismaService.workspaceInvitation.create.mockResolvedValue(
        mockInvitation,
      );
      mockResendService.send.mockResolvedValue({
        data: { id: 'email-id' },
        error: null,
        headers: null,
      });

      await expect(
        service.inviteMember('admin-uuid-001', 'workspace-uuid-001', {
          email: 'rishabh.kr.jha@gmail.com',
        }),
      ).resolves.toEqual({
        message: 'Invitation sent successfully',
        email: 'rishabh.kr.jha@gmail.com',
      });

      expect(mockResendService.send).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.workspaceInvitation.create).toHaveBeenCalled();

      const sendArgs = mockResendService.send.mock.calls[0][0] as {
        html: string;
      };
      expect(sendArgs.html).toContain('/register?token=');
    });

    // [TEST] Confirms existing registered users get accept-link email path.
    it('should send email with /invitations/accept link for already-registered user', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(mockAdminUser)
        .mockResolvedValueOnce({ ...mockTeamMember, workspace_id: null });
      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.workspaceInvitation.findFirst.mockResolvedValue(null);
      mockPrismaService.workspaceInvitation.create.mockResolvedValue(
        mockInvitation,
      );

      await service.inviteMember('admin-uuid-001', 'workspace-uuid-001', {
        email: 'member@cios.com',
      });

      const sendArgs = mockResendService.send.mock.calls[0][0] as {
        html: string;
      };
      expect(sendArgs.html).toContain('/invitations/accept?token=');
    });

    // [TEST] Confirms backend email sending still works without a frontend URL.
    it('should send a token-only email when FRONTEND_URL is not configured', async () => {
      mockConfigService.get.mockImplementation(
        (key: string): string | undefined => {
          if (key === 'FRONTEND_URL') return undefined;
          return undefined;
        },
      );
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(mockAdminUser)
        .mockResolvedValueOnce(null);
      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.workspaceInvitation.findFirst.mockResolvedValue(null);
      mockPrismaService.workspaceInvitation.create.mockResolvedValue(
        mockInvitation,
      );

      await service.inviteMember('admin-uuid-001', 'workspace-uuid-001', {
        email: 'rishabh.kr.jha@gmail.com',
      });

      const sendArgs = mockResendService.send.mock.calls[0][0] as {
        html: string;
      };
      expect(sendArgs.html).toContain(mockInvitation.token);
      expect(sendArgs.html).not.toContain('undefined/register');
    });

    // [TEST] Ensures failed provider sends do not leave stale pending invites.
    it('should delete the pending invitation and throw when email provider rejects the send', async () => {
      mockPrismaService.user.findUnique
        .mockResolvedValueOnce(mockAdminUser)
        .mockResolvedValueOnce(null);
      mockPrismaService.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.workspaceInvitation.findFirst.mockResolvedValue(null);
      mockPrismaService.workspaceInvitation.create.mockResolvedValue(
        mockInvitation,
      );
      mockResendService.send.mockResolvedValue({
        data: null,
        error: {
          message: 'Invalid from address',
          name: 'invalid_from_address',
          statusCode: 422,
        },
        headers: null,
      });

      await expect(
        service.inviteMember('admin-uuid-001', 'workspace-uuid-001', {
          email: 'rishabh.kr.jha@gmail.com',
        }),
      ).rejects.toThrow(BadGatewayException);

      expect(mockPrismaService.workspaceInvitation.delete).toHaveBeenCalledWith(
        {
          where: { id: mockInvitation.id },
        },
      );
    });
  });

  describe('acceptInvitation()', () => {
    // [TEST] Ensures unknown invitation tokens are rejected.
    it('should throw NotFoundException when token is invalid', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptInvitation('invalid-token', 'member-uuid-001'),
      ).rejects.toThrow(NotFoundException);
    });

    // [TEST] Ensures accepted tokens cannot be replayed for another join action.
    it('should throw ConflictException when invitation is already accepted', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: 'accepted',
      });

      await expect(
        service.acceptInvitation('abc123...', 'member-uuid-001'),
      ).rejects.toThrow(ConflictException);
    });

    // [TEST] Ensures invitation token cannot be used by an account with different email.
    it('should throw ForbiddenException when token email does not match user email', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        email: 'other@example.com',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockTeamMember,
        email: 'member@cios.com',
      });

      await expect(
        service.acceptInvitation('abc123...', 'member-uuid-001'),
      ).rejects.toThrow(ForbiddenException);
    });

    // [TEST] Confirms valid acceptance updates user workspace and invitation status atomically.
    it('should update user workspace_id and mark invitation accepted on valid token', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        email: 'member@cios.com',
        status: 'pending',
      });
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockTeamMember,
        email: 'member@cios.com',
      });
      mockPrismaService.user.update.mockResolvedValue({
        ...mockTeamMember,
        workspace_id: 'workspace-uuid-001',
      });
      mockPrismaService.workspaceInvitation.update.mockResolvedValue({
        ...mockInvitation,
        status: 'accepted',
      });

      await expect(
        service.acceptInvitation(mockInvitation.token, 'member-uuid-001'),
      ).resolves.toEqual({
        message: 'Successfully joined workspace',
        workspace_id: 'workspace-uuid-001',
      });

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'member-uuid-001' },
        data: {
          workspace_id: 'workspace-uuid-001',
          role: 'team_member',
        },
      });
      expect(mockPrismaService.workspaceInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'accepted' },
        }),
      );
    });
  });

  describe('acceptInvitationOnRegister()', () => {
    // [TEST] Ensures signup stays non-blocking when token is invalid.
    it('should silently return without throwing when token is not found', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptInvitationOnRegister('invalid-token', 'new-user-id'),
      ).resolves.toBeNull();
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    // [TEST] Ensures already-consumed invite tokens are ignored during registration.
    it('should silently return without throwing when invitation is already accepted', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: 'accepted',
      });

      await expect(
        service.acceptInvitationOnRegister(mockInvitation.token, 'new-user-id'),
      ).resolves.toBeNull();
      expect(mockPrismaService.user.update).not.toHaveBeenCalled();
    });

    // [TEST] Confirms valid registration token links user and marks invite accepted.
    it('should link new user to workspace and mark invitation accepted on valid token', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: 'pending',
      });
      mockPrismaService.user.update.mockResolvedValue({
        ...mockTeamMember,
        id: 'new-user-id',
        workspace_id: 'workspace-uuid-001',
      });
      mockPrismaService.workspaceInvitation.update.mockResolvedValue({
        ...mockInvitation,
        status: 'accepted',
      });

      await service.acceptInvitationOnRegister(
        mockInvitation.token,
        'new-user-id',
      );

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'new-user-id' },
        data: {
          workspace_id: 'workspace-uuid-001',
          role: 'team_member',
        },
      });
      expect(mockPrismaService.workspaceInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'accepted' },
        }),
      );
    });
  });

  describe('getWorkspaceMembers()', () => {
    // [TEST] Ensures non-admin users cannot list workspace members.
    it('should throw ForbiddenException when calling user is not admin', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockTeamMember);

      await expect(
        service.getWorkspaceMembers('member-uuid-001', 'workspace-uuid-001'),
      ).rejects.toThrow(ForbiddenException);
    });

    // [TEST] Confirms admins can list all users in their workspace.
    it('should return all users belonging to the workspace', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockAdminUser);
      mockPrismaService.user.findMany.mockResolvedValue([
        mockAdminUser,
        mockTeamMember,
      ]);

      const result = await service.getWorkspaceMembers(
        'admin-uuid-001',
        'workspace-uuid-001',
      );

      expect(result).toHaveLength(2);
      expect(mockPrismaService.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspace_id: 'workspace-uuid-001' },
        }),
      );
    });
  });

  describe('getPendingInvitations()', () => {
    // [TEST] Ensures pending invitation list is restricted to admins.
    it('should throw ForbiddenException when calling user is not admin', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockTeamMember);

      await expect(
        service.getPendingInvitations('member-uuid-001', 'workspace-uuid-001'),
      ).rejects.toThrow(ForbiddenException);
    });

    // [TEST] Confirms admin pending-invite view is filtered by pending status and newest-first order.
    it('should return only pending invitations ordered by created_at DESC', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockAdminUser);
      mockPrismaService.workspaceInvitation.findMany.mockResolvedValue([
        mockInvitation,
      ]);

      await expect(
        service.getPendingInvitations('admin-uuid-001', 'workspace-uuid-001'),
      ).resolves.toEqual([mockInvitation]);

      expect(
        mockPrismaService.workspaceInvitation.findMany,
      ).toHaveBeenCalledWith({
        where: {
          workspace_id: 'workspace-uuid-001',
          status: 'pending',
        },
        orderBy: { created_at: 'desc' },
      });
    });
  });
});
