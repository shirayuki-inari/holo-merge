import { API_ERRORS, type ApiErrorCode } from "./shared/api-errors";
import {
  createTranslator,
  detectLocale,
  isLocale,
  LANGUAGE_KEY,
} from "./i18n/core";
import type { Translate } from "./i18n/types";
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
  expires: number;
}
// Optional chaining lets Node unit tests import this module (Vite still inlines the value).
const base = (import.meta.env?.VITE_LEADERBOARD_URL || "").replace(/\/$/, "");
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
    public code: ApiErrorCode | "unavailable" | "network" = "unavailable",
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
        Object.hasOwn(API_ERRORS, detail?.code)
          ? detail.code
          : Object.entries(API_ERRORS).find(
              ([, message]) => message === detail?.error,
            )?.[0] || "unavailable",
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof LeaderboardError) throw error;
    throw new LeaderboardError("无法连接排行榜，请稍后重试。", 0, "network");
  }
}
const registeredKey = "holo-merge-registered-v1";
/** Remember (per identity) that registration succeeded, so rounds can skip it. */
function setRegistered(value: boolean) {
  try {
    if (value) localStorage.setItem(registeredKey, token().slice(0, 12));
    else localStorage.removeItem(registeredKey);
  } catch {
    /* Registration is checked again next time. */
  }
}
function isRegistered() {
  try {
    return localStorage.getItem(registeredKey) === token().slice(0, 12);
  } catch {
    return false;
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
          name: defaultPlayerName(token().slice(0, 4)),
          avatar: groups[0].members[0].id,
          token: token(),
        });
      } catch (error) {
        if (!(error instanceof LeaderboardError) || error.status !== 409)
          throw error;
      }
      board = await loadBoard();
    }
    setRegistered(true);
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
/**
 * Start a ranked round. Registered players only need one request; the
 * leaderboard itself is loaded when someone opens it.
 */
export async function beginRankedRun(): Promise<RankedSession> {
  if (!isRegistered()) await connectPlayer();
  try {
    return await startRankedRun();
  } catch (error) {
    if (!(error instanceof LeaderboardError) || error.status !== 401)
      throw error;
    // The server no longer knows this identity: register again once.
    setRegistered(false);
    await connectPlayer();
    return startRankedRun();
  }
}
// Sessions last six hours; never start a round on one that is about to expire.
const MIN_SESSION_LIFETIME = 10 * 60_000;
let prefetched: Promise<RankedSession> | null = null;
/** Request the next round's seed while the player looks at the result screen. */
export function prefetchRankedRun() {
  if (prefetched) return;
  const request = beginRankedRun();
  prefetched = request;
  request.catch(() => {
    if (prefetched === request) prefetched = null;
  });
}
export function takeRankedRun(): Promise<RankedSession> {
  const request = prefetched;
  prefetched = null;
  if (!request) return beginRankedRun();
  return request.then(
    (session) =>
      session.expires - Date.now() > MIN_SESSION_LIFETIME
        ? session
        : beginRankedRun(),
    () => beginRankedRun(),
  );
}
export const submitScore = (run: string, replay: Replay) =>
  request<Board & { acceptedScore: number; improved: boolean }>(
    "/scores",
    "POST",
    { run, replay },
  );

/** Translate stable error codes at render time so existing feedback follows language changes. */
export function leaderboardErrorText(error: unknown, t: Translate): string {
  if (error instanceof LeaderboardError) {
    return t(`error.${error.code}`);
  }
  return t("error.unavailable");
}
function defaultPlayerName(id: string) {
  let locale = detectLocale(navigator.languages || [navigator.language]);
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (isLocale(saved)) locale = saved;
  } catch {
    /* Use browser language when storage is unavailable. */
  }
  return createTranslator(locale)("player.default", { id });
}
