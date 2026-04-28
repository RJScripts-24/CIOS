import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { AuthService } from './auth.service';

const mockFetch = jest.fn();
global.fetch = mockFetch;

function buildFakeIdToken(claims: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString(
    'base64url',
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.fakesig`;
}

const mockUser = {
  id: 'uuid-google-1',
  email: 'googleuser@example.com',
  full_name: 'Google User',
  role: 'team_member',
  avatar_url: 'https://example.com/photo.jpg',
  default_model: null,
  workspace_id: null,
  is_active: true,
};

const mockPrismaService = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  projectMember: {
    findMany: jest.fn().mockResolvedValue([]),
  },
};

const mockJwtService = {
  signAsync: jest.fn().mockResolvedValue('mock_access_token'),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const cfg: Record<string, string> = {
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
    };
    return cfg[key] ?? null;
  }),
  getOrThrow: jest.fn((key: string) => {
    const cfg: Record<string, string> = {
      JWT_ACCESS_SECRET: 'access_secret',
      JWT_REFRESH_SECRET: 'refresh_secret',
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/google/callback',
    };
    if (!cfg[key]) throw new Error(`Missing config: ${key}`);
    return cfg[key];
  }),
};

const mockWorkspaceService = {
  acceptInvitationOnRegister: jest.fn(),
};

describe('AuthService - googleLogin()', () => {
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

  it('should throw UnauthorizedException when Google token exchange fails (non-ok response)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    });

    await expect(service.googleLogin('bad-code')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.googleLogin('bad-code')).rejects.toThrow(
      'Failed to exchange Google authorization code',
    );
  });

  it('should throw UnauthorizedException when Google response has no id_token', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok', token_type: 'Bearer' }),
    });

    await expect(service.googleLogin('code-no-id-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should create a new user when no account exists for the Google email', async () => {
    const idToken = buildFakeIdToken({
      sub: 'google-sub-123',
      email: 'newgoogle@example.com',
      name: 'New Google User',
      picture: 'https://example.com/pic.jpg',
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: idToken }),
    });

    mockPrismaService.user.findUnique.mockResolvedValue(null);
    mockPrismaService.user.create.mockResolvedValue({
      ...mockUser,
      email: 'newgoogle@example.com',
    });
    mockPrismaService.refreshToken.create.mockResolvedValue({});
    mockPrismaService.projectMember.findMany.mockResolvedValue([]);

    const result = await service.googleLogin('valid-new-user-code');

    expect(mockPrismaService.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'newgoogle@example.com',
          google_id: 'google-sub-123',
        }),
      }),
    );
    expect(result).toHaveProperty('access_token');
    expect(result).toHaveProperty('refresh_token');
    expect(result.user.email).toBe('newgoogle@example.com');
  });

  it('should update google_id and return tokens when user already exists', async () => {
    const idToken = buildFakeIdToken({
      sub: 'google-sub-456',
      email: 'existing@example.com',
      name: 'Existing User',
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: idToken }),
    });

    mockPrismaService.user.findUnique.mockResolvedValue({
      ...mockUser,
      email: 'existing@example.com',
    });
    mockPrismaService.user.update.mockResolvedValue({});
    mockPrismaService.refreshToken.create.mockResolvedValue({});
    mockPrismaService.projectMember.findMany.mockResolvedValue([]);

    const result = await service.googleLogin('valid-existing-user-code');

    expect(mockPrismaService.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'existing@example.com' },
        data: { google_id: 'google-sub-456' },
      }),
    );
    expect(result).toHaveProperty('access_token');
  });

  it('should throw UnauthorizedException when existing user account is inactive', async () => {
    const idToken = buildFakeIdToken({
      sub: 'google-sub-789',
      email: 'inactive@example.com',
      name: 'Inactive User',
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: idToken }),
    });

    mockPrismaService.user.findUnique.mockResolvedValue({
      ...mockUser,
      email: 'inactive@example.com',
      is_active: false,
    });

    await expect(service.googleLogin('code-inactive')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.googleLogin('code-inactive')).rejects.toThrow(
      'deactivated',
    );
  });

  it('should normalise email to lowercase from Google payload', async () => {
    const idToken = buildFakeIdToken({
      sub: 'google-sub-101',
      email: 'UPPER@EXAMPLE.COM',
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id_token: idToken }),
    });

    mockPrismaService.user.findUnique.mockResolvedValue(null);
    mockPrismaService.user.create.mockResolvedValue({
      ...mockUser,
      email: 'upper@example.com',
    });
    mockPrismaService.refreshToken.create.mockResolvedValue({});
    mockPrismaService.projectMember.findMany.mockResolvedValue([]);

    await service.googleLogin('uppercase-email-code');

    expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'upper@example.com' },
      }),
    );
  });
});
