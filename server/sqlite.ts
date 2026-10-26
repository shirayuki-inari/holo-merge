import { DatabaseSync } from "node:sqlite";
import type { Store } from "./api.ts";
export function sqliteStore(filename: string): Store & { close(): void } {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  return {
    query(sql, ...args) {
      return db.prepare(sql).all(...args) as ReturnType<Store["query"]>;
    },
    transaction(callback) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const value = callback();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
