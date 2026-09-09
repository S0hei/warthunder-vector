import type { FileBattle } from './file-battles';

// An empty contact list can mean respawn/spectator mode, not the hangar.
// Keep the last map through brief outages, but release it after a game shutdown.
export function showSessionOverview(valid: unknown, infoUpdatedAt: number, objectsUpdatedAt: number, now: number) {
  return valid !== true || Math.max(infoUpdatedAt, objectsUpdatedAt) <= 0 ||
    now - Math.max(infoUpdatedAt, objectsUpdatedAt) > 15_000;
}

export function sessionBattles(battles: FileBattle[], account: string | undefined, startedAt: string | null) {
  const since = startedAt === null ? NaN : Date.parse(startedAt);
  if (!account || !Number.isFinite(since)) return [];
  return battles.filter(b => b.accountId === account && Date.parse(b.playedAt) >= since)
    .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt));
}
