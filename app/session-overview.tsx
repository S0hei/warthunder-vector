'use client';
import { useTranslation } from './language-provider';

import { useMemo } from 'react';
import { aiCount, battleKey, killCount, summarizeFileBattles } from './lib/file-battles';
import { sessionBattles } from './lib/session-overview';
import type { FileArchive } from './use-file-archive';
import AircraftNames from './aircraft-name';
import RewardLabel from './reward-label';
import BattleStatLabel from './battle-stat-label';
import { GameLabel } from './game-icon';
import { mapName } from './lib/map-names';
import { battleOutcomeText } from './lib/ui-text';

export default function SessionOverview({ archive, account, accounts, onAccountChange, onHistory, telemetryOnline }: {
  archive: FileArchive; account: string | undefined; accounts: [string, string][];
  onAccountChange: (id: string) => void; onHistory: () => void; telemetryOnline: boolean;
}) {
  const { t, locale, number, countLabel, notAvailable } = useTranslation();
  const battles = useMemo(() => sessionBattles(archive.battles, account, archive.startedAt), [archive.battles, account, archive.startedAt]);
  const totals = useMemo(() => summarizeFileBattles(battles), [battles]);
  const started = archive.startedAt ? new Date(archive.startedAt) : null;
  const unavailable = archive.connection !== 'connected';
  const status = archive.connection === 'connecting' ? 'Loading session results' : unavailable ? 'Results offline'
    : archive.paused ? 'Updates paused' : archive.status === 'game-not-found' ? 'Game folder not found'
      : archive.status === 'read-error' ? 'Some game files could not be read'
        : archive.status === 'indexing' ? 'Loading battle history' : null;
  const display = (n: number, digits = 0) => number(archive.startedAt === null ? null : n, digits);
  return <section className="session-overview" aria-labelledby="session-title">
    <header className="session-header">
      <div><p className="eyebrow">{t("Vector / Session")}</p><h1 id="session-title">{t("Session overview")}</h1>
        <p className="session-since">{started ? <>{t('Session started')}{' '}<time dateTime={started.toISOString()}>{started.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time></> : t("This session")}</p>
      </div>
      <span className={`session-presence ${telemetryOnline ? '' : 'offline'}`}><i />{telemetryOnline ? t("Between battles") : t("Game disconnected")}</span>
    </header>

    <div className="session-identity">
      {accounts.length > 1 ? <select aria-label={t("Session game account")} value={account} onChange={e => onAccountChange(e.target.value)}>{accounts.map(([id, player]) => <option key={id} value={id}>{player}</option>)}</select>
        : <span>{accounts[0]?.[1] ?? t("Session results")}</span>}
      <span>{countLabel(archive.startedAt === null ? null : totals.count, 'battle')}</span>
    </div>
    {status && <p className="session-status" role="status">{t(status)}{archive.connection === 'standalone' ? t(". Open Vector.exe to load your results.") : ''}</p>}
    {archive.unreadable + archive.rejected > 0 && <p className="session-status error" role="alert">{t("Could not load")}{' '}{countLabel(archive.unreadable + archive.rejected, 'saved record')}.</p>}

    <dl className="session-metrics">
      <div className="session-win"><dt><GameLabel icon="victories">{t("Win rate")}</GameLabel></dt><dd>{totals.winRate === null ? notAvailable : `${number(totals.winRate, 1)}%`}</dd>
        <div className="session-outcomes"><span className="positive">{t('{count} won', { count: display(totals.wins) })}</span><span className="negative">{t('{count} lost', { count: display(totals.losses) })}</span><span>{t('{count} without a result', { count: display(totals.unresolved) })}</span></div>
        {totals.count > 0 && <div className="session-outcome-bar" aria-hidden="true"><i className="win" style={{ flexGrow: totals.wins }} /><i className="loss" style={{ flexGrow: totals.losses }} /><i className="unknown" style={{ flexGrow: totals.unresolved }} /></div>}
      </div>
      <div><dt><BattleStatLabel kind="killDeath" /></dt><dd>{totals.kills > 0 && totals.deaths === 0 ? '∞' : number(totals.kd, 2)}</dd>
        <p>{countLabel(archive.startedAt === null ? null : totals.kills, 'kill')} <span>/</span> {countLabel(archive.startedAt === null ? null : totals.deaths, 'death')}</p><small>{t('Stats from {known}/{total} battles', { known: totals.scoreCount, total: totals.count })}</small></div>
      <div><dt><BattleStatLabel kind="killSpawn" /></dt><dd>{number(totals.ks, 2)}</dd>
        <p>{countLabel(archive.startedAt === null ? null : totals.spawnKills, 'kill')} <span>/</span> {countLabel(archive.startedAt === null ? null : totals.spawns, 'spawn')}</p><small>{t('Stats from {known}/{total} battles', { known: totals.spawnCount, total: totals.count })}</small></div>
    </dl>

    <dl className="session-rewards">
      <div><dt><RewardLabel kind="wp" /></dt><dd>{number(totals.wp)}</dd><small>{t('{known}/{total} battles confirmed', { known: totals.wpCount, total: totals.resolved })}</small></div>
      <div><dt><RewardLabel kind="exp" /></dt><dd>{number(totals.exp)}</dd><small>{t('{known}/{total} battles confirmed', { known: totals.expCount, total: totals.resolved })}</small></div>
      <div><dt><GameLabel icon="kills">{t("AI kills")}</GameLabel></dt><dd>{totals.scoreCount ? number(totals.ai) : notAvailable}</dd><small>{t("Not included in kill ratios")}</small></div>
    </dl>

    <section className="session-recent" aria-labelledby="session-recent-title">
      <header><h2 id="session-recent-title"><GameLabel icon="results">{t("Recent battles")}</GameLabel></h2><button type="button" onClick={onHistory}>{t("Battle history")}{' '}<span aria-hidden="true">↗</span></button></header>
      {battles.length === 0 ? <div className="session-empty"><strong>{archive.connection === 'connecting' ? t("Loading session results") : unavailable ? t("Session results unavailable") : archive.status === 'indexing' ? t("Loading battle history") : t("No battles saved this session")}</strong>
        {unavailable && archive.connection !== 'connecting' && <p>{t("Open or restart Vector.exe to load your results.")}</p>}</div>
        : <div className="session-table-wrap" role="region" aria-label={t("Recent session battles")} tabIndex={0}>
          <table className="session-table"><caption className="activity-sr-only">{t("The six most recent battles since Vector started. Only confirmed results count toward win rate and reward totals.")}</caption>
            <thead><tr><th scope="col">{t("Battle")}</th><th scope="col">{t("Result")}</th><th scope="col"><BattleStatLabel kind="kills" /></th><th scope="col"><BattleStatLabel kind="deaths" /></th><th scope="col"><BattleStatLabel kind="spawns" /></th><th scope="col"><RewardLabel kind="wp" short /></th><th scope="col"><RewardLabel kind="exp" /></th></tr></thead>
            <tbody>{battles.slice(0, 6).map(b => <tr key={battleKey(b)}>
              <th scope="row"><strong>{b.vehicles.length ? <AircraftNames vehicles={b.vehicles} /> : mapName(b.mission, t('Battle'))}</strong><span><time dateTime={b.playedAt}>{new Date(b.playedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}</time> · {mapName(b.mission, t('Map unavailable'))}</span></th>
              <td><span className={`session-result ${b.outcome}`}>{t(battleOutcomeText(b))}</span></td>
              <td>{number(killCount(b))}{aiCount(b) !== null && <small>+{number(aiCount(b))}{' '}{t("AI")}</small>}</td><td>{number(b.deaths)}</td><td>{number(b.spawns)}</td>
              <td className={b.rewardsFinal ? '' : 'file-provisional'}>{number(b.wp)}{!b.rewardsFinal && b.wp !== null && <small>{t("Not final")}</small>}</td>
              <td className={b.rewardsFinal ? '' : 'file-provisional'}>{number(b.exp)}{!b.rewardsFinal && b.exp !== null && <small>{t("Not final")}</small>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
  </section>;
}
