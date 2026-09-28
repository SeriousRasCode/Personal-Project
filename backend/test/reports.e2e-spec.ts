import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto.js';
import type {
  KebeleConsensusListResponseDto,
  QueueSnapshotResponseDto,
  TapConsensusResponseDto,
  TapStatusReportCreatedResponseDto,
  TapStatusReportListResponseDto,
} from '../src/modules/reports/dto/report-response.dto.js';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

function jsonBody<T>(response: InjectResponse): T {
  return response.json<T>();
}

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '+251900000000';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'HydroJimma!2026';

const STATION_CODE = 'E2E-STP-01';
const KEBELE_CODE = 'GINJO';

describe('Reports and consensus (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let standpipeId: string;
  let kebeleId: string;

  const auth = () => ({ authorization: `Bearer ${accessToken}` });

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

    prisma = app.get(PrismaService);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone: ADMIN_PHONE, password: ADMIN_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    accessToken = jsonBody<AuthResponseDto>(login).accessToken;

    const kebele = await prisma.kebele.findFirst({
      where: { code: KEBELE_CODE },
      select: { id: true },
    });
    if (!kebele) {
      throw new Error(`Seed kebele ${KEBELE_CODE} is missing`);
    }
    kebeleId = kebele.id;

    await prisma.standpipe.deleteMany({ where: { code: STATION_CODE } });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/standpipes',
      headers: auth(),
      payload: {
        kebeleId,
        code: STATION_CODE,
        name: 'End to end standpipe',
        location: { longitude: 36.8319, latitude: 7.6667 },
      },
    });
    expect(created.statusCode).toBe(201);
    standpipeId = jsonBody<{ id: string }>(created).id;
  }, 60_000);

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({
      where: {
        eventType: { in: ['tap_status.reported', 'queue_wait.reported'] },
      },
    });
    if (standpipeId) {
      await prisma.standpipe.deleteMany({ where: { code: STATION_CODE } });
    }
    await app.close();
  });

  it('rejects unauthenticated report submissions', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/tap-status',
      payload: { standpipeId, status: 'DRY' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a report for an unknown standpipe', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/tap-status',
      headers: auth(),
      payload: {
        standpipeId: '3f1b1a52-9d0a-4a2f-8f2a-6b7f0f5b1c22',
        status: 'DRY',
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects an invalid flow status', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/tap-status',
      headers: auth(),
      payload: { standpipeId, status: 'SPOUTING' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('records a tap status report and returns the computed consensus', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/tap-status',
      headers: auth(),
      payload: { standpipeId, status: 'TRICKLE', source: 'OPERATOR_APP' },
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody<TapStatusReportCreatedResponseDto>(response);
    expect(body.report.status).toBe('TRICKLE');
    expect(body.consensus.status).toBe('TRICKLE');
    expect(body.consensus.sampleCount).toBe(1);
    expect(body.consensus.confidence).toBeGreaterThan(0);
    expect(
      body.consensus.fullFlowScore +
        body.consensus.trickleScore +
        body.consensus.dryScore,
    ).toBeCloseTo(1, 5);
  });

  it('persists the consensus row', async () => {
    const stored = await prisma.tapConsensus.findUnique({
      where: { standpipeId },
    });

    expect(stored?.status).toBe('TRICKLE');
    expect(Number(stored?.sampleCount)).toBe(1);
  });

  it('emits an outbox event for every report', async () => {
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: standpipeId, eventType: 'tap_status.reported' },
    });

    expect(events.length).toBeGreaterThan(0);
  });

  it('shifts consensus when corroborating reports arrive', async () => {
    for (const status of ['DRY', 'DRY', 'DRY']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/reports/tap-status',
        headers: auth(),
        payload: { standpipeId, status },
      });
      expect(response.statusCode).toBe(201);
    }

    const stored = await prisma.tapConsensus.findUnique({
      where: { standpipeId },
    });

    expect(stored?.status).toBe('DRY');
    expect(Number(stored?.sampleCount)).toBe(4);
  });

  it('serves the consensus publicly without a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/consensus/standpipes/${standpipeId}/tap-status`,
    });

    expect(response.statusCode).toBe(200);
    expect(jsonBody<TapConsensusResponseDto>(response).status).toBe('DRY');
  });

  it('returns 404 for consensus of an unknown standpipe', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/consensus/standpipes/3f1b1a52-9d0a-4a2f-8f2a-6b7f0f5b1c22/tap-status',
    });

    expect(response.statusCode).toBe(404);
  });

  it('lists reports with pagination metadata', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/tap-status?standpipeId=${standpipeId}&limit=2`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<TapStatusReportListResponseDto>(response);
    expect(body.items).toHaveLength(2);
    expect(body.meta.total).toBe(4);
    expect(body.meta.totalPages).toBe(2);
  });

  it('filters reports by status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/tap-status?standpipeId=${standpipeId}&status=TRICKLE`,
      headers: auth(),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<TapStatusReportListResponseDto>(response);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.status).toBe('TRICKLE');
  });

  it('builds a queue snapshot once enough reports exist', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/queue-wait',
      headers: auth(),
      payload: { standpipeId, waitMinutes: 60, queueSize: 40 },
    });
    expect(first.statusCode).toBe(201);
    expect(
      jsonBody<{ snapshot: QueueSnapshotResponseDto | null }>(first).snapshot,
    ).toBeNull();

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/queue-wait',
      headers: auth(),
      payload: { standpipeId, waitMinutes: 30, queueSize: 20 },
    });
    expect(second.statusCode).toBe(201);

    const snapshot = jsonBody<{ snapshot: QueueSnapshotResponseDto | null }>(
      second,
    ).snapshot;
    expect(snapshot).not.toBeNull();
    expect(snapshot?.waitMinutes).toBe(45);
    expect(snapshot?.trend).toBe('STABLE');
    expect(snapshot?.sampleCount).toBe(2);
  });

  it('serves the latest queue snapshot publicly', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/consensus/standpipes/${standpipeId}/queue`,
    });

    expect(response.statusCode).toBe(200);
    expect(jsonBody<QueueSnapshotResponseDto>(response).waitMinutes).toBe(45);
  });

  it('summarises a kebele for the citizen map', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/consensus/kebeles/${kebeleId}/standpipes`,
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<KebeleConsensusListResponseDto>(response);
    const station = body.items.find((item) => item.standpipeId === standpipeId);
    expect(station).toBeDefined();
    expect(station?.tapStatus).toBe('DRY');
    expect(station?.waitMinutes).toBe(45);
  });

  it('rejects a queue report with an out of range wait', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/queue-wait',
      headers: auth(),
      payload: { standpipeId, waitMinutes: 5000 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an observedAt in the future', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/tap-status',
      headers: auth(),
      payload: {
        standpipeId,
        status: 'DRY',
        observedAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('caps the stored reliability weight for the reporter role', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/tap-status',
      headers: auth(),
      payload: { standpipeId, status: 'DRY', reliabilityWeight: 5 },
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody<TapStatusReportCreatedResponseDto>(response);
    expect(body.report.reliabilityWeight).toBe(5);
  });
});
