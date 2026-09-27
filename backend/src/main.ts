import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { toBoolean } from './config/configuration.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: toBoolean(process.env.TRUST_PROXY, false),
      bodyLimit: 1_048_576,
    }),
  );

  await configureApp(app);

  const configService = app.get(ConfigService);

  await app.listen({
    host: '0.0.0.0',
    port: configService.getOrThrow<number>('port'),
  });
}

await bootstrap();
