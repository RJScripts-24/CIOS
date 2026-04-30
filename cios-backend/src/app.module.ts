import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
// [WORKSPACE INVITE] ConfigService is required for global ResendModule setup.
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
// [WORKSPACE INVITE] Register Resend globally at app root so WorkspaceService
// can inject ResendService without re-registering the module elsewhere.
import { ResendModule } from 'nestjs-resend';
// [WORKSPACE INVITE] Register WorkspaceModule to expose workspace creation
// and invitation endpoints. WorkspaceService is also exported for use by
// AuthModule during the post-registration invite-accept flow.
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { UsersModule } from './modules/users/users.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { ProjectsModule } from './modules/projects/projects.module';
import { ThreadGroupsModule } from './modules/thread-groups/thread-groups.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // [WORKSPACE INVITE] Configure Resend once at app root using RESEND_API_KEY
    // so invitation emails can be sent from WorkspaceService.
    ResendModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        apiKey: configService.getOrThrow<string>('RESEND_API_KEY'),
      }),
    }),
    PrismaModule,
    AuthModule,
    ApiKeysModule,
    UsersModule,
    // [WORKSPACE INVITE] Register WorkspaceModule to expose workspace creation
    // and invitation endpoints. WorkspaceService is also exported for use by
    // AuthModule during the post-registration invite-accept flow.
    WorkspaceModule,
    ProjectsModule,
    ThreadGroupsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
