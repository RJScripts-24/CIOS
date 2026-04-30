# CIOS Backend — Day 3 Changes
**Date:** 30 April 2026
**Author:** Copilot / Engineering
**Status:** ✅ Complete & Tested

---

## Summary

Day 3 added the Projects module and Thread Groups module, along with the supporting DTOs, controller wiring, service logic, and unit tests. The implementation follows the workspace-isolated multi-tenant pattern used throughout the backend and includes audit logging, guard enforcement, transaction-safe writes, and full project/member/custom-property management.

One schema-driven adjustment was also made during implementation: `thread_groups.sort_order` is not present in the current Prisma schema, so the service and DTOs were aligned to the database model rather than returning a non-persistent field.

---

## Modules Added / Completed

### `src/modules/projects/`

Implemented the full Projects feature surface:

- `projects.controller.ts`
- `projects.service.ts`
- `projects.module.ts`
- DTOs for listing, creating, updating, membership changes, ownership transfer, and custom properties
- `project-response.interface.ts`

### `src/modules/thread-groups/`

Implemented the Thread Groups feature surface:

- `thread-groups.controller.ts`
- `thread-groups.service.ts`
- `thread-groups.module.ts`
- DTOs for create/update thread group

---

## Endpoints Created

### Projects Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/v1/projects` | Lists workspace projects with filtering, sorting, membership scoping, counts, and monthly cost aggregation. |
| POST | `/api/v1/projects` | Creates a project, optionally adds members, and writes an audit log. |
| GET | `/api/v1/projects/:id` | Returns full project details including members and custom properties. |
| PATCH | `/api/v1/projects/:id` | Updates only the fields explicitly sent in the request body. |
| POST | `/api/v1/projects/:id/archive` | Archives a project by setting `status = archived`. |
| DELETE | `/api/v1/projects/:id` | Hard deletes a project when the confirmation header is set. |
| POST | `/api/v1/projects/:id/members` | Adds or updates a project member using the compound unique key. |
| PATCH | `/api/v1/projects/:id/members/:userId` | Updates an existing member's access level. |
| DELETE | `/api/v1/projects/:id/members/:userId` | Removes a project member unless that member is the project owner. |
| PATCH | `/api/v1/projects/:id/transfer-ownership` | Transfers project ownership to another workspace member. |
| GET | `/api/v1/projects/:id/custom-properties` | Lists custom properties for a project. |
| POST | `/api/v1/projects/:id/custom-properties` | Creates a custom property for a project. |
| PATCH | `/api/v1/projects/:id/custom-properties/:propertyId` | Updates a custom property definition without deleting thread values. |
| DELETE | `/api/v1/projects/:id/custom-properties/:propertyId` | Deletes a custom property and its thread values in a transaction. |

### Thread Groups Endpoints

| Method | Path | What it does |
|---|---|---|
| POST | `/api/v1/projects/:projectId/thread-groups` | Creates a thread group within a project, guarded by project edit access. |
| GET | `/api/v1/projects/:projectId/thread-groups` | Lists thread groups for a project with thread counts and total cost aggregation. |
| PATCH | `/api/v1/thread-groups/:id` | Updates a thread group definition by ID. |
| DELETE | `/api/v1/thread-groups/:id` | Unassigns threads from the group and deletes the group in a transaction. |

---

## Endpoint Behavior Notes

### Projects

- All project queries are workspace-scoped.
- Non-admin users can only access projects they are members of.
- Project creation validates member workspace membership before writing.
- Multi-table writes use transactions.
- Audit log writes happen in the service layer.
- `fathom_links` is treated as a `TEXT[]` array, not a singular link field.
- `getProjectById` returns a normalized project response with nested members and custom properties.

### Thread Groups

- Thread groups are scoped to the workspace and parent project.
- `createThreadGroup` and `deleteThreadGroup` run with transaction-safe behavior where needed.
- `listThreadGroups` returns aggregate thread counts and total cost.
- `sort_order` was removed from the API surface because it is not present in the current Prisma schema.

---

## Validation Performed

### TypeScript

```bash
npx tsc --noEmit
```

Result: ✅ Passed

### Guard Regression Tests

```bash
npx jest --testPathPatterns="guards|workspace-scope" --verbose
```

Result: ✅ Passed

### Existing Module Regression Tests

```bash
npx jest --testPathPatterns="auth|api-keys|users|workspace" --verbose
```

Result: ✅ Passed

Notes:
- Workspace tests log one expected error about an invalid email `from` address during the mocked invite path.
- The suite still passes.

### New Module Tests

```bash
npx jest --testPathPatterns="projects|thread-groups" --coverage --verbose
```

Result: ✅ Passed

Summary:
- `projects.service.spec.ts`: 45 tests passed
- `thread-groups.service.spec.ts`: 11 tests passed

### Full Test Suite

```bash
npx jest --coverage --verbose
```

Result: ✅ Passed

Summary:
- 10 test suites passed
- 1 test suite skipped
- 129 tests passed
- 12 tests skipped

### Production Build

```bash
npx nest build
```

Result: ✅ Passed

---

## Notable Implementation Fixes Made During the Day

- Batched project member validation into a single `findMany` query.
- Switched project member inserts to `createMany`.
- Removed thread-group `sort_order` usage because the current schema drops that column.
- Removed an unused `ProjectEditAccessGuard` import from the Projects controller.
- Verified `getProjectById` includes members and custom properties and maps them through the shared response helper.

---

## Final Outcome

Day 3 delivered the core project management and thread group APIs with full test coverage for the new service logic, plus regression validation for the existing authentication, workspace, and guard behavior.