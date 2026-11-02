/**
 * Short vibrations on phones that support them. Desktop browsers may expose
 * navigator.vibrate without a motor, so only coarse pointers offer the setting.
 */
export const canVibrate =
  typeof navigator !== "undefined" &&
  typeof navigator.vibrate === "function" &&
  typeof matchMedia === "function" &&
  matchMedia("(pointer: coarse)").matches;

export function vibrate(pattern: number | number[]) {
  if (!canVibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* Vibration is a nicety; ignore blocked calls. */
  }
}
