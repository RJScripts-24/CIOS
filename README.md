# CIOS Backend

**Client Intelligence Operating System** — NestJS backend API.

## Stack
- **Framework:** NestJS v11 with Fastify adapter
- **Database:** PostgreSQL via Prisma v7 (pg adapter)
- **Auth:** JWT (access + refresh tokens), bcrypt-12, role-based access control

## Setup

```bash
cp .env.example .env
# Fill in your values in .env

npm install
npx prisma migrate dev
npm run start:dev
```

## Environment Variables

See `.env.example` for all required variables.

## API

All routes are prefixed: `http://localhost:3000/api/v1`

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /auth/register | Public | Create account |
| POST | /auth/login | Public | Login |
| POST | /auth/refresh | Public | Rotate refresh token |
| POST | /auth/logout | 🔒 JWT | Logout |
| GET | /auth/me | 🔒 JWT | Get current user |

## Tests

```bash
npm test              # Unit tests
npm run test:cov      # Coverage report
```

## Docs

See `docs/CHANGELOG.md` for a full history of changes.
