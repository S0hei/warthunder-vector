import { resolveAircraft } from './aircraft';
import type { CombatEvent, CombatParticipant, CombatRow } from './combat-activity';

export const searchText = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

export function matchingParticipants(participants: CombatParticipant[], query: string) {
  const text = searchText(query);
  return participants.filter(p => searchText(`${p.name} ${p.vehicle} ${resolveAircraft(p.vehicle).name}`).includes(text));
}

export function activityRowMatches(row: CombatRow, query: string, selectedName: string | null) {
  return selectedName !== null ? row.name === selectedName
    : searchText(`${row.name} ${row.vehicle} ${resolveAircraft(row.vehicle).name}`).includes(searchText(query));
}

export function activityEventMatches(event: CombatEvent, query: string, selectedName: string | null) {
  return selectedName !== null ? event.actor.name === selectedName || event.target?.name === selectedName
    : searchText(`${event.message} ${resolveAircraft(event.actor.vehicle).name} ${event.target ? resolveAircraft(event.target.vehicle).name : ''}`).includes(searchText(query));
}
