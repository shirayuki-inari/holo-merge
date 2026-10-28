import type { Store } from "./api.ts";

export function initializeMetrics(store: Store, now: number) {
  store.query(
    `CREATE TABLE IF NOT EXISTS admin_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`,
  );
  store.query(
    `CREATE TABLE IF NOT EXISTS daily_metrics (day TEXT PRIMARY KEY, started INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, score_sum INTEGER NOT NULL DEFAULT 0)`,
  );
  store.query(
    "INSERT OR IGNORE INTO admin_meta(key,value) VALUES ('metrics_since', ?)",
    now,
  );
}

export function recordMetric(
  store: Store,
  now: number,
  kind: "started" | "accepted" | "rejected",
  score = 0,
) {
  // Only server-observed events. No changes to the game's upload protocol.
  store.query(
    `INSERT INTO daily_metrics(day,started,accepted,rejected,score_sum) VALUES (?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET started=started+excluded.started, accepted=accepted+excluded.accepted, rejected=rejected+excluded.rejected, score_sum=score_sum+excluded.score_sum`,
    new Date(now).toISOString().slice(0, 10),
    kind === "started" ? 1 : 0,
    kind === "accepted" ? 1 : 0,
    kind === "rejected" ? 1 : 0,
    score,
  );
}
