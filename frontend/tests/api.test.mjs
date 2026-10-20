import { test } from "node:test";
import assert from "node:assert/strict";
const original = {
  accessToken: "old",
  refreshToken: "refresh",
  user: { id: "admin", role: "ADMIN" },
};
const next = { ...original, accessToken: "new", refreshToken: "rotated" };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });
async function setup(fetcher) {
  const storage = new Map([["hydrojimma.session", JSON.stringify(original)]]);
  globalThis.sessionStorage = {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = new EventTarget();
  globalThis.fetch = fetcher;
  return import(`../src/lib/api.ts?case=${Math.random()}`);
}
test("expired access tokens refresh once across concurrent requests and retry", async () => {
  let refreshes = 0;
  const client = await setup(async (path, options) => {
    if (path.endsWith("/auth/refresh")) {
      refreshes++;
      await new Promise((r) => setTimeout(r, 10));
      return json(next);
    }
    return options.headers.get("Authorization") === "Bearer new"
      ? json({ ok: true })
      : json({ message: "Unauthorized" }, 401);
  });
  let changes = 0;
  window.addEventListener(client.SESSION_CHANGED, () => changes++);
  assert.deepEqual(
    await Promise.all([client.api("/users"), client.api("/audit/events")]),
    [{ ok: true }, { ok: true }],
  );
  assert.equal(refreshes, 1);
  assert.equal(changes, 1);
  assert.equal(client.getSession().accessToken, "new");
});
test("revoked refresh clears session and emits a session change", async () => {
  const client = await setup(async () =>
    json({ message: "Unauthorized" }, 401),
  );
  let changes = 0;
  window.addEventListener(client.SESSION_CHANGED, () => changes++);
  await assert.rejects(client.api("/users"), (error) => error.status === 401);
  assert.equal(client.getSession(), null);
  assert.equal(changes, 1);
});
test("403 is a permission denial, not a reason to refresh or sign out", async () => {
  const calls = [];
  const client = await setup(async (path) => {
    calls.push(path);
    return json({ message: "Forbidden" }, 403);
  });
  await assert.rejects(client.api("/users"), (error) => error.status === 403);
  assert.deepEqual(calls, ["/api/v1/users"]);
  assert.equal(client.getSession().user.role, "ADMIN");
});
test("login failures never trigger token refresh", async () => {
  const calls = [];
  const client = await setup(async (path) => {
    calls.push(path);
    return json({ message: "Unauthorized" }, 401);
  });
  await assert.rejects(client.signIn("wrong", "wrong"));
  assert.deepEqual(calls, ["/api/v1/auth/login"]);
});
test("protected auth/me requests also refresh an expired session", async () => {
  let refreshes = 0;
  const client = await setup(async (path, options) => {
    if (path.endsWith("/auth/refresh")) {
      refreshes++;
      return json(next);
    }
    return options.headers.get("Authorization") === "Bearer new"
      ? json(next.user)
      : json({ message: "Unauthorized" }, 401);
  });
  assert.equal((await client.api("/auth/me")).role, "ADMIN");
  assert.equal(refreshes, 1);
});
test("account metadata synchronization cannot discard an in-flight token refresh", async () => {
  let release;
  const client = await setup(async (path, options) => {
    if (path.endsWith("/auth/refresh"))
      return new Promise((resolve) => {
        release = () => resolve(json(next));
      });
    return options.headers.get("Authorization") === "Bearer new"
      ? json({ ok: true })
      : json({ message: "Unauthorized" }, 401);
  });
  const pending = client.api("/users");
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  client.setSession({
    ...client.getSession(),
    user: { ...client.getSession().user, status: "ACTIVE" },
  });
  release();
  assert.deepEqual(await pending, { ok: true });
  assert.equal(client.getSession().accessToken, "new");
});
test("temporary refresh-server failures do not revoke a valid refresh session", async () => {
  const client = await setup(async (path) =>
    path.endsWith("/auth/refresh")
      ? json({ message: "Temporarily unavailable" }, 503)
      : json({ message: "Unauthorized" }, 401),
  );
  await assert.rejects(client.api("/users"), (error) => error.status === 503);
  assert.equal(client.getSession().refreshToken, "refresh");
});
