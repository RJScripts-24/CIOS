import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
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

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = dto.email.toLowerCase().trim();

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

    return user;
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
