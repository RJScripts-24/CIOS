import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProjectEditAccessGuard } from '../../common/guards/project-edit-access.guard';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateThreadDto } from './dto/create-thread.dto';
import { ListThreadsDto } from './dto/list-threads.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { UpsertPropertyValuesDto } from './dto/upsert-property-values.dto';
import { ThreadsService } from './threads.service';

// Thread-level routes reuse ProjectMemberGuard, which now resolves a thread id
// to its parent project before evaluating membership.

@Controller('projects/:projectId/threads')
@UseGuards(ProjectMemberGuard)
export class ThreadsProjectController {
  constructor(private readonly threadsService: ThreadsService) {}

  @Get()
  listThreads(
    @Param('projectId') projectId: string,
    @Query() dto: ListThreadsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.threadsService.listThreads(projectId, dto, user);
  }

  @Post()
  @UseGuards(ProjectEditAccessGuard)
  createThread(
    @Param('projectId') projectId: string,
    @Body() dto: CreateThreadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.threadsService.createThread(projectId, dto, user);
  }
}

@Controller('threads')
export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  @Get(':id')
  @UseGuards(ProjectMemberGuard)
  getThreadById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.threadsService.getThreadById(id, user);
  }

  @Patch(':id')
  @UseGuards(ProjectMemberGuard, ProjectEditAccessGuard)
  updateThread(
    @Param('id') id: string,
    @Body() dto: UpdateThreadDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.threadsService.updateThread(id, dto, user);
  }

  @Post(':id/property-values')
  @UseGuards(ProjectMemberGuard, ProjectEditAccessGuard)
  upsertPropertyValues(
    @Param('id') id: string,
    @Body() dto: UpsertPropertyValuesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.threadsService.upsertPropertyValues(id, dto, user);
  }
}