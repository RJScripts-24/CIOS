import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersDto } from './dto/list-users.dto';
import { UsersService } from './users.service';

@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listUsers(@Query() filters: ListUsersDto, @CurrentUser() user: JwtPayload) {
    return this.usersService.listUsers(filters, user);
  }

  @Post()
  createUser(@Body() dto: CreateUserDto, @CurrentUser() user: JwtPayload) {
    return this.usersService.createUser(dto, user);
  }

  @Patch(':id/promote')
  promoteUser(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.promoteUser(id, user);
  }

  @Patch(':id/demote')
  demoteUser(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.demoteUser(id, user);
  }

  @Patch(':id/deactivate')
  deactivateUser(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.deactivateUser(id, user);
  }

  @Patch(':id/activate')
  activateUser(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.usersService.activateUser(id, user);
  }
}