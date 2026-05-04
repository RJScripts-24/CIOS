import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
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
  access_level: 'team',
  system_prompt: null,
  last_model_used: null,
  created_by: mockUser.sub,
  last_active_at: null,
  total_cost: null,
  created_at: new Date('2026-05-01T00:00:00Z'),
  updated_at: new Date('2026-05-01T00:00:00Z'),
  thread_property_values: [],
};

const mockThreadWithProperty = {
  ...mockThread,
  thread_property_values: [{ property_id: 'prop-1', value: 'hello' }],
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
  $transaction: jest.fn(),
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

    mockPrismaService.$transaction.mockImplementation(
      async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: typeof mockPrismaService) => unknown)(mockPrismaService);
        }

        return Promise.all(arg as Array<Promise<unknown>>);
      },
    );
  });

  describe('listThreads()', () => {
    it('returns grouped and ungrouped threads with mapped totals', async () => {
      mockPrismaService.thread.findMany.mockResolvedValue([
        {
          ...mockThread,
          group_id: 'group-1',
          total_cost: '10.500000',
          thread_property_values: [],
        },
        {
          ...mockThread,
          id: 'thread-2',
          group_id: null,
          total_cost: '2.000000',
          thread_property_values: [],
        },
      ]);
      mockPrismaService.threadGroup.findMany.mockResolvedValue([
        { id: 'group-1', name: 'Group One', created_at: new Date() },
      ]);

      const result = await service.listThreads(PROJECT_ID, {}, mockUser as any);

      expect(result.ungrouped_threads).toHaveLength(1);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]).toEqual(
        expect.objectContaining({
          id: 'group-1',
          total_cost: '10.500000',
          threads: expect.arrayContaining([
            expect.objectContaining({ id: THREAD_ID }),
          ]),
        }),
      );
      expect(mockPrismaService.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspace_id: WORKSPACE_ID,
            project_id: PROJECT_ID,
            OR: [
              { access_level: 'team' },
              { access_level: 'private', created_by: mockUser.sub },
            ],
          }),
        }),
      );
    });

    it('throws ForbiddenException if user has no workspace', async () => {
      await expect(
        service.listThreads(PROJECT_ID, {}, { ...mockUser, workspace_id: null } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('applies search and filter fields in the Prisma where clause', async () => {
      mockPrismaService.thread.findMany.mockResolvedValue([]);

      await service.listThreads(
        PROJECT_ID,
        {
          search: 'hello',
          purpose_tag: ['Dev', 'Copy'],
          created_by: 'creator-uuid',
          model: 'gpt-4.1',
          status: 'active',
          date_from: '2026-04-01T00:00:00.000Z',
          date_to: '2026-04-30T23:59:59.999Z',
          cost_min: 1,
          cost_max: 9,
          group_id: 'group-uuid',
          sort_by: 'title_asc',
        },
        mockUser as any,
      );

      const args = mockPrismaService.thread.findMany.mock.calls[0][0];
      const where = args.where as Record<string, unknown>;
      expect(where).toEqual(
        expect.objectContaining({
          title: { contains: 'hello', mode: 'insensitive' },
          purpose_tag: { in: ['Dev', 'Copy'] },
          created_by: 'creator-uuid',
          last_model_used: 'gpt-4.1',
          status: 'active',
          group_id: 'group-uuid',
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
        }),
      );
    });
  });

  describe('listThreads — access_level enforcement', () => {
    /** Simulates DB visibility for threads returned by listThreads' WHERE clause. */
    function threadPassesAccessWhere(
      row: { access_level: string; created_by: string },
      where: Prisma.ThreadWhereInput,
      userSub: string,
      isAdmin: boolean,
    ): boolean {
      if (isAdmin) return true;
      const orClause = where.OR;
      if (!orClause?.length) return true;
      return orClause.some((cond) => {
        if ('AND' in cond || 'NOT' in cond || 'OR' in cond) return false;
        const c = cond as { access_level?: string; created_by?: string };
        if (c.access_level === 'team') return row.access_level === 'team';
        if (c.access_level === 'private' && c.created_by === userSub) {
          return row.access_level === 'private' && row.created_by === userSub;
        }
        return false;
      });
    }

    beforeEach(() => {
      mockPrismaService.thread.findMany.mockImplementation(({ where }: { where: Prisma.ThreadWhereInput }) => {
        const candidates = [
          { ...mockThread, id: 't-team', access_level: 'team', created_by: 'other-user' },
          {
            ...mockThread,
            id: 't-private-other',
            access_level: 'private',
            created_by: 'other-user',
          },
          { ...mockThread, id: 't-private-own', access_level: 'private', created_by: mockUser.sub },
        ].map((t) => ({
          ...t,
          total_cost: '0',
          thread_property_values: [],
        }));

        const isAdmin = mockUser.role === 'admin';
        const filtered = candidates.filter((t) =>
          threadPassesAccessWhere(
            { access_level: t.access_level!, created_by: t.created_by! },
            where,
            mockUser.sub,
            isAdmin,
          ),
        );
        return Promise.resolve(filtered);
      });
      mockPrismaService.threadGroup.findMany.mockResolvedValue([]);
    });

    it('should not include private threads created by another user for a non-admin', async () => {
      const spy = jest.spyOn(mockPrismaService.thread, 'findMany');

      const result = await service.listThreads(PROJECT_ID, {}, mockUser as any);

      expect(spy.mock.calls[0][0].where).toMatchObject({
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        OR: [
          { access_level: 'team' },
          { access_level: 'private', created_by: mockUser.sub },
        ],
      });
      type GroupRow = { threads?: { id: string }[] };
      const groupRows = result.groups as GroupRow[];
      const ids = [
        ...groupRows.flatMap((g) => g.threads ?? []),
        ...result.ungrouped_threads,
      ].map((t) => t.id);
      expect(ids).toContain('t-team');
      expect(ids).not.toContain('t-private-other');

      spy.mockRestore();
    });

    it("should include all threads for admin users regardless of access_level", async () => {
      const admin = { ...mockUser, role: 'admin' as const };
      mockPrismaService.thread.findMany.mockImplementation(({ where }: { where: Prisma.ThreadWhereInput }) => {
        const candidates = [
          { ...mockThread, id: 't-team', access_level: 'team', created_by: 'other-user' },
          {
            ...mockThread,
            id: 't-private-other',
            access_level: 'private',
            created_by: 'other-user',
          },
        ].map((t) => ({ ...t, total_cost: '0', thread_property_values: [] }));
        const filtered = candidates.filter((t) =>
          threadPassesAccessWhere(
            { access_level: t.access_level!, created_by: t.created_by! },
            where,
            admin.sub,
            true,
          ),
        );
        return Promise.resolve(filtered);
      });

      const result = await service.listThreads(PROJECT_ID, {}, admin as any);

      const args = mockPrismaService.thread.findMany.mock.calls[0][0];
      expect(args.where).not.toHaveProperty('OR');

      type GroupRow = { threads?: { id: string }[] };
      const groupRows = result.groups as GroupRow[];
      const ids = [
        ...groupRows.flatMap((g) => g.threads ?? []),
        ...result.ungrouped_threads,
      ].map((t) => t.id);
      expect(ids).toContain('t-private-other');
      expect(ids).toContain('t-team');
    });

    it("should include user's own private threads", async () => {
      const result = await service.listThreads(PROJECT_ID, {}, mockUser as any);
      expect(result.ungrouped_threads.map((t: { id: string }) => t.id)).toContain('t-private-own');
    });
  });

  describe('createThread()', () => {
    it('creates a thread, creates skill links, and writes an audit log', async () => {
      const createdThread = {
        ...mockThread,
        title: 'New Thread',
        thread_property_values: [],
      };
      mockPrismaService.thread.create.mockResolvedValue(createdThread);
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const result = await service.createThread(
        PROJECT_ID,
        {
          title: 'New Thread',
          skill_ids: ['skill-1'],
          group_id: null,
        } as any,
        mockUser as any,
      );

      expect(result.title).toBe('New Thread');
      expect(mockPrismaService.thread.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            project_id: PROJECT_ID,
            workspace_id: WORKSPACE_ID,
            created_by: mockUser.sub,
            access_level: 'team',
          }),
        }),
      );
      expect(mockPrismaService.threadActiveSkill.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ skill_id: 'skill-1' }),
          ]),
        }),
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'thread_created',
            workspace_id: WORKSPACE_ID,
          }),
        }),
      );
    });

    it('throws ForbiddenException if user has no workspace assigned', async () => {
      await expect(
        service.createThread(
          PROJECT_ID,
          { title: 'Thread' } as any,
          { ...mockUser, workspace_id: null } as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if the group does not belong to the project', async () => {
      mockPrismaService.threadGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.createThread(
          PROJECT_ID,
          { title: 'Thread', group_id: 'bad-group' } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getThreadById()', () => {
    it('returns the mapped thread with property values', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThreadWithProperty);

      const result = await service.getThreadById(THREAD_ID, mockUser as any);

      expect(result.property_values['prop-1']).toBe('hello');
      expect(result.total_cost).toBe('0.000000');
    });

    it('throws ForbiddenException if user has no workspace assigned', async () => {
      await expect(
        service.getThreadById(THREAD_ID, { ...mockUser, workspace_id: null } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the thread does not exist', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(null);

      await expect(service.getThreadById('ghost', mockUser as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the thread when loaded directly by the service', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThreadWithProperty);

      const result = await service.getThreadById(THREAD_ID, mockUser as any);

      expect(result.id).toBe(THREAD_ID);
      expect(result.property_values['prop-1']).toBe('hello');
    });
  });

  describe('updateThread()', () => {
    it('updates only provided fields and returns the mapped thread', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThreadWithProperty);
      mockPrismaService.thread.update.mockResolvedValue({
        ...mockThreadWithProperty,
        title: 'Renamed',
      });

      const result = await service.updateThread(
        THREAD_ID,
        { title: 'Renamed' },
        mockUser as any,
      );

      expect(result.title).toBe('Renamed');
      expect(mockPrismaService.thread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: 'Renamed' }),
        }),
      );
    });

    it('returns the current thread when the DTO is empty', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThreadWithProperty);

      const result = await service.updateThread(THREAD_ID, {}, mockUser as any);

      expect(result.id).toBe(THREAD_ID);
      expect(mockPrismaService.thread.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the thread does not exist', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(null);

      await expect(
        service.updateThread('ghost', { title: 'x' }, mockUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the updated thread when loaded directly by the service', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(mockThreadWithProperty);
      mockPrismaService.thread.update.mockResolvedValue({
        ...mockThreadWithProperty,
        title: 'x',
      });

      const result = await service.updateThread(
        THREAD_ID,
        { title: 'x' },
        mockUser as any,
      );

      expect(result.title).toBe('x');
    });
  });

  describe('upsertPropertyValues()', () => {
    it('upserts all property values in a transaction and returns the updated list', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue({
        ...mockThread,
        thread_property_values: [],
      });
      mockPrismaService.projectCustomProperty.findMany.mockResolvedValue([
        { id: 'prop-1', property_type: 'text' },
      ]);
      mockPrismaService.threadPropertyValue.upsert.mockResolvedValue({
        property_id: 'prop-1',
        value: 'hello',
      });

      const result = await service.upsertPropertyValues(
        THREAD_ID,
        { values: [{ property_id: 'prop-1', value: 'hello' }] } as any,
        mockUser as any,
      );

      expect(result).toEqual({
        thread_id: THREAD_ID,
        updated_values: [{ property_id: 'prop-1', value: 'hello' }],
      });
      expect(mockPrismaService.threadPropertyValue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            thread_id_property_id: {
              thread_id: THREAD_ID,
              property_id: 'prop-1',
            },
          },
        }),
      );
    });

    it('throws NotFoundException if the thread does not exist', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue(null);

      await expect(
        service.upsertPropertyValues(
          THREAD_ID,
          { values: [{ property_id: 'prop-1', value: 'hello' }] } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if the property is not on the project', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue({
        ...mockThread,
        thread_property_values: [],
      });
      mockPrismaService.projectCustomProperty.findMany.mockResolvedValue([]);

      await expect(
        service.upsertPropertyValues(
          THREAD_ID,
          { values: [{ property_id: 'missing-prop', value: 'hello' }] } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws UnprocessableEntityException when a value has the wrong type', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue({
        ...mockThread,
        thread_property_values: [],
      });
      mockPrismaService.projectCustomProperty.findMany.mockResolvedValue([
        { id: 'prop-1', property_type: 'number' },
      ]);

      await expect(
        service.upsertPropertyValues(
          THREAD_ID,
          { values: [{ property_id: 'prop-1', value: 'bad' }] } as any,
          mockUser as any,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('validates property values without performing access checks', async () => {
      mockPrismaService.thread.findFirst.mockResolvedValue({
        ...mockThread,
        thread_property_values: [],
      });
      mockPrismaService.projectCustomProperty.findMany.mockResolvedValue([
        { id: 'prop-1', property_type: 'text' },
      ]);
      mockPrismaService.threadPropertyValue.upsert.mockResolvedValue({
        property_id: 'prop-1',
        value: 'hello',
      });

      const result = await service.upsertPropertyValues(
        THREAD_ID,
        { values: [{ property_id: 'prop-1', value: 'hello' }] } as any,
        mockUser as any,
      );

      expect(result.thread_id).toBe(THREAD_ID);
    });
  });
});