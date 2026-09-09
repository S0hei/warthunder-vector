import { GameLabel } from './game-icon';
import { useTranslation } from './language-provider';

const labels = {
  kills: { full: 'Kills', compact: 'Kills (compact)' },
  deaths: { full: 'Deaths', compact: 'Deaths (compact)' },
  spawns: { full: 'Spawns', compact: 'Spawns (compact)' },
  killDeath: { full: 'Kills / deaths', compact: 'Kills / deaths (compact)' },
  killSpawn: { full: 'Kills / spawns', compact: 'Kills / spawns (compact)' },
} as const;

// Compact only the constrained stat headings, not full labels elsewhere in the UI.
export default function BattleStatLabel({ kind }: { kind: keyof typeof labels }) {
  const { language, t } = useTranslation();
  const full = t(labels[kind].full), visible = language === 'ru' ? t(labels[kind].compact) : full;
  return <GameLabel icon={kind} title={full} className="battle-stat-label">
    {visible === full ? full : <><span aria-hidden="true">{visible}</span><span className="activity-sr-only">{full}</span></>}
  </GameLabel>;
}
