import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed_value'),
  compare: jest.fn(),
}));

const mockUser = {
  id: 'uuid-1234',
  email: 'test@example.com',
  password_hash: 'hashed_value',
  full_name: 'Test User',
  role: 'team_member',
  avatar_url: null,
  default_model: null,
  workspace_id: null,
  is_active: true,
  created_at: new Date(),
};

const mockInvitation = {
  id: 'invite-uuid-001',
  email: 'new@example.com',
  status: 'pending',
  workspace_id: 'workspace-uuid-001',
};

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
  },
  workspaceInvitation: {
    findUnique: jest.fn(),
  },
  refreshToken: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockWorkspaceService = {
  acceptInvitationOnRegister: jest.fn(),
};

const mockJwtService = {
  signAsync: jest.fn().mockResolvedValue('mock_token'),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, string> = {
      JWT_ACCESS_SECRET: 'access_secret',
      JWT_REFRESH_SECRET: 'refresh_secret',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    };
    return config[key];
  }),
  getOrThrow: jest.fn((key: string) => {
    const config: Record<string, string> = {
      JWT_ACCESS_SECRET: 'access_secret',
      JWT_REFRESH_SECRET: 'refresh_secret',
    };

    if (!config[key]) {
      throw new Error(`Config key ${key} not found`);
    }

    return config[key];
  }),
};

describe('AuthService', () => {
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

  describe('register()', () => {
    it('should throw ForbiddenException if invitation token is missing', async () => {
      await expect(
        service.register({ email: 'test@example.com', password: 'Password1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        email: 'test@example.com',
      });
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'Password1',
          token: 'invite-token',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should create a new user and return tokens + user', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue(
        mockInvitation,
      );
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        ...mockUser,
        email: 'new@example.com',
        workspace_id: 'workspace-uuid-001',
      });
      mockPrismaService.refreshToken.create.mockResolvedValue({});
      mockJwtService.signAsync.mockResolvedValue('mock_token');
      mockWorkspaceService.acceptInvitationOnRegister.mockResolvedValue({
        ...mockUser,
        email: 'new@example.com',
        workspace_id: 'workspace-uuid-001',
      });

      const result = await service.register({
        email: 'new@example.com',
        password: 'Password1',
        full_name: 'New User',
        token: 'invite-token',
      });

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result.user.email).toBe('new@example.com');
    });

    it('should normalise email to lowercase', async () => {
      mockPrismaService.workspaceInvitation.findUnique.mockResolvedValue(
        mockInvitation,
      );
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue({
        ...mockUser,
        email: 'new@example.com',
        workspace_id: 'workspace-uuid-001',
      });
      mockPrismaService.refreshToken.create.mockResolvedValue({});
      mockWorkspaceService.acceptInvitationOnRegister.mockResolvedValue({
        ...mockUser,
        email: 'new@example.com',
        workspace_id: 'workspace-uuid-001',
      });

      await service.register({
        email: 'NEW@EXAMPLE.COM',
        password: 'Password1',
        token: 'invite-token',
      });

      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'new@example.com' },
      });
    });
  });

  describe('login()', () => {
    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'notfound@example.com', password: 'Password1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password is wrong', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'WrongPass1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        is_active: false,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login({ email: 'test@example.com', password: 'Password1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should return tokens and user on valid credentials', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockPrismaService.refreshToken.create.mockResolvedValue({});
      mockJwtService.signAsync.mockResolvedValue('mock_token');

      const result = await service.login({
        email: 'test@example.com',
        password: 'Password1',
      });

      expect(result).toHaveProperty('access_token', 'mock_token');
      expect(result.user.email).toBe('test@example.com');
    });
  });

  describe('logout()', () => {
    it('should silently succeed even if token not found', async () => {
      mockPrismaService.refreshToken.findMany.mockResolvedValue([]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.logout('uuid-1234', 'some_token'),
      ).resolves.toBeUndefined();
    });
  });

  describe('getMe()', () => {
    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return user data if found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.getMe('uuid-1234');
      expect(result.email).toBe('test@example.com');
    });
  });
});
