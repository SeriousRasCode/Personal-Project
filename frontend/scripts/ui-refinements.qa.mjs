import assert from "node:assert/strict";
const tab = await (
  await fetch(
    "http://127.0.0.1:9335/json/new?" +
      encodeURIComponent("http://localhost:3001/"),
    { method: "PUT" },
  )
).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let sequence = 0;
const jobs = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    jobs.get(m.id)?.(m);
    jobs.delete(m.id);
  }
};
const call = (method, params = {}) =>
  new Promise((resolve) => {
    jobs.set(++sequence, resolve);
    ws.send(JSON.stringify({ id: sequence, method, params }));
  });
async function run(expression) {
  const m = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (m.result.exceptionDetails)
    throw Error(JSON.stringify(m.result.exceptionDetails));
  return m.result.result.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(expression, label, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await run(expression)) return;
    await delay(80);
  }
  throw Error("Timed out: " + label);
}
const areas = Array.from({ length: 10 }, (_, i) => ({
  id: "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"),
  name: i ? "Mendera " + i : "Ginjo",
  code: "AREA-" + i,
}));
const fixtures = {
  user: {
    id: "ui-refinements",
    displayName: "UI QA Administrator",
    role: "ADMIN",
    status: "ACTIVE",
  },
  areas,
  points: [
    {
      id: "point-a",
      name: "Ginjo market",
      latitude: 7.674,
      longitude: 36.837,
      pressure: 1.1,
      source: "MANUAL",
      status: "ACTIVE",
      observedAt: new Date().toISOString(),
    },
    {
      id: "point-b",
      name: "Mendera west",
      latitude: 7.669,
      longitude: 36.829,
      pressure: 2.6,
      source: "MANUAL",
      status: "ACTIVE",
      observedAt: new Date().toISOString(),
    },
  ],
};
let injection;
try {
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const source = `(()=>{const fixture=${JSON.stringify(fixtures)};sessionStorage.setItem('hydrojimma.session',JSON.stringify({accessToken:'ui-fixture',refreshToken:'ui-fixture',user:fixture.user}));localStorage.setItem('hydrojimma.tour.v2:'+fixture.user.id+':ADMIN','seen');window.__qaWrites=[];const original=window.fetch;window.fetch=async(path,options={})=>{if(!String(path).startsWith('/api/v1'))return original(path,options);if(options.method&&options.method!=='GET'){window.__qaWrites.push(String(path));return new Response(JSON.stringify({message:'No writes allowed in UI QA'}),{status:400});}let data={items:[],meta:{page:1,totalPages:1,total:0}};if(String(path).includes('/auth/me'))data=fixture.user;else if(String(path).includes('/telemetry/pressure-map'))data={items:fixture.points};else if(String(path).includes('/kebeles'))data={items:fixture.areas,meta:{page:1,totalPages:1}};else if(String(path).includes('/telemetry/sensors'))data={items:fixture.points};else if(String(path).includes('/pressure-stats'))data={sampleCount:2,averagePressureBar:1.85,minimumPressureBar:1.1,maximumPressureBar:2.6};else if(String(path).includes('/telemetry/readings'))data={items:[{id:'reading',pressureBar:1.1,observedAt:new Date().toISOString(),source:'MANUAL'}]};return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};})()`;
  injection = (await call("Page.addScriptToEvaluateOnNewDocument", { source }))
    .result.identifier;
  await call("Page.navigate", {
    url: "http://localhost:3001/?qa=refinements#telemetry",
  });
  await wait(
    `document.querySelectorAll('.network-map-canvas path[role=button]').length===2`,
    "map markers",
  );
  const alignment = await run(
    `Array.from(document.querySelectorAll('.dispatch-toolbar')).map(toolbar=>Array.from(toolbar.querySelectorAll(':scope > .workflow-field > input,:scope > .workflow-field > select,:scope > .record-picker > .workflow-field > select')).map(input=>Math.round(input.getBoundingClientRect().top))).filter(row=>row.length>1)`,
  );
  for (const row of alignment)
    assert.ok(
      Math.max(...row) - Math.min(...row) <= 1,
      "toolbar alignment " + row,
    );
  await run(
    `document.querySelector('.network-map-canvas path[role=button]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
  );
  await wait(
    `document.querySelector('main').textContent.includes('Pressure history')`,
    "selected marker pressure history",
  );
  assert.ok(
    await run(
      `!!document.querySelector('.leaflet-popup-content a[href*="openstreetmap"]')`,
    ),
  );
  await run(`document.querySelector('.leaflet-control-zoom-in').click()`);
  await delay(400);
  const inputs = await run(
    `Array.from(document.querySelectorAll('.dispatch-toolbar > .workflow-field input[type=search]')).map(input=>input.id)`,
  );
  assert.ok(inputs.length);
  await run(
    `(()=>{const field=document.getElementById(${JSON.stringify(inputs[0])});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'Mendera');field.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await wait(
    `document.querySelectorAll('.network-map-canvas path[role=button]').length===1`,
    "map/result search",
  );
  await run(
    `(()=>{const field=document.getElementById(${JSON.stringify(inputs[0])});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'');field.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await wait(
    `document.querySelector('.water-scroll')?.getAttribute('aria-valuenow')!==null`,
    "scroll rail",
  );
  await run(
    `document.querySelector('.water-scroll').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`,
  );
  await delay(200);
  assert.equal(
    await run(
      `Number(document.querySelector('.water-scroll').getAttribute('aria-valuenow'))`,
    ),
    100,
  );
  await run(
    `document.querySelector('.water-scroll').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`,
  );
  await delay(200);
  assert.equal(
    await run(
      `Number(document.querySelector('.water-scroll').getAttribute('aria-valuenow'))`,
    ),
    0,
  );
  console.log(
    "Map: marker selection, location links, zoom and search passed; filter controls aligned; water rail Home/End passed",
  );
  const expected = {
    operations: [
      "Create and assign a repair",
      "Repair progress and resolution",
    ],
    schedules: ["Plan and edit service windows"],
    leaks: [
      "Investigate and triage an incident",
      "Link an incident to a repair",
    ],
    telemetry: ["Locate and inspect observations", "Set up manual monitoring"],
  };
  for (const [route, titles] of Object.entries(expected)) {
    await run(`location.hash=${JSON.stringify(route)}`);
    await delay(300);
    await run(`document.querySelector('.tour-launch').click()`);
    await run(`document.querySelector('.tour-choice-option').click()`);
    const seen = new Set();
    let steps = 0;
    while (await run(`!!document.querySelector('.tour-dialog[open]')`)) {
      await wait(
        `!!document.querySelector('.tour-dialog[open] .button-primary:not(:disabled)')`,
        "tour ready",
      );
      seen.add(
        await run(
          `document.querySelector('.tour-dialog[open] h2').textContent.trim()`,
        ),
      );
      if (await run(`!!document.querySelector('.tour-workflow-preview')`)) {
        const previewId = await run(
          `document.querySelector('.tour-workflow-preview input')?.id`,
        );
        if (previewId)
          assert.ok(
            await run(
              `!!document.getElementById(${JSON.stringify(previewId)})`,
            ),
          );
      }
      await run(
        `document.querySelector('.tour-dialog[open] .button-primary').click()`,
      );
      await delay(30);
      if (++steps > 100) throw Error("Tour did not terminate: " + route);
    }
    for (const title of titles)
      assert.ok(
        seen.has(title),
        route + " missing " + title + " saw " + [...seen].join("|"),
      );
    assert.equal(await run(`location.hash`), "#" + route);
    assert.equal(
      await run(`document.querySelectorAll('.tour-workflow-preview').length`),
      0,
    );
    console.log(
      route +
        ": latest tour workflows and cleanup passed (" +
        steps +
        " steps)",
    );
  }
  assert.deepEqual(await run(`window.__qaWrites`), []);
  await run(
    `location.hash='telemetry';document.documentElement.dataset.theme='dark'`,
  );
  await delay(500);
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 500,
    });
    await run(`window.scrollTo({top:0,behavior:'instant'})`);
    await delay(300);
    assert.equal(
      await run(`document.documentElement.scrollWidth>innerWidth+1`),
      false,
      name + " overflow",
    );
  }
  console.log("All refinement browser checks passed; no API writes made");
} finally {
  if (injection)
    await call("Page.removeScriptToEvaluateOnNewDocument", {
      identifier: injection,
    });
  ws.close();
  await fetch("http://127.0.0.1:9335/json/close/" + tab.id);
}
