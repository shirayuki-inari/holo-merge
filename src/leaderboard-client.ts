import { groups } from "./game/model";
import type { Replay } from "./game/replay";
export interface Entry {
  id: string;
  name: string;
  avatar: string;
  score: number;
  rank: number | null;
}
export interface Board {
  entries: Entry[];
  me: Entry | null;
}
export interface RankedSession {
  id: string;
  seed: number;
  version: number;
  maxTicks: number;
  expires: number;
}
const base = (import.meta.env.VITE_LEADERBOARD_URL || "").replace(/\/$/, "");
const key = "holo-merge-player-v1";
let memoryToken = "";
function token() {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = localStorage.getItem(key) || "";
  } catch {
    /* Memory identity remains usable. */
  }
  if (!/^[a-f0-9]{64}$/.test(memoryToken)) {
    memoryToken = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    try {
      localStorage.setItem(key, memoryToken);
    } catch {
      /* Identity lasts for this page only. */
    }
  }
  return memoryToken;
}
export class LeaderboardError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  try {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(path === "/scores" ? 30_000 : 5000),
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new LeaderboardError(
        detail?.error || "排行榜暂时不可用。",
        response.status,
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof LeaderboardError) throw error;
    throw new LeaderboardError("无法连接排行榜，请稍后重试。");
  }
}
let connecting: Promise<Board> | null = null;
export function connectPlayer(): Promise<Board> {
  if (connecting) return connecting;
  connecting = (async () => {
    let board = await loadBoard();
    if (!board.me) {
      try {
        await request("/players", "POST", {
          name: `玩家${token().slice(0, 4)}`,
          avatar: groups[0].members[0].id,
          token: token(),
        });
      } catch (error) {
        if (!(error instanceof LeaderboardError) || error.status !== 409)
          throw error;
      }
      board = await loadBoard();
    }
    return board;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}
export const loadBoard = () => request<Board>("/leaderboard");
export const saveProfile = (name: string, avatar: string) =>
  request<Board>("/player", "PATCH", { name, avatar });
export const startRankedRun = () => request<RankedSession>("/runs", "POST", {});
export const submitScore = (run: string, replay: Replay) =>
  request<Board & { acceptedScore: number; improved: boolean }>(
    "/scores",
    "POST",
    { run, replay },
  );
