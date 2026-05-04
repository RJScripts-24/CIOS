import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ThreadGroupsService } from './thread-groups.service';

const mockUser = {
  sub: 'user-1',
  email: 'user@example.com',
  role: 'team_member',
  workspace_id: 'ws-1',
};

const mockPrismaService = {
  threadGroup: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  thread: {
    groupBy: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
  auditLog: {
    create: jest.fn(),
  },
};

describe('ThreadGroupsService', () => {
  let service: ThreadGroupsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadGroupsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ThreadGroupsService>(ThreadGroupsService);

    jest.clearAllMocks();

    mockPrismaService.$transaction.mockImplementation(
      async (callback: (tx: typeof mockPrismaService) => unknown) =>
        callback(mockPrismaService),
    );
  });

  describe('createThreadGroup()', () => {
    it('inserts with created_by = user.sub and workspace_id = user.workspace_id', async () => {
      mockPrismaService.threadGroup.create.mockResolvedValue({
        id: 'tg-1',
        project_id: 'project-1',
        name: 'Daily sync',
        created_by: 'user-1',
        created_at: new Date('2026-04-01T00:00:00Z'),
      });

      await service.createThreadGroup(
        'project-1',
        { name: 'Daily sync' } as any,
        mockUser as any,
      );

      expect(mockPrismaService.threadGroup.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            created_by: 'user-1',
            workspace_id: 'ws-1',
          }),
        }),
      );
    });

    it('throws ForbiddenException when user has no workspace assigned', async () => {
      await expect(
        service.createThreadGroup(
          'project-1',
          { name: 'Daily sync' } as any,
          { ...mockUser, workspace_id: null } as any,
        ),
      ).rejects.toThrow('User has no workspace assigned');
    });
  });

  describe('listThreadGroups()', () => {
    it('returns groups with total_cost and thread_count aggregate fields present', async () => {
      mockPrismaService.threadGroup.findMany.mockResolvedValue([
        { id: 'tg-1', project_id: 'project-1', name: 'Backend' },
      ]);
      mockPrismaService.thread.groupBy.mockResolvedValue([
        {
          group_id: 'tg-1',
          _count: { _all: 5 },
          _sum: { total_cost: 12.5 },
        },
      ]);

      const result = await service.listThreadGroups('project-1', mockUser as any);

      expect(result).toEqual([
        {
          id: 'tg-1',
          project_id: 'project-1',
          name: 'Backend',
          total_cost: '12.50',
          thread_count: 5,
        },
      ]);
    });

    it('returns an empty array when the project has no groups', async () => {
      mockPrismaService.threadGroup.findMany.mockResolvedValue([]);

      const result = await service.listThreadGroups('project-1', mockUser as any);

      expect(result).toEqual([]);
    });

    it('ignores aggregate rows with null group_id and defaults total_cost to 0.00', async () => {
      mockPrismaService.threadGroup.findMany.mockResolvedValue([
        { id: 'tg-2', project_id: 'project-1', name: 'Frontend' },
      ]);
      mockPrismaService.thread.groupBy.mockResolvedValue([
        { group_id: null, _count: { _all: 99 }, _sum: { total_cost: null } },
      ]);

      const result = await service.listThreadGroups('project-1', mockUser as any);

      expect(result).toEqual([
        {
          id: 'tg-2',
          project_id: 'project-1',
          name: 'Frontend',
          total_cost: '0.00',
          thread_count: 0,
        },
      ]);
    });
  });

  describe('updateThreadGroup()', () => {
    it('throws NotFoundException when group is not found in the caller workspace', async () => {
      mockPrismaService.threadGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.updateThreadGroup('tg-404', { name: 'New' } as any, mockUser as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns current group when no persisted fields are provided', async () => {
      mockPrismaService.threadGroup.findFirst.mockResolvedValue({
        id: 'tg-1',
        name: 'Backend',
        project_id: 'project-1',
        created_by: 'user-1',
        created_at: new Date('2026-04-01T00:00:00Z'),
      });

      const result = await service.updateThreadGroup(
        'tg-1',
        {} as any,
        mockUser as any,
      );

      expect(result).toEqual(
        expect.objectContaining({
          id: 'tg-1',
          name: 'Backend',
        }),
      );
      expect(mockPrismaService.threadGroup.update).not.toHaveBeenCalled();
    });

    it('updates thread-group name when provided', async () => {
      mockPrismaService.threadGroup.findFirst.mockResolvedValue({
        id: 'tg-1',
        name: 'Backend',
        project_id: 'project-1',
        created_by: 'user-1',
        created_at: new Date('2026-04-01T00:00:00Z'),
      });
      mockPrismaService.threadGroup.update.mockResolvedValue({
        id: 'tg-1',
        name: 'Platform',
        project_id: 'project-1',
        created_by: 'user-1',
        created_at: new Date('2026-04-01T00:00:00Z'),
      });

      const result = await service.updateThreadGroup(
        'tg-1',
        { name: 'Platform' } as any,
        mockUser as any,
      );

      expect(result).toEqual(
        expect.objectContaining({
          id: 'tg-1',
          name: 'Platform',
        }),
      );
      expect(mockPrismaService.threadGroup.update).toHaveBeenCalled();
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'thread_group_renamed',
            project_id: 'project-1',
            event_detail: { group_id: 'tg-1', project_id: 'project-1' },
          }),
        }),
      );
    });
  });

  describe('deleteThreadGroup()', () => {
    it('sets group_id = null on all threads in the group before deleting (in a transaction)', async () => {
      mockPrismaService.threadGroup.findFirst.mockResolvedValue({
        id: 'tg-1',
        project_id: 'project-1',
      });
      mockPrismaService.thread.updateMany.mockResolvedValue({ count: 3 });
      mockPrismaService.threadGroup.delete.mockResolvedValue({ id: 'tg-1' });

      await service.deleteThreadGroup('tg-1', mockUser as any);

      expect(mockPrismaService.thread.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { group_id: null },
        }),
      );
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.thread.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrismaService.threadGroup.delete.mock.invocationCallOrder[0],
      );
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event_type: 'thread_group_deleted',
            project_id: 'project-1',
            event_detail: {
              group_id: 'tg-1',
              project_id: 'project-1',
              unassigned_thread_count: 3,
            },
          }),
        }),
      );
    });

    it('returns unassigned_thread_count equal to the number of threads that were updated', async () => {
      mockPrismaService.threadGroup.findFirst.mockResolvedValue({
        id: 'tg-1',
        project_id: 'project-1',
      });
      mockPrismaService.thread.updateMany.mockResolvedValue({ count: 5 });
      mockPrismaService.threadGroup.delete.mockResolvedValue({ id: 'tg-1' });

      const result = await service.deleteThreadGroup('tg-1', mockUser as any);

      expect(result).toEqual({
        message: 'Group deleted',
        unassigned_thread_count: 5,
      });
    });

    it('throws NotFoundException when target group does not exist', async () => {
      mockPrismaService.threadGroup.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteThreadGroup('tg-404', mockUser as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
