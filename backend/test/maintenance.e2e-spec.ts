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
  PipelineResponseDto,
  ValveResponseDto,
} from '../src/modules/maintenance/dto/maintenance-response.dto.js';
import type { ValveStateChangeResultDto } from '../src/modules/maintenance/dto/maintenance.dto.js';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

function jsonBody<T>(response: InjectResponse): T {
  return response.json<T>();
}

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '+251900000000';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'HydroJimma!2026';
const TECHNICIAN_PHONE = '+251911100003';
const TECHNICIAN_PASSWORD = 'FieldTech!2026';
const CITIZEN_PHONE = '+251922200003';
const CITIZEN_PASSWORD = 'Citizen!2026';

const KEBELE_CODE = 'GINJO';
const RUN = 'MAINT-E2E';
const PATH = {
  type: 'LineString',
  coordinates: [
    [36.8319, 7.6667],
    [36.8321, 7.6669],
  ],
};
const LOCATION = { longitude: 36.832, latitude: 7.6668 };

describe('Maintenance registry (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let technicianToken: string;
  let citizenToken: string;
  let kebeleId: string;
  let valveId: string;
  const pipelineIds: string[] = [];
  const valveIds: string[] = [];

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

  const code = (suffix: string): string =>
    `${RUN}-${suffix}-${Date.now().toString(36).toUpperCase().slice(-5)}`;

  const purge = async (): Promise<void> => {
    if (valveIds.length > 0) {
      await prisma.valve.deleteMany({ where: { id: { in: valveIds } } });
    }
    if (pipelineIds.length > 0) {
      await prisma.pipeline.deleteMany({ where: { id: { in: pipelineIds } } });
    }
    await prisma.valve.deleteMany({ where: { name: { contains: RUN } } });
    await prisma.pipeline.deleteMany({ where: { name: { contains: RUN } } });
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
    pipelineIds.length = 0;
    valveIds.length = 0;

    await prisma.user.deleteMany({
      where: { phone: { in: [TECHNICIAN_PHONE, CITIZEN_PHONE] } },
    });

    adminToken = await login(ADMIN_PHONE, ADMIN_PASSWORD);

    const kebele = await prisma.kebele.findFirst({
      where: { code: KEBELE_CODE },
      select: { id: true },
    });
    if (!kebele) {
      throw new Error(`Seed kebele ${KEBELE_CODE} is missing`);
    }
    kebeleId = kebele.id;

    const technician = await post('/api/v1/users/staff', adminToken, {
      phone: TECHNICIAN_PHONE,
      displayName: 'Maintenance Technician',
      password: TECHNICIAN_PASSWORD,
      role: 'FIELD_TECHNICIAN',
    });
    expect(technician.statusCode).toBe(201);

    const citizen = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: CITIZEN_PHONE,
        displayName: 'Maintenance Citizen',
        password: CITIZEN_PASSWORD,
      },
    });
    expect(citizen.statusCode).toBe(201);

    const pending = await prisma.user.findUnique({
      where: { phone: CITIZEN_PHONE },
      select: { id: true },
    });
    const activated = await patch(
      `/api/v1/users/${pending?.id}/status`,
      adminToken,
      { status: 'ACTIVE' },
    );
    expect(activated.statusCode).toBe(200);

    technicianToken = await login(TECHNICIAN_PHONE, TECHNICIAN_PASSWORD);
    citizenToken = await login(CITIZEN_PHONE, CITIZEN_PASSWORD);
  });

  afterAll(async () => {
    await purge();
    await prisma.user.deleteMany({
      where: { phone: { in: [TECHNICIAN_PHONE, CITIZEN_PHONE] } },
    });
    await app.close();
  });

  it('rejects unauthenticated registry reads', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/maintenance/pipelines',
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a citizen listing pipelines', async () => {
    const response = await get('/api/v1/maintenance/pipelines', citizenToken);
    expect(response.statusCode).toBe(403);
  });

  it('registers a pipeline with a line geometry', async () => {
    const response = await post('/api/v1/maintenance/pipelines', adminToken, {
      kebeleId,
      name: `${RUN} Main Trunk`,
      material: 'PVC',
      diameterMillimeters: 300,
      path: PATH,
      installedAt: '2024-02-01',
    });
    expect(response.statusCode).toBe(201);
    const pipeline = jsonBody<PipelineResponseDto>(response);
    pipelineIds.push(pipeline.id);
    expect(pipeline.kebeleId).toBe(kebeleId);
    expect(pipeline.material).toBe('PVC');
    expect(pipeline.diameterMillimeters).toBe(300);
    expect(pipeline.isActive).toBe(true);
    expect(pipeline.path.type).toBe('LineString');
    expect(pipeline.path.coordinates).toHaveLength(2);
    expect(pipeline.installedAt).toBeTruthy();
  });

  it('rejects a pipeline with an invalid geometry', async () => {
    const response = await post('/api/v1/maintenance/pipelines', adminToken, {
      kebeleId,
      name: `${RUN} Broken`,
      path: { type: 'LineString', coordinates: [[36.8]] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a pipeline for an unknown kebele', async () => {
    const response = await post('/api/v1/maintenance/pipelines', adminToken, {
      kebeleId: '44444444-4444-4444-8444-444444444444',
      name: `${RUN} Orphan`,
      path: PATH,
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a field technician registering a pipeline', async () => {
    const response = await post(
      '/api/v1/maintenance/pipelines',
      technicianToken,
      { kebeleId, name: `${RUN} Unauthorized`, path: PATH },
    );
    expect(response.statusCode).toBe(403);
  });

  it('updates a pipeline with an optimistic lock', async () => {
    const list = await get('/api/v1/maintenance/pipelines', adminToken);
    const pipelines = jsonBody<{ items: PipelineResponseDto[] }>(list);
    const pipeline = pipelines.items[0];

    const response = await patch(
      `/api/v1/maintenance/pipelines/${pipeline.id}`,
      adminToken,
      {
        name: `${RUN} Main Trunk Rerouted`,
        path: PATH,
        isActive: false,
        expectedUpdatedAt: pipeline.updatedAt,
      },
    );
    expect(response.statusCode).toBe(200);
    const body = jsonBody<PipelineResponseDto>(response);
    expect(body.name).toBe(`${RUN} Main Trunk Rerouted`);
    expect(body.isActive).toBe(false);
    expect(body.material).toBe('PVC');
  });

  it('rejects a stale pipeline lock', async () => {
    const list = await get('/api/v1/maintenance/pipelines', adminToken);
    const pipelines = jsonBody<{ items: PipelineResponseDto[] }>(list);
    const pipeline = pipelines.items[0];

    const response = await patch(
      `/api/v1/maintenance/pipelines/${pipeline.id}`,
      adminToken,
      {
        name: `${RUN} Stale`,
        path: PATH,
        expectedUpdatedAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    );
    expect(response.statusCode).toBe(409);
  });

  it('returns 404 for an unknown pipeline', async () => {
    const response = await get(
      '/api/v1/maintenance/pipelines/55555555-5555-4555-8555-555555555555',
      technicianToken,
    );
    expect(response.statusCode).toBe(404);
  });

  it('filters pipelines by kebele and active state', async () => {
    const response = await get(
      `/api/v1/maintenance/pipelines?kebeleId=${kebeleId}&isActive=false`,
      technicianToken,
    );
    expect(response.statusCode).toBe(200);
    const body = jsonBody<{ items: PipelineResponseDto[] }>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((item) => item.isActive === false)).toBe(true);
  });

  it('registers a valve in the closed position', async () => {
    const response = await post('/api/v1/maintenance/valves', adminToken, {
      kebeleId,
      name: `${RUN} Ridge Valve`,
      code: code('V1'),
      location: LOCATION,
    });
    expect(response.statusCode).toBe(201);
    const valve = jsonBody<ValveResponseDto>(response);
    valveIds.push(valve.id);
    valveId = valve.id;
    expect(valve.isOpen).toBe(false);
    expect(valve.position).toBe('CLOSED');
    expect(valve.longitude).toBeCloseTo(LOCATION.longitude, 5);
    expect(valve.latitude).toBeCloseTo(LOCATION.latitude, 5);
    expect(valve.lastChangedAt).toBeNull();
  });

  it('rejects a duplicate valve code', async () => {
    const shared = code('DUP');
    const first = await post('/api/v1/maintenance/valves', adminToken, {
      kebeleId,
      name: `${RUN} Duplicate A`,
      code: shared,
      location: LOCATION,
    });
    expect(first.statusCode).toBe(201);
    valveIds.push(jsonBody<ValveResponseDto>(first).id);

    const second = await post('/api/v1/maintenance/valves', adminToken, {
      kebeleId,
      name: `${RUN} Duplicate B`,
      code: shared,
      location: LOCATION,
    });
    expect(second.statusCode).toBe(409);
  });

  it('rejects a valve with a malformed code', async () => {
    const response = await post('/api/v1/maintenance/valves', adminToken, {
      kebeleId,
      name: `${RUN} Bad Code`,
      code: 'lowercase code!',
      location: LOCATION,
    });
    expect(response.statusCode).toBe(400);
  });

  it('normalises a valve code to upper case', async () => {
    const response = await post('/api/v1/maintenance/valves', adminToken, {
      kebeleId,
      name: `${RUN} Normalised`,
      code: code('norm').toLowerCase(),
      location: LOCATION,
    });
    expect(response.statusCode).toBe(201);
    const valve = jsonBody<ValveResponseDto>(response);
    valveIds.push(valve.id);
    expect(valve.code).toBe(valve.code.toUpperCase());
  });

  it('opens a valve and records the operator', async () => {
    const response = await post(
      `/api/v1/maintenance/valves/${valveId}/state`,
      technicianToken,
      { isOpen: true },
    );
    expect(response.statusCode).toBe(201);
    const body = jsonBody<ValveStateChangeResultDto>(response);
    expect(body.position).toBe('OPEN');
    expect(body.previousPosition).toBe('CLOSED');
    expect(body.changedById).toBeTruthy();
    expect(new Date(body.changedAt).getTime()).toBeGreaterThan(0);

    const stored = await prisma.valve.findUnique({
      where: { id: valveId },
      select: { isOpen: true, lastChangedAt: true, lastChangedById: true },
    });
    expect(stored?.isOpen).toBe(true);
    expect(stored?.lastChangedAt).not.toBeNull();
    expect(stored?.lastChangedById).toBe(body.changedById);
  });

  it('rejects reopening a valve that is already open', async () => {
    const response = await post(
      `/api/v1/maintenance/valves/${valveId}/state`,
      technicianToken,
      { isOpen: true },
    );
    expect(response.statusCode).toBe(409);
  });

  it('closes the valve again', async () => {
    const response = await post(
      `/api/v1/maintenance/valves/${valveId}/state`,
      technicianToken,
      { isOpen: false },
    );
    expect(response.statusCode).toBe(201);
    const body = jsonBody<ValveStateChangeResultDto>(response);
    expect(body.position).toBe('CLOSED');
    expect(body.previousPosition).toBe('OPEN');
  });

  it('rejects a citizen operating a valve', async () => {
    const response = await post(
      `/api/v1/maintenance/valves/${valveId}/state`,
      citizenToken,
      { isOpen: true },
    );
    expect(response.statusCode).toBe(403);
  });

  it('rejects a state change for an unknown valve', async () => {
    const response = await post(
      '/api/v1/maintenance/valves/66666666-6666-4666-8666-666666666666/state',
      technicianToken,
      { isOpen: true },
    );
    expect(response.statusCode).toBe(404);
  });

  it('rejects a stale valve state change', async () => {
    const response = await post(
      `/api/v1/maintenance/valves/${valveId}/state`,
      technicianToken,
      {
        isOpen: true,
        expectedUpdatedAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    );
    expect(response.statusCode).toBe(409);
  });

  it('updates valve registry details without changing position', async () => {
    const current = await get(
      `/api/v1/maintenance/valves/${valveId}`,
      technicianToken,
    );
    const valve = jsonBody<ValveResponseDto>(current);

    const response = await patch(
      `/api/v1/maintenance/valves/${valveId}`,
      adminToken,
      {
        name: `${RUN} Ridge Valve Renamed`,
        code: valve.code,
        location: { longitude: 36.8325, latitude: 7.6672 },
        expectedUpdatedAt: valve.updatedAt,
      },
    );
    expect(response.statusCode).toBe(200);
    const body = jsonBody<ValveResponseDto>(response);
    expect(body.name).toBe(`${RUN} Ridge Valve Renamed`);
    expect(body.longitude).toBeCloseTo(36.8325, 5);
    expect(body.position).toBe('CLOSED');
  });

  it('filters valves by open state and search', async () => {
    const open = await get(
      '/api/v1/maintenance/valves?isOpen=true',
      technicianToken,
    );
    expect(open.statusCode).toBe(200);
    const openBody = jsonBody<{ items: ValveResponseDto[] }>(open);
    expect(openBody.items.every((item) => item.isOpen)).toBe(true);

    const search = await get(
      `/api/v1/maintenance/valves?search=${encodeURIComponent(RUN)}`,
      technicianToken,
    );
    expect(search.statusCode).toBe(200);
    const searchBody = jsonBody<{ items: ValveResponseDto[] }>(search);
    expect(searchBody.items.length).toBeGreaterThan(0);
  });

  it('records maintenance audit events', async () => {
    const events = await prisma.auditEvent.findMany({
      where: {
        action: {
          in: [
            'maintenance.pipeline_created',
            'maintenance.pipeline_updated',
            'maintenance.valve_created',
            'maintenance.valve_updated',
            'valve.opened',
            'valve.closed',
          ],
        },
      },
      select: { action: true },
    });
    const actions = events.map((event) => event.action);
    expect(actions).toContain('maintenance.pipeline_created');
    expect(actions).toContain('maintenance.pipeline_updated');
    expect(actions).toContain('maintenance.valve_created');
    expect(actions).toContain('maintenance.valve_updated');
    expect(actions).toContain('valve.opened');
    expect(actions).toContain('valve.closed');
  });
});
