import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  // Pass the FastifyAdapter to the factory
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );

  // The '0.0.0.0' is critical for Fastify
  await app.listen(3000, '0.0.0.0');
}
bootstrap();