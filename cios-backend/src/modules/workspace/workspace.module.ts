// ─────────────────────────────────────────────────────────────────────────────
// [NEW FILE] workspace.module.ts
// Purpose: Registers workspace invitation controllers and services in NestJS.
// This file is part of the Workspace Invitation feature added to support
// ClickUp-style email invite flow using Resend for transactional email.
// ─────────────────────────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
