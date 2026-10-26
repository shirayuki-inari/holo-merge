import { useRef, useState } from "react";
export function readEnabled(key: string) {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}
export function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage is optional. */
  }
}
export function useVoicePreference(change: (enabled: boolean) => void) {
  const key = "holo-merge-voices-enabled-v1";
  const [enabled, setEnabled] = useState(() => readEnabled(key));
  const ref = useRef(enabled);
  return {
    enabled,
    toggle() {
      const next = !ref.current;
      ref.current = next;
      change(next);
      setEnabled(next);
      savePreference(key, String(next));
    },
  };
}
