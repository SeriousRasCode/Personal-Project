import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { SensorStatus, SensorType } from '../src/generated/prisma/enums.js';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto.js';
import type {
  PressureAggregateResponseDto,
  PressureReadingResponseDto,
  PressureStatsResponseDto,
  RebuildAggregatesResultDto,
  RecordReadingResultDto,
  SensorResponseDto,
} from '../src/modules/telemetry/dto/telemetry-response.dto.js';
import type { StandpipeResponseDto } from '../src/modules/standpipes/dto/standpipe-response.dto.js';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

function jsonBody<T>(response: InjectResponse): T {
  return response.json<T>();
}

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '+251900000000';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'HydroJimma!2026';
const TECHNICIAN_PHONE = '+251911100002';
const TECHNICIAN_PASSWORD = 'FieldTech!2026';
const DISPATCHER_PHONE = '+251933300002';
const DISPATCHER_PASSWORD = 'Dispatch!2026';
const CITIZEN_PHONE = '+251922200002';
const CITIZEN_PASSWORD = 'Citizen!2026';

const SENSOR_LOCATION = { longitude: 36.8319, latitude: 7.6667 };
const KEBELE_CODE = 'GINJO';
const RUN = 'TELE-E2E';
const STANDPIPE_PREFIX = 'TELE-E2E-SP';

function isoAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe('Telemetry (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let technicianToken: string;
  let dispatcherToken: string;
  let citizenToken: string;
  let standpipeId: string;
  let sensorId: string;
  const createdSensorIds: string[] = [];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const login = async (phone: string, password: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone, password },
    });
    expect(response.statusCode).toBe(200);
    return jsonBody<AuthResponseDto>(response).accessToken;
  };

  const post = (
    url: string,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<InjectResponse> =>
    app.inject({ method: 'POST', url, headers: auth(token), payload });

  const patch = (
    url: string,
    token: string,
    payload: Record<string, unknown>,
  ): Promise<InjectResponse> =>
    app.inject({ method: 'PATCH', url, headers: auth(token), payload });

  const get = (url: string, token: string): Promise<InjectResponse> =>
    app.inject({ method: 'GET', url, headers: auth(token) });

  const createSensor = async (
    token: string,
    payload: Record<string, unknown>,
  ): Promise<SensorResponseDto> => {
    const response = await post('/api/v1/telemetry/sensors', token, payload);
    expect(response.statusCode).toBe(201);
    const sensor = jsonBody<SensorResponseDto>(response);
    createdSensorIds.push(sensor.id);
    return sensor;
  };

  const purge = async (): Promise<void> => {
    const sensors = await prisma.telemetrySensor.findMany({
      where: {
        OR: [{ externalId: { startsWith: RUN } }, { name: { contains: RUN } }],
      },
      select: { id: true },
    });
    const ids = sensors.map((sensor) => sensor.id);
    if (ids.length > 0) {
      await prisma.pressureReading.deleteMany({
        where: {
          OR: [{ sensorId: { in: ids } }, { externalId: { startsWith: RUN } }],
        },
      });
      await prisma.telemetrySensor.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.pressureReading.deleteMany({
      where: { externalId: { startsWith: RUN } },
    });
    await prisma.standpipe.deleteMany({
      where: { code: { startsWith: STANDPIPE_PREFIX } },
    });
  };

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

    await purge();
    createdSensorIds.length = 0;

    await prisma.user.deleteMany({
      where: {
        phone: {
          in: [TECHNICIAN_PHONE, DISPATCHER_PHONE, CITIZEN_PHONE],
        },
      },
    });

    adminToken = await login(ADMIN_PHONE, ADMIN_PASSWORD);

    const kebele = await prisma.kebele.findFirst({
      where: { code: KEBELE_CODE },
      select: { id: true },
    });
    if (!kebele) {
      throw new Error(`Seed kebele ${KEBELE_CODE} is missing`);
    }

    const standpipeCode = `${STANDPIPE_PREFIX}-${RUN}`;
    const standpipes = await post('/api/v1/standpipes', adminToken, {
      kebeleId: kebele.id,
      code: standpipeCode,
      name: 'Telemetry Test Standpipe',
      location: SENSOR_LOCATION,
    });
    expect(standpipes.statusCode).toBe(201);
    standpipeId = jsonBody<StandpipeResponseDto>(standpipes).id;

    const technicians = await post('/api/v1/users/staff', adminToken, {
      phone: TECHNICIAN_PHONE,
      displayName: 'Telemetry Technician',
      password: TECHNICIAN_PASSWORD,
      role: 'FIELD_TECHNICIAN',
    });
    expect(technicians.statusCode).toBe(201);
    const dispatchers = await post('/api/v1/users/staff', adminToken, {
      phone: DISPATCHER_PHONE,
      displayName: 'Telemetry Dispatcher',
      password: DISPATCHER_PASSWORD,
      role: 'DISPATCHER',
    });
    expect(dispatchers.statusCode).toBe(201);
    const citizens = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: CITIZEN_PHONE,
        displayName: 'Telemetry Citizen',
        password: CITIZEN_PASSWORD,
      },
    });
    expect(citizens.statusCode).toBe(201);

    const pending = await prisma.user.findUnique({
      where: { phone: CITIZEN_PHONE },
      select: { id: true, status: true },
    });
    expect(pending?.status).toBe('PENDING_VERIFICATION');

    const activated = await patch(
      `/api/v1/users/${pending?.id}/status`,
      adminToken,
      { status: 'ACTIVE' },
    );
    expect(activated.statusCode).toBe(200);

    technicianToken = await login(TECHNICIAN_PHONE, TECHNICIAN_PASSWORD);
    dispatcherToken = await login(DISPATCHER_PHONE, DISPATCHER_PASSWORD);
    citizenToken = await login(CITIZEN_PHONE, CITIZEN_PASSWORD);
  });

  afterAll(async () => {
    await purge();
    await prisma.user.deleteMany({
      where: {
        phone: {
          in: [TECHNICIAN_PHONE, DISPATCHER_PHONE, CITIZEN_PHONE],
        },
      },
    });
    await app.close();
  });

  it('rejects unauthenticated sensor reads', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/telemetry/sensors',
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a citizen listing sensors', async () => {
    const response = await get('/api/v1/telemetry/sensors', citizenToken);
    expect(response.statusCode).toBe(403);
  });

  it('registers a sensor for a standpipe', async () => {
    const sensor = await createSensor(dispatcherToken, {
      standpipeId,
      name: `${RUN} North Ridge Pressure Sensor`,
      type: SensorType.PRESSURE,
      location: SENSOR_LOCATION,
      metadata: { firmware: '1.4.2', installDepthMeters: 2 },
    });
    sensorId = sensor.id;

    expect(sensor.standpipeId).toBe(standpipeId);
    expect(sensor.type).toBe(SensorType.PRESSURE);
    expect(sensor.status).toBe(SensorStatus.ACTIVE);
    expect(sensor.externalId).toBeNull();
    expect(sensor.locationLongitude).toBeCloseTo(SENSOR_LOCATION.longitude, 5);
    expect(sensor.locationLatitude).toBeCloseTo(SENSOR_LOCATION.latitude, 5);
    expect(sensor.metadata).toMatchObject({ firmware: '1.4.2' });
    expect(sensor.lastSeenAt).toBeNull();
  });

  it('rejects a duplicate externalId with a conflict', async () => {
    const first = await createSensor(dispatcherToken, {
      name: `${RUN} Paired Sensor`,
      externalId: `${RUN}-PAIRED-1`,
    });
    expect(first.externalId).toBe(`${RUN}-PAIRED-1`);

    const response = await post('/api/v1/telemetry/sensors', dispatcherToken, {
      name: `${RUN} Paired Sensor Clone`,
      externalId: `${RUN}-PAIRED-1`,
    });
    expect(response.statusCode).toBe(409);
  });

  it('rejects a sensor that references an unknown standpipe', async () => {
    const response = await post('/api/v1/telemetry/sensors', dispatcherToken, {
      name: 'Orphan Sensor',
      standpipeId: '11111111-1111-4111-8111-111111111111',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an out of range location', async () => {
    const response = await post('/api/v1/telemetry/sensors', dispatcherToken, {
      name: 'Broken Sensor',
      location: { longitude: 999, latitude: 7.6 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a field technician registering a sensor', async () => {
    const response = await post('/api/v1/telemetry/sensors', technicianToken, {
      name: `${RUN} Technician Sensor`,
    });
    expect(response.statusCode).toBe(403);
  });

  it('returns the sensor by id and lists it for the kebele', async () => {
    const single = await get(
      `/api/v1/telemetry/sensors/${sensorId}`,
      technicianToken,
    );
    expect(single.statusCode).toBe(200);
    expect(jsonBody<SensorResponseDto>(single).id).toBe(sensorId);

    const list = await get(
      `/api/v1/telemetry/sensors?standpipeId=${standpipeId}`,
      technicianToken,
    );
    expect(list.statusCode).toBe(200);
    const body = jsonBody<{ items: SensorResponseDto[] }>(list);
    expect(body.items.map((item) => item.id)).toContain(sensorId);
  });

  it('returns 404 for an unknown sensor', async () => {
    const response = await get(
      '/api/v1/telemetry/sensors/22222222-2222-4222-8222-222222222222',
      technicianToken,
    );
    expect(response.statusCode).toBe(404);
  });

  it('updates a sensor with an optimistic lock', async () => {
    const current = await get(
      `/api/v1/telemetry/sensors/${sensorId}`,
      dispatcherToken,
    );
    const sensor = jsonBody<SensorResponseDto>(current);

    const updated = await patch(
      `/api/v1/telemetry/sensors/${sensorId}`,
      dispatcherToken,
      {
        name: `${RUN} North Ridge Pressure Sensor v2`,
        status: SensorStatus.MAINTENANCE,
        expectedUpdatedAt: sensor.updatedAt,
      },
    );
    expect(updated.statusCode).toBe(200);
    const body = jsonBody<SensorResponseDto>(updated);
    expect(body.name).toBe(`${RUN} North Ridge Pressure Sensor v2`);
    expect(body.status).toBe(SensorStatus.MAINTENANCE);
    expect(body.updatedAt).not.toBe(sensor.updatedAt);
  });

  it('rejects a stale optimistic lock', async () => {
    const response = await patch(
      `/api/v1/telemetry/sensors/${sensorId}`,
      dispatcherToken,
      {
        name: 'Stale Write',
        status: SensorStatus.ACTIVE,
        expectedUpdatedAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    );
    expect(response.statusCode).toBe(409);
  });

  it('rejects an update without an expectedUpdatedAt token', async () => {
    const response = await patch(
      `/api/v1/telemetry/sensors/${sensorId}`,
      dispatcherToken,
      { name: 'No Token' },
    );
    expect(response.statusCode).toBe(400);
  });

  it('ingests a manual reading and updates lastSeenAt', async () => {
    const response = await post('/api/v1/telemetry/readings', technicianToken, {
      sensorId,
      pressureBar: 3.42,
      flowLitersPerSecond: 0.75,
      source: 'MANUAL',
      observedAt: isoAgo(5),
    });
    expect(response.statusCode).toBe(201);
    const body = jsonBody<RecordReadingResultDto>(response);
    expect(body.created).toBe(true);
    expect(body.accepted).toBe(1);
    expect(body.duplicates).toBe(0);
    const reading = body.readings[0];
    expect(reading.sensorId).toBe(sensorId);
    expect(reading.pressureBar).toBeCloseTo(3.42, 3);

    const sensor = await prisma.telemetrySensor.findUnique({
      where: { id: sensorId },
      select: { lastSeenAt: true },
    });
    expect(sensor?.lastSeenAt).not.toBeNull();
  });

  it('treats a replayed externalId as a duplicate', async () => {
    const payload = {
      sensorId,
      pressureBar: 2.5,
      source: 'SENSOR',
      externalId: `${RUN}-READING-1`,
      observedAt: isoAgo(4),
    };
    const first = await post('/api/v1/telemetry/readings', adminToken, payload);
    expect(first.statusCode).toBe(201);
    expect(jsonBody<RecordReadingResultDto>(first).accepted).toBe(1);

    const second = await post(
      '/api/v1/telemetry/readings',
      adminToken,
      payload,
    );
    expect(second.statusCode).toBe(201);
    const body = jsonBody<RecordReadingResultDto>(second);
    expect(body.created).toBe(false);
    expect(body.accepted).toBe(0);
    expect(body.duplicates).toBe(1);
  });

  it('restricts SENSOR and CSV_IMPORT sources to administrators', async () => {
    const sensorSource = await post(
      '/api/v1/telemetry/readings',
      technicianToken,
      {
        sensorId,
        pressureBar: 3,
        source: 'SENSOR',
        observedAt: isoAgo(3),
      },
    );
    expect(sensorSource.statusCode).toBe(403);

    const importSource = await post(
      '/api/v1/telemetry/readings',
      dispatcherToken,
      {
        sensorId,
        pressureBar: 3,
        source: 'CSV_IMPORT',
        observedAt: isoAgo(3),
      },
    );
    expect(importSource.statusCode).toBe(403);
  });

  it('rejects a reading with too many decimals', async () => {
    const response = await post('/api/v1/telemetry/readings', technicianToken, {
      sensorId,
      pressureBar: 1.23456,
      source: 'MANUAL',
      observedAt: isoAgo(3),
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a reading for an unknown sensor', async () => {
    const response = await post('/api/v1/telemetry/readings', technicianToken, {
      sensorId: '33333333-3333-4333-8333-333333333333',
      pressureBar: 3,
      source: 'MANUAL',
      observedAt: isoAgo(3),
    });
    expect(response.statusCode).toBe(400);
  });

  it('ingests a batch and reports per reading outcomes', async () => {
    const response = await post(
      '/api/v1/telemetry/readings/batch',
      adminToken,
      {
        readings: [
          {
            sensorId,
            pressureBar: 4.1,
            source: 'CSV_IMPORT',
            observedAt: isoAgo(20),
          },
          {
            sensorId,
            pressureBar: 3.9,
            source: 'CSV_IMPORT',
            observedAt: isoAgo(25),
          },
          {
            sensorId,
            pressureBar: 1.1,
            source: 'CSV_IMPORT',
            observedAt: isoAgo(30),
          },
        ],
      },
    );
    expect(response.statusCode).toBe(201);
    const body = jsonBody<RecordReadingResultDto>(response);
    expect(body.accepted).toBe(3);
    expect(body.duplicates).toBe(0);
  });

  it('rejects an empty batch', async () => {
    const response = await post(
      '/api/v1/telemetry/readings/batch',
      adminToken,
      { readings: [] },
    );
    expect(response.statusCode).toBe(400);
  });

  it('lists readings newest first and filters by sensor', async () => {
    const response = await get(
      `/api/v1/telemetry/readings?sensorId=${sensorId}&limit=50`,
      technicianToken,
    );
    expect(response.statusCode).toBe(200);
    const body = jsonBody<{
      items: PressureReadingResponseDto[];
      meta: { total: number };
    }>(response);
    expect(body.meta.total).toBeGreaterThanOrEqual(5);
    expect(body.items.every((item) => item.sensorId === sensorId)).toBe(true);
    const timestamps = body.items.map((item) =>
      new Date(item.observedAt).getTime(),
    );
    const sorted = [...timestamps].sort((left, right) => right - left);
    expect(timestamps).toEqual(sorted);
  });

  it('rejects an inverted reading time range', async () => {
    const response = await get(
      `/api/v1/telemetry/readings?from=${encodeURIComponent(isoAgo(10))}&to=${encodeURIComponent(isoAgo(60))}`,
      technicianToken,
    );
    expect(response.statusCode).toBe(400);
  });

  it('summarises pressure for a window', async () => {
    const response = await get(
      `/api/v1/telemetry/pressure-stats?sensorId=${sensorId}&windowMinutes=60`,
      technicianToken,
    );
    expect(response.statusCode).toBe(200);
    const body = jsonBody<PressureStatsResponseDto>(response);
    expect(body.sampleCount).toBeGreaterThan(0);
    expect(body.averagePressureBar).not.toBeNull();
    expect(body.minimumPressureBar).toBeLessThanOrEqual(
      body.averagePressureBar ?? 0,
    );
    expect(body.maximumPressureBar).toBeGreaterThanOrEqual(
      body.averagePressureBar ?? 0,
    );
    expect(body.lowPressureThresholdBar).toBeGreaterThan(0);
  });

  it('returns empty statistics when the window has no samples', async () => {
    const response = await get(
      '/api/v1/telemetry/pressure-stats?windowMinutes=1',
      technicianToken,
    );
    expect(response.statusCode).toBe(200);
    const body = jsonBody<PressureStatsResponseDto>(response);
    expect(body.sampleCount).toBe(0);
    expect(body.averagePressureBar).toBeNull();
    expect(body.minimumPressureBar).toBeNull();
    expect(body.maximumPressureBar).toBeNull();
  });

  it('rejects an out of range statistics window', async () => {
    const response = await get(
      '/api/v1/telemetry/pressure-stats?windowMinutes=99999',
      technicianToken,
    );
    expect(response.statusCode).toBe(400);
  });

  it('rebuilds aggregates idempotently', async () => {
    const first = await post(
      '/api/v1/telemetry/aggregates/rebuild',
      dispatcherToken,
      { windowMinutes: 60 },
    );
    expect(first.statusCode).toBe(200);
    const firstBody = jsonBody<RebuildAggregatesResultDto>(first);
    expect(firstBody.windowMinutes).toBe(60);
    expect(firstBody.bucketsWritten).toBeGreaterThan(0);
    expect(firstBody.readingsScanned).toBeGreaterThan(0);

    const second = await post(
      '/api/v1/telemetry/aggregates/rebuild',
      dispatcherToken,
      { windowMinutes: 60 },
    );
    expect(second.statusCode).toBe(200);
    const secondBody = jsonBody<RebuildAggregatesResultDto>(second);
    expect(secondBody.bucketsWritten).toBe(firstBody.bucketsWritten);

    const stored = await prisma.pressureAggregate.findMany({
      where: {
        sensorId,
        windowStart: { lt: new Date(firstBody.windowEnd) },
        windowEnd: { gt: new Date(firstBody.windowStart) },
      },
      select: { id: true, windowStart: true, windowEnd: true },
    });
    expect(stored.length).toBeGreaterThanOrEqual(1);
    const ordered = [...stored].sort(
      (left, right) => left.windowStart.getTime() - right.windowStart.getTime(),
    );
    for (const bucket of ordered) {
      expect(bucket.windowEnd.getTime()).toBe(
        bucket.windowStart.getTime() + 3_600_000,
      );
    }
  });

  it('lists the rebuilt aggregates for a standpipe', async () => {
    const response = await get(
      `/api/v1/telemetry/aggregates?sensorId=${sensorId}`,
      technicianToken,
    );
    expect(response.statusCode).toBe(200);
    const body = jsonBody<{ items: PressureAggregateResponseDto[] }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    const aggregate = body.items[0];
    expect(aggregate.sensorId).toBe(sensorId);
    expect(aggregate.sampleCount).toBeGreaterThan(0);
    expect(aggregate.minimumPressureBar).toBeLessThanOrEqual(
      aggregate.maximumPressureBar,
    );
    expect(new Date(aggregate.windowEnd).getTime()).toBeGreaterThan(
      new Date(aggregate.windowStart).getTime(),
    );
  });

  it('rejects a field technician rebuilding aggregates', async () => {
    const response = await post(
      '/api/v1/telemetry/aggregates/rebuild',
      technicianToken,
      { windowMinutes: 60 },
    );
    expect(response.statusCode).toBe(403);
  });

  it('records telemetry audit events', async () => {
    const events = await prisma.auditEvent.findMany({
      where: { action: { startsWith: 'telemetry.' } },
      select: { action: true, entityType: true },
    });
    const actions = events.map((event) => event.action);
    expect(actions).toContain('telemetry.sensor_created');
    expect(actions).toContain('telemetry.sensor_updated');
    expect(actions).toContain('telemetry.aggregates_rebuilt');
  });
});
