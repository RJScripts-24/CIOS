# CIOS Backend — Change Log

## Auth Module Implementation
**Date:** 22 April 2026

**Status:** ✅ Complete & Tested

---

## Summary of Changes

This document records all changes made to the CIOS backend codebase to implement the Authentication & Role-Based Access Control system (PRD Feature F1).

---

## 1. Database Schema Changes

### New File: `prisma/schema.prisma`
Replaced the placeholder `User` model with the full production schema.

**New `UserRole` enum:**
```
admin | project_owner | team_member
```

**New `users` table:**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | gen_random_uuid() |
| workspace_id | UUID (nullable) | Future FK to workspaces |
| email | TEXT UNIQUE NOT NULL | Login identifier, normalised to lowercase |
| password_hash | TEXT (nullable) | Bcrypt hashed (rounds=12). Null for SSO users |
| full_name | TEXT (nullable) | Display name |
| avatar_url | TEXT (nullable) | Profile image |
| role | UserRole NOT NULL | Default: team_member |
| is_active | BOOLEAN | Default: true. Checked on every authenticated request |
| default_model | TEXT (nullable) | User's AI model preference |
| view_preferences | JSONB | Default: {}. Stores UI sort/group/filter state |
| created_at | TIMESTAMP | Auto-set |
| updated_at | TIMESTAMP | Auto-updated |

**New `refresh_tokens` table:**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | gen_random_uuid() |
| user_id | UUID FK | CASCADE delete when user deleted |
| token_hash | TEXT UNIQUE | Hashed refresh token — never stored in plaintext |
| expires_at | TIMESTAMP | Derived from JWT_REFRESH_EXPIRES_IN env var |
| created_at | TIMESTAMP | Auto-set |
| is_revoked | BOOLEAN | Default: false. Set true on logout or rotation |

### New Migration
`prisma/migrations/20260421185014_add_users_and_refresh_tokens/migration.sql`

---

## 2. New Files Created

### `src/modules/auth/` — Complete Auth Module

```
src/modules/auth/
├── auth.module.ts              — NestJS module wiring
├── auth.controller.ts          — Route handlers for all 5 endpoints
├── auth.service.ts             — Business logic, token issuance
├── auth.service.spec.ts        — 10 unit tests (all mocked)
├── decorators/
│   ├── current-user.decorator.ts  — Extracts user from Fastify request
│   ├── public.decorator.ts        — @Public() bypasses global guard
│   └── roles.decorator.ts         — @Roles() for RBAC
├── dto/
│   ├── register.dto.ts            — Email, password (complexity), optional name
│   ├── login.dto.ts               — Email, password
│   └── refresh-token.dto.ts       — refresh_token string
├── guards/
│   ├── jwt-auth.guard.ts          — JWT guard with @Public() bypass
│   └── roles.guard.ts             — RBAC guard using @Roles() decorator
├── interfaces/
│   ├── auth-response.interface.ts — Token pair + user shape
│   └── jwt-payload.interface.ts   — JWT claims: sub, email, role, workspace_id
└── strategies/
    ├── jwt.strategy.ts            — Validates access token, checks is_active
    └── refresh.strategy.ts        — Validates refresh token from request body
```

### `.env.example`
Documents all required environment variables.

---

## 3. Modified Files

### `src/app.module.ts`
- Added `ConfigModule.forRoot({ isGlobal: true })` — makes env vars available everywhere
- Added `AuthModule` import
- Registered `JwtAuthGuard` as a global `APP_GUARD` — all routes require authentication by default; only routes decorated with `@Public()` are exempt

### `src/app.controller.ts`
- Added `@Public()` decorator to the health check `GET /` route so it remains accessible without a token

### `src/main.ts`
- Added global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true` — rejects any unknown fields and auto-validates DTOs
- Added `app.setGlobalPrefix('api/v1')` — all routes are prefixed

---

## 4. API Endpoints

Base URL: `http://localhost:3000/api/v1`

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| POST | /auth/register | ❌ Public | Create new user. Returns token pair + user object |
| POST | /auth/login | ❌ Public | Login. Returns token pair + user object |
| POST | /auth/refresh | ❌ Public | Rotate refresh token. Returns new token pair |
| POST | /auth/logout | ✅ JWT | Revoke current refresh token |
| GET | /auth/me | ✅ JWT | Get authenticated user's profile |

### Request/Response Examples

**Register — POST /api/v1/auth/register**
```json
// Request body
{
  "email": "user@example.com",
  "password": "SecurePass1",
  "full_name": "Jane Doe"
}

// Response (201)
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "full_name": "Jane Doe",
    "role": "team_member",
    "avatar_url": null,
    "default_model": null
  }
}
```

**Login — POST /api/v1/auth/login**
```json
// Request body
{ "email": "user@example.com", "password": "SecurePass1" }

// Response (200) — same shape as register
```

**Me — GET /api/v1/auth/me**
```
Authorization: Bearer <access_token>

// Response (200)
{
  "id": "uuid",
  "email": "user@example.com",
  "full_name": "Jane Doe",
  "role": "team_member",
  "avatar_url": null,
  "default_model": null,
  "view_preferences": {},
  "workspace_id": null,
  "is_active": true,
  "created_at": "2026-04-22T..."
}
```

---

## 5. Security Implementation

| Requirement | Implementation |
|-------------|----------------|
| Password hashing | bcrypt with 12 rounds (never reducible) |
| Token storage | Refresh tokens stored as bcrypt hashes — never plaintext |
| Token rotation | Every `/refresh` call revokes the old token and issues a new pair |
| Timing-attack protection | Bcrypt hash runs even when user is not found during login |
| Global route protection | `APP_GUARD` — all routes require JWT unless `@Public()` |
| Per-request `is_active` check | `JwtStrategy.validate()` checks DB on every request |
| DTO validation | `whitelist: true` strips unknown fields, `forbidNonWhitelisted` rejects them |
| Password complexity | Min 8 chars, max 72 chars, requires uppercase + lowercase + digit |
| Email normalisation | Lowercased and trimmed before storing or querying |

---

## 6. Environment Variables

```env
DATABASE_URL=postgresql://user:password@localhost:5432/cios
JWT_ACCESS_SECRET=<min 32 chars, random>
JWT_REFRESH_SECRET=<min 32 chars, random, different from access>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
SESSION_IDLE_TIMEOUT_MS=14400000
```

---

## 7. Test Results

> Captured: 22 April 2026

```
> cios@0.0.1 test
> jest --verbose

node.exe : PASS src/modules/auth/auth.service.spec.ts
At line:1 char:1
+ & "C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (PASS src/module...service.spec.ts 
   :String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
  AuthService
    register()
      ΓêÜ should throw ConflictException if email already exists (72 ms)
      ΓêÜ should create a new user and return tokens + user (14 ms)
      ΓêÜ should normalise email to lowercase (13 ms)
    login()
      ΓêÜ should throw UnauthorizedException if user not found (9 ms)
      ΓêÜ should throw UnauthorizedException if password is wrong (8 ms)
      ΓêÜ should throw UnauthorizedException if user is inactive (13 ms)
      ΓêÜ should return tokens and user on valid credentials (5 ms)
    logout()
      ΓêÜ should silently succeed even if token not found (7 ms)
    getMe()
      ΓêÜ should throw NotFoundException if user not found (9 ms)
      ΓêÜ should return user data if found (4 ms)

Test Suites: 1 passed, 1 total
Tests:       10 passed, 10 total
Snapshots:   0 total
Time:        2.95 s, estimated 3 s
Ran all test suites.


========== TypeScript Compile Check ==========


[TS Check complete]
```

---

## 8. Dependencies Added

**Production:**
- `@nestjs/jwt` — JWT signing and verification
- `@nestjs/passport` — Passport.js integration for NestJS
- `@nestjs/config` — ConfigModule for env var management
- `passport` — Authentication middleware
- `passport-jwt` — JWT Passport strategy
- `passport-local` — Local Passport strategy
- `bcrypt` — Password hashing
- `class-validator` — DTO field validation
- `class-transformer` — DTO transformation

**Dev:**
- `@types/bcrypt`
- `@types/passport-jwt`
- `@types/passport-local`

---

## 9. What Was NOT Built (Per PRD Phase 1 Spec)

As per PRD Section 8.8 "What NOT to Build in Phase 1":
- Google SSO (password_hash is nullable to support it in future; OAuth flow deferred)
- Email verification on signup (deferred to Phase 2)
- Password reset flow (deferred to Phase 2)
- Session idle-timeout enforcement (SESSION_IDLE_TIMEOUT_MS env var is documented for future frontend implementation)

---

*Document generated: 22 April 2026*
*CIOS PRD v3.0 — Feature F1: Authentication & Role-Based Access Control*
