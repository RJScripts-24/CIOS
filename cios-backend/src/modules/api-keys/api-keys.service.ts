import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { ApiKey, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { ApiKeyResponse } from './interfaces/api-key-response.interface';

type ApiKeyProvider = 'anthropic' | 'openai' | 'google';

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async createApiKey(
    dto: CreateApiKeyDto,
    user: JwtPayload,
  ): Promise<ApiKeyResponse & { message: string }> {
    const workspaceId = this.getWorkspaceId(user);
    const validated = await this.validateKeyWithProvider(dto.provider, dto.key);
    const encryptedKey = this.encrypt(dto.key);
    const validatedAt = new Date();

    const apiKey = await this.prisma.apiKey.upsert({
      where: {
        workspace_id_provider: {
          workspace_id: workspaceId,
          provider: dto.provider,
        },
      },
      create: {
        workspace_id: workspaceId,
        provider: dto.provider,
        encrypted_key: encryptedKey,
        key_status: validated ? 'connected' : 'invalid',
        added_by: user.sub,
        last_validated_at: validatedAt,
      },
      update: {
        encrypted_key: encryptedKey,
        key_status: validated ? 'connected' : 'invalid',
        added_by: user.sub,
        last_validated_at: validatedAt,
      },
    });

    await this.writeAuditLog(workspaceId, user.sub, 'api_key_added', {
      provider: dto.provider,
      key_status: validated ? 'connected' : 'invalid',
      validated_at: validatedAt.toISOString(),
    });

    return {
      ...this.stripEncryptedKey(apiKey),
      message: validated
        ? 'API key saved successfully'
        : 'API key validation failed against provider',
    };
  }

  async listApiKeys(user: JwtPayload): Promise<ApiKeyResponse[]> {
    const workspaceId = this.getWorkspaceId(user);
    const apiKeys = await this.prisma.apiKey.findMany({
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
    });

    return apiKeys.map((apiKey) => this.stripEncryptedKey(apiKey));
  }

  async updateApiKey(
    id: string,
    dto: UpdateApiKeyDto,
    user: JwtPayload,
  ): Promise<ApiKeyResponse & { message: string }> {
    const workspaceId = this.getWorkspaceId(user);
    const existingApiKey = await this.prisma.apiKey.findFirst({
      where: { id, workspace_id: workspaceId },
    });

    if (!existingApiKey) {
      throw new NotFoundException('API key not found in this workspace');
    }

    const validated = await this.validateKeyWithProvider(
      existingApiKey.provider as ApiKeyProvider,
      dto.key,
    );
    const encryptedKey = this.encrypt(dto.key);
    const validatedAt = new Date();

    const updatedApiKey = await this.prisma.apiKey.update({
      where: { id },
      data: {
        encrypted_key: encryptedKey,
        key_status: validated ? 'connected' : 'invalid',
        added_by: user.sub,
        last_validated_at: validatedAt,
      },
    });

    await this.writeAuditLog(workspaceId, user.sub, 'api_key_rotated', {
      api_key_id: id,
      provider: existingApiKey.provider,
      key_status: validated ? 'connected' : 'invalid',
      validated_at: validatedAt.toISOString(),
    });

    return {
      ...this.stripEncryptedKey(updatedApiKey),
      message: validated
        ? 'API key updated successfully'
        : 'API key validation failed against provider',
    };
  }

  async deleteApiKey(id: string, user: JwtPayload): Promise<{ message: string }> {
    const workspaceId = this.getWorkspaceId(user);
    const existingApiKey = await this.prisma.apiKey.findFirst({
      where: { id, workspace_id: workspaceId },
      select: { id: true },
    });

    if (!existingApiKey) {
      throw new NotFoundException('API key not found in this workspace');
    }

    await this.prisma.apiKey.delete({
      where: { id },
    });

    return { message: 'API key deleted successfully' };
  }

  async validateApiKey(
    id: string,
    user: JwtPayload,
  ): Promise<ApiKeyResponse> {
    const workspaceId = this.getWorkspaceId(user);
    const existingApiKey = await this.prisma.apiKey.findFirst({
      where: { id, workspace_id: workspaceId },
    });

    if (!existingApiKey) {
      throw new NotFoundException('API key not found in this workspace');
    }

    let rawKey = '';
    try {
      rawKey = this.decrypt(existingApiKey.encrypted_key);
    } catch {
      const failedValidation = await this.prisma.apiKey.update({
        where: { id },
        data: {
          key_status: 'invalid',
          last_validated_at: new Date(),
        },
      });

      await this.writeAuditLog(workspaceId, user.sub, 'api_key_validated', {
        api_key_id: id,
        provider: existingApiKey.provider,
        key_status: 'invalid',
      });

      return this.stripEncryptedKey(failedValidation);
    }

    const validated = await this.validateKeyWithProvider(
      existingApiKey.provider as ApiKeyProvider,
      rawKey,
    );
    const validatedAt = new Date();

    const updatedApiKey = await this.prisma.apiKey.update({
      where: { id },
      data: {
        key_status: validated ? 'connected' : 'invalid',
        last_validated_at: validatedAt,
      },
    });

    await this.writeAuditLog(workspaceId, user.sub, 'api_key_validated', {
      api_key_id: id,
      provider: existingApiKey.provider,
      key_status: validated ? 'connected' : 'invalid',
      validated_at: validatedAt.toISOString(),
    });

    return this.stripEncryptedKey(updatedApiKey);
  }

  private encrypt(plaintext: string): string {
    const key = Buffer.from(
      this.configService.getOrThrow('ENCRYPTION_KEY'),
      'hex',
    );
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return JSON.stringify({
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
    });
  }

  private decrypt(stored: string): string {
    const key = Buffer.from(
      this.configService.getOrThrow('ENCRYPTION_KEY'),
      'hex',
    );
    const { iv, authTag, ciphertext } = JSON.parse(stored) as {
      iv: string;
      authTag: string;
      ciphertext: string;
    };

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }

  private async validateKeyWithProvider(
    provider: ApiKeyProvider,
    rawKey: string,
  ): Promise<boolean> {
    try {
      let response: Response;

      if (provider === 'anthropic') {
        response = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': rawKey,
            'anthropic-version': '2023-06-01',
          },
        });
      } else if (provider === 'openai') {
        response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${rawKey}` },
        });
      } else {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${rawKey}`,
        );
      }

      return response.ok;
    } catch {
      return false;
    }
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
        event_detail: eventDetail,
      },
    });
  }

  private stripEncryptedKey(apiKey: ApiKey): ApiKeyResponse {
    const response = { ...apiKey } as ApiKey & { encrypted_key?: string };
    delete response.encrypted_key;

    return response as ApiKeyResponse;
  }

  private getWorkspaceId(user: JwtPayload): string {
    if (!user.workspace_id) {
      throw new ForbiddenException('Admin user must belong to a workspace');
    }

    return user.workspace_id;
  }
}