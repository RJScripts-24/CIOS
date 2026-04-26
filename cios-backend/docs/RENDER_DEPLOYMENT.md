# Render Deployment Guide

This backend is now configured for Render with:

- dynamic port binding (`PORT`)
- a public health endpoint (`GET /api/v1/healthz`)
- graceful shutdown hooks
- Prisma generate/build/migrate deploy flow in the deploy build step
- connection pool and timeout tuning via environment variables

## Option A: Blueprint (Recommended)

1. Push this repository to GitHub.
2. In Render, choose **New +** -> **Blueprint**.
3. Select this repository.
4. Render will detect `render.yaml` and prefill the service.
5. Set secret values in Render for all `sync: false` variables.

## Option B: Manual Web Service

Use these settings in Render:

- Environment: `Node`
- Build Command: `npm ci --include=dev && npm run render:build`
- Start Command: `npm run render:start`
- Health Check Path: `/api/v1/healthz`

## Required Environment Variables

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

## Optional Environment Variables

- `FRONTEND_URL`
- `DATABASE_SSL` (default `false`, set to `true` for hosted SSL Postgres)
- `DATABASE_POOL_MAX` (default `10`)
- `DATABASE_CONNECTION_TIMEOUT_MS` (default `10000`)
- `DATABASE_IDLE_TIMEOUT_MS` (default `30000`)
- `JWT_ACCESS_EXPIRES_IN` (default `15m`)
- `JWT_REFRESH_EXPIRES_IN` (default `7d`)

## Notes

- Migrations are executed during deploy build with `prisma migrate deploy`.
- If migration fails, deployment fails (safe by default).
- Do not commit real secrets in `.env`.
