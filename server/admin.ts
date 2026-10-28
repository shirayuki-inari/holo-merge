import type { Row, Store } from "./api.ts";
import { ApiError, hash, profile, readBody } from "./http.ts";

export const ADMIN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, credential TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_audit (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, action TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, reason TEXT NOT NULL, created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created DESC, id DESC)`,
];
const SESSION_MS = 12 * 60 * 60 * 1000;
const fields = "id,name,avatar,best,best_at,created";
const ranked = `SELECT ${fields}, CASE WHEN best>0 THEN ROW_NUMBER() OVER (ORDER BY best DESC,best_at ASC,id ASC) ELSE NULL END AS rank FROM players`;
class AdminError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
function fail(status: number, code: string): never {
  throw new AdminError(status, code);
}
function randomToken() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function same(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
function number(row: Row | undefined, key: string) {
  return Number(row?.[key] || 0);
}
export function createAdmin(
  store: Store,
  configuredOrigin: string | undefined,
  clock: () => number,
  password?: string,
) {
  const credential = password && password.length >= 16 ? hash(password) : null;
  function limit(key: string, max: number, duration: number, now: number) {
    const row = store.query(
      "SELECT count,reset FROM rate_limits WHERE key=?",
      key,
    )[0];
    if (row && Number(row.reset) > now && Number(row.count) >= max)
      fail(429, "rateLimited");
    store.query(
      `INSERT INTO rate_limits(key,count,reset) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset<=? THEN 1 ELSE count+1 END, reset=CASE WHEN reset<=? THEN excluded.reset ELSE reset END`,
      key,
      now + duration,
      now,
      now,
    );
  }
  return async (request: Request, ip: string) => {
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    try {
      const url = new URL(request.url);
      const origin = configuredOrigin || url.origin;
      const originURL = new URL(origin);
      const local =
        originURL.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(originURL.hostname);
      if (!credential || (originURL.protocol !== "https:" && !local))
        fail(503, "disabled");
      // Administration must be served on the same origin as its API; no credentialed CORS.
      if (
        (request.headers.has("Origin") &&
          request.headers.get("Origin") !== origin) ||
        (request.method !== "GET" && request.headers.get("Origin") !== origin)
      )
        fail(403, "originDenied");
      const secure = !local;
      const cookieName = secure ? "__Host-holo-admin" : "holo-admin";
      const cookie = (token: string, age: number) =>
        `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
      const now = clock();
      const ipHash = await hash(ip);
      const key = await credential;
      store.transaction(() => {
        store.query(
          "DELETE FROM admin_sessions WHERE expires<=? OR credential<>?",
          now,
          key,
        );
        store.query("DELETE FROM rate_limits WHERE reset<=?", now);
        limit(`admin:read:${ipHash}`, 180, 60_000, now);
        if (url.pathname === "/api/admin/login" && request.method === "POST") {
          limit(`admin:login:${ipHash}`, 10, 15 * 60_000, now);
          limit("admin:login:global", 200, 15 * 60_000, now);
        }
      });
      let data: unknown;
      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        const body = await readBody(request, 4096);
        if (
          typeof body.password !== "string" ||
          body.password.length > 1024 ||
          !same(await hash(body.password), key)
        )
          fail(401, "invalidPassword");
        const token = randomToken(),
          csrf = randomToken();
        const digest = await hash(token);
        store.transaction(() => {
          const old = store.query(
            "SELECT token_hash FROM admin_sessions ORDER BY created DESC,token_hash DESC",
          );
          for (const row of old.slice(7))
            store.query(
              "DELETE FROM admin_sessions WHERE token_hash=?",
              row.token_hash,
            );
          store.query(
            "INSERT INTO admin_sessions(token_hash,csrf,credential,created,expires) VALUES (?,?,?,?,?)",
            digest,
            csrf,
            key,
            now,
            now + SESSION_MS,
          );
        });
        headers.set("Set-Cookie", cookie(token, SESSION_MS / 1000));
        data = { csrf, expires: now + SESSION_MS };
      } else {
        const token = request.headers
          .get("Cookie")
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1);
        const session =
          token && /^[a-f0-9]{64}$/.test(token)
            ? store.query(
                "SELECT * FROM admin_sessions WHERE token_hash=?",
                await hash(token),
              )[0]
            : undefined;
        if (!session) fail(401, "unauthorized");
        if (
          request.method !== "GET" &&
          !same(request.headers.get("X-Admin-CSRF") || "", String(session.csrf))
        )
          fail(403, "csrf");
        if (url.pathname === "/api/admin/session" && request.method === "GET")
          data = { csrf: session.csrf, expires: session.expires };
        else if (
          url.pathname === "/api/admin/logout" &&
          request.method === "POST"
        ) {
          store.query(
            "DELETE FROM admin_sessions WHERE token_hash=?",
            session.token_hash,
          );
          headers.set("Set-Cookie", cookie("", 0));
          data = { ok: true };
        } else if (
          url.pathname === "/api/admin/overview" &&
          request.method === "GET"
        ) {
          data = store.transaction(() => {
            const since = number(
              store.query(
                "SELECT value FROM admin_meta WHERE key='metrics_since'",
              )[0],
              "value",
            );
            const today = Date.UTC(
              new Date(now).getUTCFullYear(),
              new Date(now).getUTCMonth(),
              new Date(now).getUTCDate(),
            );
            const start = today - 13 * 86_400_000;
            const registered = store.query(
              "SELECT strftime('%Y-%m-%d',created/1000,'unixepoch') AS day,COUNT(*) AS n FROM players WHERE created>=? GROUP BY day",
              start,
            );
            const metrics = store.query(
              "SELECT * FROM daily_metrics WHERE day>=?",
              new Date(start).toISOString().slice(0, 10),
            );
            const totals = store.query(
              "SELECT COUNT(*) AS players,COALESCE(SUM(best>0),0) AS ranked,COALESCE(MAX(best),0) AS highest,COALESCE(AVG(CASE WHEN best>0 THEN best END),0) AS averageBest FROM players",
            )[0];
            const outstanding = number(
              store.query(
                "SELECT COUNT(*) AS n FROM runs WHERE used=0 AND expires>?",
                now,
              )[0],
              "n",
            );
            const days = Array.from({ length: 14 }, (_, i) => {
              const date = start + i * 86_400_000,
                day = new Date(date).toISOString().slice(0, 10);
              const m = metrics.find((r) => r.day === day);
              const known = date + 86_400_000 > since;
              return {
                day,
                players: number(
                  registered.find((r) => r.day === day),
                  "n",
                ),
                started: known ? number(m, "started") : null,
                accepted: known ? number(m, "accepted") : null,
                rejected: known ? number(m, "rejected") : null,
              };
            });
            const sum = metrics.reduce<{
              started: number;
              accepted: number;
              rejected: number;
              scoreSum: number;
            }>(
              (a, m) => ({
                started: a.started + number(m, "started"),
                accepted: a.accepted + number(m, "accepted"),
                rejected: a.rejected + number(m, "rejected"),
                scoreSum: a.scoreSum + number(m, "score_sum"),
              }),
              { started: 0, accepted: 0, rejected: 0, scoreSum: 0 },
            );
            const distribution = store.query(
              `SELECT CASE WHEN best=0 THEN '0' WHEN best<5000 THEN '1–4,999' WHEN best<10000 THEN '5,000–9,999' WHEN best<20000 THEN '10,000–19,999' ELSE '20,000+' END AS bucket,COUNT(*) AS count FROM players GROUP BY bucket`,
            );
            return {
              now,
              metricsSince: since,
              totals: { ...totals, outstanding },
              period: {
                started: sum.started,
                accepted: sum.accepted,
                rejected: sum.rejected,
                averageScore: sum.accepted ? sum.scoreSum / sum.accepted : 0,
              },
              days,
              distribution: [
                "0",
                "1–4,999",
                "5,000–9,999",
                "10,000–19,999",
                "20,000+",
              ].map((bucket) => ({
                bucket,
                count: number(
                  distribution.find((r) => r.bucket === bucket),
                  "count",
                ),
              })),
              top: store.query(
                `SELECT * FROM (${ranked}) WHERE best>0 ORDER BY rank LIMIT 5`,
              ),
            };
          });
        } else if (
          ["/api/admin/players", "/api/admin/audit"].includes(url.pathname) &&
          request.method === "GET"
        ) {
          const page = Number(url.searchParams.get("page") || 1),
            pageSize = 25;
          if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000)
            fail(400, "invalidPage");
          data = store.transaction(() => {
            if (url.pathname.endsWith("audit"))
              return {
                page,
                pageSize,
                total: number(
                  store.query("SELECT COUNT(*) AS n FROM admin_audit")[0],
                  "n",
                ),
                entries: store.query(
                  "SELECT * FROM admin_audit ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
                  pageSize,
                  (page - 1) * pageSize,
                ),
              };
            const search = (url.searchParams.get("search") || "").trim();
            const filter = url.searchParams.get("filter") || "ranked";
            if (
              search.length > 100 ||
              !["all", "ranked", "unranked"].includes(filter)
            )
              fail(400, "invalidFilter");
            const where = `WHERE (instr(lower(name),lower(?))>0 OR id=?)${filter === "ranked" ? " AND best>0" : filter === "unranked" ? " AND best=0" : ""}`;
            return {
              page,
              pageSize,
              total: number(
                store.query(
                  `SELECT COUNT(*) AS n FROM players ${where}`,
                  search,
                  search,
                )[0],
                "n",
              ),
              players: store.query(
                `SELECT * FROM (${ranked}) ${where} ORDER BY best DESC,best_at ASC,id ASC LIMIT ? OFFSET ?`,
                search,
                search,
                pageSize,
                (page - 1) * pageSize,
              ),
            };
          });
        } else if (
          /^\/api\/admin\/players\/[a-f0-9-]{36}$/.test(url.pathname) &&
          request.method === "PATCH"
        ) {
          const body = await readBody(request, 4096);
          const id = url.pathname.split("/").at(-1)!;
          if (
            typeof body.reason !== "string" ||
            !body.reason.trim() ||
            [...body.reason].length > 200 ||
            /[\p{C}]/u.test(body.reason)
          )
            fail(400, "invalidReason");
          if (!["edit", "reset"].includes(String(body.action)))
            fail(400, "invalidAction");
          const { name, avatar } = profile(body);
          if (
            !Number.isSafeInteger(body.best) ||
            Number(body.best) < 0 ||
            Number(body.best) > 2_147_483_647 ||
            (body.action === "reset" && body.best !== 0)
          )
            fail(400, "invalidScore");
          const reason = body.reason.trim();
          const expected = body.expected as Record<string, unknown> | null;
          data = store.transaction(() => {
            const before = store.query(
              `SELECT ${fields} FROM players WHERE id=?`,
              id,
            )[0];
            if (!before) fail(404, "notFound");
            if (
              !expected ||
              ["name", "avatar", "best", "best_at"].some(
                (k) => expected[k] !== before[k],
              )
            )
              fail(409, "conflict");
            if (
              body.action === "reset" &&
              (name !== before.name || avatar !== before.avatar)
            )
              fail(400, "invalidAction");
            if (
              name === before.name &&
              avatar === before.avatar &&
              body.best === before.best
            )
              fail(400, "noChanges");
            const bestAt =
              body.best === before.best
                ? before.best_at
                : body.best === 0
                  ? 0
                  : now;
            store.query(
              "UPDATE players SET name=?,avatar=?,best=?,best_at=? WHERE id=?",
              name,
              avatar,
              Number(body.best),
              bestAt,
              id,
            );
            const after = store.query(
              `SELECT ${fields} FROM players WHERE id=?`,
              id,
            )[0];
            store.query(
              "INSERT INTO admin_audit(id,player_id,action,before_json,after_json,reason,created) VALUES (?,?,?,?,?,?,?)",
              crypto.randomUUID(),
              id,
              String(body.action),
              JSON.stringify(before),
              JSON.stringify(after),
              reason,
              now,
            );
            return { ok: true, player: after };
          });
        } else fail(404, "notFound");
      }
      return new Response(JSON.stringify(data), { headers });
    } catch (error) {
      const known = error instanceof AdminError || error instanceof ApiError;
      if (!known)
        console.error(
          "Admin request failed",
          error instanceof Error ? error.message : "unknown",
        );
      const status = known ? error.status : 500;
      if (status === 429) headers.set("Retry-After", "900");
      return new Response(
        JSON.stringify({ code: known ? error.code : "unavailable" }),
        { status, headers },
      );
    }
  };
}
