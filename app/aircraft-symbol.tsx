import { AIRCRAFT_MARKS, aircraftViewBox } from './lib/aircraft-roles';
import type { AircraftRole } from './lib/aircraft-roles';

// One directional symbol shared by live contacts, retained tracks and the legend.
// Tail bars encode the role without changing the contact's allegiance color.
export default function AircraftSymbol({ role, heading = 0 }: { role: AircraftRole; heading?: number }) {
  const mark = AIRCRAFT_MARKS[role];
  return <svg
    className="aircraft-symbol"
    data-air-role={role}
    viewBox={aircraftViewBox(role)}
    aria-hidden="true"
    focusable="false"
    style={{ transform: `rotate(${Number.isFinite(heading) ? heading : 0}deg)` }}
  >
    <polygon points="7,1 11.5,14 2.5,14" fill={mark.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    {mark.tailBars.map((y) => <path key={y} d={`M2 ${y}H12`} fill="none" stroke="currentColor" strokeWidth="1.75" />)}
  </svg>;
}
