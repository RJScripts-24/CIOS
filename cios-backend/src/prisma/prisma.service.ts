import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client'; // Import generated Prisma client entry
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // 1. Create a connection pool using your .env database URL
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    // 2. Wrap it in the Prisma 7 Postgres Adapter
    const adapter = new PrismaPg(pool);
    
    // 3. Pass the adapter to the base PrismaClient
    super({ adapter });
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