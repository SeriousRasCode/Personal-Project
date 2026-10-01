import { createHmac } from 'node:crypto';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { EncryptionService } from '../src/common/auth/encryption.service.js';
import type { AuthResponseDto } from '../src/modules/auth/dto/auth-response.dto.js';
import type {
  UssdCallbackResponseDto,
  UssdSessionResponseDto,
} from '../src/modules/sms-ussd/dto/ussd-response.dto.js';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '+251900000000';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'HydroJimma!2026';
const SECRET =
  process.env.USSD_CALLBACK_SECRET ?? 'e2e-ussd-secret-0123456789abcdefghijkl';
const KEBELE_CODE = 'GINJO';
const RUN = 'USSD-E2E';
const STANDPIPE_PREFIX = 'USSD-E2E-SP';
const CITIZEN_PHONE = '+251922200004';
const CITIZEN_PASSWORD = 'Citizen!2026';
const OPERATOR_PHONE = '+251911100004';
const OPERATOR_PASSWORD = 'FieldTech!2026';

function body<T>(response: InjectResponse): T {
  return response.json<T>();
}

describe('USSD and SMS delivery (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let citizenToken: string;
  let standpipeId: string;

  const callUssd = (
    payload: Record<string, unknown>,
    overrides: { signature?: string; timestamp?: string } = {},
  ): Promise<InjectResponse> => {
    const raw = JSON.stringify(payload);
    const timestamp = overrides.timestamp ?? new Date().toISOString();
    const signature =
      overrides.signature ??
      createHmac('sha256', SECRET).update(`${timestamp}.${raw}`).digest('hex');

    return app.inject({
      method: 'POST',
      url: '/api/v1/ussd/callback',
      headers: {
        'content-type': 'application/json',
        'x-ussd-timestamp': timestamp,
        'x-ussd-signature': signature,
      },
      payload: raw,
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

    await prisma.user.deleteMany({
      where: { phone: { in: [CITIZEN_PHONE, OPERATOR_PHONE] } },
    });

    adminToken = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { phone: ADMIN_PHONE, password: ADMIN_PASSWORD },
      })
    ).json<AuthResponseDto>().accessToken;

    const kebele = await prisma.kebele.findFirst({
      where: { code: KEBELE_CODE },
      select: { id: true, name: true },
    });
    if (!kebele) {
      throw new Error(`Seed kebele ${KEBELE_CODE} is missing`);
    }

    const citizen = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        phone: CITIZEN_PHONE,
        displayName: 'USSD Citizen',
        password: CITIZEN_PASSWORD,
      },
    });
    expect(citizen.statusCode).toBe(201);
    const citizenRow = await prisma.user.findUnique({
      where: { phone: CITIZEN_PHONE },
      select: { id: true },
    });
    await prisma.citizenProfile.create({
      data: {
        id: crypto.randomUUID(),
        userId: citizenRow?.id ?? '',
        kebeleId: kebele.id,
      },
    });
    const activated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${citizenRow?.id}/status`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'ACTIVE' },
    });
    expect(activated.statusCode).toBe(200);

    const operator = await app.inject({
      method: 'POST',
      url: '/api/v1/users/staff',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        phone: OPERATOR_PHONE,
        displayName: 'USSD Operator',
        password: OPERATOR_PASSWORD,
        role: 'STANDPIPE_OPERATOR',
      },
    });
    expect(operator.statusCode).toBe(201);

    const standpipe = await app.inject({
      method: 'POST',
      url: '/api/v1/standpipes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        kebeleId: kebele.id,
        code: `${STANDPIPE_PREFIX}-${Date.now().toString(36).toUpperCase()}`,
        name: 'USSD Test Standpipe',
        location: { longitude: 36.832, latitude: 7.6668 },
      },
    });
    expect(standpipe.statusCode).toBe(201);
    standpipeId = body<{ id: string }>(standpipe).id;

    citizenToken = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { phone: CITIZEN_PHONE, password: CITIZEN_PASSWORD },
      })
    ).json<AuthResponseDto>().accessToken;
  });

  afterAll(async () => {
    await purge();
    await prisma.ussdSession.deleteMany({
      where: {
        phone: { in: [CITIZEN_PHONE, OPERATOR_PHONE, '+251900999999'] },
      },
    });
    await prisma.notification.deleteMany({
      where: { user: { phone: { in: [CITIZEN_PHONE, OPERATOR_PHONE] } } },
    });
    await prisma.citizenProfile.deleteMany({
      where: { user: { phone: { in: [CITIZEN_PHONE, OPERATOR_PHONE] } } },
    });
    await prisma.otpChallenge.deleteMany({
      where: { phone: { in: [CITIZEN_PHONE, OPERATOR_PHONE] } },
    });
    await prisma.user.deleteMany({
      where: { phone: { in: [CITIZEN_PHONE, OPERATOR_PHONE] } },
    });
    await app.close();
  });

  const purge = async (): Promise<void> => {
    await prisma.rotationWindow.deleteMany({
      where: { standpipeId },
    });
    await prisma.rotationSchedule.deleteMany({
      where: { name: { contains: RUN } },
    });
    await prisma.standpipe.deleteMany({
      where: { code: { startsWith: STANDPIPE_PREFIX } },
    });
  };

  describe('callback authentication', () => {
    it('rejects a callback with no signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/ussd/callback',
        payload: { sessionKey: 'no-sig', phone: '+251900999999', input: '' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a signature made with the wrong secret', async () => {
      const raw = JSON.stringify({
        sessionKey: 'wrong-secret',
        phone: '+251900999999',
        input: '',
      });
      const timestamp = new Date().toISOString();
      const signature = createHmac('sha256', 'wrong')
        .update(`${timestamp}.${raw}`)
        .digest('hex');

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/ussd/callback',
        headers: {
          'content-type': 'application/json',
          'x-ussd-timestamp': timestamp,
          'x-ussd-signature': signature,
        },
        payload: raw,
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a tampered payload', async () => {
      const response = await callUssd(
        { sessionKey: 'tampered', phone: '+251900999999', input: '' },
        { signature: 'a'.repeat(64) },
      );
      expect(response.statusCode).toBe(401);
    });

    it('rejects a stale timestamp', async () => {
      const stale = new Date(Date.now() - 3_600_000).toISOString();
      const response = await callUssd(
        { sessionKey: 'stale', phone: '+251900999999', input: '' },
        { timestamp: stale },
      );
      expect(response.statusCode).toBe(401);
    });

    it('rejects a malformed phone number', async () => {
      const response = await callUssd({
        sessionKey: 'bad-phone',
        phone: 'not-a-phone',
        input: '',
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('anonymous caller', () => {
    const sessionKey = `${RUN}-anon`;

    it('shows the main menu', async () => {
      const response = await callUssd({
        sessionKey,
        phone: '+251900999999',
        input: '',
      });
      expect(response.statusCode).toBe(201);
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.step).toBe('main');
      expect(menu.message).toContain('HydroJimma Water');
      expect(menu.ended).toBe(false);
    });

    it('explains that registration is required for water points', async () => {
      const response = await callUssd({
        sessionKey,
        phone: '+251900999999',
        input: '*1#',
      });
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.step).toBe('unregistered');
      expect(menu.message).toContain('registered account');
    });

    it('shows help without an account', async () => {
      const back = await callUssd({
        sessionKey,
        phone: '+251900999999',
        input: '*',
      });
      expect(body<UssdCallbackResponseDto>(back).step).toBe('main');

      const response = await callUssd({
        sessionKey,
        phone: '+251900999999',
        input: '*3#',
      });
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.step).toBe('help');
      expect(menu.message).toContain('80000');
    });

    it('rejects an unknown selection and stays on the menu', async () => {
      await callUssd({ sessionKey, phone: '+251900999999', input: '*' });

      const response = await callUssd({
        sessionKey,
        phone: '+251900999999',
        input: '*9#',
      });
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.step).toBe('main');
      expect(menu.message).toContain('not available');
    });

    it('ends the session on cancel', async () => {
      const response = await callUssd({
        sessionKey,
        phone: '+251900999999',
        input: '*0#',
      });
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.ended).toBe(true);
      expect(menu.message).toContain('Thank you');
    });
  });

  describe('registered citizen', () => {
    const sessionKey = `${RUN}-citizen`;

    it('lists the water points in the citizen kebele', async () => {
      const response = await callUssd({
        sessionKey,
        phone: CITIZEN_PHONE,
        input: '*1#',
      });
      expect(response.statusCode).toBe(201);
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.step).toBe('standpipes');
      expect(menu.message).toContain('Your water points');
      expect(menu.message).toContain('USSD-E2E-SP');
    });

    it('reports that no rationing window is scheduled', async () => {
      await callUssd({ sessionKey, phone: CITIZEN_PHONE, input: '*' });

      const response = await callUssd({
        sessionKey,
        phone: CITIZEN_PHONE,
        input: '*2#',
      });
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.step).toBe('schedule');
      expect(menu.message).toContain('No rationing window');
    });

    it('returns to the main menu', async () => {
      const response = await callUssd({
        sessionKey,
        phone: CITIZEN_PHONE,
        input: '*',
      });
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.step).toBe('main');
    });

    it('persists the session menu path', async () => {
      await callUssd({ sessionKey, phone: CITIZEN_PHONE, input: '*' });

      const response = await callUssd({
        sessionKey,
        phone: CITIZEN_PHONE,
        input: '*3#',
      });
      expect(body<UssdCallbackResponseDto>(response).step).toBe('help');

      const stored = await prisma.ussdSession.findUnique({
        where: { sessionKey },
        select: { menuPath: true, phone: true },
      });
      expect(stored?.menuPath).toBe('help');
      expect(stored?.phone).toBe(CITIZEN_PHONE);
    });

    it('restarts a session that has expired', async () => {
      await prisma.ussdSession.update({
        where: { sessionKey },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const response = await callUssd({
        sessionKey,
        phone: CITIZEN_PHONE,
        input: '',
      });
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.step).toBe('main');
      expect(menu.message).toContain('HydroJimma Water');

      const stored = await prisma.ussdSession.findUnique({
        where: { sessionKey },
        select: { menuPath: true, expiresAt: true },
      });
      expect(stored?.menuPath).toBe('main');
      expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('does not leak a session to a different phone', async () => {
      const response = await callUssd({
        sessionKey,
        phone: '+251900999999',
        input: '*1#',
      });
      const menu = body<UssdCallbackResponseDto>(response);
      expect(menu.step).toBe('unregistered');

      const stored = await prisma.ussdSession.findUnique({
        where: { sessionKey },
        select: { phone: true },
      });
      expect(stored?.phone).toBe('+251900999999');
    });
  });

  describe('session listing', () => {
    it('rejects an anonymous request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/ussd/sessions',
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a citizen request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/ussd/sessions',
        headers: { authorization: `Bearer ${citizenToken}` },
      });
      expect(response.statusCode).toBe(403);
    });

    it('lists sessions for an admin', async () => {
      await callUssd({
        sessionKey: `${RUN}-citizen`,
        phone: CITIZEN_PHONE,
        input: '*',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/ussd/sessions?phone=${encodeURIComponent(CITIZEN_PHONE)}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(200);
      const page = body<{ items: UssdSessionResponseDto[]; total: number }>(
        response,
      );
      expect(page.total).toBeGreaterThan(0);
      expect(page.items.every((item) => item.phone === CITIZEN_PHONE)).toBe(
        true,
      );
      expect(page.items[0]?.active).toBe(true);
    });

    it('filters to active sessions only', async () => {
      await prisma.ussdSession.updateMany({
        where: { sessionKey: `${RUN}-citizen` },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/ussd/sessions?activeOnly=true',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(200);
      const page = body<{ items: UssdSessionResponseDto[] }>(response);
      expect(page.items.every((item) => item.active)).toBe(true);

      const filtered = await app.inject({
        method: 'GET',
        url: `/api/v1/ussd/sessions?phone=${encodeURIComponent(CITIZEN_PHONE)}&activeOnly=false`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const all = body<{ items: UssdSessionResponseDto[] }>(filtered);
      expect(all.items.every((item) => !item.active)).toBe(true);
    });

    it('rejects a malformed phone filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/ussd/sessions?phone=abc',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('OTP SMS delivery', () => {
    it('delivers the code over SMS exactly once', async () => {
      const dispatcher = app.get(
        (await import('../src/modules/outbox/outbox-dispatcher.service.js'))
          .OutboxDispatcherService,
      );

      const requested = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/request',
        payload: { phone: CITIZEN_PHONE, purpose: 'LOGIN' },
      });
      expect([200, 201]).toContain(requested.statusCode);

      const first = await dispatcher.dispatchOnce();
      expect(first.processed).toBeGreaterThan(0);

      const sms = await prisma.notification.findFirst({
        where: {
          user: { phone: CITIZEN_PHONE },
          channel: 'SMS',
          template: 'identity.otp.sms',
        },
        orderBy: { createdAt: 'desc' },
        select: { body: true, status: true, sentAt: true, payload: true },
      });

      expect(sms).not.toBeNull();
      expect(sms?.status).toBe('SENT');
      expect(sms?.sentAt).not.toBeNull();

      const challenge = await prisma.otpChallenge.findFirst({
        where: { id: (sms?.payload as { challengeId: string }).challengeId },
        select: { id: true, codeCiphertext: true },
      });
      const code = app
        .get(EncryptionService)
        .decrypt(challenge?.codeCiphertext ?? '');
      expect(code).toMatch(/^\d{6}$/);
      expect(sms?.body).not.toContain(code);
      expect(JSON.stringify(sms?.payload)).not.toContain(code);

      const pending = await prisma.outboxEvent.findMany({
        where: { eventType: 'identity.otp.requested', status: 'PENDING' },
        select: { id: true },
      });
      expect(pending).toHaveLength(0);
    });

    it('does not resend for an already dispatched event', async () => {
      const dispatcher = app.get(
        (await import('../src/modules/outbox/outbox-dispatcher.service.js'))
          .OutboxDispatcherService,
      );

      const before = await prisma.notification.count({
        where: { channel: 'SMS', template: 'identity.otp.sms' },
      });

      await dispatcher.dispatchOnce();
      await dispatcher.dispatchOnce();

      const after = await prisma.notification.count({
        where: { channel: 'SMS', template: 'identity.otp.sms' },
      });

      expect(after).toBe(before);
    });

    it('leaves the challenge usable', async () => {
      const challenge = await prisma.otpChallenge.findFirst({
        where: { phone: CITIZEN_PHONE, consumedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, expiresAt: true },
      });
      expect(challenge).not.toBeNull();
      expect(challenge?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
