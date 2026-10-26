import { useEffect, useRef, useState } from "react";
import { BGM_TRACKS, BgmPlayer, chooseBgmTrack } from "./bgm";
import { readEnabled, savePreference } from "../preferences";
const PREFERENCE_KEY = "holo-merge-bgm-enabled-v1";
const TRACK_KEY = "holo-merge-bgm-track-v1";
function storedTrack() {
  try {
    const saved = localStorage.getItem(TRACK_KEY);
    if (saved !== null && /^(0|[1-9]\d*)$/.test(saved)) {
      const index = Number(saved);
      if (index < BGM_TRACKS.length) return BGM_TRACKS[index];
    }
  } catch {
    /* Fall back to a random track. */
  }
  return chooseBgmTrack();
}
export function useBackgroundMusic(suspended: boolean) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<BgmPlayer | null>(null);
  const [track, setTrack] = useState(storedTrack);
  const initialTrack = useRef(track);
  const [enabled, setEnabled] = useState(() => readEnabled(PREFERENCE_KEY));
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
      source: initialTrack.current,
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
  }, []);
  useEffect(() => {
    playerRef.current?.setSuspended(suspended);
  }, [suspended]);
  function toggle() {
    const next = !enabledRef.current;
    enabledRef.current = next;
    // Preserve the click gesture so playback can unlock on mobile browsers.
    playerRef.current?.setEnabled(next);
    setEnabled(next);
    savePreference(PREFERENCE_KEY, String(next));
  }
  function selectTrack(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= BGM_TRACKS.length)
      return;
    const source = BGM_TRACKS[index];
    playerRef.current?.setSource(source);
    setTrack(source);
    savePreference(TRACK_KEY, String(index));
  }
  return {
    audioRef,
    enabled,
    playing,
    toggle,
    selectTrack,
    trackIndex: BGM_TRACKS.findIndex((source) => source === track),
  };
}
