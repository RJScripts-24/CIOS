# CIOS — Day 3 Copilot Implementation Prompt
## Projects Module + Thread Groups Module (13 + 4 endpoints)

---

## HOW TO USE THIS PROMPT

This prompt is divided into **8 staged gates**. Each gate has a hard stop at the end.
**Do not start the next stage until the current stage is fully complete and verified.**

This staging exists because implementing 17 endpoints in one pass leads to context
drift, missed constraints, and bugs that are expensive to untangle. Each gate is
small enough to reason about correctly. Trust the process.

```
STAGE 1 → Read everything, fix guards
STAGE 2 → Scaffold folder structure and empty shells
STAGE 3 → DTOs for both modules
STAGE 4 → ProjectsService — core CRUD methods only
STAGE 5 → ProjectsService — members + custom properties + full ProjectsController
STAGE 6 → ThreadGroupsService + ThreadGroupsController
STAGE 7 → Tests for all new service methods
STAGE 8 → Final validation (tsc + jest + build)
```

---

## CODE QUALITY MANDATE

You are writing production code for a real SaaS platform handling real client data.

**Write as a staff-level TypeScript/NestJS engineer with 10+ years of production
backend experience would write it.** The output must look indistinguishable from
code written by a highly experienced human. Not textbook code. Not tutorial code.
Production code — the kind a senior engineer would be proud to have in their
commit history.

That means the following rules are non-negotiable:

### Naming

Every function name is a precise verb that says what it does:
`addMemberToProject`, not `handleMember`. `buildProjectWhereClause`, not `filter`.

Every variable is self-documenting:
`existingMembership`, `resolvedProjectId`, `invalidMember` — not `m`, `result`, `data`.

### Comments

**Never comment what the code does — the code already says that.**

Comment **why** something non-obvious is done, and what breaks if you change it:

```typescript
// We read from the guard-attached project here instead of re-querying.
// ProjectOwnerOrAdminGuard already verified workspace ownership and fetched
// the project row. A second findFirst would be redundant and waste a DB round-trip.
const project = (request as any).project as Project;
```

Comment every production gotcha inline where the code is:

```typescript
// fathom_links is TEXT[] — use .length > 0, not !! (empty array is truthy in JS)
fathom: project.fathom_links.length > 0,
```

### Error handling

Every thrown exception uses the correct NestJS class with a message a frontend
developer can actually act on. Never throw a generic `new Error()`. Never let a
Prisma FK violation (P2003) surface to the caller — validate cross-entity
constraints in the service before touching the DB.

Use: `NotFoundException`, `ForbiddenException`, `BadRequestException`,
`ConflictException` as appropriate.

### Transactions

Any operation writing to more than one table uses `this.prisma.$transaction`.
No exceptions. This prevents partial writes leaving the DB in an inconsistent state.

### Logging

Every service class has a private logger:
```typescript
private readonly logger = new Logger(ProjectsService.name);
```

Use `this.logger.log()`, `this.logger.warn()`, `this.logger.error()`.
**No `console.log` anywhere in production code paths.**

### No shortcuts

- No `// TODO` in any production code path
- No `any` unless genuinely unavoidable — and when it is, add a comment
  explaining exactly why and what would be needed to remove it
- No unused imports, no dead code, no leftover debug artifacts

---

## ⚠️ CRITICAL SCHEMA FACTS — MEMORISE BEFORE STAGE 1

Three things that will silently break the implementation if missed.

### Fact 1 — `fathom_links` is plural and is a `TEXT[]` array

Migration `20260424163705` renamed `fathom_link TEXT` → `fathom_links TEXT[]`.
The Prisma client reflects this rename. Every reference must use `fathom_links`
(plural) — in DTOs, service logic, and response mapping.

```typescript
// CORRECT — empty array is truthy in JS, must check length
fathom: project.fathom_links.length > 0,

// WRONG — !![] is true even when the array is empty
fathom: !!project.fathom_links,

// WRONG — singular field, does not exist in Prisma client
dto.fathom_link
```

After each stage, grep for `fathom_link` (singular without trailing `s`).
Zero matches is the only acceptable result.

---

### Fact 2 — The `projectMember` upsert key is `project_id_user_id`

Prisma generates the compound unique identifier from `@@unique([project_id, user_id])`
as the underscore-joined string `project_id_user_id`.

```typescript
// CORRECT
await this.prisma.projectMember.upsert({
  where: {
    project_id_user_id: { project_id: projectId, user_id: dto.user_id },
  },
  update: { access_level: dto.access_level },
  create: { ... },
});

// WRONG — Prisma will throw a compile-time type error on this
where: { project_id: projectId, user_id: dto.user_id }
```

---

### Fact 3 — Thread groups require two separate controller classes

`/api/projects/:projectId/thread-groups` and `/api/thread-groups/:id` have
different base paths. NestJS does not support mixing base paths in one
`@Controller()` decorator. Two classes are required in `thread-groups.controller.ts`:

```typescript
// Class 1 — project-scoped (POST, GET)
@Controller('projects/:projectId/thread-groups')
export class ThreadGroupsProjectController { ... }

// Class 2 — direct access (PATCH, DELETE)
@Controller('thread-groups')
export class ThreadGroupsController { ... }
```

Both inject the same `ThreadGroupsService`. Both are listed in
`ThreadGroupsModule.controllers`. If merged into one class, routes silently
fail to resolve — there is no runtime error, just 404s.

---

## PART 0 — NON-NEGOTIABLE RULES (apply to every line in every stage)

1. **WORKSPACE ISOLATION**: Every Prisma query includes `...workspaceScope(user)`.
   Import from `src/common/helpers/workspace-scope.helper.ts`. This is the
   multi-tenant isolation boundary. No exceptions.

2. **AUDIT LOG IN SERVICE**: All `auditLog.create()` calls live in the service
   layer, never in the controller. Service methods fire regardless of which
   controller code path runs — controllers do not.

3. **GUARD ORDER IS FIXED**:
   `JwtAuthGuard (global)` → `RolesGuard (global)` → `ProjectMemberGuard` →
   `ProjectEditAccessGuard` / `ProjectOwnerOrAdminGuard`. Never reverse.

4. **NO SECOND DB QUERY AFTER GUARD FETCH**: `ProjectOwnerOrAdminGuard` attaches
   the project to `(request as any).project`. Read from it — never re-query.

5. **UNDEFINED-CHECKING IN PARTIAL UPDATES**: Use `!== undefined`, not `!= null`.
   A field explicitly set to `null` in the request body is an intentional clear.
   A field absent from the body means "leave it unchanged".

6. **TRANSACTIONS FOR MULTI-TABLE WRITES**: Any service method writing to more
   than one table uses `this.prisma.$transaction(async (tx) => { ... })`.

7. **IMPORTS**:
   - `PrismaService` → `../../prisma/prisma.service`
   - `JwtPayload` → `../../modules/auth/interfaces/jwt-payload.interface`
   - `workspaceScope` → `../../common/helpers/workspace-scope.helper`
   - `RequestWithUser` → `../../common/interfaces/request-with-user.interface`
   - Prisma enums/types → `../../generated/prisma/client` — **never** `@prisma/client`

8. **FASTIFY**: App uses the Fastify adapter. `RequestWithUser` already extends
   `FastifyRequest` — always use it for typed request access.

9. **MODULE LOCATION**: New modules go under `src/modules/`.
   Mirror the exact structure of `src/modules/api-keys/`.

10. **LOGGER**: Every service class declares:
    ```typescript
    private readonly logger = new Logger(ProjectsService.name);
    ```

---

## PART 1 — EXISTING CODEBASE CONTEXT

### Already implemented (do not modify without an explicit stated reason)

```
src/modules/auth/          register, login, google OAuth, refresh, logout, me
src/modules/api-keys/      BYOK CRUD + validate
src/modules/users/         admin user mgmt: list, create, promote, demote, deactivate, reactivate
src/modules/workspace/     workspace creation + email invite flow
```

### Existing guards and helpers (Stage 1 reviews and refines these)

```
src/common/guards/project-member.guard.ts
src/common/guards/project-edit-access.guard.ts
src/common/guards/project-owner-or-admin.guard.ts
src/common/helpers/workspace-scope.helper.ts
src/common/interfaces/request-with-user.interface.ts
```

### Global guard registration in AppModule (do not change this order)

```typescript
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },  // 1st — is the user authenticated?
  { provide: APP_GUARD, useClass: RolesGuard },     // 2nd — do they have the right workspace role?
]
// ProjectMemberGuard, ProjectEditAccessGuard, ProjectOwnerOrAdminGuard
// are applied per-controller with @UseGuards() — NOT globally.
// They are not on every route, so global registration would cause false rejections.
```

### Schema quick reference

| Field / Concept | Detail |
|-----------------|--------|
| `fathom_links` | `TEXT[]` on `projects`. Plural. Array. See Critical Fact 1. |
| `AccessLevel` enum | `read_only` \| `edit` |
| `UserRole` enum | `admin` \| `team_member` only. `project_owner` is NOT a role. |
| Project ownership | `projects.owner_id` FK → `users.id`. Resolved at guard/service level. |
| `project_id_user_id` | Compound unique key on `ProjectMember`. See Critical Fact 2. |
| Two controller classes | Required for thread-groups. See Critical Fact 3. |
| All IDs | UUIDs via `gen_random_uuid()` |

---

---

# ━━━ STAGE 1 — GUARD REVIEW AND REFINEMENT ━━━

**Stop. Do not create any new files yet.**

Open the three guard files and their spec files. Verify every behaviour in the
tables below. Make surgical fixes where anything deviates. Do not rewrite guards
from scratch — targeted fixes only. Update the `.spec.ts` file alongside every
guard change.

### `ProjectMemberGuard` (`src/common/guards/project-member.guard.ts`)

| # | Behaviour to verify | Expected |
|---|---------------------|----------|
| 1 | Admin bypass | `if (user.role === 'admin') return true` — before any DB call |
| 2 | Null workspace | If `!user.workspace_id` → `ForbiddenException('User has no workspace assigned')` |
| 3 | projectId resolution | `request.params.projectId ?? request.params.id` |
| 4 | Project existence | `findFirst({ where: { id: projectId, workspace_id: user.workspace_id }, select: { id, workspace_id, owner_id } })` |
| 5 | Project missing error | `NotFoundException('Project not found')` — NOT ForbiddenException |
| 6 | Membership missing error | `ForbiddenException('You are not a member of this project')` |
| 7 | Membership attachment | `(request as any).projectMembership = membership` for downstream guards |

### `ProjectOwnerOrAdminGuard` (`src/common/guards/project-owner-or-admin.guard.ts`)

| # | Behaviour to verify | Expected |
|---|---------------------|----------|
| 1 | Admin bypass | `if (user.role === 'admin') return true` — zero DB queries |
| 2 | Missing projectId | `ForbiddenException('Project ID missing')` |
| 3 | Null workspace | `ForbiddenException('User has no workspace assigned')` |
| 4 | Project query | Uses `select: { id: true, owner_id: true, workspace_id: true }` — never fetch `*` in a guard |
| 5 | Project missing | `NotFoundException('Project not found')` |
| 6 | Not owner | `ForbiddenException('Only the project owner or admin can perform this action')` |
| 7 | Project attachment | `(request as any).project = project` — full selected object attached for downstream use |

### `ProjectEditAccessGuard` (`src/common/guards/project-edit-access.guard.ts`)

| # | Behaviour to verify | Expected |
|---|---------------------|----------|
| 1 | Admin bypass | `if (user.role === 'admin') return true` — synchronous, zero DB calls |
| 2 | Missing membership | `ForbiddenException('Project membership not resolved - ensure ProjectMemberGuard runs first')` |
| 3 | Read-only user | `ForbiddenException('You have read-only access to this project')` |
| 4 | Synchronous | No DB queries. Pure access-level check. Depends entirely on `projectMembership` from `ProjectMemberGuard`. |

### Stage 1 gate ✋

All four items must be verified before proceeding:

- [ ] All three guard files reviewed; deviations fixed
- [ ] All three guard `.spec.ts` files updated if guards were changed
- [ ] `npx jest --testPathPattern="guards" --verbose` → all green
- [ ] `npx tsc --noEmit` → exits 0

**Do not start Stage 2 until this gate is clear.**

---

# ━━━ STAGE 2 — SCAFFOLD FOLDER STRUCTURE ━━━

Create the folder structure and empty file shells below. No implementation yet —
only correct class declarations, constructor injection, and module wiring. This
stage exists to get the NestJS module graph wired correctly before any logic is
added. A clean compile here means Stage 3–6 can focus entirely on logic.

### Files to create

```
src/modules/projects/
  dto/
    list-projects.dto.ts
    create-project.dto.ts
    update-project.dto.ts
    add-member.dto.ts
    update-member.dto.ts
    transfer-ownership.dto.ts
    create-custom-property.dto.ts
    update-custom-property.dto.ts
  interfaces/
    project-response.interface.ts
  projects.service.ts
  projects.controller.ts
  projects.module.ts

src/modules/thread-groups/
  dto/
    create-thread-group.dto.ts
    update-thread-group.dto.ts
  thread-groups.service.ts
  thread-groups.controller.ts    ← must contain TWO @Controller() classes (Critical Fact 3)
  thread-groups.module.ts
```

Each DTO file exports an empty class decorated with `export class XxxDto {}`.
Each service file exports an `@Injectable()` class with constructor injecting
`PrismaService` and a private `logger`.
Each controller file exports its controller class(es) with constructor injecting
the service.
Each module file wires `PrismaModule`, service, and controller(s).

### AppModule

Add both new modules to `AppModule` imports **after** all existing modules:

```typescript
imports: [
  // ... existing modules ...
  ProjectsModule,
  ThreadGroupsModule,
],
```

### Stage 2 gate ✋

- [ ] All files exist with correct class declarations
- [ ] `ThreadGroupsModule.controllers` already lists both controller classes
- [ ] Both new modules registered in `AppModule`
- [ ] `npx nest build` → clean compile
- [ ] `npx tsc --noEmit` → exits 0

---

# ━━━ STAGE 3 — DTOs ━━━

Fill in all DTO files created in Stage 2. No service logic yet.

Use `class-validator` decorators. Import nested DTO support via `@Type` from
`class-transformer`. Do not use `PartialType` for `UpdateProjectDto` — define
all fields explicitly so field presence is deterministic at runtime.

### `ListProjectsDto`

```typescript
import { IsOptional, IsString, IsIn, IsUUID, IsDateString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export class ListProjectsDto {
  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsIn(['active', 'paused', 'completed', 'archived'])
  status?: string;

  @IsOptional() @IsIn(['client', 'internal_bd', 'internal_build'])
  type?: string;

  @IsOptional() @IsUUID()
  owner_id?: string;

  @IsOptional() @IsDateString()
  date_from?: string;

  @IsOptional() @IsDateString()
  date_to?: string;

  // Query string booleans arrive as strings — normalise before validation
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  has_linked_sources?: boolean;

  @IsOptional() @IsIn(['none', 'owner', 'last_active', 'monthly_cost'])
  group_by?: string;

  @IsOptional() @IsIn(['last_active', 'name_asc', 'cost_high_low', 'thread_count'])
  sort_by?: string;
}
```

### `AddMemberItem` (nested inside `CreateProjectDto`)

```typescript
export class AddMemberItem {
  @IsUUID() user_id: string;
  @IsIn(['read_only', 'edit']) access_level: string;
}
```

### `CreateProjectDto`

```typescript
export class CreateProjectDto {
  @IsString() @IsNotEmpty() @MaxLength(200) name: string;
  @IsIn(['client', 'internal_bd', 'internal_build']) type: string;
  @IsOptional() @IsIn(['active', 'paused', 'completed', 'archived']) status?: string;
  @IsOptional() @IsString() brief?: string;
  @IsOptional() @IsString() system_instructions?: string;
  @IsOptional() @IsString() default_model?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AddMemberItem)
  members?: AddMemberItem[];
  @IsOptional() @IsString() clickup_link?: string;
  @IsOptional() @IsString() slack_channel_link?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) fathom_links?: string[];   // ← PLURAL, ARRAY
  @IsOptional() @IsString() vault_drive_link?: string;
}
```

### `UpdateProjectDto`

All fields from `CreateProjectDto` except `type` and `members`, all optional.
Define each field explicitly — do not use `PartialType(CreateProjectDto)`.

```typescript
export class UpdateProjectDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsOptional() @IsIn(['active', 'paused', 'completed', 'archived']) status?: string;
  @IsOptional() @IsString() brief?: string;
  @IsOptional() @IsString() system_instructions?: string;
  @IsOptional() @IsString() default_model?: string;
  @IsOptional() @IsString() clickup_link?: string;
  @IsOptional() @IsString() slack_channel_link?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) fathom_links?: string[];   // ← PLURAL, ARRAY
  @IsOptional() @IsString() vault_drive_link?: string;
}
```

### `AddMemberDto`

```typescript
export class AddMemberDto {
  @IsUUID() user_id: string;
  @IsIn(['read_only', 'edit']) access_level: string;
}
```

### `UpdateMemberDto`

```typescript
export class UpdateMemberDto {
  @IsIn(['read_only', 'edit']) access_level: string;
}
```

### `TransferOwnershipDto`

```typescript
export class TransferOwnershipDto {
  @IsUUID() @IsNotEmpty() new_owner_id: string;
}
```

### `CreateCustomPropertyDto`

```typescript
export class CreateCustomPropertyDto {
  @IsString() @IsNotEmpty() @MaxLength(100) name: string;
  @IsIn(['text', 'number', 'date', 'single_select', 'multi_select', 'checkbox', 'person'])
  property_type: string;
  @IsOptional() @IsArray() options?: object[];
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}
```

### `UpdateCustomPropertyDto`

```typescript
export class UpdateCustomPropertyDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) name?: string;
  @IsOptional() @IsArray() options?: object[];
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}
```

### `CreateThreadGroupDto`

```typescript
export class CreateThreadGroupDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}
```

### `UpdateThreadGroupDto`

```typescript
export class UpdateThreadGroupDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsInt() @Min(0) sort_order?: number;
}
```

### Stage 3 gate ✋

- [ ] All DTO files filled in
- [ ] `fathom_links` is `string[]` plural in `CreateProjectDto` and `UpdateProjectDto`
- [ ] `AddMemberItem` uses `@ValidateNested` + `@Type(() => AddMemberItem)` in `CreateProjectDto`
- [ ] `npx tsc --noEmit` → exits 0

---

# ━━━ STAGE 4 — PROJECTSSERVICE: CORE CRUD METHODS ━━━

Implement only the following six methods in `projects.service.ts`. Member
management and custom properties come in Stage 5.

Methods for this stage:
1. `listProjects(dto: ListProjectsDto, user: JwtPayload)`
2. `createProject(dto: CreateProjectDto, user: JwtPayload)`
3. `getProjectById(id: string, user: JwtPayload)`
4. `updateProject(id: string, dto: UpdateProjectDto, user: JwtPayload, attachedProject)`
5. `archiveProject(id: string, user: JwtPayload)`
6. `deleteProject(id: string, confirmHeader: string, user: JwtPayload)`

Also implement the private helper `writeAuditLog` used by all of the above.

---

### Private helper: `writeAuditLog`

Extract this pattern to a private method so every service method shares one
consistent audit log write:

```typescript
private async writeAuditLog(
  user: JwtPayload,
  eventType: string,
  eventDetail: Record<string, unknown>,
): Promise<void> {
  await this.prisma.auditLog.create({
    data: {
      workspace_id: user.workspace_id,
      user_id:      user.sub,
      event_type:   eventType,
      event_detail: eventDetail,
    },
  });
}
```

---

### `listProjects` — detailed implementation guidance

Build a single Prisma query. No in-memory filtering after the fetch.

```typescript
async listProjects(dto: ListProjectsDto, user: JwtPayload) {
  // Admins see every project in their workspace.
  // Non-admins see only projects they are an explicit member of.
  const membershipFilter: Prisma.ProjectWhereInput =
    user.role === 'admin'
      ? {}
      : { members: { some: { user_id: user.sub } } };

  // Build the where clause dynamically — only include conditions for
  // query params that were actually provided. Spreading empty objects
  // is a no-op in Prisma where clauses.
  const where: Prisma.ProjectWhereInput = {
    ...workspaceScope(user),
    ...membershipFilter,

    // Default: hide archived projects. When status is explicitly provided,
    // respect it (allows fetching archived projects via ?status=archived).
    ...(dto.status
      ? { status: dto.status }
      : { status: { not: 'archived' } }),

    ...(dto.type     ? { type:     dto.type }     : {}),
    ...(dto.owner_id ? { owner_id: dto.owner_id } : {}),

    ...(dto.date_from || dto.date_to
      ? {
          created_at: {
            ...(dto.date_from ? { gte: new Date(dto.date_from) } : {}),
            ...(dto.date_to   ? { lte: new Date(dto.date_to) }   : {}),
          },
        }
      : {}),

    ...(dto.search
      ? {
          OR: [
            { name:  { contains: dto.search, mode: 'insensitive' } },
            { brief: { contains: dto.search, mode: 'insensitive' } },
          ],
        }
      : {}),

    ...(dto.has_linked_sources
      ? {
          OR: [
            { clickup_link:       { not: null } },
            { slack_channel_link: { not: null } },
            // fathom_links is TEXT[] — use isEmpty: false to check non-empty array
            { fathom_links: { isEmpty: false } },
          ],
        }
      : {}),
  };

  const sortByMap: Record<string, Prisma.ProjectOrderByWithRelationInput> = {
    last_active:  { last_active_at: 'desc' },
    name_asc:     { name: 'asc' },
    cost_high_low: { monthly_cost: 'desc' },   // adjust if field name differs
    thread_count: { threads: { _count: 'desc' } },
  };
  const orderBy = sortByMap[dto.sort_by ?? 'last_active'];

  const projects = await this.prisma.project.findMany({
    where,
    orderBy,
    include: {
      owner: { select: { id: true, full_name: true, avatar_url: true } },
      _count: {
        select: {
          threads: true,
          members: true,
        },
      },
    },
  });

  // monthly_cost requires a date-bounded SUM which Prisma _sum does not support
  // with a date filter on a related table. Compute via $queryRaw and merge.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const costRows = await this.prisma.$queryRaw<{ project_id: string; total: number }[]>`
    SELECT project_id, COALESCE(SUM(cost_usd), 0) AS total
    FROM usage_events
    WHERE workspace_id = ${user.workspace_id}
      AND created_at >= ${monthStart}
      AND project_id = ANY(${projects.map((p) => p.id)}::uuid[])
    GROUP BY project_id
  `;

  const costByProjectId = new Map(costRows.map((r) => [r.project_id, r.total]));

  return projects.map((project) => ({
    id:             project.id,
    name:           project.name,
    type:           project.type,
    status:         project.status,
    owner:          project.owner,
    thread_count:   project._count.threads,
    member_count:   project._count.members,
    monthly_cost:   (costByProjectId.get(project.id) ?? 0).toFixed(2),
    last_active_at: project.last_active_at,
    linked_sources: {
      clickup: !!project.clickup_link,
      slack:   !!project.slack_channel_link,
      // fathom_links is TEXT[] — .length > 0 is correct; !! would be wrong ([] is truthy)
      fathom:  project.fathom_links.length > 0,
    },
  }));
}
```

---

### `createProject` — detailed implementation guidance

```typescript
async createProject(dto: CreateProjectDto, user: JwtPayload) {
  // Validate cross-workspace member references before opening a transaction.
  // Letting an invalid user_id reach Prisma would surface as a cryptic FK
  // constraint violation (P2003) rather than a meaningful error message.
  if (dto.members?.length) {
    const memberUsers = await this.prisma.user.findMany({
      where: {
        id: { in: dto.members.map((m) => m.user_id) },
      },
      select: { id: true, workspace_id: true },
    });

    const invalidMember = memberUsers.find(
      (u) => u.workspace_id !== user.workspace_id,
    );

    if (invalidMember) {
      throw new BadRequestException(
        `Member user_id ${invalidMember.id} does not belong to this workspace`,
      );
    }

    const foundIds = new Set(memberUsers.map((u) => u.id));
    const missingId = dto.members.find((m) => !foundIds.has(m.user_id));
    if (missingId) {
      throw new BadRequestException(
        `Member user_id ${missingId.user_id} does not exist`,
      );
    }
  }

  return this.prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        ...workspaceScope(user),
        name:                dto.name,
        type:                dto.type,
        status:              dto.status ?? 'active',
        brief:               dto.brief              ?? null,
        system_instructions: dto.system_instructions ?? null,
        default_model:       dto.default_model       ?? null,
        owner_id:            user.sub,  // creator is always the owner at creation time
        clickup_link:        dto.clickup_link        ?? null,
        slack_channel_link:  dto.slack_channel_link  ?? null,
        fathom_links:        dto.fathom_links        ?? [],   // default to empty array — not null
        vault_drive_link:    dto.vault_drive_link    ?? null,
      },
      include: {
        owner: { select: { id: true, full_name: true, avatar_url: true } },
      },
    });

    if (dto.members?.length) {
      await tx.projectMember.createMany({
        data: dto.members.map((m) => ({
          project_id:   project.id,
          user_id:      m.user_id,
          access_level: m.access_level,
          workspace_id: user.workspace_id,
          assigned_by:  user.sub,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        workspace_id: user.workspace_id,
        user_id:      user.sub,
        event_type:   'project_created',
        event_detail: {
          project_id:   project.id,
          project_name: project.name,
          member_count: dto.members?.length ?? 0,
        },
      },
    });

    return project;
  });
}
```

---

### `updateProject` — detailed implementation guidance

```typescript
async updateProject(
  id: string,
  dto: UpdateProjectDto,
  user: JwtPayload,
  attachedProject: { id: string; workspace_id: string },
) {
  // Guard already verified ownership and attached the project object.
  // Do NOT issue a second findFirst — it is redundant and wastes a DB round-trip.
  //
  // Build the update payload using undefined-checking, not null-checking.
  // undefined = "caller did not send this field" → leave it unchanged.
  // null      = "caller explicitly wants to clear this field" → apply the null.
  const data: Prisma.ProjectUpdateInput = {};

  if (dto.name                !== undefined) data.name                = dto.name;
  if (dto.brief               !== undefined) data.brief               = dto.brief;
  if (dto.system_instructions !== undefined) data.system_instructions = dto.system_instructions;
  if (dto.status              !== undefined) data.status              = dto.status;
  if (dto.default_model       !== undefined) data.default_model       = dto.default_model;
  if (dto.clickup_link        !== undefined) data.clickup_link        = dto.clickup_link;
  if (dto.slack_channel_link  !== undefined) data.slack_channel_link  = dto.slack_channel_link;
  if (dto.fathom_links        !== undefined) data.fathom_links        = dto.fathom_links;   // plural array
  if (dto.vault_drive_link    !== undefined) data.vault_drive_link    = dto.vault_drive_link;

  const changedFields = Object.keys(data);

  if (changedFields.length === 0) {
    // Nothing was sent in the request body — return the existing record.
    // No DB write needed.
    return attachedProject;
  }

  const updated = await this.prisma.project.update({
    where: { id },
    data,
  });

  await this.writeAuditLog(user, 'project_updated', {
    project_id:     id,
    changed_fields: changedFields,
  });

  return updated;
}
```

---

### `deleteProject` — detailed implementation guidance

```typescript
async deleteProject(id: string, confirmHeader: string, user: JwtPayload) {
  // Require an explicit opt-in header for destructive operations.
  // This prevents accidental deletes from misconfigured clients or UI bugs.
  // Industry standard pattern (used by GitHub, Stripe, etc.).
  if (confirmHeader !== 'true') {
    throw new BadRequestException(
      'Confirmation required: set header X-Confirm-Delete: true',
    );
  }

  const project = await this.prisma.project.findFirst({
    where: { ...workspaceScope(user), id },
    select: { id: true, name: true },
  });

  if (!project) {
    throw new NotFoundException('Project not found');
  }

  await this.prisma.project.delete({ where: { id } });

  await this.writeAuditLog(user, 'project_deleted', {
    project_id:   project.id,
    project_name: project.name,
    deleted_by:   user.sub,
  });

  return { message: 'Project deleted' };
}
```

---

### Stage 4 gate ✋

- [ ] All 6 methods implemented
- [ ] `writeAuditLog` is a private helper (not duplicated in each method)
- [ ] `listProjects` builds a single Prisma query — no post-fetch JS filtering
- [ ] `createProject` validates cross-workspace members before the transaction
- [ ] `updateProject` uses `!== undefined` checking (not `!= null`)
- [ ] `deleteProject` checks `confirmHeader !== 'true'` before any DB call
- [ ] `fathom_links` (plural) used everywhere — grep for `fathom_link` singular → zero results
- [ ] `npx tsc --noEmit` → exits 0

---

# ━━━ STAGE 5 — MEMBER MANAGEMENT + CUSTOM PROPERTIES + FULL PROJECTSCONTROLLER ━━━

Implement the remaining `ProjectsService` methods, then wire the complete controller.

---

### `addMember(id: string, dto: AddMemberDto, user: JwtPayload)`

```typescript
async addMember(id: string, dto: AddMemberDto, user: JwtPayload) {
  // Verify the target user exists and belongs to the same workspace.
  // Prevents cross-tenant data leakage through the membership table.
  const targetUser = await this.prisma.user.findUnique({
    where: { id: dto.user_id },
    select: { id: true, workspace_id: true },
  });

  if (!targetUser) {
    throw new BadRequestException(
      `User ${dto.user_id} does not exist`,
    );
  }

  if (targetUser.workspace_id !== user.workspace_id) {
    throw new BadRequestException(
      'The user you are adding does not belong to this workspace',
    );
  }

  // Upsert: update access_level if already a member, insert otherwise.
  // Must use the compound unique key project_id_user_id — not individual fields.
  return this.prisma.projectMember.upsert({
    where: {
      project_id_user_id: { project_id: id, user_id: dto.user_id },
    },
    update: {
      access_level: dto.access_level,
    },
    create: {
      project_id:   id,
      user_id:      dto.user_id,
      access_level: dto.access_level,
      workspace_id: user.workspace_id,
      assigned_by:  user.sub,
    },
  });
}
```

---

### `updateMemberAccess(id: string, userId: string, dto: UpdateMemberDto, user: JwtPayload)`

- Find the membership row using `project_id_user_id`.
- Throw `NotFoundException('Membership not found')` if absent.
- Update `access_level` only.
- Return the updated record.

---

### `removeMember(id: string, userId: string, attachedProject, user: JwtPayload)`

```typescript
async removeMember(
  id: string,
  userId: string,
  attachedProject: { id: string; owner_id: string },
  user: JwtPayload,
) {
  // The project owner cannot be removed through this endpoint.
  // Ownership must be transferred first to avoid leaving a project without an owner.
  if (attachedProject.owner_id === userId) {
    throw new ForbiddenException(
      'Transfer ownership before removing the project owner',
    );
  }

  await this.prisma.projectMember.delete({
    where: {
      project_id_user_id: { project_id: id, user_id: userId },
    },
  });

  return { message: 'Member removed' };
}
```

---

### `transferOwnership(id: string, dto: TransferOwnershipDto, user: JwtPayload)`

```typescript
async transferOwnership(id: string, dto: TransferOwnershipDto, user: JwtPayload) {
  // Verify the new owner belongs to the same workspace.
  const newOwner = await this.prisma.user.findUnique({
    where: { id: dto.new_owner_id },
    select: { id: true, workspace_id: true },
  });

  if (!newOwner || newOwner.workspace_id !== user.workspace_id) {
    throw new BadRequestException(
      'The new owner must be a member of this workspace',
    );
  }

  // Fetch current project to capture old_owner_id for the audit trail.
  const project = await this.prisma.project.findFirst({
    where: { ...workspaceScope(user), id },
    select: { id: true, owner_id: true },
  });

  if (!project) throw new NotFoundException('Project not found');

  const updated = await this.prisma.project.update({
    where: { id },
    data: { owner_id: dto.new_owner_id },
  });

  await this.writeAuditLog(user, 'project_ownership_transferred', {
    project_id:    id,
    old_owner_id:  project.owner_id,
    new_owner_id:  dto.new_owner_id,
  });

  return updated;
}
```

---

### `listCustomProperties(id: string, user: JwtPayload)`

```typescript
return this.prisma.projectCustomProperty.findMany({
  where: { ...workspaceScope(user), project_id: id },
  orderBy: { sort_order: 'asc' },
});
```

---

### `createCustomProperty(id: string, dto: CreateCustomPropertyDto, user: JwtPayload)`

```typescript
// Select-type properties require options to be defined and non-empty.
// A single_select or multi_select property with no options is unusable
// on the frontend and would cause render errors.
if (
  (dto.property_type === 'single_select' || dto.property_type === 'multi_select') &&
  (!dto.options || dto.options.length === 0)
) {
  throw new BadRequestException(
    `options is required and must be non-empty for property_type '${dto.property_type}'`,
  );
}

return this.prisma.projectCustomProperty.create({
  data: {
    project_id:    id,
    workspace_id:  user.workspace_id,
    created_by:    user.sub,
    name:          dto.name,
    property_type: dto.property_type,
    options:       dto.options ?? [],
    sort_order:    dto.sort_order ?? 0,
  },
});
```

---

### `updateCustomProperty(id: string, propertyId: string, dto: UpdateCustomPropertyDto, user: JwtPayload)`

- Verify the property exists for this project in this workspace. Throw `NotFoundException` if not.
- Partial update using `!== undefined` checking.
- Existing `thread_property_values` are NOT deleted — this is a definition-only update.
- Return the updated property.

---

### `deleteCustomProperty(id: string, propertyId: string, user: JwtPayload)`

```typescript
async deleteCustomProperty(id: string, propertyId: string, user: JwtPayload) {
  const property = await this.prisma.projectCustomProperty.findFirst({
    where: { ...workspaceScope(user), id: propertyId, project_id: id },
    select: { id: true },
  });

  if (!property) throw new NotFoundException('Custom property not found');

  // Delete all thread values referencing this property definition first.
  // Then delete the definition itself. Both must succeed atomically.
  await this.prisma.$transaction(async (tx) => {
    await tx.threadPropertyValue.deleteMany({
      where: { property_id: propertyId },
    });
    await tx.projectCustomProperty.delete({
      where: { id: propertyId },
    });
  });

  return { message: 'Property deleted' };
}
```

---

### `ProjectsController` — complete wiring

```typescript
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
    // Guard attached the project — read from request, do not re-query
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
    return this.projectsService.removeMember(id, userId, (req as any).project, user);
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
```

### Stage 5 gate ✋

- [ ] All member management methods use `project_id_user_id` compound key in upsert/delete
- [ ] `removeMember` reads from `attachedProject` passed from controller (not re-queried)
- [ ] `deleteCustomProperty` runs inside `$transaction`
- [ ] `createCustomProperty` rejects select types with missing/empty options
- [ ] All controller routes wired with guards matching the composition table
- [ ] `npx tsc --noEmit` → exits 0

---

# ━━━ STAGE 6 — THREADGROUPSSERVICE + THREADGROUPSCONTROLLER ━━━

### `ThreadGroupsService` — all four methods

#### `createThreadGroup(projectId: string, dto: CreateThreadGroupDto, user: JwtPayload)`

```typescript
return this.prisma.threadGroup.create({
  data: {
    project_id:   projectId,
    workspace_id: user.workspace_id,
    created_by:   user.sub,
    name:         dto.name,
    sort_order:   dto.sort_order ?? 0,
  },
});
```

---

#### `listThreadGroups(projectId: string, user: JwtPayload)`

Compute thread_count and total_cost in one query — no loops, no N+1:

```typescript
async listThreadGroups(projectId: string, user: JwtPayload) {
  const groups = await this.prisma.threadGroup.findMany({
    where: { ...workspaceScope(user), project_id: projectId },
    orderBy: { sort_order: 'asc' },
    include: {
      _count: { select: { threads: true } },
    },
  });

  // If Prisma _sum on a related table's Decimal field is not available directly,
  // compute total_cost via $queryRaw and merge by group id.
  const costRows = await this.prisma.$queryRaw<{ group_id: string; total: number }[]>`
    SELECT group_id, COALESCE(SUM(total_cost), 0) AS total
    FROM threads
    WHERE workspace_id = ${user.workspace_id}
      AND project_id   = ${projectId}
      AND group_id IS NOT NULL
    GROUP BY group_id
  `;

  const costByGroupId = new Map(costRows.map((r) => [r.group_id, r.total]));

  return groups.map((group) => ({
    id:           group.id,
    name:         group.name,
    sort_order:   group.sort_order,
    thread_count: group._count.threads,
    total_cost:   (costByGroupId.get(group.id) ?? 0).toFixed(2),
  }));
}
```

---

#### `updateThreadGroup(id: string, dto: UpdateThreadGroupDto, user: JwtPayload)`

```typescript
const group = await this.prisma.threadGroup.findFirst({
  where: { ...workspaceScope(user), id },
  select: { id: true },
});

if (!group) throw new NotFoundException('Thread group not found');

const data: Prisma.ThreadGroupUpdateInput = {};
if (dto.name       !== undefined) data.name       = dto.name;
if (dto.sort_order !== undefined) data.sort_order = dto.sort_order;

return this.prisma.threadGroup.update({ where: { id }, data });
```

---

#### `deleteThreadGroup(id: string, user: JwtPayload)`

```typescript
async deleteThreadGroup(id: string, user: JwtPayload) {
  const group = await this.prisma.threadGroup.findFirst({
    where: { ...workspaceScope(user), id },
    select: { id: true },
  });

  if (!group) throw new NotFoundException('Thread group not found');

  return this.prisma.$transaction(async (tx) => {
    // Unassign all threads in this group — do NOT delete them.
    // Threads retain all their history and become "ungrouped" on the frontend.
    const { count: unassigned_thread_count } = await tx.thread.updateMany({
      where: { group_id: id, ...workspaceScope(user) },
      data:  { group_id: null },
    });

    await tx.threadGroup.delete({ where: { id } });

    return {
      message: 'Group deleted',
      unassigned_thread_count,
    };
  });
}
```

---

### `ThreadGroupsController` — two classes in one file

```typescript
import { Controller, Post, Get, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ProjectMemberGuard } from '../../common/guards/project-member.guard';
import { ProjectEditAccessGuard } from '../../common/guards/project-edit-access.guard';
import { ProjectOwnerOrAdminGuard } from '../../common/guards/project-owner-or-admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ThreadGroupsService } from './thread-groups.service';
import { CreateThreadGroupDto } from './dto/create-thread-group.dto';
import { UpdateThreadGroupDto } from './dto/update-thread-group.dto';

// ── Class 1: project-scoped routes ─────────────────────────────────────────
// Base path is 'projects/:projectId/thread-groups'.
// NestJS requires a separate @Controller() class — you cannot mix base paths.
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

// ── Class 2: direct thread-group routes ────────────────────────────────────
// Base path is 'thread-groups'.
// Only owner/admin can rename or delete groups — edit-access members cannot.
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
```

`ThreadGroupsModule`:

```typescript
@Module({
  imports:     [PrismaModule],
  providers:   [ThreadGroupsService],
  controllers: [ThreadGroupsProjectController, ThreadGroupsController],  // both classes
})
export class ThreadGroupsModule {}
```

### Stage 6 gate ✋

- [ ] `deleteThreadGroup` runs `thread.updateMany` before deleting the group (in transaction)
- [ ] `listThreadGroups` does not use a loop — aggregates computed in queries
- [ ] Two separate `@Controller()` classes in `thread-groups.controller.ts`
- [ ] Both classes listed in `ThreadGroupsModule.controllers`
- [ ] `npx tsc --noEmit` → exits 0

---

# ━━━ STAGE 7 — TESTS ━━━

Write unit tests for all new service methods. Follow the exact patterns from
`src/modules/auth/auth.service.spec.ts` and the guard `*.spec.ts` files.

### Mock setup

```typescript
const mockPrismaService = {
  project: {
    findFirst:  jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    delete:     jest.fn(),
  },
  projectMember: {
    findUnique:  jest.fn(),
    findFirst:   jest.fn(),
    findMany:    jest.fn(),
    upsert:      jest.fn(),
    update:      jest.fn(),
    delete:      jest.fn(),
    createMany:  jest.fn(),
  },
  projectCustomProperty: {
    findMany:   jest.fn(),
    findFirst:  jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    delete:     jest.fn(),
  },
  threadPropertyValue: {
    deleteMany: jest.fn(),
  },
  threadGroup: {
    findMany:   jest.fn(),
    findFirst:  jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    delete:     jest.fn(),
  },
  thread: {
    updateMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findMany:   jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  // Executes callback synchronously so assertions work without real transactions
  $transaction: jest.fn((fn) => fn(mockPrismaService)),
  $queryRaw:    jest.fn().mockResolvedValue([]),
};
```

Rules: `jest.clearAllMocks()` in `beforeEach`. Every test is isolated.
Descriptive test names that describe the exact scenario and expected outcome.

---

### Required: `projects.service.spec.ts`

**`listProjects()`**
- admin role: query does NOT include a membership join filter
- team_member role: query includes `members: { some: { user_id: user.sub } }`
- `search` param: `OR` clause with ILIKE on both `name` and `brief`
- `status` param provided: applied in where clause as-is
- no `status` param: `status: { not: 'archived' }` is applied automatically
- `fathom_links.length > 0` → `linked_sources.fathom` is `true`
- `fathom_links` empty array → `linked_sources.fathom` is `false`
- returns `monthly_cost` formatted as `"0.00"` when no cost rows returned

**`createProject()`**
- throws `BadRequestException` when a member user_id does not exist
- throws `BadRequestException` when a member's workspace_id differs from caller's
- uses `$transaction`
- creates project with `owner_id = user.sub`
- inserts project_members with `assigned_by = user.sub`
- `fathom_links` defaults to `[]` when not in DTO
- writes audit log: `event_type = 'project_created'`

**`updateProject()`**
- returns early with no DB write when DTO has no fields set
- only includes defined fields in `data` object (undefined is omitted, null is included)
- writes audit log listing keys of fields that actually changed
- `fathom_links` plural correctly included when provided

**`archiveProject()`**
- sets `status = 'archived'`
- writes audit log with `event_type = 'project_archived'`

**`deleteProject()`**
- throws `BadRequestException` when `confirmHeader` is `undefined`
- throws `BadRequestException` when `confirmHeader` is `'false'`
- throws `BadRequestException` when `confirmHeader` is empty string `''`
- deletes project and writes audit log when `confirmHeader === 'true'`

**`addMember()`**
- throws `BadRequestException` when target user does not exist
- throws `BadRequestException` when target user is in a different workspace
- calls `projectMember.upsert` with `project_id_user_id` compound key (not individual fields)
- on create path: `assigned_by` is set to `user.sub`

**`updateMemberAccess()`**
- throws `NotFoundException` when membership row does not exist

**`removeMember()`**
- throws `ForbiddenException('Transfer ownership before removing the project owner')`
  when `userId === attachedProject.owner_id`
- deletes membership when `userId !== owner_id`
- returns `{ message: 'Member removed' }`

**`transferOwnership()`**
- throws `BadRequestException` when new owner does not exist
- throws `BadRequestException` when new owner is in a different workspace
- updates `owner_id` on the project
- writes audit log with both `old_owner_id` and `new_owner_id`

**`createCustomProperty()`**
- throws `BadRequestException` for `property_type = 'single_select'` with `options = undefined`
- throws `BadRequestException` for `property_type = 'multi_select'` with `options = []`
- inserts with `created_by = user.sub` and `workspace_id = user.workspace_id`

**`deleteCustomProperty()`**
- throws `NotFoundException` when property is not found
- calls `threadPropertyValue.deleteMany` before `projectCustomProperty.delete`
- wraps both deletes in `$transaction`

---

### Required: `thread-groups.service.spec.ts`

**`createThreadGroup()`**
- inserts with `created_by = user.sub` and `workspace_id = user.workspace_id`
- includes `project_id` from params

**`listThreadGroups()`**
- returns groups ordered by `sort_order`
- each group has `total_cost` and `thread_count` in the response
- `total_cost` is formatted as a string with 2 decimal places

**`updateThreadGroup()`**
- throws `NotFoundException` when group not found in caller's workspace
- only includes defined fields in `data` object

**`deleteThreadGroup()`**
- throws `NotFoundException` when group not found before the transaction
- calls `thread.updateMany` with `{ group_id: null }` inside the transaction
- deletes the group row inside the same transaction
- returns `{ message: 'Group deleted', unassigned_thread_count: N }`
  where N equals the mocked `updateMany.count`

---

### Run tests for this stage

```bash
npx jest --testPathPattern="projects|thread-groups" --coverage --verbose
```

Fix every failure before Stage 8. Red tests mean Stage 8 does not start.

### Stage 7 gate ✋

- [ ] All tests in `projects.service.spec.ts` pass
- [ ] All tests in `thread-groups.service.spec.ts` pass
- [ ] Guard spec files updated in Stage 1 still pass
- [ ] `npx tsc --noEmit` → exits 0

---

# ━━━ STAGE 8 — FINAL VALIDATION ━━━

Run every command below in order. Report the output of each command.
All six must exit `0`. Do not mark Day 3 complete until every command is green.

### Command 1 — TypeScript
```bash
npx tsc --noEmit
```
Zero errors. Fix everything before continuing.

### Command 2 — Guard regression check
```bash
npx jest --testPathPattern="guards|workspace-scope" --verbose
```
All existing guard and helper tests must still pass.

### Command 3 — Existing module regression check
```bash
npx jest --testPathPattern="auth|api-keys|users|workspace" --verbose
```
No regressions in anything from Days 1 and 2.

### Command 4 — New module coverage
```bash
npx jest --testPathPattern="projects|thread-groups" --coverage --verbose
```
All tests green. Service file statement coverage ≥ 80%.

### Command 5 — Full suite
```bash
npx jest --coverage --verbose
```
Entire suite green. Zero regressions.

### Command 6 — Production build
```bash
npx nest build
```
Clean build. No errors. No warnings.

---

## Day 3 Completion Checklist

Mark every item before closing the prompt:

```
[ ] GET  /projects → single DB query; all filters applied; thread_count, monthly_cost, member_count correct
[ ] POST /projects → cross-workspace validation; transaction used; audit log written
[ ] GET  /projects/:id → members and custom_properties included in response
[ ] PATCH /projects/:id → undefined-checking; only changed fields in audit log
[ ] POST /projects/:id/archive → status = 'archived'; excluded from default list
[ ] DELETE /projects/:id → X-Confirm-Delete: true header required; hard delete
[ ] POST /projects/:id/members → upsert via project_id_user_id compound key
[ ] PATCH /projects/:id/members/:userId → NotFoundException when membership absent
[ ] DELETE /projects/:id/members/:userId → ForbiddenException when removing project owner
[ ] PATCH /projects/:id/transfer-ownership → audit log with old + new owner IDs
[ ] GET  /projects/:id/custom-properties → ordered by sort_order ASC
[ ] POST /projects/:id/custom-properties → BadRequestException for select types without options
[ ] PATCH /projects/:id/custom-properties/:propId → thread_property_values untouched
[ ] DELETE /projects/:id/custom-properties/:propId → cascades in $transaction
[ ] POST /projects/:projectId/thread-groups → ProjectEditAccessGuard enforced
[ ] GET  /projects/:projectId/thread-groups → total_cost + thread_count in single query
[ ] PATCH /thread-groups/:id → ProjectOwnerOrAdminGuard; NotFoundException for missing group
[ ] DELETE /thread-groups/:id → threads unassigned (not deleted); count returned; transaction used
```

---

## Appendix — Pitfall Quick Reference

### Schema

| Wrong | Correct |
|-------|---------|
| `fathom_link: string` | `fathom_links: string[]` (plural, array) |
| `!!project.fathom_links` | `project.fathom_links.length > 0` |
| `where: { project_id, user_id }` on upsert | `where: { project_id_user_id: { project_id, user_id } }` |
| `import from '@prisma/client'` | `import from '../../generated/prisma/client'` |

### Guard and controller

| Wrong | Correct |
|-------|---------|
| Second `findFirst` after `ProjectOwnerOrAdminGuard` | Read from `(request as any).project` |
| One `@Controller()` class for thread-groups | Two classes: `ThreadGroupsProjectController` + `ThreadGroupsController` |
| Both controller classes not in `ThreadGroupsModule.controllers` | List both explicitly |
| Global registration of `ProjectMemberGuard` | Per-controller `@UseGuards()` only |

### Service logic

| Wrong | Correct |
|-------|---------|
| `if (dto.field != null)` in partial update | `if (dto.field !== undefined)` |
| Filtering archived projects in JS after fetch | `status: { not: 'archived' }` in Prisma `where` |
| Audit log in controller | Audit log in service method only |
| Multi-table write without transaction | `this.prisma.$transaction(async (tx) => { ... })` |
| `console.log` in service | `this.logger.log()` or `this.logger.error()` |
| Letting Prisma P2003 reach the caller | Validate cross-entity constraints in service before DB call |
