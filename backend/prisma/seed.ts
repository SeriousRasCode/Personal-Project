import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { argon2id, hash } from 'argon2';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { UserRole, UserStatus } from '../src/generated/prisma/enums.js';

const connectionString = process.env.DATABASE_URL;
const adminPhone = process.env.SEED_ADMIN_PHONE;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

if (!adminPhone || !adminPassword || adminPassword.length < 12) {
  throw new Error(
    'SEED_ADMIN_PHONE and a 12-character SEED_ADMIN_PASSWORD are required',
  );
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const kebeles = [
  { code: 'GINJO', name: 'Ginjo', longitude: 36.8319, latitude: 7.6667 },
  { code: 'MENDERA', name: 'Mendera', longitude: 36.8333, latitude: 7.65 },
  { code: 'HERMATA', name: 'Hermata', longitude: 36.81, latitude: 7.64 },
  { code: 'BOCHO_BORE', name: 'Bocho Bore', longitude: 36.86, latitude: 7.67 },
];

async function seed(): Promise<void> {
  if (!adminPhone || !adminPassword) {
    throw new Error('Seed administrator credentials are required');
  }

  const passwordHash = await hash(adminPassword, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await prisma.user.upsert({
    where: { phone: adminPhone },
    update: {
      displayName: 'System Administrator',
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
    create: {
      phone: adminPhone,
      displayName: 'System Administrator',
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
    },
  });

  for (const kebele of kebeles) {
    await prisma.kebele.upsert({
      where: { code: kebele.code },
      update: { name: kebele.name },
      create: { code: kebele.code, name: kebele.name },
    });
    await prisma.$executeRaw(
      Prisma.sql`UPDATE kebeles
        SET center = ST_SetSRID(ST_MakePoint(${kebele.longitude}, ${kebele.latitude}), 4326)
        WHERE code = ${kebele.code}`,
    );
  }
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
