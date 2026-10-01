import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';

export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const configService = app.get(ConfigService);
  const apiPrefix = configService.getOrThrow<string>('apiPrefix');
  const corsOrigins = configService.getOrThrow<string[]>('corsOrigins');

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });
  await app.register(compress, {
    global: true,
    encodings: ['gzip', 'deflate'],
  });

  app.setGlobalPrefix(apiPrefix, {
    exclude: ['health/live', 'health/ready'],
  });
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('HydroJimma API')
    .setDescription(
      'Municipal water rationing, standpipe, pressure, leak, and maintenance API',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, openApiDocument, {
    jsonDocumentUrl: 'docs/openapi.json',
  });
}
