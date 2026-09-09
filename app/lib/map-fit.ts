export type AutoFitMode = 'air' | 'battle';
export type MapBounds = { minX: number; maxX: number; minY: number; maxY: number };
export type MapViewport = { width: number; height: number };
export type MapView = { zoom: number; pan: { x: number; y: number } };

type RunwayGeometry = { type: string; sx?: number; sy?: number; ex?: number; ey?: number };

export const MIN_MAP_ZOOM = 0.25;
export const MAX_MAP_ZOOM = 4;
const BATTLE_PADDING = 0.1;
const MIN_BATTLE_PADDING = 0.025;

// Use complete runway segments, not their centers or spawn/bombing markers.
// All exposed airfields participate regardless of team or layer visibility.
export function airfieldBattleArea(objects: readonly RunwayGeometry[]): MapBounds | null {
  let bounds: MapBounds | null = null;
  for (const object of objects) {
    if (object.type !== 'airfield') continue;
    const { sx, sy, ex, ey } = object;
    if (sx == null || sy == null || ex == null || ey == null ||
      ![sx, sy, ex, ey].every((value) => Number.isFinite(value))) continue;
    const runway = { minX: Math.min(sx, ex), maxX: Math.max(sx, ex), minY: Math.min(sy, ey), maxY: Math.max(sy, ey) };
    bounds = bounds ? {
      minX: Math.min(bounds.minX, runway.minX), maxX: Math.max(bounds.maxX, runway.maxX),
      minY: Math.min(bounds.minY, runway.minY), maxY: Math.max(bounds.maxY, runway.maxY),
    } : runway;
  }
  if (!bounds) return null;
  const padX = Math.max((bounds.maxX - bounds.minX) * BATTLE_PADDING, MIN_BATTLE_PADDING);
  const padY = Math.max((bounds.maxY - bounds.minY) * BATTLE_PADDING, MIN_BATTLE_PADDING);
  // Do not clamp to map edges: airfields near the border still need breathing room.
  return { minX: bounds.minX - padX, maxX: bounds.maxX + padX, minY: bounds.minY - padY, maxY: bounds.maxY + padY };
}

export function fitMapArea(bounds: MapBounds | null, viewport: MapViewport, mode: AutoFitMode): MapView | null {
  const { width, height } = viewport;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const overview = { zoom: 1, pan: { x: 0, y: 0 } };
  if (!bounds || !Object.values(bounds).every(Number.isFinite) || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) return overview;
  const size = Math.min(width, height);
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.22);
  const spanY = Math.max(bounds.maxY - bounds.minY, 0.22);
  const fitted = Math.min(width / (spanX * size), height / (spanY * size));
  // Preserve the existing aircraft fit. Battle bounds already contain world-space
  // padding and may require zooming out below 1 to include runways at map edges.
  const zoom = mode === 'air'
    ? Math.max(1, Math.min(3.5, fitted * 0.82))
    : Math.min(3.5, fitted * 0.96);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return { zoom, pan: { x: -(centerX - 0.5) * size * zoom, y: -(centerY - 0.5) * size * zoom } };
}
