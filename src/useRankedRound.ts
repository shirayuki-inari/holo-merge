import { useEffect, useState } from "react";
import {
  connectPlayer,
  startRankedRun,
  type RankedSession,
} from "./leaderboard-client";
export function useRankedRound(round: number) {
  const [value, setValue] = useState<{
    round: number;
    session: RankedSession | null;
    message: "rank.ready" | "rank.offline" | "rank.unavailable";
  } | null>(null);
  useEffect(() => {
    let active = true;
    connectPlayer()
      .then(() => (active ? startRankedRun() : null))
      .then((session) => {
        if (active)
          setValue({
            round,
            session,
            message: session ? "rank.ready" : "rank.offline",
          });
      })
      .catch(() => {
        if (active)
          setValue({
            round,
            session: null,
            message: "rank.unavailable",
          });
      });
    return () => {
      active = false;
    };
  }, [round]);
  return {
    ready: value?.round === round,
    session: value?.round === round ? value.session : null,
    message:
      value?.round === round ? value.message : ("rank.connecting" as const),
  };
}
