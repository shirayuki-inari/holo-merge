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
    message: string;
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
            message: session ? "本局可提交排行榜" : "本局为离线游戏",
          });
      })
      .catch(() => {
        if (active)
          setValue({
            round,
            session: null,
            message: "本局为离线游戏，排行榜暂不可用",
          });
      });
    return () => {
      active = false;
    };
  }, [round]);
  return {
    ready: value?.round === round,
    session: value?.round === round ? value.session : null,
    message: value?.round === round ? value.message : "正在连接排行榜…",
  };
}
