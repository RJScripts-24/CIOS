import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  // [WORKSPACE INVITE] Accept invite token via /auth/register?token=...
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  // [WORKSPACE INVITE] Register supports optional token query parameter for
  // invite-email flows that land users directly on /register?token=...
  async register(@Body() dto: RegisterDto, @Query('token') token?: string) {
    // ── [WORKSPACE INVITE] BEGIN ─────────────────────────────────────────────
    // [WORKSPACE INVITE] Support invite token from query string so users who
    // arrive via /register?token=... are linked to the invited workspace.
    const registerDto = token ? { ...dto, token } : dto;
    // [WORKSPACE INVITE] Pass merged DTO so body token and query token are both
    // accepted without breaking existing registration clients.
    // ── [WORKSPACE INVITE] END ───────────────────────────────────────────────
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async googleLogin(@Body() dto: GoogleAuthDto) {
    return this.authService.googleLogin(dto.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    const payload = await this.decodeRefreshToken(dto.refresh_token);
    return this.authService.refreshTokens(payload.sub, dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: { id: string },
    @Body() dto: RefreshTokenDto,
  ) {
    await this.authService.logout(user.id, dto.refresh_token);
  }

  @Get('me')
  async me(@CurrentUser() user: { id: string }) {
    return this.authService.getMe(user.id);
  }

  private async decodeRefreshToken(token: string): Promise<{ sub: string }> {
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });

      if (!payload?.sub) {
        throw new UnauthorizedException('Invalid refresh token payload');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Malformed or invalid refresh token');
    }
  }
}
