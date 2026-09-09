import type { CombatActivity, CombatParticipant } from './lib/combat-activity';
import { matchingParticipants } from './lib/activity-search';
import AircraftNames from './aircraft-name';
import { GameLabel } from './game-icon';
import type { GameIconName } from './game-icon';

const damageLabels = {
  critical_damage: 'Critical', severe_damage: 'Severe', shot_down: 'Shot down', destroyed: 'Destroyed', crashed: 'Crashed',
};
const damageIcons: Record<keyof typeof damageLabels, GameIconName> = {
  critical_damage: 'target', severe_damage: 'target', shot_down: 'airKills', destroyed: 'kills', crashed: 'deaths',
};

export default function EnemyParticipants({ participants = [], status, search, selectedName }: {
  participants: CombatParticipant[]; status: CombatActivity['status']; search: string; selectedName: string | null;
}) {
  const enemies = participants.filter(p => p.team === 'enemy');
  const rows = selectedName === null ? matchingParticipants(enemies, search) : enemies.filter(p => p.name === selectedName);
  const empty = status === 'waiting' ? 'Waiting for a battle' : search || selectedName ? 'No matching enemies'
    : status === 'offline' && !enemies.length ? 'Enemy activity unavailable' : 'No enemies identified yet';
  return <section className="enemy-participants" aria-label="Known enemy participants">
    <header><span>{status === 'live' ? 'Known enemies' : status === 'paused' || status === 'offline' ? 'Last flight enemies' : 'Known enemies'}</span><span>{rows.length}</span></header>
    <div className="enemy-table-wrap" role="region" aria-label="Enemy aircraft and last reported damage" tabIndex={0}>
      <table className="enemy-table">
        <caption className="activity-sr-only">Observed enemies, one row per exact nickname. Aircraft is the latest observed type. Damage is the last reported damage received, not current health. Unreported damage is unknown.</caption>
        <thead><tr><th scope="col">Nickname</th><th scope="col"><GameLabel icon="spawns">Aircraft</GameLabel></th><th scope="col"><GameLabel icon="target">Last damage</GameLabel></th></tr></thead>
        <tbody>{rows.length === 0 && <tr><td colSpan={3} className="enemy-empty">{empty}</td></tr>}
          {rows.map(p => <tr key={p.name}>
            <th scope="row" className="combat-enemy">{p.name}</th>
            <td title="Latest observed aircraft"><AircraftNames vehicles={[p.vehicle]} /></td>
            <td><Damage participant={p} /></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

function Damage({ participant }: { participant: CombatParticipant }) {
  const damage = participant.lastDamage;
  if (!damage) return <span className="enemy-damage unknown">Unknown</span>;
  return <span className={`enemy-damage ${damage.action}`}>
    <GameLabel icon={damageIcons[damage.action]}>{damageLabels[damage.action]}</GameLabel>
    <time dateTime={new Date(damage.observedAt).toISOString()} title="Damage observed at">{new Date(damage.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time>
  </span>;
}
