export const ENEMY_MEMORY_MS = 90000;
export const MAP_FRESH_MS = 1800;

// A disconnected feed is not a fresh sighting. Expiration must also run while
// no new object snapshots arrive, using the UI clock rather than a poll callback.
export function visibleEnemyTracks<T extends { lastSeen: number; active: boolean }>(tracks: readonly T[], observedAt: number, now: number): T[] {
  const live = observedAt > 0 && now - observedAt < MAP_FRESH_MS;
  return tracks.filter(track => now - track.lastSeen <= ENEMY_MEMORY_MS)
    .map(track => track.active && !live ? { ...track, active: false } : track);
}
