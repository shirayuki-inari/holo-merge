import assert from "node:assert/strict";
const base = process.env.API_URL || "http://127.0.0.1:8787";
const origin = process.env.ADMIN_ORIGIN || "http://127.0.0.1:5175";
const password =
  process.env.ADMIN_TEST_PASSWORD || "test-only-administrator-password";
let cookie = "",
  csrf = "";
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-Admin-CSRF": csrf,
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, body: await r.json() };
}
assert.equal((await call("/api/admin/overview")).status, 401);
assert.equal(
  (await call("/api/admin/login", "POST", { password: "wrong" })).body.code,
  "invalidPassword",
);
const login = await call("/api/admin/login", "POST", { password });
assert.equal(login.status, 200);
cookie = login.headers.get("set-cookie")!.split(";")[0];
csrf = login.body.csrf;
assert.match(login.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
assert.equal((await call("/api/admin/session")).status, 200);
const token = [...crypto.getRandomValues(new Uint8Array(32))]
  .map((n) => n.toString(16).padStart(2, "0"))
  .join("");
const registered = await call("/api/players", "POST", {
  token,
  name: "Admin HTTP Test",
  avatar: "shirakami-fubuki",
});
assert.equal(registered.status, 200);
const list = await call(
  `/api/admin/players?filter=all&search=${registered.body.id}`,
);
assert.equal(list.body.total, 1);
const expected = list.body.players[0];
assert.equal("token_hash" in expected, false);
const patch = {
  action: "edit",
  name: "Admin HTTP Test",
  avatar: "shirakami-fubuki",
  best: 12345,
  reason: "HTTP verification",
  expected,
};
const url = `/api/admin/players/${expected.id}`;
assert.equal(
  (await call(url, "PATCH", patch, { "X-Admin-CSRF": "" })).status,
  403,
);
assert.equal(
  (await call(url, "PATCH", patch, { Origin: "https://invalid.test" })).status,
  403,
);
assert.equal((await call(url, "PATCH", patch)).status, 200);
assert.equal((await call(url, "PATCH", patch)).status, 409);
const publicBoard = await call("/api/leaderboard");
assert.ok(
  publicBoard.body.entries.some(
    (p: { id: string; score: number }) =>
      p.id === expected.id && p.score === 12345,
  ),
);
assert.ok(
  (await call("/api/admin/audit")).body.entries.some(
    (e: { player_id: string }) => e.player_id === expected.id,
  ),
);
const overview = await call("/api/admin/overview");
assert.equal(overview.status, 200);
assert.equal(overview.body.days.length, 14);
assert.match(overview.headers.get("cache-control")!, /no-store/);
const current = (await call(`/api/admin/players?search=${expected.id}`)).body
  .players[0];
assert.equal(
  (
    await call(url, "PATCH", {
      ...patch,
      action: "reset",
      best: 0,
      expected: current,
    })
  ).status,
  200,
);
assert.equal((await call("/api/admin/logout", "POST", {})).status, 200);
assert.equal((await call("/api/admin/session")).status, 401);
console.log(
  "Admin HTTP smoke passed: auth, cookie, CSRF, overview, ranking edit/reset, optimistic concurrency, audit and logout",
);
