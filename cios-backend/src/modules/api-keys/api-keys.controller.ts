import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { ApiKeysService } from './api-keys.service';

@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  createApiKey(
    @Body() dto: CreateApiKeyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.apiKeysService.createApiKey(dto, user);
  }

  @Get()
  listApiKeys(@CurrentUser() user: JwtPayload) {
    return this.apiKeysService.listApiKeys(user);
  }

  @Patch(':id')
  updateApiKey(
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.apiKeysService.updateApiKey(id, dto, user);
  }

  @Delete(':id')
  deleteApiKey(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.apiKeysService.deleteApiKey(id, user);
  }

  @Post(':id/validate')
  validateApiKey(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.apiKeysService.validateApiKey(id, user);
  }
}