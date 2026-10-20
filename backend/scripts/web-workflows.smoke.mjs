// Opt-in local integration check; never run against production data.
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
});
if (process.env.HYDRO_QA_ALLOW_MUTATIONS !== 'local')
  throw Error(
    'Set HYDRO_QA_ALLOW_MUTATIONS=local to opt into isolated local test records.',
  );
if (!process.env.HYDRO_QA_PHONE || !process.env.HYDRO_QA_PASSWORD)
  throw Error(
    'Set HYDRO_QA_PHONE and HYDRO_QA_PASSWORD to a local administrator account.',
  );
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(process.env.DATABASE_URL).hostname,
  )
)
  throw Error('This smoke test only permits a local database.');
const base = 'http://localhost:3000/api/v1';
const suffix = Date.now().toString(36),
  created = { points: [], windows: [] };
let session, previousArea, previousInApp, selectedOrder, ws, tabId;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(
  path,
  body,
  method = body ? 'POST' : 'GET',
  token = session?.accessToken,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  if (!response.ok)
    throw Error(
      `${method} ${path}: ${response.status} ${JSON.stringify(value)}`,
    );
  return value;
}
async function wait(check, label, timeout = 10000, interval = 200) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await delay(interval);
  }
  throw Error('Timed out: ' + label);
}
let counter = 0;
const pending = new Map();
function call(method, params = {}) {
  return new Promise((resolve) => {
    pending.set(++counter, resolve);
    ws.send(JSON.stringify({ id: counter, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.result?.exceptionDetails)
    throw Error(JSON.stringify(result.result.exceptionDetails));
  return result.result.result.value;
}
const click = (text) =>
  evaluate(
    `(()=>{const button=[...document.querySelectorAll('main button')].find(node=>node.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Button not found: '+${JSON.stringify(text)});button.click()})()`,
  );
const fill = (selector, value) =>
  evaluate(
    `(()=>{const field=document.querySelector(${JSON.stringify(selector)});if(!field)throw Error('Missing field');Object.getOwnPropertyDescriptor(field instanceof HTMLSelectElement?HTMLSelectElement.prototype:field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event(field instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`,
  );
try {
  session = await request('/auth/login', {
    phone: process.env.HYDRO_QA_PHONE,
    password: process.env.HYDRO_QA_PASSWORD,
  });
  previousArea = await request('/notifications/water-area');
  previousInApp =
    (await request('/notifications/preferences')).find(
      (preference) => preference.channel === 'IN_APP',
    )?.enabled ?? true;
  await request(
    '/notifications/preferences',
    { channel: 'IN_APP', enabled: true },
    'PATCH',
  );
  const area = await request('/kebeles', {
    name: 'Workflow QA ' + suffix,
    code: 'QA-' + suffix,
    center: { latitude: 7.95, longitude: 36.95 },
    boundary: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [36.94, 7.94],
            [36.96, 7.94],
            [36.96, 7.96],
            [36.94, 7.96],
            [36.94, 7.94],
          ],
        ],
      ],
    },
  });
  created.area = area.id;
  await request('/notifications/water-area', { kebeleId: area.id }, 'PATCH');
  for (let i = 0; i < 2; i++) {
    const point = await request('/standpipes', {
      kebeleId: area.id,
      code: `QA-${suffix}-${i}`,
      name: `QA point ${i}`,
      location: { latitude: 7.95, longitude: 36.95 + i * 0.001 },
    });
    created.points.push(point.id);
  }
  await request('/reports/tap-status', {
    standpipeId: created.points[0],
    status: 'FULL_FLOW',
  });
  const neighbor = await request(
    `/consensus/standpipes/${created.points[1]}/tap-status`,
  );
  assert.equal(neighbor.status, 'FULL_FLOW');
  assert.ok(neighbor.confidence > 0);
  const sensor = await request('/telemetry/sensors', {
    name: 'QA pressure ' + suffix,
    type: 'PRESSURE',
    standpipeId: created.points[0],
  });
  created.sensor = sensor.id;
  await request('/telemetry/readings', {
    sensorId: sensor.id,
    pressureBar: 2.1,
    source: 'MANUAL',
    observedAt: new Date().toISOString(),
  });
  const map = await request('/telemetry/pressure-map?kebeleId=' + area.id);
  assert.equal(map.items.find((point) => point.id === sensor.id).pressure, 2.1);
  const leak = await request('/leaks/reports', {
    location: { latitude: 7.95, longitude: 36.95 },
    description: 'Isolated workflow QA pipe burst evidence',
    severity: 'CRITICAL',
  });
  created.report = leak.report.id;
  assert.equal(
    leak.attachedToExistingCluster,
    false,
    'QA report must never mutate a pre-existing incident',
  );
  assert.equal(leak.cluster.kebeleId, area.id);
  created.cluster = leak.cluster.id;
  const assignees = await request('/work-orders/assignees');
  const technician = assignees.items.find(
    (person) => person.role === 'FIELD_TECHNICIAN',
  );
  assert.ok(technician);
  console.log(
    'Live API: spatial evidence, geolocated pressure and isolated leak fixtures passed',
  );
  const tab = await (
    await fetch(
      'http://127.0.0.1:9335/json/new?' +
        encodeURIComponent('http://localhost:3001/'),
      { method: 'PUT' },
    )
  ).json();
  tabId = tab.id;
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  };
  await call('Page.enable');
  await evaluate(
    `sessionStorage.setItem('hydrojimma.session',${JSON.stringify(JSON.stringify({ ...session, accessToken: 'expired-token-fixture' }))});localStorage.setItem('hydrojimma.tour.v2:${session.user.id}:${session.user.role}','seen');location.hash='leaks'`,
  );
  await call('Page.reload');
  await wait(
    () =>
      evaluate(
        `Boolean([...document.querySelectorAll('main button')].find(button=>button.textContent.includes(${JSON.stringify(leak.cluster.code)})))`,
      ),
    'admin leak list after real token refresh',
  );
  session = await evaluate(
    `JSON.parse(sessionStorage.getItem('hydrojimma.session'))`,
  );
  assert.notEqual(session.accessToken, 'expired-token-fixture');
  await evaluate(
    `([...document.querySelectorAll('main button')].find(button=>button.textContent.includes(${JSON.stringify(leak.cluster.code)}))).click()`,
  );
  await wait(
    () => evaluate(`Boolean(document.querySelector('select[name=status]'))`),
    'incident details',
  );
  await fill('select[name=status]', 'TRIAGED');
  await evaluate(`document.querySelector('main form').requestSubmit()`);
  await wait(
    async () =>
      (await request('/leaks/clusters/' + created.cluster)).cluster.status ===
      'TRIAGED',
    'saved triage',
  );
  await wait(
    () =>
      evaluate(
        `document.querySelector('main').textContent.includes('Incident status updated.')`,
      ),
    'triage success',
  );
  await click('Create linked work order');
  await wait(
    () =>
      evaluate(
        `Boolean(document.querySelector('select[name=assignedToId] option[value="${technician.id}"]'))`,
      ),
    'assignable field staff',
  );
  await fill('input[name=title]', 'QA repair ' + suffix);
  await fill(
    'textarea[name=description]',
    'Repair this isolated workflow QA pipe burst.',
  );
  await fill('select[name=assignedToId]', technician.id);
  await evaluate(
    `document.querySelector('input[name=title]').closest('form').requestSubmit()`,
  );
  await wait(async () => {
    const result = await request(
      '/work-orders?leakClusterId=' + created.cluster,
    );
    selectedOrder = result.items.find(
      (order) => order.title === 'QA repair ' + suffix,
    );
    return Boolean(selectedOrder);
  }, 'linked order creation');
  created.order = selectedOrder.id;
  await wait(
    () =>
      evaluate(
        `document.querySelector('main').textContent.includes('Work order created and linked')`,
      ),
    'creation success',
  );
  await evaluate(
    `([...document.querySelectorAll('main button')].find(button=>button.textContent.includes(${JSON.stringify('QA repair ' + suffix)})&&button.classList.contains('dispatch-record'))).click()`,
  );
  await wait(
    () => evaluate(`Boolean(document.querySelector('textarea[name=note]'))`),
    'work order detail',
  );
  for (const status of ['ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED']) {
    await fill('select[name=status]', status);
    await fill(
      'textarea[name=note]',
      status === 'COMPLETED'
        ? 'Repair completed and flow checked during isolated QA.'
        : 'QA field progress recorded.',
    );
    await evaluate(
      `document.querySelector('textarea[name=note]').closest('form').requestSubmit()`,
    );
    await wait(
      async () =>
        (await request('/work-orders/' + created.order)).status === status,
      'saved ' + status,
    );
    await wait(
      () =>
        evaluate(
          `!document.querySelector('button[disabled]') || ![...document.querySelectorAll('main button')].some(button=>button.textContent==='Save progress'&&button.disabled)`,
        ),
      'progress settled',
    );
    await delay(300);
  }
  assert.ok(
    (await request(`/work-orders/${created.order}/activities?limit=100`)).items
      .length >= 4,
  );
  console.log(
    'Browser: expired-token recovery, leak triage, linked assignment and complete repair lifecycle passed',
  );
  await evaluate(`location.hash='schedules'`);
  await wait(
    () =>
      evaluate(
        `document.querySelector('main').textContent.includes('New rotation')`,
      ),
    'rotation page',
  );
  await click('New rotation');
  await fill('input[name=name]', 'QA rotation ' + suffix);
  await wait(
    () =>
      evaluate(
        `Boolean(document.querySelector('select[name=kebeleId] option[value="${area.id}"]'))`,
      ),
    'area options',
  );
  await fill('select[name=kebeleId]', area.id);
  const start = new Date(Math.ceil((Date.now() + 10000) / 60000) * 60000),
    end = new Date(start.getTime() + 120000),
    nextStart = new Date(end.getTime() + 60000),
    nextEnd = new Date(nextStart.getTime() + 180000);
  const date = start.toISOString().slice(0, 10);
  await fill('input[name=startsOn]', date);
  await fill('input[name=endsOn]', date);
  await click('Add service window');
  await wait(
    () =>
      evaluate(
        `document.querySelectorAll('input[type=datetime-local]').length===4`,
      ),
    'second window',
  );
  const local = (iso) =>
    new Date(
      new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
  const inputs = await evaluate(
    `Array.from(document.querySelectorAll('input[type=datetime-local]')).map(input=>input.name)`,
  );
  for (const [index, time] of [start, end, nextStart, nextEnd].entries())
    await fill(`input[name="${inputs[index]}"]`, local(time));
  await wait(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('select[name$="-point"]')).every(select=>!select.disabled)`,
      ),
    'window point options',
  );
  await click('Save draft');
  let rotation;
  await wait(async () => {
    const result = await request('/schedules/staff?kebeleId=' + area.id);
    rotation = result.items.find(
      (record) => record.name === 'QA rotation ' + suffix,
    );
    return Boolean(rotation);
  }, 'draft rotation');
  created.rotation = rotation.id;
  created.windows = rotation.windows.map((window) => window.id);
  assert.equal(rotation.windows.length, 2);
  await wait(
    () =>
      evaluate(
        `document.querySelector('main').textContent.includes('Edit draft / windows')`,
      ),
    'draft selection',
  );
  await click('Edit draft / windows');
  await wait(
    () => evaluate(`Boolean(document.querySelector('input[name=name]'))`),
    'draft editor',
  );
  await fill('input[name=name]', 'QA edited rotation ' + suffix);
  await wait(
    () =>
      evaluate(
        `Array.from(document.querySelectorAll('select[name$="-point"]')).every(select=>!select.disabled)`,
      ),
    'edit options',
  );
  await click('Save draft');
  await wait(async () => {
    rotation = await request('/schedules/staff/' + created.rotation);
    return rotation.name === 'QA edited rotation ' + suffix;
  }, 'saved draft edit');
  created.windows = rotation.windows.map((window) => window.id);
  await wait(
    () => evaluate(`!document.querySelector('input[name=name]')`),
    'editor closed',
  );
  await click('publish');
  await wait(
    async () =>
      (await request('/schedules/staff/' + created.rotation)).status ===
      'PUBLISHED',
    'published',
  );
  await delay(400);
  await click('activate');
  await wait(
    async () =>
      (await request('/schedules/staff/' + created.rotation)).status ===
      'ACTIVE',
    'active',
  );
  console.log(
    'Browser: multi-window rotation creation, edit, publication and activation passed; waiting for timed opening',
  );
  await wait(
    async () => {
      rotation = await request('/schedules/staff/' + created.rotation);
      return rotation.windows.some((window) => window.status === 'OPENED');
    },
    'automatic timed opening',
    90000,
    2000,
  );
  await wait(
    async () =>
      (await request('/notifications?limit=100')).items.some(
        (notification) =>
          notification.template === 'rotation_window.opened' &&
          notification.payload?.kebeleId === area.id,
      ),
    'targeted opening notification',
    15000,
  );
  const window = rotation.windows.find((window) => window.status === 'OPENED');
  await request(
    `/schedules/${rotation.id}/windows/${window.id}/close`,
    { updatedAt: window.updatedAt },
    'PATCH',
  );
  await wait(
    async () =>
      (await request('/notifications?limit=100')).items.some(
        (notification) =>
          notification.template === 'rotation_window.closed' &&
          notification.payload?.kebeleId === area.id,
      ),
    'targeted closing notification',
    15000,
  );
  console.log(
    'Live end-to-end: scheduled opening and geographically targeted opening/closing inbox alerts passed',
  );
  for (const route of ['telemetry', 'preferences', 'ussd']) {
    await evaluate(`location.hash=${JSON.stringify(route)}`);
    await delay(1000);
    const errors = await evaluate(
      `Array.from(document.querySelectorAll('main [role=alert]')).map(node=>node.textContent)`,
    );
    assert.deepEqual(errors, [], route + ' page errors');
  }
  await evaluate(`location.hash='telemetry'`);
  await delay(1000);
  assert.ok(
    await evaluate(`Boolean(document.querySelector('svg.dispatch-map'))`),
  );
  console.log(
    'Browser: monitoring map, preferences and gateway status load without API errors',
  );
  if (process.env.USSD_CALLBACK_SECRET) {
    const timestamp = new Date().toISOString(),
      raw = JSON.stringify(
        { sessionKey: 'qa-' + suffix, phone: '+251900009999', input: '' },
        null,
        2,
      );
    const signature = createHmac('sha256', process.env.USSD_CALLBACK_SECRET)
      .update(timestamp + '.' + raw)
      .digest('hex');
    const callback = await fetch(base + '/ussd/callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ussd-timestamp': timestamp,
        'x-ussd-signature': signature,
      },
      body: raw,
    });
    assert.equal(
      callback.status,
      201,
      'provider-signed non-canonical JSON must verify',
    );
    console.log(
      'Live API: provider callback signature verified against exact request bytes',
    );
  }
} finally {
  if (session && previousArea) {
    await request('/notifications/water-area', previousArea, 'PATCH').catch(
      (error) => console.error('Area restore:', error.message),
    );
  }
  if (session && previousInApp !== undefined)
    await request(
      '/notifications/preferences',
      { channel: 'IN_APP', enabled: previousInApp },
      'PATCH',
    ).catch((error) => console.error('Preference restore:', error.message));
  if (created.rotation) {
    const rotation = await request(
      '/schedules/staff/' + created.rotation,
    ).catch(() => null);
    if (rotation && !['CANCELLED', 'COMPLETED'].includes(rotation.status))
      await request(`/schedules/${rotation.id}/cancel`, {
        updatedAt: rotation.updatedAt,
      }).catch((error) => console.error('Cancel QA rotation:', error.message));
  }
  if (created.area) {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    try {
      await client.query('BEGIN');
      const ids = [
        created.area,
        created.report,
        created.cluster,
        created.order,
        created.sensor,
        created.rotation,
        ...created.points,
        ...created.windows,
      ].filter(Boolean);
      const events = await client.query(
        'SELECT id FROM outbox_events WHERE aggregate_id=ANY($1::text[])',
        [ids],
      );
      await client.query(
        "DELETE FROM notifications WHERE payload->>'kebeleId'=$1 OR payload->>'clusterId'=$2 OR payload->>'workOrderId'=$3",
        [created.area, created.cluster || '', created.order || ''],
      );
      for (const event of events.rows)
        await client.query(
          'DELETE FROM idempotency_records WHERE key LIKE $1',
          [event.id + ':%'],
        );
      await client.query(
        'DELETE FROM outbox_events WHERE aggregate_id=ANY($1::text[])',
        [ids],
      );
      await client.query(
        'DELETE FROM audit_events WHERE entity_id=ANY($1::text[])',
        [ids],
      );
      if (created.order) {
        await client.query(
          'DELETE FROM work_order_activities WHERE work_order_id=$1',
          [created.order],
        );
        await client.query('DELETE FROM work_orders WHERE id=$1', [
          created.order,
        ]);
      }
      if (created.report)
        await client.query('DELETE FROM leak_reports WHERE id=$1', [
          created.report,
        ]);
      if (created.cluster)
        await client.query('DELETE FROM leak_clusters WHERE id=$1', [
          created.cluster,
        ]);
      if (created.sensor) {
        await client.query('DELETE FROM pressure_readings WHERE sensor_id=$1', [
          created.sensor,
        ]);
        await client.query(
          'DELETE FROM pressure_aggregates WHERE sensor_id=$1',
          [created.sensor],
        );
        await client.query('DELETE FROM telemetry_sensors WHERE id=$1', [
          created.sensor,
        ]);
      }
      if (created.rotation) {
        await client.query(
          'DELETE FROM rotation_windows WHERE rotation_schedule_id=$1',
          [created.rotation],
        );
        await client.query('DELETE FROM rotation_schedules WHERE id=$1', [
          created.rotation,
        ]);
      }
      for (const table of [
        'tap_status_reports',
        'queue_wait_reports',
        'tap_consensus',
        'queue_snapshots',
      ])
        await client.query(
          `DELETE FROM ${table} WHERE standpipe_id=ANY($1::uuid[])`,
          [created.points],
        );
      await client.query('DELETE FROM standpipes WHERE id=ANY($1::uuid[])', [
        created.points,
      ]);
      await client.query('DELETE FROM kebeles WHERE id=$1 AND code=$2', [
        created.area,
        'QA-' + suffix,
      ]);
      await client.query('DELETE FROM ussd_sessions WHERE session_key=$1', [
        'qa-' + suffix,
      ]);
      await client.query('COMMIT');
      console.log('Removed only the isolated QA records created by this run');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('QA cleanup failed:', error.message);
      process.exitCode = 1;
    } finally {
      await client.end();
    }
  }
  if (ws) {
    ws.close();
    if (tabId)
      await fetch('http://127.0.0.1:9335/json/close/' + tabId).catch(() => {});
  }
}
