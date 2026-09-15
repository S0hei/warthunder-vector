import { useTranslation } from './language-provider';
import { battleClock, BATTLE_STATUS_FRESH_MS } from './lib/live-battle';
import type { LiveBattleStatus } from './lib/live-battle';

export default function BattleStatusStrip({ battle, connected, now }: { battle?: LiveBattleStatus | null; connected: boolean; now: number }) {
  const { t, number, notAvailable } = useTranslation();
  const current = connected && battle && now - battle.scannedAt <= BATTLE_STATUS_FRESH_MS ? battle : null;
  return <section className="battle-status-strip" aria-label={t('Battle status')}>
    <div className="battle-allies"><span>{t('Known allies alive')}</span><strong>{number(current?.alliesAlive ?? null)}</strong></div>
    <div className="battle-clock" title={t('Elapsed battle time, synchronized from game events')}><span>{t('Battle time')}</span><strong>{battleClock(current?.clockStartedAt ?? null, now) ?? notAvailable}</strong></div>
    <div className="battle-enemies"><span>{t('Known enemies alive')}</span><strong>{number(current?.enemiesAlive ?? null)}</strong></div>
  </section>;
}
