import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProjectEditAccessGuard } from '../../common/guards/project-edit-access.guard';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard';
import { ProjectOwnerOrAdminGuard } from '../../common/guards/project-owner-or-admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateThreadGroupDto } from './dto/create-thread-group.dto';
import { UpdateThreadGroupDto } from './dto/update-thread-group.dto';
import { ThreadGroupsService } from './thread-groups.service';

@Controller('projects/:projectId/thread-groups')
export class ThreadGroupsProjectController {
  constructor(private readonly threadGroupsService: ThreadGroupsService) {}

  @Post()
  @UseGuards(ProjectMemberGuard, ProjectEditAccessGuard)
  createThreadGroup(
    @Param('projectId') projectId: string,
    @Body() dto: CreateThreadGroupDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.threadGroupsService.createThreadGroup(projectId, dto, user);
  }

  @Get()
  @UseGuards(ProjectMemberGuard)
  listThreadGroups(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.threadGroupsService.listThreadGroups(projectId, user);
  }
}

@Controller('thread-groups')
export class ThreadGroupsController {
  constructor(private readonly threadGroupsService: ThreadGroupsService) {}

  @Patch(':id')
  @UseGuards(ProjectOwnerOrAdminGuard)
  updateThreadGroup(
    @Param('id') id: string,
    @Body() dto: UpdateThreadGroupDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.threadGroupsService.updateThreadGroup(id, dto, user);
  }

  @Delete(':id')
  @UseGuards(ProjectOwnerOrAdminGuard)
  deleteThreadGroup(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.threadGroupsService.deleteThreadGroup(id, user);
  }
}