import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { AuthService } from './auth.service';

const mockUser = {
  id: 'uuid-1234',
  email: 'user@example.com',
  full_name: 'Test User',
  role: 'team_member',
  avatar_url: null,
  default_model: null,
  workspace_id: 'ws-uuid',
  is_active: true,
  view_preferences: {},
  created_at: new Date('2024-01-01'),
};

const mockMemberships = [
  {
    access_level: 'edit',
    project: { id: 'proj-1', name: 'Alpha', type: 'client', status: 'active' },
  },
  {
    access_level: 'read_only',
    project: {
      id: 'proj-2',
      name: 'Beta',
      type: 'internal_bd',
      status: 'paused',
    },
  },
];

const mockPrismaService = {
  user: { findUnique: jest.fn() },
  refreshToken: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  projectMember: { findMany: jest.fn() },
};

const mockJwtService = { signAsync: jest.fn() };
const mockConfigService = {
  get: jest.fn(),
  getOrThrow: jest.fn((key: string) => {
    const cfg: Record<string, string> = {
      JWT_ACCESS_SECRET: 'secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
    };
    if (!cfg[key]) throw new Error(`Missing: ${key}`);
    return cfg[key];
  }),
};

const mockWorkspaceService = {
  acceptInvitationOnRegister: jest.fn(),
};

describe('AuthService - getMe()', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should throw NotFoundException when user does not exist', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(null);

    await expect(service.getMe('nonexistent-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should return user with empty assigned_projects array when user has no memberships', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
    mockPrismaService.projectMember.findMany.mockResolvedValue([]);

    const result = await service.getMe('uuid-1234');

    expect(result.assigned_projects).toEqual([]);
    expect(result.email).toBe('user@example.com');
  });

  it('should return user with populated assigned_projects when memberships exist', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
    mockPrismaService.projectMember.findMany.mockResolvedValue(mockMemberships);

    const result = await service.getMe('uuid-1234');

    expect(result.assigned_projects).toHaveLength(2);
    expect(result.assigned_projects[0]).toEqual({
      id: 'proj-1',
      name: 'Alpha',
      type: 'client',
      status: 'active',
      access_level: 'edit',
    });
    expect(result.assigned_projects[1]).toEqual({
      id: 'proj-2',
      name: 'Beta',
      type: 'internal_bd',
      status: 'paused',
      access_level: 'read_only',
    });
  });

  it('should include core user fields in response', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
    mockPrismaService.projectMember.findMany.mockResolvedValue([]);

    const result = await service.getMe('uuid-1234');

    expect(result).toMatchObject({
      id: 'uuid-1234',
      email: 'user@example.com',
      role: 'team_member',
      workspace_id: 'ws-uuid',
      is_active: true,
    });
  });

  it('should query projectMember using the correct user_id', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
    mockPrismaService.projectMember.findMany.mockResolvedValue([]);

    await service.getMe('uuid-1234');

    expect(mockPrismaService.projectMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'uuid-1234' },
      }),
    );
  });
});
