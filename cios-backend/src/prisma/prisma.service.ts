import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client'; // Import generated Prisma client entry
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }

    const poolMax = PrismaService.getIntEnv('DATABASE_POOL_MAX', 10);
    const connectionTimeoutMs = PrismaService.getIntEnv(
      'DATABASE_CONNECTION_TIMEOUT_MS',
      10_000,
    );
    const idleTimeoutMs = PrismaService.getIntEnv(
      'DATABASE_IDLE_TIMEOUT_MS',
      30_000,
    );
    const useSsl = (process.env.DATABASE_SSL ?? 'false').toLowerCase() === 'true';

    // Use a bounded pool and predictable timeouts for containerized platforms.
    const pool = new Pool({
      connectionString,
      max: poolMax,
      connectionTimeoutMillis: connectionTimeoutMs,
      idleTimeoutMillis: idleTimeoutMs,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });
    
    // 2. Wrap it in the Prisma 7 Postgres Adapter
    const adapter = new PrismaPg(pool);
    
    // 3. Pass the adapter to the base PrismaClient
    super({ adapter });
  }

  private static getIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
      return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  // Connect to the database when the module initializes
  async onModuleInit() {
    await this.$connect();
  }

  // Clean up the connection when the app shuts down
  async onModuleDestroy() {
    await this.$disconnect();
  }
}