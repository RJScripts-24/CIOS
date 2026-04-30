import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ThreadGroupsService } from './thread-groups.service';
import { ThreadGroupsProjectController, ThreadGroupsController } from './thread-groups.controller';

@Module({
  imports: [PrismaModule],
  providers: [ThreadGroupsService],
  controllers: [ThreadGroupsProjectController, ThreadGroupsController],
})
export class ThreadGroupsModule {}