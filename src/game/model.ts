import rawGroups from "../talents.json";
export interface Talent {
  id: string;
  name: string;
  en: string;
  image: string;
  source: string;
  url: string;
}
export interface Group {
  id: string;
  name: string;
  year: string;
  members: Talent[];
}
export const groups: Group[] = rawGroups;
export const RADII = [18, 23, 29, 35, 42, 50, 59, 69, 80, 92, 106];
export const COLORS = [
  "#f8b3c7",
  "#aab4ef",
  "#7ddcc9",
  "#ab8ed8",
  "#8bcbf0",
  "#f3bb80",
  "#eaa4c6",
  "#a1d8a2",
  "#f4cf67",
  "#76c4e1",
  "#48c5f4",
];
export const WIDTH = 440,
  HEIGHT = 580,
  DANGER_Y = 105;
export function createLineup(random = Math.random): Talent[] {
  const selected = new Set<string>();
  return groups.map((group) => {
    // Some talents belong to both GAMERS and a numbered generation.
    const unique = group.members.filter((member) => !selected.has(member.id));
    const available = unique.length ? unique : group.members;
    const member =
      available[
        Math.min(available.length - 1, Math.floor(random() * available.length))
      ];
    selected.add(member.id);
    return member;
  });
}
export function randomDrop(random = Math.random) {
  const n = random();
  return n < 0.65 ? 0 : n < 0.92 ? 1 : 2;
}
export function mergeLevel(a: number, b: number): number | null {
  return a === b && a < groups.length - 1 ? a + 1 : null;
}
export function mergePoints(level: number) {
  return 2 ** (level + 1);
}
export function clampDrop(x: number, level: number) {
  return Math.max(RADII[level] + 9, Math.min(WIDTH - RADII[level] - 9, x));
}
