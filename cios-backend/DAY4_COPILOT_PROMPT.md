# CIOS Backend — Day 4 Copilot Implementation Prompt
## Threads Module + Integration QA

**Date:** Day 4  
**Author:** Engineering  
**Scope:** `src/modules/threads/` — 5 endpoints, full service logic, unit tests, and cross-module integration QA pass

---

## Context You Must Read Before Writing Any Code

You are continuing the CIOS (Client Intelligence Operating System) backend — a production-grade, multi-tenant NestJS/Fastify API built on top of PostgreSQL (Neon serverless) with Prisma 7.

### What Is Already Done (Do Not Re-Implement)

The following modules are fully implemented, tested, and passing:

| Module | Location | Status |
|--------|----------|--------|
| Auth (register, login, Google OAuth, refresh, logout, me) | `src/modules/auth/` | ✅ Complete |
| BYOK API Keys (add, list, update, delete, validate) | `src/modules/api-keys/` | ✅ Complete |
| Users/Roles (list, create, promote, demote, deactivate) | `src/modules/users/` | ✅ Complete |
| Workspace | `src/modules/workspace/` | ✅ Complete |
| Projects (full CRUD, members, custom-properties, archive) | `src/modules/projects/` | ✅ Complete |
| **Thread Groups** (create, list, patch, delete) | `src/modules/thread-groups/` | ✅ Complete |
| Guards & Decorators | `src/common/` | ✅ Complete |
| Prisma Service | `src/prisma/` | ✅ Complete |

### What Day 4 Must Build

**Only the Threads module is missing.**

```
src/modules/threads/
├── dto/
│   ├── create-thread.dto.ts
│   ├── update-thread.dto.ts
│   ├── list-threads.dto.ts
│   └── upsert-property-values.dto.ts
├── interfaces/
│   └── thread-response.interface.ts
├── threads.controller.ts
├── threads.service.ts
├── threads.module.ts
└── threads.service.spec.ts
```

Register `ThreadsModule` in `src/app.module.ts`.

---

## Critical Architecture Rules — Non-Negotiable

Read these before writing a single line. Every single one has caused production bugs in the past.

1. **`workspaceScope(user)` is mandatory on every Prisma query.** No query ever hits the database without `workspace_id: user.workspace_id` in the `where` clause. Import from `src/common/helpers/workspace-scope.helper.ts`.

2. **`encrypted_key` must never appear in any response.** This is in the API keys module, not threads, but reinforces the pattern: never return sensitive fields.

3. **Private thread filtering is enforced at the SQL layer.** Never fetch all threads and filter in application code. The `OR` condition must be inside the Prisma `where` block itself.

4. **`access_level` was removed from the `Thread` model in the current schema.** The original spec documents reference it, but a migration dropped that column from `threads`. Do NOT add it back. Every thread is visible to all project members unless explicitly hidden by future feature work. The `include_private` query param and `access_level` field are **not implemented** in this iteration.

5. **Audit log writes happen in the service layer, not the controller.** Use the same private `writeAuditLog` helper pattern used in `ProjectsService`.

6. **`total_cost` in the schema is `Decimal` type.** When returning it in API responses, call `.toFixed(6)` or `.toString()` — never return a raw `Decimal` object, it will serialize incorrectly.

7. **`skill_ids` linking uses `thread_active_skills` table.** When `skill_ids` is provided in the create body, insert each as a `ThreadActiveSkill` row inside a transaction.

8. **All multi-step writes (create with skills, delete group with thread unassignment) must be wrapped in `this.prisma.$transaction()`.**

9. **Guard order on routes is fixed:**  
   `JwtAuthGuard` (global, always runs) → `ProjectMemberGuard` → `ProjectEditAccessGuard` or `ProjectOwnerOrAdminGuard`  
   Never reverse this order.

10. **Two separate `@Controller()` classes are required** in `threads.controller.ts` — one for `/projects/:projectId/threads` (list + create) and one for `/threads` (get by id, patch, property-values). Both classes inject the same `ThreadsService`. Both are exported in `ThreadsModule.controllers`.

---

## Stage 1 — DTOs

Create `src/modules/threads/dto/` with four files.

### `list-threads.dto.ts`

```typescript
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListThreadsDto {
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Multi-value: ?purpose_tag=Dev&purpose_tag=Copy
   * class-transformer handles array coercion from query strings.
   */
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  purpose_tag?: string[];

  @IsOptional()
  @IsUUID()
  created_by?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost_min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost_max?: number;

  @IsOptional()
  @IsUUID()
  group_id?: string;

  @IsOptional()
  @IsIn(['last_active', 'title_asc', 'cost_desc', 'created_at'])
  sort_by?: string;

  /**
   * Reserved for future use — access_level was removed from the Thread model.
   * Accepted in the DTO for forward-compatibility but ignored in the service.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  include_private?: boolean;
}
```

### `create-thread.dto.ts`

```typescript
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateThreadDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  purpose_tag?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  system_prompt?: string;

  /**
   * access_level field is accepted for forward-compatibility with the frontend
   * but is not persisted — the Thread schema does not have this column in the
   * current migration state.
   */
  @IsOptional()
  @IsIn(['team', 'private'])
  access_level?: string;

  @IsOptional()
  @IsUUID()
  group_id?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  skill_ids?: string[];
}
```

### `update-thread.dto.ts`

```typescript
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  purpose_tag?: string;

  @IsOptional()
  @IsIn(['active', 'archived'])
  status?: string;

  @IsOptional()
  @IsUUID()
  group_id?: string | null;

  @IsOptional()
  @IsString()
  system_prompt?: string;
}
```

### `upsert-property-values.dto.ts`

```typescript
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class PropertyValueItemDto {
  @IsUUID()
  property_id: string;

  @IsNotEmpty()
  value: unknown;
}

export class UpsertPropertyValuesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PropertyValueItemDto)
  values: PropertyValueItemDto[];
}
```

**Stage 1 checkpoint:** Run `npx tsc --noEmit`. Fix any type errors before proceeding.

---

## Stage 2 — Interface

Create `src/modules/threads/interfaces/thread-response.interface.ts`:

```typescript
export interface ThreadResponse {
  id: string;
  project_id: string;
  workspace_id: string;
  group_id: string | null;
  title: string;
  purpose_tag: string | null;
  status: string | null;
  system_prompt: string | null;
  last_model_used: string | null;
  created_by: string;
  last_active_at: Date | null;
  total_cost: string;
  created_at: Date;
  updated_at: Date;
  property_values: Record<string, unknown>;
}
```

---

## Stage 3 — ThreadsService

Create `src/modules/threads/threads.service.ts`.

Write this as an **experienced senior engineer would**: no `any` casts unless strictly necessary, explicit error messages that make debugging straightforward, transactions for all multi-step writes, and no in-memory post-processing of database results.

### Imports and class skeleton

```typescript
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { workspaceScope } from '../../common/helpers/workspace-scope.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateThreadDto } from './dto/create-thread.dto';
import { ListThreadsDto } from './dto/list-threads.dto';
import { UpdateThreadDto } from './dto/update-thread.dto';
import { UpsertPropertyValuesDto } from './dto/upsert-property-values.dto';
import { ThreadResponse } from './interfaces/thread-response.interface';

@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Private helpers ──────────────────────────────────────────────────────

  private async writeAuditLog(
    user: JwtPayload,
    eventType: string,
    eventDetail: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        workspace_id: user.workspace_id,
        user_id: user.sub,
        event_type: eventType,
        event_detail: eventDetail,
      },
    });
  }

  private mapThreadResponse(thread: any): ThreadResponse {
    const property_values: Record<string, unknown> = {};
    for (const pv of thread.thread_property_values ?? []) {
      property_values[pv.property_id] = pv.value;
    }

    return {
      id: thread.id,
      project_id: thread.project_id,
      workspace_id: thread.workspace_id,
      group_id: thread.group_id ?? null,
      title: thread.title,
      purpose_tag: thread.purpose_tag ?? null,
      status: thread.status ?? null,
      system_prompt: thread.system_prompt ?? null,
      last_model_used: thread.last_model_used ?? null,
      created_by: thread.created_by,
      last_active_at: thread.last_active_at ?? null,
      total_cost: thread.total_cost != null
        ? Number(thread.total_cost).toFixed(6)
        : '0.000000',
      created_at: thread.created_at,
      updated_at: thread.updated_at,
      property_values,
    };
  }

  // ── Public methods ────────────────────────────────────────────────────────
}
```

### Method: `listThreads`

Implement this method on `ThreadsService`. This is the most complex query in the entire system. Build the full `where` clause in Prisma — do not split into multiple queries or filter in JavaScript after the fetch.

```typescript
async listThreads(
  projectId: string,
  dto: ListThreadsDto,
  user: JwtPayload,
): Promise<{ groups: unknown[]; ungrouped_threads: ThreadResponse[] }> {
  if (!user.workspace_id) {
    throw new ForbiddenException('User has no workspace assigned');
  }

  const where: Prisma.ThreadWhereInput = {
    ...workspaceScope(user),
    project_id: projectId,
  };

  // ── Optional filters — all ANDed together ─────────────────────────────

  if (dto.search) {
    where.title = { contains: dto.search, mode: 'insensitive' };
  }

  if (dto.purpose_tag && dto.purpose_tag.length > 0) {
    where.purpose_tag = { in: dto.purpose_tag };
  }

  if (dto.created_by) {
    where.created_by = dto.created_by;
  }

  if (dto.model) {
    where.last_model_used = dto.model;
  }

  if (dto.status) {
    where.status = dto.status;
  }

  if (dto.date_from || dto.date_to) {
    where.created_at = {};
    if (dto.date_from) where.created_at.gte = new Date(dto.date_from);
    if (dto.date_to) where.created_at.lte = new Date(dto.date_to);
  }

  if (dto.cost_min !== undefined || dto.cost_max !== undefined) {
    where.total_cost = {};
    if (dto.cost_min !== undefined) {
      (where.total_cost as Prisma.DecimalNullableFilter).gte = dto.cost_min;
    }
    if (dto.cost_max !== undefined) {
      (where.total_cost as Prisma.DecimalNullableFilter).lte = dto.cost_max;
    }
  }

  if (dto.group_id) {
    where.group_id = dto.group_id;
  }

  // ── Sort order ────────────────────────────────────────────────────────

  const sortMap: Record<string, Prisma.ThreadOrderByWithRelationInput> = {
    last_active: { last_active_at: 'desc' },
    title_asc: { title: 'asc' },
    cost_desc: { total_cost: 'desc' },
    created_at: { created_at: 'desc' },
  };
  const orderBy = sortMap[dto.sort_by ?? 'last_active'];

  // ── Single Prisma query — includes property values ─────────────────

  const threads = await this.prisma.thread.findMany({
    where,
    orderBy,
    include: {
      thread_property_values: {
        select: { property_id: true, value: true },
      },
    },
  });

  const mapped = threads.map((t) => this.mapThreadResponse(t));

  // ── Group threads by group_id for the response ─────────────────────
  // Fetch group metadata for any groups that appear in the result.

  const groupIds = [...new Set(
    mapped.filter((t) => t.group_id).map((t) => t.group_id as string),
  )];

  let groups: unknown[] = [];

  if (groupIds.length > 0) {
    const groupRecords = await this.prisma.threadGroup.findMany({
      where: { ...workspaceScope(user), id: { in: groupIds } },
      orderBy: { created_at: 'asc' },
    });

    groups = groupRecords.map((g) => {
      const groupThreads = mapped.filter((t) => t.group_id === g.id);
      const total_cost = groupThreads
        .reduce((sum, t) => sum + parseFloat(t.total_cost), 0)
        .toFixed(6);

      return {
        id: g.id,
        name: g.name,
        total_cost,
        threads: groupThreads,
      };
    });
  }

  const ungrouped_threads = mapped.filter((t) => !t.group_id);

  return { groups, ungrouped_threads };
}
```

### Method: `createThread`

```typescript
async createThread(
  projectId: string,
  dto: CreateThreadDto,
  user: JwtPayload,
): Promise<ThreadResponse> {
  if (!user.workspace_id) {
    throw new ForbiddenException('User has no workspace assigned');
  }

  // Validate group_id belongs to this project if provided
  if (dto.group_id) {
    const group = await this.prisma.threadGroup.findFirst({
      where: {
        ...workspaceScope(user),
        id: dto.group_id,
        project_id: projectId,
      },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException(
        `Thread group ${dto.group_id} not found in this project`,
      );
    }
  }

  const thread = await this.prisma.$transaction(async (tx) => {
    const created = await tx.thread.create({
      data: {
        project_id: projectId,
        workspace_id: user.workspace_id,
        created_by: user.sub,
        title: dto.title,
        purpose_tag: dto.purpose_tag,
        last_model_used: dto.model,
        system_prompt: dto.system_prompt,
        group_id: dto.group_id ?? null,
        status: 'active',
      },
      include: {
        thread_property_values: {
          select: { property_id: true, value: true },
        },
      },
    });

    if (dto.skill_ids && dto.skill_ids.length > 0) {
      await tx.threadActiveSkill.createMany({
        data: dto.skill_ids.map((skillId) => ({
          thread_id: created.id,
          skill_id: skillId,
          workspace_id: user.workspace_id,
        })),
        skipDuplicates: true,
      });
    }

    return created;
  });

  await this.writeAuditLog(user, 'thread_created', {
    thread_id: thread.id,
    project_id: projectId,
    title: thread.title,
  });

  return this.mapThreadResponse(thread);
}
```

### Method: `getThreadById`

```typescript
async getThreadById(
  id: string,
  user: JwtPayload,
): Promise<ThreadResponse> {
  if (!user.workspace_id) {
    throw new ForbiddenException('User has no workspace assigned');
  }

  const thread = await this.prisma.thread.findFirst({
    where: { ...workspaceScope(user), id },
    include: {
      thread_property_values: {
        select: { property_id: true, value: true },
      },
    },
  });

  if (!thread) {
    throw new NotFoundException('Thread not found');
  }

  return this.mapThreadResponse(thread);
}
```

### Method: `updateThread`

```typescript
async updateThread(
  id: string,
  dto: UpdateThreadDto,
  user: JwtPayload,
): Promise<ThreadResponse> {
  if (!user.workspace_id) {
    throw new ForbiddenException('User has no workspace assigned');
  }

  const existing = await this.prisma.thread.findFirst({
    where: { ...workspaceScope(user), id },
    select: { id: true, project_id: true },
  });

  if (!existing) {
    throw new NotFoundException('Thread not found');
  }

  // Validate new group_id if being changed
  if (dto.group_id) {
    const group = await this.prisma.threadGroup.findFirst({
      where: {
        ...workspaceScope(user),
        id: dto.group_id,
        project_id: existing.project_id,
      },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException(
        `Thread group ${dto.group_id} not found in this project`,
      );
    }
  }

  const data: Prisma.ThreadUpdateInput = {};
  if (dto.title !== undefined) data.title = dto.title;
  if (dto.purpose_tag !== undefined) data.purpose_tag = dto.purpose_tag;
  if (dto.status !== undefined) data.status = dto.status;
  if ('group_id' in dto) data.group_id = dto.group_id ?? null;
  if (dto.system_prompt !== undefined) data.system_prompt = dto.system_prompt;

  if (Object.keys(data).length === 0) {
    // Nothing to update — return current state to avoid a no-op write
    const unchanged = await this.prisma.thread.findFirst({
      where: { ...workspaceScope(user), id },
      include: {
        thread_property_values: { select: { property_id: true, value: true } },
      },
    });
    return this.mapThreadResponse(unchanged!);
  }

  const updated = await this.prisma.thread.update({
    where: { id },
    data,
    include: {
      thread_property_values: { select: { property_id: true, value: true } },
    },
  });

  return this.mapThreadResponse(updated);
}
```

### Method: `upsertPropertyValues`

```typescript
async upsertPropertyValues(
  threadId: string,
  dto: UpsertPropertyValuesDto,
  user: JwtPayload,
): Promise<{ thread_id: string; updated_values: unknown[] }> {
  if (!user.workspace_id) {
    throw new ForbiddenException('User has no workspace assigned');
  }

  // Verify thread exists and belongs to this workspace
  const thread = await this.prisma.thread.findFirst({
    where: { ...workspaceScope(user), id: threadId },
    select: { id: true, project_id: true },
  });

  if (!thread) {
    throw new NotFoundException('Thread not found');
  }

  // Validate all property_ids exist on this project and retrieve their types
  const propertyIds = dto.values.map((v) => v.property_id);
  const properties = await this.prisma.projectCustomProperty.findMany({
    where: {
      ...workspaceScope(user),
      project_id: thread.project_id,
      id: { in: propertyIds },
    },
    select: { id: true, property_type: true },
  });

  const propertyMap = new Map(properties.map((p) => [p.id, p]));

  // Validate every requested property_id exists on this project
  for (const item of dto.values) {
    if (!propertyMap.has(item.property_id)) {
      throw new NotFoundException(
        `Custom property ${item.property_id} not found on this project`,
      );
    }
  }

  // Type validation
  for (const item of dto.values) {
    const prop = propertyMap.get(item.property_id)!;
    const valid = validatePropertyValue(prop.property_type, item.value);
    if (!valid) {
      throw new UnprocessableEntityException(
        `Value for property ${item.property_id} does not match expected type "${prop.property_type}"`,
      );
    }
  }

  // Upsert all values in a single transaction
  const updated_values = await this.prisma.$transaction(
    dto.values.map((item) =>
      this.prisma.threadPropertyValue.upsert({
        where: {
          thread_id_property_id: {
            thread_id: threadId,
            property_id: item.property_id,
          },
        },
        create: {
          thread_id: threadId,
          property_id: item.property_id,
          value: item.value as Prisma.InputJsonValue,
        },
        update: {
          value: item.value as Prisma.InputJsonValue,
        },
        select: { property_id: true, value: true },
      }),
    ),
  );

  return { thread_id: threadId, updated_values };
}
```

Add this **module-level** helper function at the bottom of the file (outside the class, same file):

```typescript
function validatePropertyValue(propertyType: string, value: unknown): boolean {
  if (value === null || value === undefined) return true; // null clears a value

  switch (propertyType) {
    case 'text':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && isFinite(value);
    case 'date':
      return typeof value === 'string' && !isNaN(Date.parse(value));
    case 'checkbox':
      return typeof value === 'boolean';
    case 'single_select':
      return typeof value === 'string';
    case 'multi_select':
    case 'person':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
    default:
      return false;
  }
}
```

**Stage 3 checkpoint:** Run `npx tsc --noEmit`. Fix every type error before continuing.

---

## Stage 4 — ThreadsController

Create `src/modules/threads/threads.controller.ts`.

**Two separate `@Controller()` classes are required in this single file.** This is the same pattern used in `thread-groups.controller.ts`.

```typescript
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

// ── Controller 1: project-scoped routes ──────────────────────────────────────
// Handles list and create, both of which require project membership context.

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

// ── Controller 2: thread-level routes ────────────────────────────────────────
// Handles operations on a specific thread by its ID.
// ProjectMemberGuard is applied per-method because :id here is a thread ID,
// not a projectId, so the guard resolves project membership via the thread's project.

@Controller('threads')
export class ThreadsController {
  constructor(private readonly threadsService: ThreadsService) {}

  @Get(':id')
  @UseGuards(ProjectMemberGuard)
  getThreadById(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
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
```

> **Critical note on `ProjectMemberGuard` with thread-level routes:** The `ProjectMemberGuard` reads `request.params.projectId ?? request.params.id`. On the `/threads/:id` routes, `:id` is a thread UUID, not a project UUID. The guard will attempt to look up a project with that thread's UUID and fail. **You must verify how `ProjectMemberGuard` is implemented in `src/common/guards/project-member.guard.ts` before applying it to `/threads/:id` routes.**
>
> **If the guard relies solely on params** and cannot handle thread-level routes, implement the membership check inside the service methods instead (look up the thread, then verify `project_members` contains `user.sub`). Do not silently skip the membership check — it is a security boundary.
>
> Apply whichever pattern is consistent with the existing guard implementation. Document the chosen approach in a comment at the top of the controller.

---

## Stage 5 — ThreadsModule

Create `src/modules/threads/threads.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ThreadsProjectController, ThreadsController } from './threads.controller';
import { ThreadsService } from './threads.service';

@Module({
  imports: [PrismaModule],
  providers: [ThreadsService],
  controllers: [ThreadsProjectController, ThreadsController],
  exports: [ThreadsService],
})
export class ThreadsModule {}
```

### Register in `src/app.module.ts`

Open `src/app.module.ts`. Add `ThreadsModule` to the `imports` array alongside the existing modules. Do not remove any existing imports.

**Stage 5 checkpoint:** Run `npx tsc --noEmit`. Run `npx nest build`. Fix every error before continuing.

---

## Stage 6 — Unit Tests

Create `src/modules/threads/threads.service.spec.ts`.

Write tests that match the pattern established in `projects.service.spec.ts` and `thread-groups.service.spec.ts`. Use Jest mocks for `PrismaService`. Every service method must have at minimum:

- A happy-path test proving the correct Prisma calls were made and the response shape is correct
- A test for every thrown exception (NotFoundException, ForbiddenException, UnprocessableEntityException)
- Tests for the no-op path in `updateThread` (empty DTO body)

### Test structure skeleton

```typescript
import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ThreadsService } from './threads.service';

const WORKSPACE_ID = 'workspace-uuid';
const PROJECT_ID = 'project-uuid';
const THREAD_ID = 'thread-uuid';

const mockUser = {
  sub: 'user-uuid',
  email: 'user@test.com',
  role: 'team_member' as const,
  workspace_id: WORKSPACE_ID,
};

const mockThread = {
  id: THREAD_ID,
  project_id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  group_id: null,
  title: 'Test Thread',
  purpose_tag: null,
  status: 'active',
  system_prompt: null,
  last_model_used: null,
  created_by: mockUser.sub,
  last_active_at: null,
  total_cost: null,
  created_at: new Date(),
  updated_at: new Date(),
  thread_property_values: [],
};

const mockPrismaService = {
  thread: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  threadGroup: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  threadActiveSkill: {
    createMany: jest.fn(),
  },
  threadPropertyValue: {
    upsert: jest.fn(),
  },
  projectCustomProperty: {
    findMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn((arg) => {
    if (typeof arg === 'function') return arg(mockPrismaService);
    return Promise.all(arg);
  }),
};

describe('ThreadsService', () => {
  let service: ThreadsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ThreadsService>(ThreadsService);
    jest.clearAllMocks();
  });

  // ── listThreads ────────────────────────────────────────────────────────

  describe('listThreads', () => {
    it('should return grouped and ungrouped threads', async () => {
      mockPrismaService.thread.findMany.mockResolvedValue([mockThread]);
      mockPrismaService.threadGroup.findMany.mockResolvedValue([]);

      const result = await service.listThreads(PROJECT_ID, {}, mockUser);

      expect(result.ungrouped_threads).toHaveLength(1);
      expect(result.groups).toHaveLength(0);
      expect(mockPrismaService.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspace_id: WORKSPACE_ID,
            project_id: PROJECT_ID,
          }),
        }),
      );
    });

    it('should throw ForbiddenException if user has no workspace', async () => {
      await expect(
        service.listThreads(PROJECT_ID, {}, { ...mockUser, workspace_id: '' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should apply search filter as case-insensitive title contains', async () => {
      mockPrismaService.thread.findMany.mockResolvedValue([]);
      mockPrismaService.threadGroup.findMany.mockResolvedValue([]);

      await service.listThreads(PROJECT_ID, { search: 'hello' }, mockUser);

      expect(mockPrismaService.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            title: { contains: 'hello', mode: 'insensitive' },
          }),
        }),
      );
    });
  });

  // ── createThread ───────────────────────────────────────────────────────

  describe('createThread', () => {
    it('should create a thread and write an audit log', async () => {
      mockPrismaService.$transaction.mockImplementation(async (fn: any) =>
        fn(mockPrismaService),
      );
      mockPrismaService.thread.create.mockResolvedValue(mockThread);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.createThread(
        PROJECT_ID,
        { title: 'Test Thread' },
        mockUser,
      );

      expect(result.title).toBe('Test Thread');
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event_type: 'thread_created' }),
        }),
      );
    });

    it('should insert skill associations when skill_ids are provided', async () => {
      mockPrismaService.$transaction.mockImplementation(async (fn: any) =>
        fn(mockPrismaService),
      );
      mockPrismaService.thread.create.mockResolvedValue(mockThread);
      mockPrismaService.threadActiveSkill.createMany.mockResolvedValue({ count: 1 });
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.createThread(
        PROJECT_ID,
        { title: 'Thread', skill_ids: ['skill-uuid'] },
        mockUser,
      );

      expect(mockPrismaService.threadActiveSkill.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ skill_id: 'skill-uuid' }),
          ]),
        }),
      );
    });

    it('should throw NotFoundException if group_id does not exist in project', async () => {
      mockPrismaService.threadGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.createThread(
          PROJECT_ID,
          { title: 'Thread', group_id: 'bad-group-uuid' },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getThreadById ──────────────────────────────────────────────────────

  describe('getThreadById', () => {
    it('should return the thread with mapped property_values', async () => {
      const threadWithProps = {
        ...mockThread,
        thread_property_values: [{ property_id: 'prop-1', value: 'hello' }],
      };
      mockPrismaService.thread.findFirst.mockResolvedValue(threadWithProps);

      const result = await service.getThreadById(THREAD_ID, mockUser);

      expect(result.property_values['prop-1']).toBe('hello');
    });

    it('should throw NotFoundException if thread not found', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(null);

      await expect(
        service.getThreadById('ghost-id', mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateThread ───────────────────────────────────────────────────────

  describe('updateThread', () => {
    it('should update only provided fields', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThread);
      mockPrismaService.thread.update.mockResolvedValue({ ...mockThread, title: 'Renamed' });

      const result = await service.updateThread(
        THREAD_ID,
        { title: 'Renamed' },
        mockUser,
      );

      expect(result.title).toBe('Renamed');
      expect(mockPrismaService.thread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Renamed' }),
        }),
      );
    });

    it('should return unchanged thread when no fields are provided', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThread);

      await service.updateThread(THREAD_ID, {}, mockUser);

      expect(mockPrismaService.thread.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if thread not found', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(null);

      await expect(
        service.updateThread('ghost-id', { title: 'x' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── upsertPropertyValues ───────────────────────────────────────────────

  describe('upsertPropertyValues', () => {
    it('should upsert property values and return updated list', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThread);
      mockPrismaService.projectCustomProperty.findMany.mockResolvedValue([
        { id: 'prop-1', property_type: 'text' },
      ]);
      mockPrismaService.$transaction.mockResolvedValue([
        { property_id: 'prop-1', value: 'hello' },
      ]);

      const result = await service.upsertPropertyValues(
        THREAD_ID,
        { values: [{ property_id: 'prop-1', value: 'hello' }] },
        mockUser,
      );

      expect(result.thread_id).toBe(THREAD_ID);
      expect(result.updated_values).toHaveLength(1);
    });

    it('should throw NotFoundException if property not on this project', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThread);
      mockPrismaService.projectCustomProperty.findMany.mockResolvedValue([]);

      await expect(
        service.upsertPropertyValues(
          THREAD_ID,
          { values: [{ property_id: 'missing-prop', value: 'x' }] },
          mockUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw UnprocessableEntityException on type mismatch', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThread);
      mockPrismaService.projectCustomProperty.findMany.mockResolvedValue([
        { id: 'prop-1', property_type: 'number' },
      ]);

      await expect(
        service.upsertPropertyValues(
          THREAD_ID,
          { values: [{ property_id: 'prop-1', value: 'not-a-number' }] },
          mockUser,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });
});
```

**Stage 6 checkpoint:** Run `npx jest --testPathPattern="threads" --verbose`. All tests must pass before proceeding.

---

## Stage 7 — Regression + Build Verification

Run the full validation sequence in order. Do not skip any step.

### 7.1 TypeScript compile check

```bash
npx tsc --noEmit
```

Expected: zero errors.

### 7.2 Production build

```bash
npx nest build
```

Expected: exits with code 0, zero warnings about missing modules.

### 7.3 New module tests

```bash
npx jest --testPathPattern="threads" --coverage --verbose
```

Expected: all tests pass.

### 7.4 Full regression suite

```bash
npx jest --coverage --verbose
```

Expected: all existing test suites still pass. The total number of passing tests should be higher than it was after Day 3 (which ended at 129 passing). Any test that was passing before Day 4 must still pass.

### 7.5 Guard regression

```bash
npx jest --testPathPattern="guards|workspace-scope" --verbose
```

Expected: all guard and workspace scope tests pass.

---

## Stage 8 — Integration QA Scenarios

After all tests pass, manually verify the following scenarios by calling the running API (or writing additional e2e-style tests if a test harness exists).

### Security boundary tests

| Scenario | Expected HTTP Status |
|----------|---------------------|
| Valid JWT from Workspace A fetches a project from Workspace B | `404 Not Found` |
| `team_member` calls `GET /api/v1/admin/users` | `403 Forbidden` |
| `read_only` project member calls `POST /api/v1/projects/:projectId/threads` | `403 Forbidden` |
| `team_member` who is the project owner calls `PATCH /api/v1/projects/:id` | `200 OK` |
| Any non-public route with an expired JWT | `401 Unauthorized` |
| Any non-public route with no `Authorization` header | `401 Unauthorized` |
| Admin calls `GET /api/v1/projects` | `200 OK` — all workspace projects returned |
| `team_member` calls `GET /api/v1/projects` | `200 OK` — only their projects returned |

### Functional flow tests

**Full thread lifecycle:**

1. Login as an `edit` access member → get access token
2. `POST /api/v1/projects/:projectId/threads` with `{ title, model, skill_ids: [...] }` → verify `201`, verify skill rows inserted
3. `GET /api/v1/projects/:projectId/threads` → verify thread appears in `ungrouped_threads`
4. `PATCH /api/v1/threads/:id` with `{ title: "Renamed" }` → verify `200`, title updated
5. `POST /api/v1/threads/:id/property-values` with a valid property → verify `200`, upsert confirmed
6. `POST /api/v1/threads/:id/property-values` again with same property, different value → verify value is updated (not duplicated)
7. `POST /api/v1/threads/:id/property-values` with wrong type for property → verify `422`
8. `GET /api/v1/threads/:id` → verify `property_values` reflects latest upserted value

**Thread group flow:**

1. `edit` member creates a thread group → `201`
2. `edit` member attempts to rename the group via `PATCH /api/v1/thread-groups/:id` → `403`
3. Project owner renames the group → `200`
4. Create a thread inside that group
5. Owner deletes the group → `200`, verify `unassigned_thread_count: 1`
6. `GET /api/v1/projects/:projectId/threads` → the previously grouped thread now appears in `ungrouped_threads`

**Custom property flow:**

1. Owner creates a `number` type custom property on the project
2. `edit` member sets its value on a thread to `42` → `200`
3. `GET /api/v1/projects/:projectId/threads` → confirm `property_values` includes the value
4. Member tries to set value to `"forty-two"` (string for number property) → `422`
5. Owner deletes the custom property → `200`
6. Thread property values for that property are gone (cascade delete in schema)

---

## Stage 9 — Completion Checklist

Confirm each item before closing out Day 4.

- [ ] `src/modules/threads/dto/list-threads.dto.ts` — all filter params with proper validation
- [ ] `src/modules/threads/dto/create-thread.dto.ts` — `skill_ids` as optional UUID array
- [ ] `src/modules/threads/dto/update-thread.dto.ts` — `group_id` can be `null` to ungroupt
- [ ] `src/modules/threads/dto/upsert-property-values.dto.ts` — nested validated array
- [ ] `src/modules/threads/interfaces/thread-response.interface.ts` — `total_cost` is `string`, `property_values` is `Record<string, unknown>`
- [ ] `src/modules/threads/threads.service.ts` — all 5 methods implemented
- [ ] `src/modules/threads/threads.controller.ts` — **two `@Controller()` classes** in one file
- [ ] `src/modules/threads/threads.module.ts` — both controllers in `controllers` array
- [ ] `ThreadsModule` registered in `src/app.module.ts`
- [ ] `src/modules/threads/threads.service.spec.ts` — all tests passing
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `npx nest build` completes successfully
- [ ] `npx jest --coverage --verbose` — full suite passes, no regressions
- [ ] Thread list returns `{ groups: [...], ungrouped_threads: [...] }`
- [ ] Property value type validation returns `422` on mismatch
- [ ] Skill association writes to `thread_active_skills` inside a transaction
- [ ] `total_cost` is serialized as a string (not raw Decimal) in all thread responses
- [ ] No endpoint leaks `encrypted_key` under any code path
- [ ] `access_level` column is NOT added back to the Thread model or migration

---

## Known Schema Discrepancies to Handle

These are differences between the original spec documents and the actual current Prisma schema. Implement according to the schema, not the spec.

| Spec Says | Actual Schema | What to Do |
|-----------|---------------|------------|
| `Thread.access_level` field (`team` \| `private`) | Column was dropped in a migration | Accept `access_level` in create/list DTOs for frontend compatibility, but **do not persist or filter on it**. Private thread SQL enforcement is deferred. |
| `ThreadGroup.sort_order` field | Column not in schema (dropped Day 3) | Do not include `sort_order` in any DTO or response for thread groups |
| `ThreadActiveSkill.workspace_id` | Present in schema — include it | Pass `workspace_id: user.workspace_id` when inserting `thread_active_skills` rows |

---

## Code Quality Standards

Write code the way a senior engineer maintaining this for 3 years would:

- **No `any` types** unless wrapping a Prisma edge case (e.g., `$transaction` callback). When you must use `any`, add an inline comment explaining why.
- **All error messages are actionable.** "Thread not found" ✅. "Not found" ❌.
- **No silent swallows.** If a validation fails, throw. Never return empty data pretending success.
- **Every multi-step database operation uses `$transaction`.** Partial writes that leave inconsistent state are production incidents.
- **`Logger.warn()` or `Logger.error()`** on non-trivial exceptions before re-throwing, so logs are useful in production.
- **No dead code.** Do not leave commented-out blocks or `console.log` statements.
- **DTOs validate everything.** Never trust raw body input. Use `class-validator` decorators on every field.
- **Decimal serialization is explicit.** Every `total_cost` field calls `.toFixed()` or `Number().toFixed()` — never pass a raw `Decimal` to the JSON response.
