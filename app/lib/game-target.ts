type TargetMapObject = {
  type?: unknown;
  icon?: unknown;
  icon_bg?: unknown;
  x?: unknown;
  y?: unknown;
};

// The live map feed marks the selected vehicle with <icon>Target in icon_bg.
// Verified while switching between Fighter, Wheeled and Airdefence contacts.
// blink is also used for ordinary mission units, so it is not a selection flag.
export function isGameSelectedTarget(object: TargetMapObject | null | undefined, feedLive: boolean): boolean {
  if (!feedLive || !object || (object.type !== 'aircraft' && object.type !== 'ground_model')) return false;
  if (!Number.isFinite(object.x) || !Number.isFinite(object.y)) return false;
  if (typeof object.icon !== 'string' || typeof object.icon_bg !== 'string') return false;
  const icon = object.icon.trim().toLowerCase();
  if (!icon || icon === 'none' || icon === 'player') return false;
  return object.icon_bg.trim().toLowerCase() === `${icon}target`;
}
