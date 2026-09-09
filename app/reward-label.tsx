import { GameLabel } from './game-icon';

const labels = {
  wp: { name: 'Battle earnings', short: 'Earnings', detail: 'The game’s recorded reward (WP). This may differ from your net Silver Lions after costs.' },
  exp: { name: 'Experience', short: 'Experience', detail: 'The game’s recorded experience (EXP). This may differ from vehicle research points.' },
} as const;

export default function RewardLabel({ kind, short = false }: { kind: keyof typeof labels; short?: boolean }) {
  return <GameLabel icon={kind === 'wp' ? 'silverLions' : 'experience'} title={labels[kind].detail}>{short ? labels[kind].short : labels[kind].name}</GameLabel>;
}
