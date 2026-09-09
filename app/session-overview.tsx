'use client';

import { useMemo } from 'react';
import { aiCount, battleKey, killCount, summarizeFileBattles } from './lib/file-battles';
import { sessionBattles } from './lib/session-overview';
import type { FileArchive } from './use-file-archive';
import AircraftNames from './aircraft-name';
import RewardLabel from './reward-label';
import { GameLabel } from './game-icon';
import { mapName } from './lib/map-names';
import { formatNumber as number, notAvailable, countLabel, battleOutcomeText } from './lib/ui-text';

export default function SessionOverview({ archive, account, accounts, onAccountChange, onHistory, telemetryOnline }: {
  archive: FileArchive; account: string | undefined; accounts: [string, string][];
  onAccountChange: (id: string) => void; onHistory: () => void; telemetryOnline: boolean;
}) {
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
      <div><p className="eyebrow">Vector / Session</p><h1 id="session-title">Session overview</h1>
        <p className="session-since">{started ? <>Session started <time dateTime={started.toISOString()}>{started.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time></> : 'This session'}</p>
      </div>
      <span className={`session-presence ${telemetryOnline ? '' : 'offline'}`}><i />{telemetryOnline ? 'Between battles' : 'Game disconnected'}</span>
    </header>

    <div className="session-identity">
      {accounts.length > 1 ? <select aria-label="Session game account" value={account} onChange={e => onAccountChange(e.target.value)}>{accounts.map(([id, player]) => <option key={id} value={id}>{player}</option>)}</select>
        : <span>{accounts[0]?.[1] ?? 'Session results'}</span>}
      <span>{countLabel(archive.startedAt === null ? null : totals.count, 'battle')}</span>
    </div>
    {status && <p className="session-status" role="status">{status}{archive.connection === 'standalone' ? '. Open Vector.exe to load your results.' : ''}</p>}
    {archive.unreadable + archive.rejected > 0 && <p className="session-status error" role="alert">Could not load {countLabel(archive.unreadable + archive.rejected, 'saved record')}.</p>}

    <dl className="session-metrics">
      <div className="session-win"><dt><GameLabel icon="victories">Win rate</GameLabel></dt><dd>{totals.winRate === null ? notAvailable : `${number(totals.winRate, 1)}%`}</dd>
        <div className="session-outcomes"><span className="positive">{display(totals.wins)} won</span><span className="negative">{display(totals.losses)} lost</span><span>{display(totals.unresolved)} without a result</span></div>
        {totals.count > 0 && <div className="session-outcome-bar" aria-hidden="true"><i className="win" style={{ flexGrow: totals.wins }} /><i className="loss" style={{ flexGrow: totals.losses }} /><i className="unknown" style={{ flexGrow: totals.unresolved }} /></div>}
      </div>
      <div><dt><GameLabel icon="killDeath">Kills / deaths</GameLabel></dt><dd>{totals.kills > 0 && totals.deaths === 0 ? '∞' : number(totals.kd, 2)}</dd>
        <p>{countLabel(archive.startedAt === null ? null : totals.kills, 'kill')} <span>/</span> {countLabel(archive.startedAt === null ? null : totals.deaths, 'death')}</p><small>Stats from {totals.scoreCount}/{totals.count} battles</small></div>
      <div><dt><GameLabel icon="killSpawn">Kills / spawns</GameLabel></dt><dd>{number(totals.ks, 2)}</dd>
        <p>{countLabel(archive.startedAt === null ? null : totals.spawnKills, 'kill')} <span>/</span> {countLabel(archive.startedAt === null ? null : totals.spawns, 'spawn')}</p><small>Airfield repairs included · {totals.spawnCount}/{totals.count} battles</small></div>
    </dl>

    <dl className="session-rewards">
      <div><dt><RewardLabel kind="wp" /></dt><dd>{number(totals.wp)}</dd><small>{totals.wpCount}/{totals.resolved} battles confirmed</small></div>
      <div><dt><RewardLabel kind="exp" /></dt><dd>{number(totals.exp)}</dd><small>{totals.expCount}/{totals.resolved} battles confirmed</small></div>
      <div><dt><GameLabel icon="kills">AI kills</GameLabel></dt><dd>{totals.scoreCount ? number(totals.ai) : notAvailable}</dd><small>Not included in kill ratios</small></div>
    </dl>

    <section className="session-recent" aria-labelledby="session-recent-title">
      <header><h2 id="session-recent-title"><GameLabel icon="results">Recent battles</GameLabel></h2><button type="button" onClick={onHistory}>Battle history <span aria-hidden="true">↗</span></button></header>
      {battles.length === 0 ? <div className="session-empty"><strong>{archive.connection === 'connecting' ? 'Loading session results' : unavailable ? 'Session results unavailable' : archive.status === 'indexing' ? 'Loading battle history' : 'No battles saved this session'}</strong>
        {unavailable && archive.connection !== 'connecting' && <p>Open or restart Vector.exe to load your results.</p>}</div>
        : <div className="session-table-wrap" role="region" aria-label="Recent session battles" tabIndex={0}>
          <table className="session-table"><caption className="activity-sr-only">The six most recent battles since Vector started. Only confirmed results count toward win rate and reward totals.</caption>
            <thead><tr><th scope="col">Battle</th><th scope="col">Result</th><th scope="col"><GameLabel icon="kills">Kills</GameLabel></th><th scope="col"><GameLabel icon="deaths">Deaths</GameLabel></th><th scope="col"><GameLabel icon="spawns">Spawns</GameLabel></th><th scope="col"><RewardLabel kind="wp" short /></th><th scope="col"><RewardLabel kind="exp" /></th></tr></thead>
            <tbody>{battles.slice(0, 6).map(b => <tr key={battleKey(b)}>
              <th scope="row"><strong>{b.vehicles.length ? <AircraftNames vehicles={b.vehicles} /> : mapName(b.mission, 'Battle')}</strong><span><time dateTime={b.playedAt}>{new Date(b.playedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time> · {mapName(b.mission)}</span></th>
              <td><span className={`session-result ${b.outcome}`}>{battleOutcomeText(b)}</span></td>
              <td>{number(killCount(b))}{aiCount(b) !== null && <small>+{number(aiCount(b))} AI</small>}</td><td>{number(b.deaths)}</td><td>{number(b.spawns)}</td>
              <td className={b.rewardsFinal ? '' : 'file-provisional'}>{number(b.wp)}{!b.rewardsFinal && b.wp !== null && <small>Not final</small>}</td>
              <td className={b.rewardsFinal ? '' : 'file-provisional'}>{number(b.exp)}{!b.rewardsFinal && b.exp !== null && <small>Not final</small>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
  </section>;
}
