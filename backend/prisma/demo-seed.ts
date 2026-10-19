import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { argon2id, hash } from 'argon2';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import {
  FlowStatus,
  LeakSeverity,
  LeakStatus,
  NotificationChannel,
  NotificationStatus,
  QueueTrend,
  ReportSource,
  UserRole,
  UserStatus,
  WorkOrderPriority,
  WorkOrderStatus,
} from '../src/generated/prisma/enums.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Demo data cannot be seeded in production');
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const demoPassword = process.env.SEED_DEMO_PASSWORD ?? 'HydroDemo!2026';
const demoUsers = [
  {
    phone: '+251900000101',
    displayName: 'Mulugeta Bekele',
    role: UserRole.DISPATCHER,
  },
  {
    phone: '+251900000102',
    displayName: 'Hana Tesfaye',
    role: UserRole.FIELD_TECHNICIAN,
  },
  {
    phone: '+251900000103',
    displayName: 'Samira Ali',
    role: UserRole.STANDPIPE_OPERATOR,
  },
  {
    phone: '+251900000104',
    displayName: 'Abdi Mohammed',
    role: UserRole.CITIZEN,
  },
] as const;

const demoPoints = [
  {
    id: 'd0000000-0000-4000-8000-000000000101',
    code: 'DEMO-GIN-01',
    name: 'Ginjo Market Water Point',
    kebeleCode: 'GINJO',
    longitude: 36.8319,
    latitude: 7.6667,
    flow: FlowStatus.FULL_FLOW,
    wait: 12,
    queue: 8,
  },
  {
    id: 'd0000000-0000-4000-8000-000000000102',
    code: 'DEMO-GIN-02',
    name: 'Ginjo Health Centre Tap',
    kebeleCode: 'GINJO',
    longitude: 36.834,
    latitude: 7.6638,
    flow: FlowStatus.TRICKLE,
    wait: 26,
    queue: 17,
  },
  {
    id: 'd0000000-0000-4000-8000-000000000103',
    code: 'DEMO-MEN-01',
    name: 'Mendera Community Standpipe',
    kebeleCode: 'MENDERA',
    longitude: 36.8333,
    latitude: 7.65,
    flow: FlowStatus.FULL_FLOW,
    wait: 8,
    queue: 5,
  },
  {
    id: 'd0000000-0000-4000-8000-000000000104',
    code: 'DEMO-HER-01',
    name: 'Hermata School Water Point',
    kebeleCode: 'HERMATA',
    longitude: 36.81,
    latitude: 7.64,
    flow: FlowStatus.DRY,
    wait: 0,
    queue: 0,
  },
  {
    id: 'd0000000-0000-4000-8000-000000000105',
    code: 'DEMO-BOC-01',
    name: 'Bocho Bore Junction Tap',
    kebeleCode: 'BOCHO_BORE',
    longitude: 36.86,
    latitude: 7.67,
    flow: FlowStatus.TRICKLE,
    wait: 19,
    queue: 12,
  },
] as const;

const demoLeaks = [
  {
    id: 'd0000000-0000-4000-8000-000000000201',
    reportId: 'd0000000-0000-4000-8000-000000000211',
    code: 'DEMO-LEAK-01',
    kebeleCode: 'GINJO',
    longitude: 36.837,
    latitude: 7.669,
    severity: LeakSeverity.HIGH,
    description:
      'Water is leaking beside the main market road near the bus stop.',
  },
  {
    id: 'd0000000-0000-4000-8000-000000000202',
    reportId: 'd0000000-0000-4000-8000-000000000212',
    code: 'DEMO-LEAK-02',
    kebeleCode: 'HERMATA',
    longitude: 36.814,
    latitude: 7.643,
    severity: LeakSeverity.MEDIUM,
    description: 'A small steady leak is visible beside the school junction.',
  },
] as const;

async function seed(): Promise<void> {
  const admin = await prisma.user.findUnique({
    where: { phone: process.env.SEED_ADMIN_PHONE ?? '+251900000000' },
  });
  if (!admin || admin.role !== UserRole.ADMIN) {
    throw new Error('Run npm run db:seed before seeding demo data');
  }

  const passwordHash = await hash(demoPassword, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const users = new Map<UserRole, string>();
  for (const user of demoUsers) {
    const saved = await prisma.user.upsert({
      where: { phone: user.phone },
      update: {
        displayName: user.displayName,
        passwordHash,
        role: user.role,
        status: UserStatus.ACTIVE,
      },
      create: { ...user, passwordHash, status: UserStatus.ACTIVE },
    });
    users.set(user.role, saved.id);
  }
  const citizenId = users.get(UserRole.CITIZEN)!;
  const technicianId = users.get(UserRole.FIELD_TECHNICIAN)!;

  const kebeles = new Map<string, string>();
  for (const code of ['GINJO', 'MENDERA', 'HERMATA', 'BOCHO_BORE']) {
    const kebele = await prisma.kebele.findUnique({ where: { code } });
    if (!kebele) throw new Error(`Missing kebele ${code}; run npm run db:seed`);
    kebeles.set(code, kebele.id);
  }

  for (const point of demoPoints) {
    const kebeleId = kebeles.get(point.kebeleCode)!;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO standpipes (id, kebele_id, code, name, location, is_active, created_at, updated_at)
      VALUES (${point.id}::uuid, ${kebeleId}::uuid, ${point.code}, ${point.name},
        ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326), true,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (code) DO NOTHING
    `);
    const saved = await prisma.standpipe.findUniqueOrThrow({
      where: { code: point.code },
    });
    const observedAt = new Date(Date.now() - 20 * 60_000);
    await prisma.tapStatusReport.upsert({
      where: { id: point.id.replace('0000000001', '0000000003') },
      update: {},
      create: {
        id: point.id.replace('0000000001', '0000000003'),
        standpipeId: saved.id,
        reportedById: citizenId,
        status: point.flow,
        source: ReportSource.CITIZEN_APP,
        observedAt,
        note: 'Demo water flow observation',
      },
    });
    await prisma.tapConsensus.upsert({
      where: { standpipeId: saved.id },
      update: {},
      create: {
        standpipeId: saved.id,
        status: point.flow,
        confidence: 0.82,
        sampleCount: 1,
        fullFlowScore: point.flow === FlowStatus.FULL_FLOW ? 1 : 0,
        trickleScore: point.flow === FlowStatus.TRICKLE ? 1 : 0,
        dryScore: point.flow === FlowStatus.DRY ? 1 : 0,
        lastObservedAt: observedAt,
      },
    });
    await prisma.queueWaitReport.upsert({
      where: { id: point.id.replace('0000000001', '0000000004') },
      update: {},
      create: {
        id: point.id.replace('0000000001', '0000000004'),
        standpipeId: saved.id,
        reportedById: citizenId,
        waitMinutes: point.wait,
        queueSize: point.queue,
        source: ReportSource.CITIZEN_APP,
        observedAt,
      },
    });
    await prisma.queueSnapshot.upsert({
      where: { id: point.id.replace('0000000001', '0000000005') },
      update: {},
      create: {
        id: point.id.replace('0000000001', '0000000005'),
        standpipeId: saved.id,
        waitMinutes: point.wait,
        queueSize: point.queue,
        trend: QueueTrend.STABLE,
        confidence: 0.8,
        sampleCount: 1,
      },
    });
  }

  for (const leak of demoLeaks) {
    const kebeleId = kebeles.get(leak.kebeleCode)!;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO leak_clusters (id, kebele_id, code, centroid, radius_meters, severity, status,
        report_count, confidence, first_reported_at, last_reported_at, created_at, updated_at)
      VALUES (${leak.id}::uuid, ${kebeleId}::uuid, ${leak.code},
        ST_SetSRID(ST_MakePoint(${leak.longitude}, ${leak.latitude}), 4326), 150,
        ${leak.severity}::"LeakSeverity", ${LeakStatus.OPEN}::"LeakStatus", 1, 0.6,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (code) DO NOTHING
    `);
    const cluster = await prisma.leakCluster.findUniqueOrThrow({
      where: { code: leak.code },
    });
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO leak_reports (id, reported_by_id, cluster_id, location, description, severity,
        status, source, confidence, observed_at, created_at, updated_at)
      VALUES (${leak.reportId}::uuid, ${citizenId}::uuid, ${cluster.id}::uuid,
        ST_SetSRID(ST_MakePoint(${leak.longitude}, ${leak.latitude}), 4326),
        ${leak.description}, ${leak.severity}::"LeakSeverity", ${LeakStatus.OPEN}::"LeakStatus",
        ${ReportSource.CITIZEN_APP}::"ReportSource", 0.6,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  const primaryLeak = await prisma.leakCluster.findUniqueOrThrow({
    where: { code: 'DEMO-LEAK-01' },
  });
  await prisma.workOrder.upsert({
    where: { code: 'DEMO-WO-01' },
    update: {},
    create: {
      code: 'DEMO-WO-01',
      leakClusterId: primaryLeak.id,
      createdById: admin.id,
      assignedToId: technicianId,
      title: 'Repair Ginjo market pipe leak',
      description:
        'Inspect the reported leak near the market road and repair the damaged connection.',
      priority: WorkOrderPriority.HIGH,
      status: WorkOrderStatus.ASSIGNED,
    },
  });
  await prisma.notification.upsert({
    where: { id: 'd0000000-0000-4000-8000-000000000501' },
    update: {},
    create: {
      id: 'd0000000-0000-4000-8000-000000000501',
      userId: citizenId,
      channel: NotificationChannel.IN_APP,
      template: 'demo.welcome',
      title: 'Welcome to HydroJimma',
      body: 'Your community water updates will appear here.',
      status: NotificationStatus.QUEUED,
    },
  });

  console.log(
    `Demo data ready: ${demoPoints.length} water points, ${demoLeaks.length} leak areas, one work order, and ${demoUsers.length} active accounts.`,
  );
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
