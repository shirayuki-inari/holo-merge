import { useEffect, useRef, useState } from "react";
import { BgmPlayer, chooseBgmTrack } from "./bgm";
const PREFERENCE_KEY = "holo-merge-bgm-enabled-v1";
function storedPreference() {
  try {
    return localStorage.getItem(PREFERENCE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function useBackgroundMusic(suspended: boolean) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<BgmPlayer | null>(null);
  const [track] = useState(chooseBgmTrack);
  const [enabled, setEnabled] = useState(storedPreference);
  const enabledRef = useRef(enabled);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current!;
    const onPlaying = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onPause);
    const player = new BgmPlayer(audio, {
      source: track,
      enabled: enabledRef.current,
      suspended,
    });
    playerRef.current = player;
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onPause);
      player.destroy();
      playerRef.current = null;
    };
  }, [track]);
  useEffect(() => {
    playerRef.current?.setSuspended(suspended);
  }, [suspended]);

  function toggle() {
    const next = !enabledRef.current;
    enabledRef.current = next;
    // Call play synchronously inside the click gesture, before React's next effect.
    playerRef.current?.setEnabled(next);
    setEnabled(next);
    try {
      localStorage.setItem(PREFERENCE_KEY, String(next));
    } catch {
      /* Storage is optional. */
    }
  }
  return { audioRef, enabled, playing, toggle };
}
