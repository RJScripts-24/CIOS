import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ThreadsController, ThreadsProjectController } from './threads.controller';
import { ThreadsService } from './threads.service';

@Module({
  imports: [PrismaModule],
  providers: [ThreadsService],
  controllers: [ThreadsProjectController, ThreadsController],
  exports: [ThreadsService],
})
export class ThreadsModule {}