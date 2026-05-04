// [NEW FILE]
import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { workspaceScope } from '../../common/helpers/workspace-scope.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { FinanceQueryDto } from './dto/finance-query.dto';
import type {
  FinanceProjectDetailResponse,
  FinanceSummaryResponse,
} from './interfaces/finance-summary.interface';
import type { FastifyReply } from 'fastify';

function monthBounds(month?: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  const label =
    month ??
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const [y, m] = label.split('-').map((v) => Number.parseInt(v, 10));
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  return { start, end, label };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Workspace finance summary recomputed from usage_events × model_pricing.
   */
  async summary(user: JwtPayload, dto: FinanceQueryDto): Promise<FinanceSummaryResponse> {
    const workspaceId = this.requireWs(user);
    const { start, end, label } = monthBounds(dto.month);

    const by_model = await this.prisma.$queryRaw<
      {
        provider: string;
        model: string;
        total_tokens_in: bigint | null;
        total_tokens_out: bigint | null;
        total_cost_usd: unknown;
      }[]
    >(Prisma.sql`
      SELECT
        ue.provider,
        ue.model,
        SUM(ue.tokens_in) AS total_tokens_in,
        SUM(ue.tokens_out) AS total_tokens_out,
        SUM(
          COALESCE(ue.tokens_in, 0) * COALESCE(mp.price_per_1k_token_in, 0) / 1000.0
          + COALESCE(ue.tokens_out, 0) * COALESCE(mp.price_per_1k_token_out, 0) / 1000.0
        ) AS total_cost_usd
      FROM usage_events ue
      LEFT JOIN model_pricing mp
        ON mp.provider = ue.provider
        AND mp.model_name = ue.model
        AND mp.is_current = TRUE
      WHERE ue.workspace_id = ${workspaceId}::uuid
        AND ue.timestamp >= ${start}
        AND ue.timestamp < ${end}
      GROUP BY ue.provider, ue.model
      ORDER BY total_cost_usd DESC NULLS LAST
    `);

    const by_project = await this.prisma.$queryRaw<
      { project_id: string; total_cost_usd: unknown }[]
    >(Prisma.sql`
      SELECT
        ue.project_id,
        SUM(
          COALESCE(ue.tokens_in, 0) * COALESCE(mp.price_per_1k_token_in, 0) / 1000.0
          + COALESCE(ue.tokens_out, 0) * COALESCE(mp.price_per_1k_token_out, 0) / 1000.0
        ) AS total_cost_usd
      FROM usage_events ue
      LEFT JOIN model_pricing mp
        ON mp.provider = ue.provider
        AND mp.model_name = ue.model
        AND mp.is_current = TRUE
      WHERE ue.workspace_id = ${workspaceId}::uuid
        AND ue.timestamp >= ${start}
        AND ue.timestamp < ${end}
        AND ue.project_id IS NOT NULL
      GROUP BY ue.project_id
      ORDER BY total_cost_usd DESC NULLS LAST
    `);

    return {
      month: label,
      by_model: by_model.map((r) => ({
        provider: r.provider,
        model: r.model,
        total_tokens_in: r.total_tokens_in?.toString() ?? null,
        total_tokens_out: r.total_tokens_out?.toString() ?? null,
        total_cost_usd: r.total_cost_usd != null ? String(r.total_cost_usd) : null,
      })),
      by_project: by_project.map((r) => ({
        project_id: r.project_id,
        total_cost_usd: r.total_cost_usd != null ? String(r.total_cost_usd) : null,
      })),
    };
  }

  /**
   * Per-project finance breakdown for admins or project owners.
   */
  async projectDetail(
    user: JwtPayload,
    projectId: string,
    dto: FinanceQueryDto,
  ): Promise<FinanceProjectDetailResponse> {
    const workspaceId = this.requireWs(user);
    const { start, end, label } = monthBounds(dto.month);

    const by_model = await this.prisma.$queryRaw<
      {
        provider: string;
        model: string;
        total_tokens_in: bigint | null;
        total_tokens_out: bigint | null;
        total_cost_usd: unknown;
      }[]
    >(Prisma.sql`
      SELECT
        ue.provider,
        ue.model,
        SUM(ue.tokens_in) AS total_tokens_in,
        SUM(ue.tokens_out) AS total_tokens_out,
        SUM(
          COALESCE(ue.tokens_in, 0) * COALESCE(mp.price_per_1k_token_in, 0) / 1000.0
          + COALESCE(ue.tokens_out, 0) * COALESCE(mp.price_per_1k_token_out, 0) / 1000.0
        ) AS total_cost_usd
      FROM usage_events ue
      LEFT JOIN model_pricing mp
        ON mp.provider = ue.provider
        AND mp.model_name = ue.model
        AND mp.is_current = TRUE
      WHERE ue.workspace_id = ${workspaceId}::uuid
        AND ue.project_id = ${projectId}::uuid
        AND ue.timestamp >= ${start}
        AND ue.timestamp < ${end}
      GROUP BY ue.provider, ue.model
      ORDER BY total_cost_usd DESC NULLS LAST
    `);

    const by_user = await this.prisma.$queryRaw<
      { user_id: string | null; total_cost_usd: unknown }[]
    >(Prisma.sql`
      SELECT
        ue.user_id,
        SUM(
          COALESCE(ue.tokens_in, 0) * COALESCE(mp.price_per_1k_token_in, 0) / 1000.0
          + COALESCE(ue.tokens_out, 0) * COALESCE(mp.price_per_1k_token_out, 0) / 1000.0
        ) AS total_cost_usd
      FROM usage_events ue
      LEFT JOIN model_pricing mp
        ON mp.provider = ue.provider
        AND mp.model_name = ue.model
        AND mp.is_current = TRUE
      WHERE ue.workspace_id = ${workspaceId}::uuid
        AND ue.project_id = ${projectId}::uuid
        AND ue.timestamp >= ${start}
        AND ue.timestamp < ${end}
      GROUP BY ue.user_id
      ORDER BY total_cost_usd DESC NULLS LAST
    `);

    const by_event_type = await this.prisma.$queryRaw<
      { event_type: string; total_cost_usd: unknown }[]
    >(Prisma.sql`
      SELECT
        ue.event_type,
        SUM(
          COALESCE(ue.tokens_in, 0) * COALESCE(mp.price_per_1k_token_in, 0) / 1000.0
          + COALESCE(ue.tokens_out, 0) * COALESCE(mp.price_per_1k_token_out, 0) / 1000.0
        ) AS total_cost_usd
      FROM usage_events ue
      LEFT JOIN model_pricing mp
        ON mp.provider = ue.provider
        AND mp.model_name = ue.model
        AND mp.is_current = TRUE
      WHERE ue.workspace_id = ${workspaceId}::uuid
        AND ue.project_id = ${projectId}::uuid
        AND ue.timestamp >= ${start}
        AND ue.timestamp < ${end}
      GROUP BY ue.event_type
      ORDER BY total_cost_usd DESC NULLS LAST
    `);

    return {
      month: label,
      project_id: projectId,
      by_model: by_model.map((r) => ({
        provider: r.provider,
        model: r.model,
        total_tokens_in: r.total_tokens_in?.toString() ?? null,
        total_tokens_out: r.total_tokens_out?.toString() ?? null,
        total_cost_usd: r.total_cost_usd != null ? String(r.total_cost_usd) : null,
      })),
      by_user: by_user.map((r) => ({
        user_id: r.user_id,
        total_cost_usd: r.total_cost_usd != null ? String(r.total_cost_usd) : null,
      })),
      by_event_type: by_event_type.map((r) => ({
        event_type: r.event_type,
        total_cost_usd: r.total_cost_usd != null ? String(r.total_cost_usd) : null,
      })),
    };
  }

  /**
   * Streams a CSV of raw usage events × recomputed cost for the given month.
   * Caller sets Content-Type and Content-Disposition headers via reply before any writes.
   */
  async exportCsv(
    user: JwtPayload,
    dto: FinanceQueryDto,
    reply: FastifyReply,
  ): Promise<void> {
    const workspaceId = this.requireWs(user);
    const { start, end, label } = monthBounds(dto.month);

    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header(
      'Content-Disposition',
      `attachment; filename="finance-${label}.csv"`,
    );

    const raw = reply.raw;

    const HEADER =
      'id,workspace_id,project_id,thread_id,user_id,event_type,provider,model,tokens_in,tokens_out,cost_usd_recomputed,timestamp\n';
    raw.write(HEADER);

    let lastId: string | undefined;
    let rowCount = 0;
    const PAGE = 500;

    while (rowCount < 10_000) {
      const rows = await this.prisma.$queryRaw<
        {
          id: string;
          workspace_id: string;
          project_id: string | null;
          thread_id: string | null;
          user_id: string | null;
          event_type: string;
          provider: string;
          model: string;
          tokens_in: number | null;
          tokens_out: number | null;
          cost_usd_recomputed: unknown;
          timestamp: Date;
        }[]
      >(Prisma.sql`
      SELECT
        ue.id, ue.workspace_id, ue.project_id, ue.thread_id, ue.user_id,
        ue.event_type, ue.provider, ue.model, ue.tokens_in, ue.tokens_out,
        (
          COALESCE(ue.tokens_in, 0) * COALESCE(mp.price_per_1k_token_in, 0) / 1000.0
          + COALESCE(ue.tokens_out, 0) * COALESCE(mp.price_per_1k_token_out, 0) / 1000.0
        ) AS cost_usd_recomputed,
        ue.timestamp
      FROM usage_events ue
      LEFT JOIN model_pricing mp
        ON mp.provider = ue.provider AND mp.model_name = ue.model AND mp.is_current = TRUE
      WHERE ue.workspace_id = ${workspaceId}::uuid
        AND ue.timestamp >= ${start}
        AND ue.timestamp < ${end}
        ${lastId ? Prisma.sql`AND ue.id > ${lastId}::uuid` : Prisma.sql``}
      ORDER BY ue.id ASC
      LIMIT ${PAGE}
    `);

      if (!rows.length) break;

      for (const r of rows) {
        const line = [
          r.id,
          r.workspace_id,
          r.project_id ?? '',
          r.thread_id ?? '',
          r.user_id ?? '',
          r.event_type,
          r.provider,
          r.model,
          r.tokens_in?.toString() ?? '',
          r.tokens_out?.toString() ?? '',
          r.cost_usd_recomputed != null ? String(r.cost_usd_recomputed) : '',
          r.timestamp.toISOString(),
        ]
          .map((v) => csvEscape(String(v)))
          .join(',');
        raw.write(line + '\n');
      }

      lastId = rows[rows.length - 1]!.id;
      rowCount += rows.length;
      if (rows.length < PAGE) break;
    }

    raw.end();
  }

  private requireWs(user: JwtPayload): string {
    const id = user.workspace_id;
    if (!id) throw new ForbiddenException('User has no workspace assigned');
    return id;
  }
}
