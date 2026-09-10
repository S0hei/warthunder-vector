export type FileBattle = {
  schemaVersion: 1; id: string; accountId: string; player: string | null; playedAt: string;
  mission: string | null; outcome: 'win' | 'loss' | 'unknown'; conflict: boolean;
  hasLog: boolean; hasReplay: boolean; rewardsFinal: boolean; wp: number | null; exp: number | null;
  kills: number | null; groundKills: number | null; navalKills: number | null;
  aiKills: number | null; aiGroundKills: number | null; aiNavalKills: number | null;
  assists: number | null; deaths: number | null; spawns: number | null; score: number | null;
  seconds: number | null; vehicles: string[];
};
const counters = ['kills', 'groundKills', 'navalKills', 'aiKills', 'aiGroundKills', 'aiNavalKills', 'assists', 'deaths', 'score'] as const;
const numeric = (v: unknown, min: number, max: number) => v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max);
export const battleKey = (b: Pick<FileBattle, 'accountId' | 'id'>) => `${b.accountId}-${b.id}`;
export function battleAccounts(battles: readonly FileBattle[]): [string, string][] {
  const accounts = new Map<string, string>();
  // Archives arrive newest first. An older nickname must not replace the current one.
  for (const battle of battles) {
    if (!accounts.has(battle.accountId) || (accounts.get(battle.accountId) === battle.accountId && battle.player)) {
      accounts.set(battle.accountId, battle.player || battle.accountId);
    }
  }
  return [...accounts];
}
export function decodeFileBattles(input: unknown): { battles: FileBattle[]; rejected: number } {
  if (!Array.isArray(input) || input.length > 5000) throw new Error('Invalid battle archive');
  const battles: FileBattle[] = [], seen = new Set<string>(); let rejected = 0;
  for (const value of input) {
    if (!value || typeof value !== 'object') { rejected++; continue; }
    const b = value as FileBattle;
    if (b.schemaVersion !== 1 || typeof b.id !== 'string' || !/^[0-9a-f]{8,32}$/.test(b.id) ||
      typeof b.accountId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(b.accountId) || typeof b.playedAt !== 'string' || !Number.isFinite(Date.parse(b.playedAt)) ||
      !['win', 'loss', 'unknown'].includes(b.outcome) || typeof b.conflict !== 'boolean' || (b.conflict && b.outcome !== 'unknown') ||
      typeof b.hasLog !== 'boolean' || typeof b.hasReplay !== 'boolean' || (!b.hasLog && !b.hasReplay) ||
      typeof b.rewardsFinal !== 'boolean' || (b.rewardsFinal && (!b.hasLog || (b.outcome === 'unknown' && !b.conflict))) ||
      (b.player !== null && (typeof b.player !== 'string' || b.player.length > 128)) ||
      (b.mission !== null && (typeof b.mission !== 'string' || b.mission.length > 260)) ||
      !Array.isArray(b.vehicles) || b.vehicles.length > 32 || b.vehicles.some(v => typeof v !== 'string' || v.length > 128) ||
      !counters.every(k => numeric(b[k], 0, 10_000_000)) || (b.spawns !== undefined && !numeric(b.spawns, 1, 512)) ||
      (b.spawns != null && !b.hasLog) || !numeric(b.wp, -1_000_000_000, 1_000_000_000) || !numeric(b.exp, -1_000_000_000, 1_000_000_000) ||
      (b.seconds !== null && (typeof b.seconds !== 'number' || !Number.isFinite(b.seconds) || b.seconds < 0 || b.seconds > 86400)) || seen.has(battleKey(b))) { rejected++; continue; }
    seen.add(battleKey(b)); battles.push({ ...b, spawns: b.spawns ?? null });
  }
  battles.sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
  return { battles, rejected };
}
export const killCount = (b: FileBattle) => b.hasReplay && b.kills !== null && b.groundKills !== null && b.navalKills !== null ? b.kills + b.groundKills + b.navalKills : null;
export const aiCount = (b: FileBattle) => b.hasReplay && b.aiKills !== null && b.aiGroundKills !== null && b.aiNavalKills !== null ? b.aiKills + b.aiGroundKills + b.aiNavalKills : null;
export function summarizeFileBattles(battles: FileBattle[]) {
  const resolved = battles.filter(b => b.outcome !== 'unknown' && !b.conflict), wins = resolved.filter(b => b.outcome === 'win').length;
  const scores = battles.filter(b => killCount(b) !== null && b.deaths !== null);
  const kills = scores.reduce((n, b) => n + killCount(b)!, 0), deaths = scores.reduce((n, b) => n + b.deaths!, 0);
  // Each ratio uses only matches with BOTH its numerator and denominator.
  const spawnScores = battles.filter(b => killCount(b) !== null && b.spawns != null && b.spawns > 0);
  const spawnKills = spawnScores.reduce((n, b) => n + killCount(b)!, 0), spawns = spawnScores.reduce((n, b) => n + b.spawns!, 0);
  const wp = resolved.filter(b => b.rewardsFinal && b.wp !== null), exp = resolved.filter(b => b.rewardsFinal && b.exp !== null);
  return { count: battles.length, wins, losses: resolved.length - wins, unresolved: battles.length - resolved.length,
    resolved: resolved.length, winRate: resolved.length ? wins / resolved.length * 100 : null,
    kills, deaths, scoreCount: scores.length, kd: deaths ? kills / deaths : null,
    spawnKills, spawns, spawnCount: spawnScores.length, ks: spawns ? spawnKills / spawns : null,
    ai: scores.reduce((n, b) => n + (aiCount(b) ?? 0), 0),
    wp: wp.length ? wp.reduce((n, b) => n + b.wp!, 0) : null, wpCount: wp.length,
    exp: exp.length ? exp.reduce((n, b) => n + b.exp!, 0) : null, expCount: exp.length };
}
export function localBattleDay(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export type BattlePeriod = 'today' | 'yesterday' | 'day-before-yesterday' | 'week' | 'custom' | 'session' | 'all';
export type BattlePeriodRange = { kind: BattlePeriod; from: string; to: string; error: string | null };

function parseBattleDay(day: string) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  if (year < 1) return null;
  // Local noon and calendar arithmetic avoid UTC date shifts and 23/25-hour days.
  const value = new Date(2000, 0, 1, 12);
  value.setFullYear(year, month - 1, date);
  return localBattleDay(value.toISOString()) === day ? value : null;
}

export function resolveBattlePeriod(kind: BattlePeriod, today: string, custom: { from: string; to: string }): BattlePeriodRange {
  const result: BattlePeriodRange = { kind, from: '', to: '', error: null };
  if (kind === 'all' || kind === 'session') return result;
  const date = parseBattleDay(today);
  if (!date) return { ...result, error: 'Current date unavailable.' };
  if (kind === 'custom') {
    const error = !custom.from || !custom.to ? 'Choose a start and end date.'
      : !parseBattleDay(custom.from) || !parseBattleDay(custom.to) ? 'Enter valid dates.'
        : custom.from > custom.to ? 'End date must be on or after start date.'
          : custom.to > today ? 'Choose dates up to today.' : null;
    return { ...result, ...custom, error };
  }
  if (kind === 'yesterday') date.setDate(date.getDate() - 1);
  if (kind === 'day-before-yesterday') date.setDate(date.getDate() - 2);
  if (kind === 'week') date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  const from = localBattleDay(date.toISOString());
  return { ...result, from, to: kind === 'week' ? today : from };
}

export function battlesForPeriod(battles: FileBattle[], account: string | undefined, period: BattlePeriodRange, startedAt: string | null) {
  if (!account || period.error) return [];
  const since = startedAt === null ? NaN : Date.parse(startedAt);
  return battles.filter(b => {
    if (b.accountId !== account) return false;
    if (period.kind === 'all') return true;
    if (period.kind === 'session') return Number.isFinite(since) && Date.parse(b.playedAt) >= since;
    const day = localBattleDay(b.playedAt);
    return day >= period.from && day <= period.to;
  });
}
