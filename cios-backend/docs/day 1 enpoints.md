# CIOS Day 1 Endpoints

This document lists the API endpoints implemented or updated during Day 1 work.

Base path: /api/v1

## Auth

- POST /auth/register
  - Registers a user (invitation token supported via body or query token)
- POST /auth/login
  - Email/password login
- POST /auth/refresh
  - Refresh access token using refresh token
- POST /auth/logout
  - Revoke refresh token for the current user
- GET /auth/me
  - Returns user profile plus assigned_projects
- POST /auth/google
  - Exchanges Google authorization code for tokens and user profile

## Workspace (already present, verified during tests)

- POST /workspaces
  - Create workspace (admin only)
- POST /workspaces/:workspaceId/invite
  - Invite member by email (admin only)
- POST /workspaces/invitations/accept
  - Accept invitation (existing user)
- GET /workspaces/:workspaceId/members
  - List workspace members (admin only)
- GET /workspaces/:workspaceId/invitations/pending
  - List pending invitations (admin only)

## Notes

- All endpoints are scoped to the global prefix /api/v1.
- Project-scoped guards are applied per-controller, not globally.

## Test Results

Command executed:

npm run test -- --verbose 2>&1

Summary:

- Passed suites: 8
- Failed suites: 0
- Skipped suites: 1
- Passed tests: 68
- Failed tests: 0
- Skipped tests: 12

Passed suites:

- src/common/helpers/workspace-scope.helper.spec.ts
- src/common/guards/project-edit-access.guard.spec.ts
- src/common/guards/project-member.guard.spec.ts
- src/common/guards/project-owner-or-admin.guard.spec.ts
- src/modules/auth/auth.service.getme.spec.ts
- src/modules/workspace/workspace.service.spec.ts
- src/modules/auth/auth.service.spec.ts
- src/modules/auth/auth.service.google.spec.ts

Skipped suites:

- src/modules/workspace/workspace.e2e.spec.ts
  - Skipped because it requires RUN_WORKSPACE_E2E=true and real DATABASE_URL and RESEND_API_KEY
