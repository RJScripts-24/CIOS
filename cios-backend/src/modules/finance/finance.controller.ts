// [NEW FILE]
import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProjectOwnerOrAdminGuard } from '../../common/guards/project-owner-or-admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { FinanceQueryDto } from './dto/finance-query.dto';
import { FinanceService } from './finance.service';

@ApiBearerAuth()
@ApiTags('finance')
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Workspace finance summary (admin)' })
  @UseGuards(RolesGuard)
  @Roles('admin')
  summary(@Query() dto: FinanceQueryDto, @CurrentUser() user: JwtPayload) {
    return this.finance.summary(user, dto);
  }

  @Get('projects/:projectId')
  @ApiOperation({ summary: 'Project finance detail (admin or project owner)' })
  @UseGuards(ProjectOwnerOrAdminGuard)
  projectDetail(
    @Param('projectId') projectId: string,
    @Query() dto: FinanceQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.finance.projectDetail(user, projectId, dto);
  }

  @Get('export')
  @ApiOperation({ summary: 'Finance usage CSV export (admin)' })
  @UseGuards(RolesGuard)
  @Roles('admin')
  async export(
    @Query() dto: FinanceQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.finance.exportCsv(user, dto, reply);
  }
}
