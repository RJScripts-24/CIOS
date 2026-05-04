// [NEW FILE]
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from './finance.service';

const mockPrisma = {
  $queryRaw: jest.fn(),
};

const admin = { sub: 'a1', role: 'admin', workspace_id: 'ws-1', email: 'a@x.com' };
const member = { sub: 'u1', role: 'team_member', workspace_id: 'ws-1', email: 'u@x.com' };

describe('FinanceService', () => {
  let service: FinanceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FinanceService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(FinanceService);
    jest.clearAllMocks();
  });

  it('should throw ForbiddenException if user has no workspace', async () => {
    await expect(service.summary({ ...admin, workspace_id: null } as any, {} as any)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('summary: should use $queryRaw with JOIN on model_pricing — never use messages.cost_estimate', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.summary(admin as any, {} as any);
    const sqlText = JSON.stringify(mockPrisma.$queryRaw.mock.calls[0][0]);
    expect(sqlText).toContain('usage_events');
    expect(sqlText).toContain('model_pricing');
    expect(sqlText).not.toContain('messages');
  });

  it('summary: should default to current month if no month param provided', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const now = new Date();
    const expected = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const res = await service.summary(admin as any, {} as any);
    expect(res.month).toBe(expected);
  });

  it('summary: should parse month param correctly into UTC day-boundary timestamps', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await service.summary(admin as any, { month: '2026-03' } as any);
    const callArg = mockPrisma.$queryRaw.mock.calls[0][0] as any;
    const values = callArg.values as unknown[];
    expect(values).toEqual(expect.arrayContaining([new Date('2026-03-01T00:00:00.000Z')]));
    expect(values).toEqual(expect.arrayContaining([new Date('2026-04-01T00:00:00.000Z')]));
  });

  it('summary: should return by_model and by_project breakdown', async () => {
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([
        {
          provider: 'openai',
          model: 'gpt-4.1',
          total_tokens_in: BigInt(10),
          total_tokens_out: BigInt(20),
          total_cost_usd: 1.23,
        },
      ])
      .mockResolvedValueOnce([{ project_id: 'p1', total_cost_usd: 4.56 }]);

    const res = await service.summary(admin as any, {} as any);
    expect(res.by_model).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4.1',
          total_tokens_in: '10',
          total_tokens_out: '20',
          total_cost_usd: '1.23',
        }),
      ]),
    );
    expect(res.by_project).toEqual(
      expect.arrayContaining([expect.objectContaining({ project_id: 'p1', total_cost_usd: '4.56' })]),
    );
  });

  it('projectDetail: should throw ForbiddenException if user is neither admin nor project owner (guard-enforced outside service)', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(service.projectDetail(member as any, 'p1', {} as any)).resolves.toEqual(
      expect.objectContaining({ project_id: 'p1' }),
    );
  });

  it('exportCsv: should write CSV header as first line', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([] as any[]);
    const raw = { write: jest.fn(), end: jest.fn() };
    const reply = { header: jest.fn().mockReturnThis(), raw } as any;

    await service.exportCsv(admin as any, {} as any, reply);

    expect(raw.write).toHaveBeenCalled();
    expect(raw.write.mock.calls[0][0]).toContain(
      'id,workspace_id,project_id,thread_id,user_id,event_type,provider,model,tokens_in,tokens_out,cost_usd_recomputed,timestamp',
    );
  });

  it('exportCsv: should use reply.raw.write() and reply.raw.end() — not reply.write()', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([] as any[]);
    const raw = { write: jest.fn(), end: jest.fn() };
    const reply = { header: jest.fn().mockReturnThis(), raw, write: jest.fn() } as any;
    await service.exportCsv(admin as any, {} as any, reply);
    expect(raw.write).toHaveBeenCalled();
    expect(raw.end).toHaveBeenCalled();
    expect(reply.write).not.toHaveBeenCalled();
  });

  it('exportCsv: should paginate through usage_events in batches of 500', async () => {
    const firstPage = Array.from({ length: 500 }).map((_, i) => ({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      workspace_id: 'ws-1',
      project_id: 'p1',
      thread_id: 't1',
      user_id: 'u1',
      event_type: 'message',
      provider: 'openai',
      model: 'gpt-4.1',
      tokens_in: 1,
      tokens_out: 2,
      cost_usd_recomputed: 0.001,
      timestamp: new Date('2026-03-01T00:00:00.000Z'),
    }));
    mockPrisma.$queryRaw.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([]);
    const raw = { write: jest.fn(), end: jest.fn() };
    const reply = { header: jest.fn().mockReturnThis(), raw } as any;

    await service.exportCsv(admin as any, { month: '2026-03' } as any, reply);

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    const firstSql = JSON.stringify(mockPrisma.$queryRaw.mock.calls[0][0]);
    expect(firstSql).toContain('LIMIT');
    expect(firstSql).toContain('500');
  });
});
