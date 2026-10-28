export interface ManagedPlayer {
  id: string;
  name: string;
  avatar: string;
  best: number;
  best_at: number;
  created: number;
  rank: number | null;
}
export interface AdminOverview {
  now: number;
  metricsSince: number;
  totals: {
    players: number;
    ranked: number;
    highest: number;
    averageBest: number;
    outstanding: number;
  };
  period: {
    started: number;
    accepted: number;
    rejected: number;
    averageScore: number;
  };
  days: {
    day: string;
    players: number;
    started: number | null;
    accepted: number | null;
    rejected: number | null;
  }[];
  distribution: { bucket: string; count: number }[];
  top: ManagedPlayer[];
}
export interface AdminPlayers {
  players: ManagedPlayer[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AdminAuditEntry {
  id: string;
  player_id: string;
  action: "edit" | "reset";
  before_json: string;
  after_json: string;
  reason: string;
  created: number;
}
export interface AdminAudit {
  entries: AdminAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}
