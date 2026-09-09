'use client';

import { useEffect, useMemo, useState } from 'react';
import { aiCount, battleKey, battlesForPeriod, killCount, localBattleDay, resolveBattlePeriod, summarizeFileBattles } from './lib/file-battles';
import type { BattlePeriod, FileBattle } from './lib/file-battles';
import type { FileArchive } from './use-file-archive';
import AircraftNames from './aircraft-name';
import RewardLabel from './reward-label';
import { GameLabel } from './game-icon';
import { mapName } from './lib/map-names';
import { formatNumber as number, notAvailable, countLabel, battleOutcomeText } from './lib/ui-text';

export default function FileBattlesPanel({ archive, account, accounts, onAccountChange }: { archive: FileArchive; account: string | undefined; accounts: [string, string][]; onAccountChange: (id: string) => void }) {
  const [range, setRange] = useState<BattlePeriod>('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [pagination, setPagination] = useState({ filter: '', page: 0 });
  const [expanded, setExpanded] = useState<string | null>(null), [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => { const timer = setInterval(() => setNow(new Date().toISOString()), 30000); return () => clearInterval(timer); }, []);
  const day = localBattleDay(now);
  const period = useMemo(() => resolveBattlePeriod(range, day, custom), [range, day, custom]);
  const battles = useMemo(() => battlesForPeriod(archive.battles, account, period, archive.startedAt), [archive.battles, archive.startedAt, account, period]);
  const totals = useMemo(() => summarizeFileBattles(battles), [battles]);
  const filter = JSON.stringify([account, period, range === 'session' ? archive.startedAt : null]);
  const lastPage = Math.max(0, Math.ceil(battles.length / 20) - 1), currentPage = pagination.filter === filter ? Math.min(pagination.page, lastPage) : 0;
  const changeRange = (next: BattlePeriod) => {
    if (next === 'custom' && !custom.from && !custom.to) setCustom({ from: period.from || day, to: period.to || day });
    setRange(next); setPagination({ filter: '', page: 0 }); setExpanded(null);
  };
  const healthy = archive.connection === 'connected' && !archive.paused && ['ready', 'indexing', 'searching'].includes(archive.status);
  const label = archive.connection === 'connecting' ? 'Connecting' : archive.connection !== 'connected' ? 'Results offline'
    : archive.paused ? 'Updates paused' : archive.status === 'ready' ? 'Auto updates on' : archive.status === 'indexing' ? 'Loading battle history'
      : archive.status === 'game-not-found' ? 'Game folder not found' : archive.status === 'read-error' ? 'Some files unavailable' : 'Looking for War Thunder';
  return <section className="battle-results" aria-label="Automatic battle history">
    <header className="activity-heading"><span className={`activity-status ${healthy ? 'live' : 'offline'}`}><i />{label}</span></header>
    {archive.connection === 'standalone' && <p className="results-message">Open Vector.exe to load your battle history.</p>}
    {archive.connection === 'offline' && <p className="results-message" role="status">Open or restart Vector.exe to reconnect.</p>}
    {archive.status === 'game-not-found' && <p className="results-message" role="status">Choose the War Thunder folder from Vector’s tray menu.</p>}
    {archive.status === 'read-error' && <p className="results-message error" role="status">Some game files could not be read or saved. Check folder access and free disk space. Unsupported replays are skipped.</p>}
    {(archive.rejected + archive.unreadable) > 0 && <p className="results-message error" role="alert">Could not load {countLabel(archive.rejected + archive.unreadable, 'saved record')}.</p>}
    <div className="results-toolbar">
      <select aria-label="Battle period" value={range} onChange={e => changeRange(e.target.value as BattlePeriod)}>
        <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="day-before-yesterday">Day before yesterday</option>
        <option value="week" title="Monday to today">This week</option><option value="custom">Custom period</option>
        <option value="session">This session</option><option value="all">All saved battles</option>
      </select>
      {accounts.length > 1 && <select aria-label="Game account" value={account} onChange={e => { onAccountChange(e.target.value); setPagination({ filter: '', page: 0 }); setExpanded(null); }}>{accounts.map(([id, player]) => <option key={id} value={id}>{player}</option>)}</select>}
      <span aria-live="polite" aria-atomic="true">{countLabel(totals.count, 'battle')}</span>
    </div>
    {range === 'custom' && <fieldset className="results-date-range">
      <legend className="activity-sr-only">Custom battle period, including both dates</legend>
      <label>From<input type="date" aria-label="Start date" value={custom.from} max={day} required
        aria-invalid={!!period.error} aria-describedby={period.error ? 'results-date-error' : undefined}
        onChange={e => { setCustom({ ...custom, from: e.target.value }); setPagination({ filter: '', page: 0 }); setExpanded(null); }} /></label>
      <label>To<input type="date" aria-label="End date" value={custom.to} min={custom.from || undefined} max={day} required
        aria-invalid={!!period.error} aria-describedby={period.error ? 'results-date-error' : undefined}
        onChange={e => { setCustom({ ...custom, to: e.target.value }); setPagination({ filter: '', page: 0 }); setExpanded(null); }} /></label>
      {period.error && <p id="results-date-error" className="results-message error" role="alert">{period.error}</p>}
    </fieldset>}
    <div className="results-win-summary">
      <div><GameLabel icon="victories">Win rate</GameLabel><strong>{totals.winRate === null ? notAvailable : `${number(totals.winRate, 1)}%`}</strong></div>
      <p><span className="positive">{totals.wins} won</span><span className="negative">{totals.losses} lost</span><span>{totals.unresolved} without a result</span></p>
    </div>
    <dl className="results-totals results-ratios">
      <div><dt><GameLabel icon="killDeath">Kills / deaths</GameLabel></dt><dd>{totals.deaths === 0 && totals.kills > 0 ? '∞' : number(totals.kd, 2)}</dd><small>{countLabel(totals.kills, 'kill')} · {countLabel(totals.deaths, 'death')}</small><small>Stats from {totals.scoreCount}/{totals.count} battles</small></div>
      <div><dt><GameLabel icon="killSpawn">Kills / spawns</GameLabel></dt><dd>{number(totals.ks, 2)}</dd><small>{countLabel(totals.spawnKills, 'kill')} · {countLabel(totals.spawns, 'spawn')}</small><small>Airfield repairs included · {totals.spawnCount}/{totals.count} battles</small></div>
    </dl>
    <dl className="results-rewards">
      <div><dt><RewardLabel kind="wp" /></dt><dd>{number(totals.wp)}</dd><small>{countLabel(totals.wpCount, 'battle')} confirmed</small></div>
      <div><dt><RewardLabel kind="exp" /></dt><dd>{number(totals.exp)}</dd><small>{countLabel(totals.expCount, 'battle')} confirmed</small></div>
    </dl>
    <div className="results-table-wrap" role="region" tabIndex={0} aria-label="Saved battle history">
      <table className="results-table"><caption className="activity-sr-only">Saved battles, newest first. Only confirmed results count toward win rate and reward totals. AI kills are counted separately.</caption>
        <thead><tr><th scope="col">Battle</th><th scope="col"><GameLabel icon="kills">Kills</GameLabel></th><th scope="col"><GameLabel icon="deaths">Deaths</GameLabel></th><th scope="col"><GameLabel icon="spawns">Spawns</GameLabel></th></tr></thead>
        <tbody>{battles.length === 0 && <tr><td colSpan={4} className="results-empty">{period.error ? 'Choose a valid period' : archive.status === 'indexing' ? 'Loading battle history' : 'No battles in this period'}</td></tr>}
          {battles.slice(currentPage * 20, currentPage * 20 + 20).map(b => <FileBattleRow key={battleKey(b)} battle={b} expanded={expanded === battleKey(b)} toggle={() => setExpanded(expanded === battleKey(b) ? null : battleKey(b))} />)}
        </tbody>
      </table>
    </div>
    {lastPage > 0 && <nav className="results-pagination" aria-label="Battle pages"><button type="button" disabled={!currentPage} onClick={() => setPagination({ filter, page: currentPage - 1 })}>Newer</button><span>{currentPage + 1} / {lastPage + 1}</span><button type="button" disabled={currentPage === lastPage} onClick={() => setPagination({ filter, page: currentPage + 1 })}>Older</button></nav>}
  </section>;
}
function FileBattleRow({ battle: b, expanded, toggle }: { battle: FileBattle; expanded: boolean; toggle: () => void }) {
  const provisional = b.outcome === 'unknown';
  const provisionalRewards = !b.rewardsFinal && (b.wp !== null || b.exp !== null);
  return <><tr>
    <th scope="row"><button type="button" className="result-match" aria-expanded={expanded} aria-controls={`battle-${battleKey(b)}`} onClick={toggle}>
      <span className={`result-outcome ${b.outcome}`}>{battleOutcomeText(b)} <time dateTime={b.playedAt}>{new Date(b.playedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time></span>
      <strong>{b.vehicles.length ? <AircraftNames vehicles={b.vehicles} /> : mapName(b.mission, 'Battle')}</strong>
    </button></th>
    <td>{number(killCount(b))}{aiCount(b) !== null && <small className="file-battle-ai">+{number(aiCount(b))} AI</small>}</td>
    <td>{number(b.deaths)}</td>
    <td>{number(b.spawns)}</td>
  </tr><tr id={`battle-${battleKey(b)}`} hidden={!expanded}><td colSpan={4}><div className="report-details">
    {(provisional || provisionalRewards) && <p className="results-message">{provisional ? 'No confirmed result for this battle. ' : ''}{provisionalRewards ? 'These rewards were recorded when you left. They are not final and do not count toward totals.' : ''}</p>}
    <dl><div><dt>Map</dt><dd>{mapName(b.mission)}</dd></div>
      <div><dt><GameLabel icon="killDeath">Kills / deaths</GameLabel></dt><dd>{killCount(b) === null || b.deaths === null ? notAvailable : b.deaths ? number(killCount(b)! / b.deaths, 2) : killCount(b)! > 0 ? '∞' : notAvailable}</dd></div>
      <div><dt><GameLabel icon="killSpawn">Kills / spawns</GameLabel></dt><dd>{killCount(b) === null || !b.spawns ? notAvailable : number(killCount(b)! / b.spawns, 2)}</dd></div>
      <div><dt><RewardLabel kind="wp" /></dt><dd className={b.rewardsFinal ? '' : 'file-provisional'}>{number(b.wp)}{provisionalRewards && b.wp !== null ? ' · not final' : ''}</dd></div>
      <div><dt><RewardLabel kind="exp" /></dt><dd className={b.rewardsFinal ? '' : 'file-provisional'}>{number(b.exp)}{provisionalRewards && b.exp !== null ? ' · not final' : ''}</dd></div>
      <div><dt>Air / ground / sea kills</dt><dd>{number(b.kills)} / {number(b.groundKills)} / {number(b.navalKills)}</dd></div>
      <div><dt>AI kills: air / ground / sea</dt><dd>{number(b.aiKills)} / {number(b.aiGroundKills)} / {number(b.aiNavalKills)}</dd></div>
      <div><dt>Assists / score</dt><dd>{number(b.assists)} / {number(b.score)}</dd></div><div><dt>Time played</dt><dd>{b.seconds === null ? notAvailable : `${Math.floor(b.seconds / 60)}:${String(Math.floor(b.seconds % 60)).padStart(2, '0')}`}</dd></div>
      <div><dt>Sources</dt><dd>{[b.hasLog ? 'Game log' : '', b.hasReplay ? 'Replay' : ''].filter(Boolean).join(' + ')}</dd></div><div><dt>Battle ID</dt><dd>{b.id}</dd></div>
    </dl>
  </div></td></tr></>;
}
