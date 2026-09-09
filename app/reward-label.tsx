import { useTranslation } from './language-provider';
import { GameLabel } from './game-icon';

const labels = {
  wp: { name: 'Battle earnings', short: 'Earnings', detail: 'The game’s recorded reward (WP). This may differ from your net Silver Lions after costs.' },
  exp: { name: 'Experience', short: 'Experience', detail: 'The game’s recorded experience (EXP). This may differ from vehicle research points.' },
} as const;

export default function RewardLabel({ kind, short = false }: { kind: keyof typeof labels; short?: boolean }) {
  const { t } = useTranslation();
  return <GameLabel icon={kind === 'wp' ? 'silverLions' : 'experience'} title={t(labels[kind].detail)}>{t(short ? labels[kind].short : labels[kind].name)}</GameLabel>;
}
