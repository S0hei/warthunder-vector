import { useTranslation } from './language-provider';
import { battleClock, BATTLE_STATUS_FRESH_MS } from './lib/live-battle';
import type { LiveBattleStatus } from './lib/live-battle';

export default function BattleStatusStrip({ battle, connected, now }: { battle?: LiveBattleStatus | null; connected: boolean; now: number }) {
  const { t, number, notAvailable } = useTranslation();
  const current = connected && battle && now - battle.scannedAt <= BATTLE_STATUS_FRESH_MS ? battle : null;
  const elapsed = battleClock(current?.clockStartedAt ?? null, now);
  return <section className="battle-status-strip" aria-label={t('Battle status')}>
    <div className="battle-allies" title={t('Known allies alive')}><span>{t('Allies')}</span><strong className={current?.alliesAlive == null ? 'is-unavailable' : undefined}>{number(current?.alliesAlive ?? null)}</strong></div>
    <div className="battle-clock" title={t('Elapsed battle time, synchronized from game events')}><span>{t('Battle time')}</span><strong aria-label={elapsed === null ? notAvailable : undefined} className={elapsed === null ? 'is-unavailable' : undefined}>{elapsed ?? '--:--'}</strong></div>
    <div className="battle-enemies" title={t('Known enemies alive')}><span>{t('Enemies')}</span><strong className={current?.enemiesAlive == null ? 'is-unavailable' : undefined}>{number(current?.enemiesAlive ?? null)}</strong></div>
  </section>;
}
