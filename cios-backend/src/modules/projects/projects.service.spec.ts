import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectsService } from './projects.service';

const mockUser = {
  sub: 'user-1',
  email: 'user@example.com',
  role: 'team_member',
  workspace_id: 'ws-1',
};

const mockAdmin = {
  sub: 'admin-1',
  email: 'admin@example.com',
  role: 'admin',
  workspace_id: 'ws-1',
};

const projectDetailRecord = {
  id: 'project-1',
  name: 'Project One',
  type: 'client',
  status: 'active',
  brief: 'Brief text',
  system_instructions: 'Do this',
  default_model: 'gpt-4o',
  clickup_link: 'https://clickup',
  slack_channel_link: null,
  fathom_links: ['https://fathom'],
  vault_drive_link: null,
  created_at: new Date('2026-04-01T00:00:00Z'),
  updated_at: new Date('2026-04-01T00:00:00Z'),
  owner: { id: 'owner-1', full_name: 'Owner Name', avatar_url: null },
  project_members: [
    {
      id: 'pm-1',
      project_id: 'project-1',
      user_id: 'user-1',
      workspace_id: 'ws-1',
      access_level: 'edit',
      assigned_by: 'owner-1',
      assigned_at: new Date('2026-04-01T00:00:00Z'),
      user: {
        id: 'user-1',
        full_name: 'Test User',
        email: 'user@example.com',
        avatar_url: null,
      },
    },
  ],
  project_custom_properties: [
    {
      id: 'prop-1',
      name: 'Priority',
      property_type: 'single_select',
      options: [{ value: 'high', label: 'High' }],
      sort_order: 0,
    },
  ],
};

const mockPrismaService = {
  project: {
    findMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  thread: {
    groupBy: jest.fn(),
  },
  usageEvent: {
    groupBy: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  projectMember: {
    create: jest.fn(),
    upsert: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  projectCustomProperty: {
    findMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  threadPropertyValue: {
    deleteMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);

    jest.clearAllMocks();

    mockPrismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrismaService) => unknown) =>
        callback(mockPrismaService),
    );
  });

  describe('listProjects()', () => {
    it('admin sees all projects in their workspace without a membership filter', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([]);

      await service.listProjects({}, mockAdmin as any);

      const args = mockPrismaService.project.findMany.mock.calls[0][0];
      expect(args.where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ workspace_id: 'ws-1' }),
        ]),
      );
      expect(JSON.stringify(args.where)).not.toContain('project_members');
    });

    it('team_member only sees projects they are a member of', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([]);

      await service.listProjects({}, mockUser as any);

      const args = mockPrismaService.project.findMany.mock.calls[0][0];
      expect(JSON.stringify(args.where)).toContain('project_members');
      expect(JSON.stringify(args.where)).toContain('owner_id');
    });

    it('search param produces a filter on both name and brief', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([]);

      await service.listProjects({ search: 'growth' }, mockAdmin as any);

      const args = mockPrismaService.project.findMany.mock.calls[0][0];
      expect(args.where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            OR: [
              { name: { contains: 'growth', mode: 'insensitive' } },
              { brief: { contains: 'growth', mode: 'insensitive' } },
            ],
          }),
        ]),
      );
    });

    it('status param is applied in the where clause', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([]);

      await service.listProjects({ status: 'paused' }, mockAdmin as any);

      const args = mockPrismaService.project.findMany.mock.calls[0][0];
      expect(args.where.AND).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'paused' })]),
      );
    });

    it('returns correct shape including thread_count, monthly_cost, member_count, and linked_sources', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([
        {
          id: 'project-1',
          name: 'Project One',
          type: 'client',
          status: 'active',
          owner_id: 'owner-1',
          clickup_link: 'https://clickup',
          slack_channel_link: null,
          fathom_links: ['https://fathom'],
          owner: { id: 'owner-1', full_name: 'Owner Name', avatar_url: null },
          _count: { threads: 12, project_members: 3 },
        },
      ]);
      mockPrismaService.thread.groupBy.mockResolvedValue([
        { project_id: 'project-1', _max: { last_active_at: new Date('2026-04-29T00:00:00Z') } },
      ]);
      mockPrismaService.usageEvent.groupBy.mockResolvedValue([
        { project_id: 'project-1', _sum: { cost_usd: 24.5 } },
      ]);

      const result = await service.listProjects({}, mockAdmin as any);

      expect(result).toEqual([
        {
          id: 'project-1',
          name: 'Project One',
          type: 'client',
          status: 'active',
          owner: { id: 'owner-1', full_name: 'Owner Name', avatar_url: null },
          thread_count: 12,
          monthly_cost: '24.50',
          last_active_at: new Date('2026-04-29T00:00:00Z'),
          linked_sources: { clickup: true, slack: false, fathom: true },
          member_count: 3,
        },
      ]);
    });

    it('linked_sources.fathom is true when fathom_links array is non-empty', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([
        {
          id: 'project-2',
          name: 'Project Two',
          type: 'client',
          status: 'active',
          owner_id: 'owner-1',
          clickup_link: null,
          slack_channel_link: null,
          fathom_links: ['https://fathom/1'],
          owner: { id: 'owner-1', full_name: null, avatar_url: null },
          _count: { threads: 0, project_members: 1 },
        },
      ]);
      mockPrismaService.thread.groupBy.mockResolvedValue([]);
      mockPrismaService.usageEvent.groupBy.mockResolvedValue([]);

      const result = await service.listProjects({}, mockAdmin as any);

      expect(result[0].linked_sources.fathom).toBe(true);
    });

    it('applies type, owner, date range and linked-source filters in the where clause', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([]);

      await service.listProjects(
        {
          type: 'client',
          owner_id: 'owner-1',
          date_from: '2026-04-01T00:00:00.000Z',
          date_to: '2026-04-30T23:59:59.999Z',
          has_linked_sources: true,
        },
        mockAdmin as any,
      );

      const args = mockPrismaService.project.findMany.mock.calls[0][0];
      expect(args.where.AND).toEqual(
        expect.arrayContaining([
          { type: 'client' },
          { owner_id: 'owner-1' },
          {
            created_at: {
              gte: new Date('2026-04-01T00:00:00.000Z'),
              lte: new Date('2026-04-30T23:59:59.999Z'),
            },
          },
          {
            OR: [
              { clickup_link: { not: null } },
              { slack_channel_link: { not: null } },
              { fathom_links: { isEmpty: false } },
            ],
          },
        ]),
      );
    });

    it('supports has_linked_sources=false and all sort modes', async () => {
      const rows = [
        {
          id: 'project-a',
          name: 'Zeta',
          type: 'client',
          status: 'active',
          owner_id: 'owner-1',
          clickup_link: null,
          slack_channel_link: null,
          fathom_links: [],
          owner: { id: 'owner-1', full_name: 'Beta Owner', avatar_url: null },
          _count: { threads: 5, project_members: 2 },
        },
        {
          id: 'project-b',
          name: 'Alpha',
          type: 'client',
          status: 'active',
          owner_id: 'owner-2',
          clickup_link: null,
          slack_channel_link: null,
          fathom_links: [],
          owner: { id: 'owner-2', full_name: 'Alpha Owner', avatar_url: null },
          _count: { threads: 1, project_members: 1 },
        },
      ];

      mockPrismaService.project.findMany.mockResolvedValue(rows);
      mockPrismaService.thread.groupBy.mockResolvedValue([
        { project_id: 'project-a', _max: { last_active_at: new Date('2026-04-20T00:00:00Z') } },
        { project_id: 'project-b', _max: { last_active_at: new Date('2026-04-10T00:00:00Z') } },
      ]);
      mockPrismaService.usageEvent.groupBy.mockResolvedValue([
        { project_id: 'project-a', _sum: { cost_usd: 10 } },
        { project_id: 'project-b', _sum: { cost_usd: 20 } },
      ]);

      const byName = await service.listProjects(
        { has_linked_sources: false, sort_by: 'name_asc' },
        mockAdmin as any,
      );
      expect(byName.map((p: any) => p.name)).toEqual(['Alpha', 'Zeta']);

      const byCost = await service.listProjects(
        { has_linked_sources: false, sort_by: 'cost_high_low' },
        mockAdmin as any,
      );
      expect(byCost.map((p: any) => p.id)).toEqual(['project-b', 'project-a']);

      const byThreads = await service.listProjects(
        { has_linked_sources: false, sort_by: 'thread_count' },
        mockAdmin as any,
      );
      expect(byThreads.map((p: any) => p.id)).toEqual(['project-a', 'project-b']);

      const byOwnerGroup = await service.listProjects(
        { has_linked_sources: false, group_by: 'owner' },
        mockAdmin as any,
      );
      expect(byOwnerGroup.map((p: any) => p.owner.full_name)).toEqual([
        'Alpha Owner',
        'Beta Owner',
      ]);

      const args = mockPrismaService.project.findMany.mock.calls[3][0];
      expect(args.where.AND).toEqual(
        expect.arrayContaining([
          {
            AND: [
              { OR: [{ clickup_link: null }, { clickup_link: '' }] },
              { OR: [{ slack_channel_link: null }, { slack_channel_link: '' }] },
              { fathom_links: { isEmpty: true } },
            ],
          },
        ]),
      );
    });

    it('throws ForbiddenException when user has no workspace assigned', async () => {
      await expect(
        service.listProjects({}, { ...mockUser, workspace_id: null } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createProject()', () => {
    it("throws BadRequestException when a member's workspace_id differs from the caller's", async () => {
      mockPrismaService.project.create.mockResolvedValue({ id: 'project-1', name: 'P1' });
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'other-user', workspace_id: 'ws-2' },
      ]);

      await expect(
        service.createProject(
          {
            name: 'Project',
            type: 'client',
            members: [{ user_id: 'other-user', access_level: 'edit' }],
          } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets owner_id = user.sub on the created project', async () => {
      mockPrismaService.project.create.mockResolvedValue({ id: 'project-1', name: 'P1' });
      mockPrismaService.project.findFirst.mockResolvedValue(projectDetailRecord);

      await service.createProject(
        { name: 'Project', type: 'client', members: [] } as any,
        mockUser as any,
      );

      expect(mockPrismaService.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ owner_id: mockUser.sub }),
        }),
      );
    });

    it('inserts members into project_members with assigned_by = user.sub', async () => {
      mockPrismaService.project.create.mockResolvedValue({ id: 'project-1', name: 'P1' });
      mockPrismaService.user.findMany.mockResolvedValue([
        { id: 'member-1', workspace_id: 'ws-1' },
      ]);
      mockPrismaService.project.findFirst.mockResolvedValue(projectDetailRecord);

      await service.createProject(
        {
          name: 'Project',
          type: 'client',
          members: [{ user_id: 'member-1', access_level: 'edit' }],
        } as any,
        mockUser as any,
      );

      expect(mockPrismaService.projectMember.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              assigned_by: mockUser.sub,
              user_id: 'member-1',
            }),
          ],
        }),
      );
    });

    it("writes audit log with event_type = 'project_created'", async () => {
      mockPrismaService.project.create.mockResolvedValue({ id: 'project-1', name: 'P1' });
      mockPrismaService.project.findFirst.mockResolvedValue(projectDetailRecord);

      await service.createProject(
        { name: 'Project', type: 'client', members: [] } as any,
        mockUser as any,
      );

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event_type: 'project_created' }),
        }),
      );
    });

    it('throws NotFoundException when post-create lookup fails', async () => {
      mockPrismaService.project.create.mockResolvedValue({ id: 'project-1', name: 'P1' });
      mockPrismaService.project.findFirst.mockResolvedValue(null);

      await expect(
        service.createProject(
          { name: 'Project', type: 'client', members: [] } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getProjectById()', () => {
    it('throws NotFoundException when project is not found in the workspace', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue(null);

      await expect(service.getProjectById('missing-id', mockUser as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns project with members and custom_properties included', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue(projectDetailRecord);

      const result = await service.getProjectById('project-1', mockUser as any);

      expect(result.members).toHaveLength(1);
      expect(result.custom_properties).toHaveLength(1);
    });
  });

  describe('updateProject()', () => {
    it('throws ForbiddenException when guard context is missing', async () => {
      await expect(
        service.updateProject('project-1', { name: 'Renamed' } as any, mockUser as any, undefined),
      ).rejects.toThrow(ForbiddenException);
    });

    it('only updates fields explicitly present in the DTO', async () => {
      mockPrismaService.project.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.project.findFirst.mockResolvedValue(projectDetailRecord);

      await service.updateProject(
        'project-1',
        {
          name: 'Renamed',
          fathom_links: ['https://fathom/new'],
        } as any,
        mockUser as any,
        { id: 'project-1', owner_id: 'user-1', workspace_id: 'ws-1' } as any,
      );

      expect(mockPrismaService.project.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Renamed',
            fathom_links: ['https://fathom/new'],
          },
        }),
      );
    });

    it('writes audit log with the keys of fields that changed', async () => {
      mockPrismaService.project.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.project.findFirst.mockResolvedValue(projectDetailRecord);

      await service.updateProject(
        'project-1',
        { name: 'Renamed', status: 'paused' } as any,
        mockUser as any,
        { id: 'project-1', owner_id: 'user-1', workspace_id: 'ws-1' } as any,
      );

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'project_updated',
            event_detail: expect.objectContaining({
              changed_fields: ['name', 'status'],
            }),
          }),
        }),
      );
    });

    it('throws NotFoundException when updateMany affects zero rows', async () => {
      mockPrismaService.project.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateProject(
          'project-1',
          { name: 'Renamed' } as any,
          mockUser as any,
          { id: 'project-1', owner_id: 'user-1', workspace_id: 'ws-1' } as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('archiveProject()', () => {
    it("sets status = 'archived' on the project row", async () => {
      mockPrismaService.project.updateMany.mockResolvedValue({ count: 1 });

      await service.archiveProject('project-1', mockAdmin as any);

      expect(mockPrismaService.project.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'archived' },
        }),
      );
    });

    it('writes audit log', async () => {
      mockPrismaService.project.updateMany.mockResolvedValue({ count: 1 });

      await service.archiveProject('project-1', mockAdmin as any);

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event_type: 'project_archived' }),
        }),
      );
    });

    it('throws NotFoundException when project is missing', async () => {
      mockPrismaService.project.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.archiveProject('project-404', mockAdmin as any)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteProject()', () => {
    it("throws BadRequestException when X-Confirm-Delete header is missing or is not 'true'", async () => {
      await expect(
        service.deleteProject('project-1', 'false', mockAdmin as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('deletes the project and writes audit log when header is correct', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue({
        id: 'project-1',
        name: 'Project One',
      });
      mockPrismaService.project.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.deleteProject('project-1', 'true', mockAdmin as any);

      expect(mockPrismaService.project.deleteMany).toHaveBeenCalled();
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event_type: 'project_deleted' }),
        }),
      );
      expect(result).toEqual({ message: 'Project deleted' });
    });

    it('throws NotFoundException when project is missing', async () => {
      mockPrismaService.project.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteProject('project-404', 'true', mockAdmin as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addMember()', () => {
    it('throws BadRequestException when the user being added is in a different workspace', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        service.addMember(
          'project-1',
          { user_id: 'user-2', access_level: 'edit' } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('uses upsert with project_id_user_id compound key', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({ id: 'user-2' });
      mockPrismaService.projectMember.upsert.mockResolvedValue({
        project_id: 'project-1',
        user_id: 'user-2',
        access_level: 'edit',
        assigned_at: new Date('2026-04-01T00:00:00Z'),
      });

      await service.addMember(
        'project-1',
        { user_id: 'user-2', access_level: 'edit' } as any,
        mockUser as any,
      );

      expect(mockPrismaService.projectMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            project_id_user_id: { project_id: 'project-1', user_id: 'user-2' },
          },
        }),
      );
    });

    it('creates new member row when membership does not exist', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({ id: 'user-2' });
      mockPrismaService.projectMember.upsert.mockResolvedValue({
        project_id: 'project-1',
        user_id: 'user-2',
        access_level: 'edit',
        assigned_at: new Date('2026-04-01T00:00:00Z'),
      });

      const result = await service.addMember(
        'project-1',
        { user_id: 'user-2', access_level: 'edit' } as any,
        mockUser as any,
      );

      expect(result.access_level).toBe('edit');
    });

    it('updates access_level when membership already exists', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({ id: 'user-2' });
      mockPrismaService.projectMember.upsert.mockResolvedValue({
        project_id: 'project-1',
        user_id: 'user-2',
        access_level: 'read_only',
        assigned_at: new Date('2026-04-01T00:00:00Z'),
      });

      const result = await service.addMember(
        'project-1',
        { user_id: 'user-2', access_level: 'read_only' } as any,
        mockUser as any,
      );

      expect(result.access_level).toBe('read_only');
    });
  });

  describe('updateMemberAccess()', () => {
    it('throws NotFoundException when the membership row does not exist', async () => {
      mockPrismaService.projectMember.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMemberAccess(
          'project-1',
          'user-2',
          { access_level: 'edit' } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the updated membership when found', async () => {
      mockPrismaService.projectMember.findFirst.mockResolvedValue({
        project_id: 'project-1',
        user_id: 'user-2',
        access_level: 'edit',
      });
      mockPrismaService.projectMember.update.mockResolvedValue({
        project_id: 'project-1',
        user_id: 'user-2',
        access_level: 'edit',
      });

      const result = await service.updateMemberAccess(
        'project-1',
        'user-2',
        { access_level: 'edit' } as any,
        mockUser as any,
      );

      expect(result).toEqual({
        project_id: 'project-1',
        user_id: 'user-2',
        access_level: 'edit',
      });
    });
  });

  describe('removeMember()', () => {
    it('throws ForbiddenException when guard-attached project is missing', async () => {
      await expect(
        service.removeMember('project-1', 'user-2', mockUser as any, undefined),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ForbiddenException when removing the project owner", async () => {
      await expect(
        service.removeMember(
          'project-1',
          'owner-1',
          mockUser as any,
          { id: 'project-1', owner_id: 'owner-1', workspace_id: 'ws-1' } as any,
        ),
      ).rejects.toThrow(
        'Transfer ownership before removing the project owner',
      );
    });

    it('deletes the membership row when userId is not the owner', async () => {
      mockPrismaService.projectMember.findFirst.mockResolvedValue({
        project_id: 'project-1',
        user_id: 'user-2',
      });
      mockPrismaService.projectMember.delete.mockResolvedValue({
        project_id: 'project-1',
        user_id: 'user-2',
      });

      const result = await service.removeMember(
        'project-1',
        'user-2',
        mockUser as any,
        { id: 'project-1', owner_id: 'owner-1', workspace_id: 'ws-1' } as any,
      );

      expect(mockPrismaService.projectMember.delete).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Member removed' });
    });

    it('throws NotFoundException when membership row does not exist', async () => {
      mockPrismaService.projectMember.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember(
          'project-1',
          'user-2',
          mockUser as any,
          { id: 'project-1', owner_id: 'owner-1', workspace_id: 'ws-1' } as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('transferOwnership()', () => {
    it('throws BadRequestException when new_owner_id belongs to a different workspace', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(
        service.transferOwnership(
          'project-1',
          { new_owner_id: 'user-9' } as any,
          mockAdmin as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates owner_id and writes audit log with both old and new owner IDs', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({ id: 'user-2' });
      mockPrismaService.project.findFirst
        .mockResolvedValueOnce({ id: 'project-1', owner_id: 'owner-1' })
        .mockResolvedValueOnce({
          id: 'project-1',
          owner_id: 'user-2',
          owner: { id: 'user-2', full_name: 'New Owner', avatar_url: null },
        });
      mockPrismaService.project.updateMany.mockResolvedValue({ count: 1 });

      await service.transferOwnership(
        'project-1',
        { new_owner_id: 'user-2' } as any,
        mockAdmin as any,
      );

      expect(mockPrismaService.project.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { owner_id: 'user-2' } }),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'project_ownership_transferred',
            event_detail: {
              project_id: 'project-1',
              old_owner_id: 'owner-1',
              new_owner_id: 'user-2',
            },
          }),
        }),
      );
    });

    it('throws NotFoundException when project is not found before transfer', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({ id: 'user-2' });
      mockPrismaService.project.findFirst.mockResolvedValue(null);

      await expect(
        service.transferOwnership(
          'project-404',
          { new_owner_id: 'user-2' } as any,
          mockAdmin as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createCustomProperty()', () => {
    it("throws BadRequestException when property_type is 'single_select' and options is missing", async () => {
      await expect(
        service.createCustomProperty(
          'project-1',
          {
            name: 'Priority',
            property_type: 'single_select',
          } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when property_type is 'multi_select' and options is empty array", async () => {
      await expect(
        service.createCustomProperty(
          'project-1',
          {
            name: 'Tags',
            property_type: 'multi_select',
            options: [],
          } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('inserts with created_by = user.sub', async () => {
      mockPrismaService.projectCustomProperty.create.mockResolvedValue({
        id: 'prop-1',
        name: 'Priority',
        property_type: 'single_select',
        options: [{ value: 'high', label: 'High' }],
        sort_order: 0,
      });

      await service.createCustomProperty(
        'project-1',
        {
          name: 'Priority',
          property_type: 'single_select',
          options: [{ value: 'high', label: 'High' }],
          sort_order: 0,
        } as any,
        mockUser as any,
      );

      expect(mockPrismaService.projectCustomProperty.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ created_by: mockUser.sub }),
        }),
      );
    });
  });

  describe('listCustomProperties()', () => {
    it('returns properties ordered by sort_order ASC', async () => {
      mockPrismaService.projectCustomProperty.findMany.mockResolvedValue([
        { id: 'prop-1', sort_order: 0 },
      ]);

      await service.listCustomProperties('project-1', mockUser as any);

      expect(mockPrismaService.projectCustomProperty.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { sort_order: 'asc' },
        }),
      );
    });
  });

  describe('updateCustomProperty()', () => {
    it('throws NotFoundException when property is missing', async () => {
      mockPrismaService.projectCustomProperty.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCustomProperty(
          'project-1',
          'prop-missing',
          { name: 'x' } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates only provided fields', async () => {
      mockPrismaService.projectCustomProperty.findFirst.mockResolvedValue({ id: 'prop-1' });
      mockPrismaService.projectCustomProperty.update.mockResolvedValue({
        id: 'prop-1',
        name: 'Renamed',
        property_type: 'text',
        options: null,
        sort_order: 1,
      });

      await service.updateCustomProperty(
        'project-1',
        'prop-1',
        { name: 'Renamed', sort_order: 1 } as any,
        mockUser as any,
      );

      expect(mockPrismaService.projectCustomProperty.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Renamed', sort_order: 1 },
        }),
      );
    });
  });

  describe('deleteCustomProperty()', () => {
    it('cascades deletion: deleteMany on thread_property_values before deleting the property', async () => {
      mockPrismaService.projectCustomProperty.findFirst.mockResolvedValue({ id: 'prop-1' });
      mockPrismaService.threadPropertyValue.deleteMany.mockResolvedValue({ count: 2 });
      mockPrismaService.projectCustomProperty.delete.mockResolvedValue({ id: 'prop-1' });

      await service.deleteCustomProperty('project-1', 'prop-1', mockUser as any);

      expect(mockPrismaService.threadPropertyValue.deleteMany).toHaveBeenCalledWith({
        where: { property_id: 'prop-1' },
      });
      expect(mockPrismaService.projectCustomProperty.delete).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
      });
      expect(
        mockPrismaService.threadPropertyValue.deleteMany.mock.invocationCallOrder[0],
      ).toBeLessThan(mockPrismaService.projectCustomProperty.delete.mock.invocationCallOrder[0]);
    });

    it('wraps deletion operations in a transaction', async () => {
      mockPrismaService.projectCustomProperty.findFirst.mockResolvedValue({ id: 'prop-1' });
      mockPrismaService.threadPropertyValue.deleteMany.mockResolvedValue({ count: 2 });
      mockPrismaService.projectCustomProperty.delete.mockResolvedValue({ id: 'prop-1' });

      await service.deleteCustomProperty('project-1', 'prop-1', mockUser as any);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when property does not exist', async () => {
      mockPrismaService.projectCustomProperty.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteCustomProperty('project-1', 'prop-missing', mockUser as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
