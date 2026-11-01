import { useEffect, useRef, useState } from "react";
import { takeRankedRun, type RankedSession } from "./leaderboard-client";
export function useRankedRound(round: number) {
  const [value, setValue] = useState<{
    round: number;
    session: RankedSession | null;
    message: "rank.ready" | "rank.unavailable";
  } | null>(null);
  // One request per round, even when StrictMode re-runs the effect.
  const requests = useRef(new Map<number, Promise<RankedSession>>());
  useEffect(() => {
    let active = true;
    let request = requests.current.get(round);
    if (!request) {
      request = takeRankedRun();
      requests.current.clear();
      requests.current.set(round, request);
    }
    request.then(
      (session) => {
        if (active) setValue({ round, session, message: "rank.ready" });
      },
      () => {
        if (active)
          setValue({ round, session: null, message: "rank.unavailable" });
      },
    );
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
