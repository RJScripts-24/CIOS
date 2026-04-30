import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard';
import { ProjectOwnerOrAdminGuard } from '../../common/guards/project-owner-or-admin.guard';
import { RequestWithUser } from '../../common/interfaces/request-with-user.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateCustomPropertyDto } from './dto/create-custom-property.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { UpdateCustomPropertyDto } from './dto/update-custom-property.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  listProjects(
    @Query() query: ListProjectsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.listProjects(query, user);
  }

  @Post()
  createProject(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.createProject(dto, user);
  }

  @Get(':id')
  @UseGuards(ProjectMemberGuard)
  getProjectById(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.getProjectById(id, user);
  }

  @Patch(':id')
  @UseGuards(ProjectOwnerOrAdminGuard)
  updateProject(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @Req() req: RequestWithUser,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.updateProject(id, dto, user, (req as any).project);
  }

  @Post(':id/archive')
  @UseGuards(RolesGuard)
  @Roles('admin')
  archiveProject(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.archiveProject(id, user);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  deleteProject(
    @Param('id') id: string,
    @Headers('x-confirm-delete') confirmHeader: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.deleteProject(id, confirmHeader, user);
  }

  @Post(':id/members')
  @UseGuards(ProjectOwnerOrAdminGuard)
  addMember(
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.addMember(id, dto, user);
  }

  @Patch(':id/members/:userId')
  @UseGuards(ProjectOwnerOrAdminGuard)
  updateMemberAccess(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.updateMemberAccess(id, userId, dto, user);
  }

  @Delete(':id/members/:userId')
  @UseGuards(ProjectOwnerOrAdminGuard)
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: RequestWithUser,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.removeMember(id, userId, user, (req as any).project);
  }

  @Patch(':id/transfer-ownership')
  @UseGuards(RolesGuard)
  @Roles('admin')
  transferOwnership(
    @Param('id') id: string,
    @Body() dto: TransferOwnershipDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.transferOwnership(id, dto, user);
  }

  @Get(':id/custom-properties')
  @UseGuards(ProjectMemberGuard)
  listCustomProperties(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.listCustomProperties(id, user);
  }

  @Post(':id/custom-properties')
  @UseGuards(ProjectOwnerOrAdminGuard)
  createCustomProperty(
    @Param('id') id: string,
    @Body() dto: CreateCustomPropertyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.createCustomProperty(id, dto, user);
  }

  @Patch(':id/custom-properties/:propertyId')
  @UseGuards(ProjectOwnerOrAdminGuard)
  updateCustomProperty(
    @Param('id') id: string,
    @Param('propertyId') propertyId: string,
    @Body() dto: UpdateCustomPropertyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.updateCustomProperty(id, propertyId, dto, user);
  }

  @Delete(':id/custom-properties/:propertyId')
  @UseGuards(ProjectOwnerOrAdminGuard)
  deleteCustomProperty(
    @Param('id') id: string,
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.projectsService.deleteCustomProperty(id, propertyId, user);
  }
}