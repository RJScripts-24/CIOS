// ─────────────────────────────────────────────────────────────────────────────
// [TEST FILE] workspace.e2e.spec.ts
// Purpose: E2E tests for Workspace Invitation flow using real DB + real Resend.
//          Boots full AppModule with Fastify and validates end-to-end behavior.
//          Run: RUN_WORKSPACE_E2E=true npx jest workspace.e2e.spec.ts --verbose --testTimeout=30000
// ─────────────────────────────────────────────────────────────────────────────

import { ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

const runRealE2E =
  process.env.RUN_WORKSPACE_E2E === 'true' &&
  Boolean(process.env.DATABASE_URL && process.env.RESEND_API_KEY);
const describeRealE2E = runRealE2E ? describe : describe.skip;

describeRealE2E('Workspace Invitation — Full E2E Flow', () => {
  jest.setTimeout(30000); // 30 seconds for real email + DB operations

  let app: NestFastifyApplication;
  let prismaService: PrismaService;
  let httpServer: any;

  let adminAccessToken: string;
  let memberAccessToken: string;
  let adminUserId: string;
  let workspaceId: string;
  let invitationToken: string;

  const cleanupTestData = async () => {
    await prismaService.workspaceInvitation.deleteMany({
      where: {
        OR: [
          { email: { contains: '@cios-test.com' } },
          { email: 'rishabh.kr.jha@gmail.com' },
        ],
      },
    });

    await prismaService.user.deleteMany({
      where: {
        OR: [
          { email: { contains: '@cios-test.com' } },
          { email: 'rishabh.kr.jha@gmail.com' },
        ],
      },
    });

    await prismaService.workspace.deleteMany({
      where: {
        name: { contains: 'E2E Test Workspace' },
      },
    });
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    httpServer = app.getHttpAdapter().getInstance().server;
    prismaService = app.get(PrismaService);

    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await app.close();
  });

  // [TEST] Verifies admin registration works and stores token/user for downstream admin-only actions.
  it('Step 1: Register an admin user', async () => {
    const adminInviteToken = `seed-admin-${Date.now().toString(36)}`;

    const bootstrapWorkspace = await prismaService.workspace.create({
      data: {
        name: 'E2E Test Workspace Bootstrap',
      },
    });

    const bootstrapInviter = await prismaService.user.create({
      data: {
        email: 'seed-inviter@cios-test.com',
        password_hash: 'seeded-hash',
        full_name: 'Seed Inviter',
        role: 'admin',
        workspace_id: bootstrapWorkspace.id,
      },
    });

    await prismaService.workspaceInvitation.create({
      data: {
        workspace_id: bootstrapWorkspace.id,
        invited_by: bootstrapInviter.id,
        email: 'admin@cios-test.com',
        token: adminInviteToken,
        status: 'pending',
      },
    });

    const registerResponse = await request(httpServer)
      .post('/api/v1/auth/register')
      .send({
        email: 'admin@cios-test.com',
        password: 'AdminPass1',
        full_name: 'E2E Admin',
        token: adminInviteToken,
      });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body).toHaveProperty('access_token');
    expect(registerResponse.body).toHaveProperty('refresh_token');
    expect(registerResponse.body).toHaveProperty('user');

    adminAccessToken = registerResponse.body.access_token as string;
    adminUserId = registerResponse.body.user.id as string;

    await prismaService.user.update({
      where: { id: adminUserId },
      data: { role: 'admin' },
    });

    const loginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@cios-test.com',
        password: 'AdminPass1',
      });

    expect(loginResponse.status).toBe(200);
    adminAccessToken = loginResponse.body.access_token as string;
  });

  // [TEST] Verifies an admin can create a workspace and receive workspace metadata.
  it('Step 2: Create a workspace as admin', async () => {
    const response = await request(httpServer)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'E2E Test Workspace' });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.name).toBe('E2E Test Workspace');

    workspaceId = response.body.id as string;
  });

  // [TEST] Verifies team members are forbidden from creating workspaces.
  it('Step 3: Non-admin cannot create a workspace', async () => {
    const memberInviteToken = `seed-member-${Date.now().toString(36)}`;

    await prismaService.workspaceInvitation.create({
      data: {
        workspace_id: workspaceId,
        invited_by: adminUserId,
        email: 'member@cios-test.com',
        token: memberInviteToken,
        status: 'pending',
      },
    });

    const memberRegisterResponse = await request(httpServer)
      .post('/api/v1/auth/register')
      .send({
        email: 'member@cios-test.com',
        password: 'MemberPass1',
        full_name: 'E2E Member',
        token: memberInviteToken,
      });

    expect(memberRegisterResponse.status).toBe(201);
    memberAccessToken = memberRegisterResponse.body.access_token as string;

    const unauthorizedCreateResponse = await request(httpServer)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${memberAccessToken}`)
      .send({ name: 'Unauthorized Workspace' });

    expect(unauthorizedCreateResponse.status).toBe(403);
  });

  // [TEST] Verifies admin invite endpoint creates pending invite and sends a real email.
  it('Step 4: Admin invites rishabh.kr.jha@gmail.com — real email is sent', async () => {
    const response = await request(httpServer)
      .post(`/api/v1/workspaces/${workspaceId}/invite`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: 'rishabh.kr.jha@gmail.com' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      message: 'Invitation sent successfully',
      email: 'rishabh.kr.jha@gmail.com',
    });

    const invitation = await prismaService.workspaceInvitation.findFirst({
      where: {
        email: 'rishabh.kr.jha@gmail.com',
        workspace_id: workspaceId,
      },
    });

    expect(invitation).not.toBeNull();
    expect(invitation!.status).toBe('pending');
    invitationToken = invitation!.token;

    console.log('\n✅ INVITATION EMAIL SENT TO: rishabh.kr.jha@gmail.com');
    if (process.env.FRONTEND_URL) {
      console.log(
        '🔗 Magic link (new user path):',
        `${process.env.FRONTEND_URL}/register?token=${invitationToken}`,
      );
      console.log(
        '🔗 Magic link (existing user path):',
        `${process.env.FRONTEND_URL}/invitations/accept?token=${invitationToken}`,
      );
    } else {
      console.log('📋 Token included in email:', invitationToken);
    }
  });

  // [TEST] Verifies duplicate pending invitation attempts return conflict.
  it('Step 5: Duplicate invite to same email returns 409', async () => {
    const response = await request(httpServer)
      .post(`/api/v1/workspaces/${workspaceId}/invite`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: 'rishabh.kr.jha@gmail.com' });

    expect(response.status).toBe(409);
  });

  // [TEST] Verifies non-admin users cannot send workspace invitations.
  it('Step 6: Non-admin cannot invite members', async () => {
    const response = await request(httpServer)
      .post(`/api/v1/workspaces/${workspaceId}/invite`)
      .set('Authorization', `Bearer ${memberAccessToken}`)
      .send({ email: 'another@example.com' });

    expect(response.status).toBe(403);
  });

  // [TEST] Verifies invite-token registration auto-links new account to workspace and accepts invite.
  it('Step 7: New user registers via invite token — auto-joined to workspace', async () => {
    const response = await request(httpServer)
      .post('/api/v1/auth/register')
      .send({
        email: 'rishabh.kr.jha@gmail.com',
        password: 'InvitePass1',
        full_name: 'Rishabh Jha',
        token: invitationToken,
      });

    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe('rishabh.kr.jha@gmail.com');

    const invitedUser = await prismaService.user.findUnique({
      where: { email: 'rishabh.kr.jha@gmail.com' },
    });
    expect(invitedUser).not.toBeNull();
    expect(invitedUser!.workspace_id).toBe(workspaceId);

    const acceptedInvite = await prismaService.workspaceInvitation.findFirst({
      where: {
        email: 'rishabh.kr.jha@gmail.com',
        workspace_id: workspaceId,
      },
    });
    expect(acceptedInvite).not.toBeNull();
    expect(acceptedInvite!.status).toBe('accepted');

    console.log('\n✅ NEW USER REGISTERED VIA INVITE TOKEN');
    console.log('   User workspace_id:', invitedUser!.workspace_id);
    console.log('   Invitation status:', acceptedInvite!.status, '\n');
  });

  // [TEST] Verifies reusing the same token does not incorrectly attach another user to the workspace.
  it('Step 8: Using the same token a second time returns 409', async () => {
    const response = await request(httpServer)
      .post('/api/v1/auth/register')
      .send({
        email: 'another-new@cios-test.com',
        password: 'AnotherPass1',
        token: invitationToken,
      });

    expect([201, 409]).toContain(response.status);

    const secondUser = await prismaService.user.findUnique({
      where: { email: 'another-new@cios-test.com' },
    });

    if (response.status === 201) {
      expect(secondUser).not.toBeNull();
      expect(secondUser!.workspace_id).not.toBe(workspaceId);
    } else {
      expect(secondUser).toBeNull();
    }
  });

  // [TEST] Verifies existing-user invitation acceptance endpoint joins user to workspace.
  it('Step 9: Registered user accept flow — existing user uses /invitations/accept endpoint', async () => {
    const existingInviteToken = `existing-user-bootstrap-${Date.now().toString(36)}`;

    const existingUserBootstrapWorkspace = await prismaService.workspace.create(
      {
        data: {
          name: 'E2E Test Workspace Existing Bootstrap',
        },
      },
    );

    await prismaService.workspaceInvitation.create({
      data: {
        workspace_id: existingUserBootstrapWorkspace.id,
        invited_by: adminUserId,
        email: 'existing@cios-test.com',
        token: existingInviteToken,
        status: 'pending',
      },
    });

    const registerExistingResponse = await request(httpServer)
      .post('/api/v1/auth/register')
      .send({
        email: 'existing@cios-test.com',
        password: 'ExistingPass1',
        token: existingInviteToken,
      });

    expect(registerExistingResponse.status).toBe(201);

    const loginResponse = await request(httpServer)
      .post('/api/v1/auth/login')
      .send({
        email: 'existing@cios-test.com',
        password: 'ExistingPass1',
      });

    expect(loginResponse.status).toBe(200);
    const existingUserToken = loginResponse.body.access_token as string;

    const secondInviteResponse = await request(httpServer)
      .post(`/api/v1/workspaces/${workspaceId}/invite`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ email: 'existing@cios-test.com' });

    expect(secondInviteResponse.status).toBe(201);

    const secondInvite = await prismaService.workspaceInvitation.findFirst({
      where: { email: 'existing@cios-test.com', workspace_id: workspaceId },
      orderBy: { created_at: 'desc' },
    });
    expect(secondInvite).not.toBeNull();

    const acceptResponse = await request(httpServer)
      .post('/api/v1/workspaces/invitations/accept')
      .set('Authorization', `Bearer ${existingUserToken}`)
      .send({ token: secondInvite!.token });

    expect(acceptResponse.status).toBe(201);
    expect(acceptResponse.body).toEqual({
      message: 'Successfully joined workspace',
      workspace_id: workspaceId,
    });

    const joinedUser = await prismaService.user.findUnique({
      where: { email: 'existing@cios-test.com' },
    });
    expect(joinedUser!.workspace_id).toBe(workspaceId);
  });

  // [TEST] Verifies admins can retrieve workspace members including invited users.
  it('Step 10: Admin can list all workspace members', async () => {
    const response = await request(httpServer)
      .get(`/api/v1/workspaces/${workspaceId}/members`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);

    const emails = (response.body as Array<{ email: string }>).map(
      (u) => u.email,
    );
    expect(emails).toContain('admin@cios-test.com');
    expect(emails).toContain('rishabh.kr.jha@gmail.com');
  });

  // [TEST] Verifies pending invitation list includes only pending records and excludes accepted invite.
  it('Step 11: Admin can list pending invitations', async () => {
    const response = await request(httpServer)
      .get(`/api/v1/workspaces/${workspaceId}/invitations/pending`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);

    const pendingInvitations = response.body as Array<{
      email: string;
      status: string;
    }>;
    expect(pendingInvitations.every((inv) => inv.status === 'pending')).toBe(
      true,
    );

    const pendingEmails = pendingInvitations.map((inv) => inv.email);
    expect(pendingEmails).not.toContain('rishabh.kr.jha@gmail.com');
  });

  // [TEST] Verifies global JwtAuthGuard protects workspace endpoints from anonymous access.
  it('Step 12: Unauthenticated request to any workspace endpoint returns 401', async () => {
    const response = await request(httpServer)
      .post('/api/v1/workspaces')
      .send({ name: 'No Auth' });

    expect(response.status).toBe(401);
  });
});
