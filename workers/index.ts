import { DurableObject } from "cloudflare:workers";
import { createApi, type Store } from "../server/api.ts";
interface Env {
  LEADERBOARD: DurableObjectNamespace<Leaderboard>;
  PUBLIC_ORIGIN: string;
}
// One strongly consistent, SQLite-backed object owns the small community leaderboard.
export class Leaderboard extends DurableObject<Env> {
  private api: ReturnType<typeof createApi>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const store: Store = {
      query(sql, ...args) {
        return ctx.storage.sql
          .exec<import("../server/api.ts").Row>(sql, ...args)
          .toArray();
      },
      transaction(callback) {
        return ctx.storage.transactionSync(callback);
      },
    };
    this.api = createApi(store, env.PUBLIC_ORIGIN);
  }
  fetch(request: Request) {
    return this.api(
      request,
      request.headers.get("CF-Connecting-IP") || "unknown",
    );
  }
}
export default {
  fetch(request: Request, env: Env) {
    // Forward the platform-issued IP, not user-supplied forwarding headers.
    const object = env.LEADERBOARD.get(env.LEADERBOARD.idFromName("global-v1"));
    return object.fetch(request);
  },
};
