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
  LeakClusterDetailResponseDto,
  LeakClusterListResponseDto,
  LeakClusterResponseDto,
  LeakReportCreatedResponseDto,
  LeakReportListResponseDto,
  PublicLeakClusterListResponseDto,
} from '../src/modules/leaks/dto/leak-response.dto.js';
import type {
  WorkOrderActivityListResponseDto,
  WorkOrderListResponseDto,
  WorkOrderResponseDto,
} from '../src/modules/work-orders/dto/work-order-response.dto.js';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

function jsonBody<T>(response: InjectResponse): T {
  return response.json<T>();
}

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '+251900000000';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'HydroJimma!2026';
const TECHNICIAN_PHONE = '+251911100001';
const TECHNICIAN_PASSWORD = 'FieldTech!2026';
const CITIZEN_PHONE = '+251922200001';
const CITIZEN_PASSWORD = 'Citizen!2026';

const KEBELE_CODE = 'GINJO';
const NEAR = { longitude: 36.8319, latitude: 7.6667 };
const NEARBY = { longitude: 36.8321, latitude: 7.6669 };
const ADJACENT = { longitude: 36.832, latitude: 7.6668 };
const DISTANT = { longitude: 36.9, latitude: 7.75 };
const DESCRIPTION =
  'Water is spraying continuously from the pipe beside the road.';

describe('Leaks and work orders (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let technicianToken: string;
  let citizenToken: string;
  let kebeleId: string;
  let clusterId: string;
  let workOrderId: string;
  const createdReportIds: string[] = [];
  const createdClusterIds: string[] = [];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const createLeak = (
    token: string,
    payload: Record<string, unknown>,
  ): Promise<InjectResponse> =>
    app.inject({
      method: 'POST',
      url: '/api/v1/leaks/reports',
      headers: auth(token),
      payload,
    });

  const login = async (phone: string, password: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { phone, password },
    });
    expect(response.statusCode).toBe(200);
    return jsonBody<AuthResponseDto>(response).accessToken;
  };

  const currentVersion = async (): Promise<string> => {
    const order = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { updatedAt: true },
    });
    if (!order) {
      throw new Error('Work order is missing');
    }
    return order.updatedAt.toISOString();
  };

  const moveWorkOrder = (
    token: string,
    payload: Record<string, unknown>,
  ): Promise<InjectResponse> =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/work-orders/${workOrderId}/status`,
      headers: auth(token),
      payload,
    });

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

    adminToken = await login(ADMIN_PHONE, ADMIN_PASSWORD);

    const kebele = await prisma.kebele.findFirst({
      where: { code: KEBELE_CODE },
      select: { id: true },
    });
    if (!kebele) {
      throw new Error(`Seed kebele ${KEBELE_CODE} is missing`);
    }
    kebeleId = kebele.id;

    await prisma.user.deleteMany({
      where: { phone: { in: [TECHNICIAN_PHONE, CITIZEN_PHONE] } },
    });

    const technician = await app.inject({
      method: 'POST',
      url: '/api/v1/users/staff',
      headers: auth(adminToken),
      payload: {
        phone: TECHNICIAN_PHONE,
        displayName: 'Field Technician',
        password: TECHNICIAN_PASSWORD,
        role: 'FIELD_TECHNICIAN',
      },
    });
    expect(technician.statusCode).toBe(201);
    expect(jsonBody<{ role: string }>(technician).role).toBe(
      'FIELD_TECHNICIAN',
    );
    technicianToken = await login(TECHNICIAN_PHONE, TECHNICIAN_PASSWORD);

    const citizen = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: CITIZEN_PHONE,
        displayName: 'Concerned Citizen',
        password: CITIZEN_PASSWORD,
      },
    });
    expect(citizen.statusCode).toBe(201);

    const pending = await prisma.user.findUnique({
      where: { phone: CITIZEN_PHONE },
      select: { id: true, status: true },
    });
    expect(pending?.status).toBe('PENDING_VERIFICATION');

    const activated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${pending?.id}/status`,
      headers: auth(adminToken),
      payload: { status: 'ACTIVE' },
    });
    expect(activated.statusCode).toBe(200);
    citizenToken = await login(CITIZEN_PHONE, CITIZEN_PASSWORD);

    await prisma.workOrder.deleteMany({
      where: { leakClusterId: { not: null } },
    });
    await prisma.leakReport.deleteMany({});
    await prisma.leakCluster.deleteMany({});
  }, 120_000);

  afterAll(async () => {
    if (workOrderId !== undefined) {
      await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    }
    await prisma.workOrder.deleteMany({
      where: { leakClusterId: { in: createdClusterIds } },
    });
    if (createdReportIds.length > 0) {
      await prisma.leakReport.deleteMany({
        where: { id: { in: createdReportIds } },
      });
    }
    if (createdClusterIds.length > 0) {
      await prisma.leakCluster.deleteMany({
        where: { id: { in: createdClusterIds } },
      });
      await prisma.outboxEvent.deleteMany({
        where: {
          OR: [
            { aggregateId: { in: createdClusterIds } },
            { aggregateId: workOrderId },
          ],
        },
      });
      await prisma.auditEvent.deleteMany({
        where: { entityId: { in: [...createdClusterIds, workOrderId] } },
      });
    }
    await prisma.user.deleteMany({
      where: { phone: { in: [TECHNICIAN_PHONE, CITIZEN_PHONE] } },
    });
    await app.close();
  });

  it('rejects an unauthenticated leak report', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/leaks/reports',
      payload: { location: NEAR, description: DESCRIPTION },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a leak report with a too short description', async () => {
    const response = await createLeak(adminToken, {
      location: NEAR,
      description: 'leak',
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a leak report with a malformed location', async () => {
    const response = await createLeak(adminToken, {
      location: { longitude: 999, latitude: 7.6667 },
      description: DESCRIPTION,
    });

    expect(response.statusCode).toBe(400);
  });

  it('creates a cluster for the first report', async () => {
    const response = await createLeak(adminToken, {
      location: NEAR,
      description: DESCRIPTION,
      severity: 'MEDIUM',
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody<LeakReportCreatedResponseDto>(response);
    expect(body.attachedToExistingCluster).toBe(false);
    expect(body.report.clusterId).toBe(body.cluster.id);
    expect(body.report.kebeleId).toBe(kebeleId);
    expect(body.report.status).toBe('OPEN');
    expect(body.report.confidence).toBeGreaterThan(0);
    expect(body.report.source).toBe('CITIZEN_APP');
    expect(body.cluster.reportCount).toBe(1);
    expect(body.cluster.kebeleCode).toBe(KEBELE_CODE);
    expect(body.cluster.code).toMatch(/^LEAK-[0-9A-F]{12}$/);
    expect(body.cluster.centroidLongitude).toBeCloseTo(NEAR.longitude, 4);
    expect(body.cluster.centroidLatitude).toBeCloseTo(NEAR.latitude, 4);
    expect(body.cluster.radiusMeters).toBeGreaterThan(0);
    expect(body.cluster.centroidGeoJson).toMatchObject({ type: 'Point' });

    clusterId = body.cluster.id;
    createdReportIds.push(body.report.id);
    createdClusterIds.push(clusterId);
  });

  it('attaches a nearby report to the existing cluster', async () => {
    const response = await createLeak(adminToken, {
      location: NEARBY,
      description: DESCRIPTION,
      severity: 'CRITICAL',
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody<LeakReportCreatedResponseDto>(response);
    expect(body.attachedToExistingCluster).toBe(true);
    expect(body.cluster.id).toBe(clusterId);
    expect(body.cluster.reportCount).toBe(2);
    expect(body.cluster.severity).toBe('CRITICAL');
    expect(body.cluster.confidence).toBeCloseTo(0.6, 5);

    createdReportIds.push(body.report.id);
  });

  it('creates a separate cluster for a distant report', async () => {
    const response = await createLeak(adminToken, {
      location: DISTANT,
      description: DESCRIPTION,
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody<LeakReportCreatedResponseDto>(response);
    expect(body.attachedToExistingCluster).toBe(false);
    expect(body.cluster.id).not.toBe(clusterId);
    expect(body.cluster.severity).toBe('MEDIUM');
    expect(body.cluster.kebeleCode).not.toBe(KEBELE_CODE);

    createdReportIds.push(body.report.id);
    createdClusterIds.push(body.cluster.id);
  });

  it('keeps the cluster severity when a lesser report arrives', async () => {
    const response = await createLeak(adminToken, {
      location: ADJACENT,
      description: DESCRIPTION,
      severity: 'LOW',
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody<LeakReportCreatedResponseDto>(response);
    expect(body.cluster.id).toBe(clusterId);
    expect(body.cluster.severity).toBe('CRITICAL');
    expect(body.cluster.reportCount).toBe(3);

    createdReportIds.push(body.report.id);
  });

  it('caps a citizen confidence at the role ceiling', async () => {
    const response = await createLeak(citizenToken, {
      location: { longitude: 36.8601, latitude: 7.6701 },
      description: DESCRIPTION,
      severity: 'CRITICAL',
      confidence: 1,
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody<LeakReportCreatedResponseDto>(response);
    expect(body.report.confidence).toBeCloseTo(0.6, 5);

    createdReportIds.push(body.report.id);
    createdClusterIds.push(body.cluster.id);
  });

  it('publishes an outbox event for every report', async () => {
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: clusterId, eventType: 'leak.reported' },
    });

    expect(events).toHaveLength(3);
  });

  it('serves unresolved clusters publicly without a token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/leaks/public/active',
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<PublicLeakClusterListResponseDto>(response);
    const cluster = body.items.find((item) => item.id === clusterId);
    expect(cluster).toBeDefined();
    expect(cluster?.severity).toBe('CRITICAL');
    expect(cluster?.reportCount).toBe(3);
    expect(cluster?.status).toBe('OPEN');
    expect(cluster?.centroidLatitude).not.toBeNull();
  });

  it('filters the public map by kebele', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/leaks/public/active?kebeleId=${kebeleId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<PublicLeakClusterListResponseDto>(response);
    expect(body.items.every((item) => item.kebeleCode === KEBELE_CODE)).toBe(
      true,
    );
    expect(body.items.some((item) => item.id === clusterId)).toBe(true);
  });

  it('hides the cluster review queue from citizens', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/leaks/clusters',
      headers: auth(citizenToken),
    });

    expect(response.statusCode).toBe(403);
  });

  it('lists clusters for reviewers, most severe first', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/leaks/clusters?kebeleId=${kebeleId}`,
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<LeakClusterListResponseDto>(response);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.meta.total).toBe(body.items.length);
    expect(body.items[0]?.id).toBe(clusterId);
  });

  it('lists leak reports with pagination metadata', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/leaks/reports?clusterId=${clusterId}&limit=2`,
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<LeakReportListResponseDto>(response);
    expect(body.items).toHaveLength(2);
    expect(body.meta.total).toBe(3);
    expect(body.meta.totalPages).toBe(2);
    expect(body.meta.limit).toBe(2);
  });

  it('returns the cluster with its reports', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/leaks/clusters/${clusterId}`,
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<LeakClusterDetailResponseDto>(response);
    expect(body.cluster.id).toBe(clusterId);
    expect(body.reports).toHaveLength(3);
    expect(body.reports.every((report) => report.clusterId === clusterId)).toBe(
      true,
    );
  });

  it('refuses to skip triage', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/leaks/clusters/${clusterId}/status`,
      headers: auth(adminToken),
      payload: { status: 'RESOLVED' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('refuses triage from a reviewer who is not a dispatcher', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/leaks/clusters/${clusterId}/status`,
      headers: auth(technicianToken),
      payload: { status: 'TRIAGED' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('triages a cluster and refuses to reopen it', async () => {
    const triaged = await app.inject({
      method: 'PATCH',
      url: `/api/v1/leaks/clusters/${clusterId}/status`,
      headers: auth(adminToken),
      payload: { status: 'TRIAGED', note: 'Confirmed on site' },
    });
    expect(triaged.statusCode).toBe(200);
    expect(jsonBody<LeakClusterResponseDto>(triaged).status).toBe('TRIAGED');

    const reopened = await app.inject({
      method: 'PATCH',
      url: `/api/v1/leaks/clusters/${clusterId}/status`,
      headers: auth(adminToken),
      payload: { status: 'OPEN' },
    });
    expect(reopened.statusCode).toBe(409);
  });

  it('records an audit entry when a cluster is triaged', async () => {
    const events = await prisma.auditEvent.findMany({
      where: { entityId: clusterId, action: 'leak.status_changed' },
    });

    expect(events).toHaveLength(1);
  });

  it('resolves a cluster and closes its reports', async () => {
    const investigating = await app.inject({
      method: 'PATCH',
      url: `/api/v1/leaks/clusters/${clusterId}/status`,
      headers: auth(adminToken),
      payload: { status: 'INVESTIGATING' },
    });
    expect(investigating.statusCode).toBe(200);

    const resolved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/leaks/clusters/${clusterId}/status`,
      headers: auth(adminToken),
      payload: { status: 'RESOLVED' },
    });
    expect(resolved.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/leaks/clusters/${clusterId}`,
      headers: auth(adminToken),
    });
    const body = jsonBody<LeakClusterDetailResponseDto>(detail);
    expect(body.cluster.status).toBe('RESOLVED');
    expect(body.reports.every((report) => report.status === 'RESOLVED')).toBe(
      true,
    );
    expect(body.reports.every((report) => report.resolvedAt !== null)).toBe(
      true,
    );
  });

  it('drops a resolved cluster from the public map', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/leaks/public/active',
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<PublicLeakClusterListResponseDto>(response);
    expect(body.items.some((item) => item.id === clusterId)).toBe(false);
  });

  it('creates a work order against the cluster', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/work-orders',
      headers: auth(adminToken),
      payload: {
        title: 'Repair the leaking main',
        description: 'Excavate the road surface and replace the cracked joint.',
        leakClusterId: clusterId,
        priority: 'HIGH',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = jsonBody<WorkOrderResponseDto>(response);
    expect(body.code).toMatch(/^WO-[0-9A-F]{12}$/);
    expect(body.leakClusterId).toBe(clusterId);
    expect(body.status).toBe('OPEN');
    expect(body.priority).toBe('HIGH');
    expect(body.assignee).toBeNull();
    expect(body.assignedToId).toBeNull();
    workOrderId = body.id;
  });

  it('refuses to create a work order for a citizen', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/work-orders',
      headers: auth(citizenToken),
      payload: {
        title: 'Not allowed',
        description: 'This must be rejected by the roles guard.',
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('refuses an assignee that is not a user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/work-orders',
      headers: auth(adminToken),
      payload: {
        title: 'Assign to nobody',
        description: 'The assignee must be an existing user.',
        assignedToId: '3f1b1a52-9d0a-4a2f-8f2a-6b7f0f5b1c22',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a citizen as the assignee', async () => {
    const citizen = await prisma.user.findUnique({
      where: { phone: CITIZEN_PHONE },
      select: { id: true },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/work-orders',
      headers: auth(adminToken),
      payload: {
        title: 'Assign to a citizen',
        description: 'A citizen must never be the assignee.',
        assignedToId: citizen?.id,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a work order for an unknown cluster', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/work-orders',
      headers: auth(adminToken),
      payload: {
        title: 'Attach to nothing',
        description: 'The leak cluster must exist.',
        leakClusterId: '3f1b1a52-9d0a-4a2f-8f2a-6b7f0f5b1c22',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('assigns the work order to a field technician', async () => {
    const technician = await prisma.user.findUnique({
      where: { phone: TECHNICIAN_PHONE },
      select: { id: true },
    });

    const response = await moveWorkOrder(adminToken, {
      status: 'ASSIGNED',
      assignedToId: technician?.id,
      expectedUpdatedAt: await currentVersion(),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<WorkOrderResponseDto>(response);
    expect(body.status).toBe('ASSIGNED');
    expect(body.assignee).toMatchObject({ role: 'FIELD_TECHNICIAN' });
  });

  it('refuses a status change from someone who is not the assignee', async () => {
    const response = await moveWorkOrder(citizenToken, {
      status: 'ACKNOWLEDGED',
      expectedUpdatedAt: await currentVersion(),
    });

    expect(response.statusCode).toBe(403);
  });

  it('lets the assignee progress the work order', async () => {
    const response = await moveWorkOrder(technicianToken, {
      status: 'ACKNOWLEDGED',
      expectedUpdatedAt: await currentVersion(),
    });

    expect(response.statusCode).toBe(200);
    expect(jsonBody<WorkOrderResponseDto>(response).status).toBe(
      'ACKNOWLEDGED',
    );
  });

  it('refuses a stale update', async () => {
    const response = await moveWorkOrder(adminToken, {
      status: 'IN_PROGRESS',
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(409);
  });

  it('refuses to complete without a resolution note', async () => {
    const started = await moveWorkOrder(technicianToken, {
      status: 'IN_PROGRESS',
      expectedUpdatedAt: await currentVersion(),
    });
    expect(started.statusCode).toBe(200);

    const response = await moveWorkOrder(technicianToken, {
      status: 'COMPLETED',
      expectedUpdatedAt: await currentVersion(),
    });

    expect(response.statusCode).toBe(400);
  });

  it('completes the work order and stamps the timestamps', async () => {
    const response = await moveWorkOrder(technicianToken, {
      status: 'COMPLETED',
      note: 'Replaced the cracked joint and backfilled the trench.',
      expectedUpdatedAt: await currentVersion(),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<WorkOrderResponseDto>(response);
    expect(body.status).toBe('COMPLETED');
    expect(body.startedAt).not.toBeNull();
    expect(body.completedAt).not.toBeNull();
    expect(body.resolutionNote).toContain('cracked joint');
  });

  it('refuses to reopen a completed work order', async () => {
    const response = await moveWorkOrder(adminToken, {
      status: 'IN_PROGRESS',
      expectedUpdatedAt: await currentVersion(),
    });

    expect(response.statusCode).toBe(409);
  });

  it('records the full status history', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/work-orders/${workOrderId}/activities`,
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<WorkOrderActivityListResponseDto>(response);
    expect(body.items.map((item) => item.toStatus)).toEqual([
      'OPEN',
      'ASSIGNED',
      'ACKNOWLEDGED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
    expect(body.items[0]?.fromStatus).toBeNull();
    expect(body.items.at(-1)?.note).toContain('cracked joint');
    expect(body.meta.total).toBe(5);
  });

  it('lets a dispatcher see every work order', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/work-orders',
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<WorkOrderListResponseDto>(response);
    expect(body.items.some((item) => item.id === workOrderId)).toBe(true);
  });

  it('only lets a technician see their own work orders', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/work-orders',
      headers: auth(technicianToken),
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<WorkOrderListResponseDto>(response);
    expect(body.items.some((item) => item.id === workOrderId)).toBe(true);
    expect(
      body.items.every(
        (item) =>
          item.assignedToId === item.assignee?.id && item.assignee !== null,
      ),
    ).toBe(true);
  });

  it('hides work orders from citizens', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/work-orders',
      headers: auth(citizenToken),
    });

    expect(response.statusCode).toBe(403);
  });

  it('updates the assignment of a work order', async () => {
    const open = await app.inject({
      method: 'POST',
      url: '/api/v1/work-orders',
      headers: auth(adminToken),
      payload: {
        title: 'Inspect the standpipe',
        description: 'Check the valve and flush the line.',
        priority: 'NORMAL',
      },
    });
    expect(open.statusCode).toBe(201);
    const order = jsonBody<WorkOrderResponseDto>(open);
    expect(order.status).toBe('OPEN');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/work-orders/${order.id}`,
      headers: auth(adminToken),
      payload: {
        priority: 'URGENT',
        scheduledFor: '2026-10-01T08:00:00.000Z',
        expectedUpdatedAt: order.updatedAt,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = jsonBody<WorkOrderResponseDto>(response);
    expect(body.priority).toBe('URGENT');
    expect(body.scheduledFor).not.toBeNull();

    await prisma.workOrder.deleteMany({ where: { id: order.id } });
  });

  it('refuses a stale work order update', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/work-orders/${workOrderId}`,
      headers: auth(adminToken),
      payload: {
        priority: 'LOW',
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it('returns 404 for an unknown work order', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/work-orders/3f1b1a52-9d0a-4a2f-8f2a-6b7f0f5b1c22',
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('rejects a malformed work order id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/work-orders/not-a-uuid',
      headers: auth(adminToken),
    });

    expect(response.statusCode).toBe(400);
  });
});
