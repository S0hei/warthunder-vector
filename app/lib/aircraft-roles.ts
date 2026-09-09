export type AircraftRole = 'fighter' | 'assault' | 'bomber' | 'unknown';

export const AIRCRAFT_MARKS = {
  fighter: { label: 'Fighter', filled: true, tailBars: [] },
  assault: { label: 'Assault', filled: true, tailBars: [16] },
  bomber: { label: 'Bomber', filled: true, tailBars: [16, 20] },
  unknown: { label: 'Unknown', filled: false, tailBars: [] },
} as const;

// Center each role's painted extent (including its tail bars and stroke), not
// the unused space in the common 14×22 canvas. Keep the same scale and shape.
export function aircraftViewBox(role: AircraftRole): string {
  const top = 1 - .5;
  const bottom = Math.max(14 + .5, ...AIRCRAFT_MARKS[role].tailBars.map((y) => y + 1.75 / 2));
  const centerY = (top + bottom) / 2;
  return `0 ${centerY - 11} 14 22`;
}

// Exact role names exposed by map_obj.json. Allegiance, blinking and background
// icons do not identify aircraft roles or human/bot identity. "Player" carries no role.
export function aircraftRole(object: { type?: unknown; icon?: unknown } | null | undefined): AircraftRole {
  if (object?.type !== 'aircraft' || typeof object.icon !== 'string') return 'unknown';
  const icon = object.icon.trim().toLowerCase();
  return icon === 'fighter' || icon === 'assault' || icon === 'bomber' ? icon : 'unknown';
}

export function aircraftRoleLabel(role: AircraftRole) {
  return role === 'unknown' ? 'Aircraft (role unknown)' : `${AIRCRAFT_MARKS[role].label} aircraft`;
}
