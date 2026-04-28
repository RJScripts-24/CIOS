# CIOS Backend - Day 1 Changes (2026-04-28)

## Overview

This document captures the Day 1 implementation changes for shared infrastructure, Google OAuth completion, and the upgraded /auth/me response. It also includes test results and notes about skipped tests, why they are skipped, and how to run them.

## Scope Delivered

1) Shared infrastructure under src/common
2) Global RolesGuard registration
3) Google OAuth login flow for /auth/google
4) /auth/me response includes assigned_projects
5) Prisma schema update for google_id and nullable workspace_id
6) Test coverage for new guards, helpers, and AuthService additions

## Code Changes by Area

### 1) Shared Infrastructure (src/common)

Added common guard, helper, and request typing utilities:

- src/common/interfaces/request-with-user.interface.ts
  - FastifyRequest augmentation for user, projectMembership, and project
- src/common/helpers/workspace-scope.helper.ts
  - workspaceScope helper that enforces workspace_id presence
- src/common/guards/project-member.guard.ts
  - Ensures the requesting user is a member of a project in their workspace
- src/common/guards/project-edit-access.guard.ts
  - Requires edit access level on resolved projectMembership
- src/common/guards/project-owner-or-admin.guard.ts
  - Allows only project owner or admin, attaches project to request

Associated unit tests:

- src/common/helpers/workspace-scope.helper.spec.ts
- src/common/guards/project-member.guard.spec.ts
- src/common/guards/project-edit-access.guard.spec.ts
- src/common/guards/project-owner-or-admin.guard.spec.ts

### 2) Global RolesGuard Registration

- src/app.module.ts
  - Added RolesGuard as the second global APP_GUARD after JwtAuthGuard

### 3) Google OAuth Login

Added support for POST /auth/google using an OAuth authorization code:

- src/modules/auth/strategies/google.strategy.ts
  - Passport strategy registered with client ID/secret/callback URL
- src/modules/auth/dto/google-auth.dto.ts
  - DTO for incoming { code }
- src/modules/auth/auth.service.ts
  - Added googleLogin() method that exchanges the code, decodes ID token, and upserts user
- src/modules/auth/auth.controller.ts
  - Added POST /auth/google endpoint
- src/modules/auth/auth.module.ts
  - Registered GoogleStrategy provider

Associated unit tests:

- src/modules/auth/auth.service.google.spec.ts

### 4) /auth/me Upgrade

- src/modules/auth/auth.service.ts
  - getMe() now returns assigned_projects derived from projectMember joins

Associated unit tests:

- src/modules/auth/auth.service.getme.spec.ts
- Updated mocks in src/modules/auth/auth.service.spec.ts

### 5) Prisma Schema and Migrations

- prisma/schema.prisma
  - Added User.google_id String? @unique
  - Made User.workspace_id nullable and workspace relation optional

New migrations created and applied:

- prisma/migrations/20260428124432_add_google_id_to_users/migration.sql
- prisma/migrations/20260428124642_make_user_workspace_nullable/migration.sql

### 6) Environment Variables

- .env.example
  - Added GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL

## Test Results

Command executed:

npm run test -- --verbose 2>&1

Summary (from the test run output):

- Suites: 8 passed, 1 skipped, 9 total
- Tests: 68 passed, 12 skipped, 80 total

Passing suites included:

- src/common/helpers/workspace-scope.helper.spec.ts
- src/common/guards/project-member.guard.spec.ts
- src/common/guards/project-edit-access.guard.spec.ts
- src/common/guards/project-owner-or-admin.guard.spec.ts
- src/modules/auth/auth.service.google.spec.ts
- src/modules/auth/auth.service.getme.spec.ts
- src/modules/auth/auth.service.spec.ts
- src/modules/workspace/workspace.service.spec.ts

## Skipped Tests (Do Not Ignore)

The skipped suite is intentional:

- src/modules/workspace/workspace.e2e.spec.ts

Why it is skipped:

- It is gated behind RUN_WORKSPACE_E2E=true and requires real DATABASE_URL and RESEND_API_KEY.
- This avoids accidentally running destructive E2E flows or sending real emails during normal unit test runs.

How to run the skipped tests:

- Ensure the environment variables are set:
  - RUN_WORKSPACE_E2E=true
  - DATABASE_URL (real database)
  - RESEND_API_KEY (real provider key)
  - RESEND_FROM_EMAIL (verified sender domain)
- Then run:
  - npx jest src/modules/workspace/workspace.e2e.spec.ts --runInBand --testTimeout=30000

How to tackle keeping them unskipped in CI:

- Option A: Use a dedicated CI job with ephemeral database and a Resend sandbox account.
- Option B: Mock Resend in E2E and use a seeded local DB, but this becomes an integration test rather than a true E2E.
- Option C: Use a nightly pipeline that sets RUN_WORKSPACE_E2E=true with real secrets.

## Commands Executed

- npm install passport-google-oauth20
- npm install --save-dev @types/passport-google-oauth20
- npx prisma migrate dev --name add_google_id_to_users
- npx prisma migrate dev --name make_user_workspace_nullable
- npm run prisma:generate
- npm run build
- npm run test -- --verbose 2>&1

## Notes and Constraints

- JwtAuthGuard remains the first global guard; RolesGuard is the second.
- Common project guards are not global and must be applied per-controller.
- Google OAuth uses authorization code exchange and ID token payload decoding.
- workspace_id is now nullable for SSO flows; existing invite flow still works.
- Prisma client path remains src/generated/prisma.
