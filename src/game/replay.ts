// The protocol is versioned so rule updates cannot silently change old results.
export const RULES_VERSION = 1;
export const MAX_TICKS = 108_000; // 15 minutes of active play; pauses do not count.
export const MAX_DROPS = 2400;
export interface Replay {
  version: number;
  ticks: number;
  drops: [number, number][];
}
export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
