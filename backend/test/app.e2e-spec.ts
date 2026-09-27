import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import type { HealthController } from '../src/health/health.controller.js';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;
type ReadinessResponse = Awaited<ReturnType<HealthController['ready']>>;

function jsonBody<T>(response: InjectResponse): T {
  return response.json<T>();
}

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  it('GET /api/v1', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'HydroJimma API',
      status: 'operational',
    });
  });

  it('GET /health/live stays outside the api prefix', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /health/ready reports dependency status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<ReadinessResponse>(response);
    expect(body.status).toBe('ok');
    expect(body.checks.database?.status).toBe('up');
    expect(body.checks.redis?.status).toBe('up');
  });

  it('rejects unrecognised body properties', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone: '+251900000000', password: 'x', extra: true },
    });

    expect(response.statusCode).toBe(400);
  });

  it('serves the generated OpenAPI document', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/docs/openapi.json',
    });

    expect(response.statusCode).toBe(200);
    const document = jsonBody<OpenAPIObject>(response);
    expect(document.info.title).toBe('HydroJimma API');
    expect(document.paths['/api/v1/reports/tap-status']).toBeDefined();
  });

  afterAll(async () => {
    await app.close();
  });
});
