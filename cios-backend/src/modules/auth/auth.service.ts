import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  // [WORKSPACE INVITE] Used when registration attempts to use a token that
  // does not belong to the registering email or when token is missing.
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { StringValue } from 'ms';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AuthResponse } from './interfaces/auth-response.interface';
// [WORKSPACE INVITE] Import WorkspaceService so registration can attach a new
// user to an invited workspace when an invite token is provided.
import { WorkspaceService } from '../workspace/workspace.service';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    // [WORKSPACE INVITE] Injected to handle post-registration workspace linking
    // when a user registers via an invitation magic link token.
    private readonly workspaceService: WorkspaceService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = dto.email.toLowerCase().trim();
    // [WORKSPACE INVITE] Normalize optional invitation token so query/body
    // variants with accidental whitespace do not break invite acceptance.
    const invitationToken = dto.token?.trim();

    // ── [WORKSPACE INVITE] BEGIN ─────────────────────────────────────────────────
    // [WORKSPACE INVITE] users.workspace_id is required in the current schema,
    // so registration must resolve a workspace from an invitation token first.
    if (!invitationToken) {
      throw new ForbiddenException('Registration requires a valid invitation token');
    }

    // [WORKSPACE INVITE] Resolve invitation details up-front so we can set the
    // new user workspace_id at creation time and validate email ownership.
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { token: invitationToken },
      select: {
        id: true,
        email: true,
        status: true,
        workspace_id: true,
      },
    });

    // [WORKSPACE INVITE] Reject unknown invite tokens during signup.
    if (!invitation) {
      throw new NotFoundException('Invalid invitation token');
    }

    // [WORKSPACE INVITE] Prevent replay of invitation links that were already used.
    if (invitation.status === 'accepted') {
      throw new ConflictException('This invitation has already been used');
    }

    // [WORKSPACE INVITE] Bind registration strictly to the invited email address.
    if (invitation.email.toLowerCase() !== email) {
      throw new ForbiddenException(
        'This invitation was not sent to your email address',
      );
    }
    // ── [WORKSPACE INVITE] END ───────────────────────────────────────────────────

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const password_hash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email,
        password_hash,
        full_name: dto.full_name ?? null,
        // [WORKSPACE INVITE] Assign the user to the invited workspace at
        // creation time so required workspace_id constraints are satisfied.
        workspace_id: invitation.workspace_id,
        role: 'team_member',
      },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        avatar_url: true,
        default_model: true,
        workspace_id: true,
      },
    });

    // ── [WORKSPACE INVITE] BEGIN ─────────────────────────────────────────────────
    // [WORKSPACE INVITE] Track workspace assignment for JWT payload generation.
    // If invite linking succeeds, the access token should immediately include
    // the invited workspace_id so the user lands in the correct tenant context.
    let resolvedWorkspaceId = user.workspace_id;

    // [WORKSPACE INVITE] If a valid invitation token was passed during
    // registration, link this new user to the invited workspace immediately.
    if (invitationToken) {
      try {
        // [WORKSPACE INVITE] Attempt invite acceptance in non-blocking mode;
        // registration remains successful even if token handling fails.
        const invitedUser = await this.workspaceService.acceptInvitationOnRegister(
          invitationToken,
          user.id,
        );

        // [WORKSPACE INVITE] When the token is valid and pending, keep the
        // updated workspace_id for downstream JWT token issuance.
        if (invitedUser?.workspace_id) {
          resolvedWorkspaceId = invitedUser.workspace_id;
        }
      } catch (e) {
        // [WORKSPACE INVITE] Non-blocking: log but do not surface to caller.
        // Registration is primary; workspace linking is secondary.
        console.error(
          '[WorkspaceInvite] acceptInvitationOnRegister failed silently:',
          e,
        );
      }
    }
    // ── [WORKSPACE INVITE] END ───────────────────────────────────────────────────

    // [WORKSPACE INVITE] Issue JWTs with effective workspace context so invited
    // users receive correct tenant claims immediately after registration.
    const tokens = await this.issueTokens({
      ...user,
      workspace_id: resolvedWorkspaceId,
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
        default_model: user.default_model,
      },
    };
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password_hash) {
      await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.is_active) {
      throw new UnauthorizedException(
        'Your account has been deactivated. Contact your admin.',
      );
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
        default_model: user.default_model,
      },
    };
  }

  async googleLogin(code: string): Promise<AuthResponse> {
    // Exchange the authorization code for tokens using Google's OAuth2 endpoint.
    // This uses the google-auth-library approach via fetch - no extra passport call needed here.
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
        client_secret:
          this.configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
        redirect_uri: this.configService.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      throw new UnauthorizedException(
        'Failed to exchange Google authorization code',
      );
    }

    const tokenData = (await tokenRes.json()) as {
      id_token?: string;
      error?: string;
    };

    if (!tokenData.id_token) {
      throw new UnauthorizedException('Google did not return an ID token');
    }

    // Decode the ID token payload (we verify by checking it came from Google's endpoint above)
    const [, payloadBase64] = tokenData.id_token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadBase64, 'base64url').toString('utf8'),
    ) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
      email_verified?: boolean;
    };

    if (!payload.email) {
      throw new UnauthorizedException('Google account has no email address');
    }

    const email = payload.email.toLowerCase().trim();

    // Upsert user: if exists update google_id, if not create with no password_hash
    let user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        avatar_url: true,
        default_model: true,
        workspace_id: true,
        is_active: true,
      },
    });

    if (user) {
      // Update google_id on existing user
      await this.prisma.user.update({
        where: { email },
        data: { google_id: payload.sub },
      });

      if (!user.is_active) {
        throw new UnauthorizedException(
          'Your account has been deactivated. Contact your admin.',
        );
      }
    } else {
      // Create new user - no password_hash for SSO users
      user = await this.prisma.user.create({
        data: {
          email,
          google_id: payload.sub,
          full_name: payload.name ?? null,
          avatar_url: payload.picture ?? null,
          role: 'team_member',
          // workspace_id is null until the user joins a workspace
        },
        select: {
          id: true,
          email: true,
          full_name: true,
          role: true,
          avatar_url: true,
          default_model: true,
          workspace_id: true,
          is_active: true,
        },
      });
    }

    const tokens = await this.issueTokens(user);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        avatar_url: user.avatar_url,
        default_model: user.default_model,
      },
    };
  }

  async refreshTokens(
    userId: string,
    rawRefreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const storedTokens = await this.prisma.refreshToken.findMany({
      where: {
        user_id: userId,
        is_revoked: false,
        expires_at: { gt: new Date() },
      },
    });

    let matchedToken: (typeof storedTokens)[number] | null = null;

    for (const token of storedTokens) {
      const match = await bcrypt.compare(rawRefreshToken, token.token_hash);
      if (match) {
        matchedToken = token;
        break;
      }
    }

    if (!matchedToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: matchedToken.id },
      data: { is_revoked: true },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        workspace_id: true,
        is_active: true,
      },
    });

    if (!user.is_active) {
      throw new UnauthorizedException('Account deactivated');
    }

    return this.issueTokens(user);
  }

  async logout(userId: string, rawRefreshToken: string): Promise<void> {
    const storedTokens = await this.prisma.refreshToken.findMany({
      where: { user_id: userId, is_revoked: false },
    });

    for (const token of storedTokens) {
      const match = await bcrypt.compare(rawRefreshToken, token.token_hash);
      if (match) {
        await this.prisma.refreshToken.update({
          where: { id: token.id },
          data: { is_revoked: true },
        });
        break;
      }
    }
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        full_name: true,
        role: true,
        avatar_url: true,
        default_model: true,
        view_preferences: true,
        workspace_id: true,
        is_active: true,
        created_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Fetch all project memberships for this user with project summary
    const memberships = await this.prisma.projectMember.findMany({
      where: { user_id: userId },
      select: {
        access_level: true,
        project: {
          select: {
            id: true,
            name: true,
            type: true,
            status: true,
          },
        },
      },
    });

    const assigned_projects = memberships.map((m) => ({
      id: m.project.id,
      name: m.project.name,
      type: m.project.type,
      status: m.project.status,
      access_level: m.access_level,
    }));

    return {
      ...user,
      assigned_projects,
    };
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    role: string;
    workspace_id: string | null;
  }): Promise<{ access_token: string; refresh_token: string }> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      workspace_id: user.workspace_id,
    };

    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
          '15m') as StringValue,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ??
          '7d') as StringValue,
      }),
    ]);

    const token_hash = await bcrypt.hash(refresh_token, BCRYPT_ROUNDS);
    const expiresInStr =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const daysMatch = expiresInStr.match(/^(\d+)d$/);
    const hoursMatch = expiresInStr.match(/^(\d+)h$/);
    const expiryMs = daysMatch
      ? parseInt(daysMatch[1], 10) * 24 * 60 * 60 * 1000
      : hoursMatch
        ? parseInt(hoursMatch[1], 10) * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;

    const expires_at = new Date(Date.now() + expiryMs);

    await this.prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token_hash,
        expires_at,
      },
    });

    return { access_token, refresh_token };
  }
}
