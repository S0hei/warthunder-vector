'use client';

import { useEffect, useMemo, useState } from 'react';
import { CombatActivityTracker, emptyCombatActivity } from './lib/combat-activity';
import type { CombatAction, CombatActivity, CombatParty } from './lib/combat-activity';
import { vectorEndpoint } from './lib/vector-bridge';
import { countLabel } from './lib/ui-text';
import { activityEventMatches } from './lib/activity-search';
import ActivityPlayerPicker from './activity-player-picker';
import EnemyParticipants from './enemy-participants';
import { GameLabel } from './game-icon';
import type { GameIconName } from './game-icon';

type ReadTelemetry = (path: string) => Promise<unknown>;

export function useCombatActivity(readTelemetry: ReadTelemetry) {
  const [activity, setActivity] = useState<CombatActivity>(emptyCombatActivity);

  useEffect(() => {
    const tracker = new CombatActivityTracker();
    const endpoint = vectorEndpoint('activity-teams');
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        // Bracket the HUD read so a map change in flight cannot mix sorties.
        const before = await readTelemetry('/map_info.json');
        if (stopped) return;
        const hud = await readTelemetry('/hudmsg?lastEvt=0&lastDmg=0');
        if (stopped) return;
        const after = await readTelemetry('/map_info.json');
        if (stopped) return;
        setActivity(tracker.ingest({ before, hud, after }, Date.now()));
        if (endpoint) {
          try {
            const response = await fetch(endpoint.url, { headers: endpoint.headers, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(1500) });
            if (response.ok) { const teams = await response.json(); if (!stopped) setActivity(tracker.annotate(teams)); }
          } catch { /* Optional annotations must never interrupt the live HUD feed. */ }
        }
      } catch {
        if (!stopped) setActivity(tracker.disconnected());
      } finally {
        if (!stopped) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [readTelemetry]);

  return activity;
}

const actionLabels: Record<CombatAction, string> = {
  destroyed: 'Destroyed', shot_down: 'Shot down', critical_damage: 'Critical damage',
  severe_damage: 'Severe damage', crashed: 'Crashed',
};
const actionIcons: Record<CombatAction, GameIconName> = {
  destroyed: 'kills', shot_down: 'airKills', critical_damage: 'target', severe_damage: 'target', crashed: 'deaths',
};

function eventTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}

export default function CombatActivityPanel({ activity }: { activity: CombatActivity }) {
  return <ActivityFlightPanel key={activity.startedAt ?? 'waiting'} activity={activity} />;
}

function ActivityFlightPanel({ activity }: { activity: CombatActivity }) {
  const [search, setSearch] = useState(''), [selectedName, setSelectedName] = useState<string | null>(null);
  const [view, setView] = useState<'events' | 'participants'>('events');
  const query = search.trim().toLocaleLowerCase();
  const enemies = useMemo(() => (activity.participants ?? []).filter(p => p.team === 'enemy'), [activity.participants]);
  const events = useMemo(() => [...activity.recent].reverse().filter((event) => (
    activityEventMatches(event, query, selectedName)
  )), [activity.recent, query, selectedName]);
  const status = {
    live: 'Live', paused: 'Last battle', waiting: 'Waiting for battle', offline: 'Game disconnected',
  }[activity.status];
  const started = activity.startedAt == null ? null : new Date(activity.startedAt);
  const empty = query ? 'No matching participants' : activity.status === 'offline'
    ? 'Combat activity unavailable' : activity.status === 'waiting'
      ? 'Waiting for a battle' : 'No combat events yet';

  return (
    <section className="combat-activity" aria-label="Combat activity">
      <header className="activity-heading">
        <span className={`activity-status ${activity.status}`}><i />{status}</span>
        <span>{countLabel(activity.eventCount, 'event')}</span>
      </header>
      <div className="activity-scope">
        <span>{started ? <>Since <time dateTime={started.toISOString()}>{started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time></> : 'Combat activity'}</span>
        {view === 'events' && <span className="activity-team-key"><i className="combat-ally" />Allies <i className="combat-enemy" />Enemies</span>}
      </div>
      <div className="activity-view" role="group" aria-label="Activity view">
        <button type="button" aria-pressed={view === 'events'} onClick={() => setView('events')}><GameLabel icon="activity">Events</GameLabel></button>
        <button type="button" aria-pressed={view === 'participants'} onClick={() => {
          if (selectedName && !enemies.some(p => p.name === selectedName)) { setSearch(''); setSelectedName(null); }
          setView('participants');
        }}><GameLabel icon="participants">Participants</GameLabel></button>
      </div>
      <ActivityPlayerPicker participants={view === 'participants' ? enemies : activity.participants} status={activity.status} search={search} selectedName={selectedName} compact={view === 'participants'}
        onChange={(query, name) => { setSearch(query); setSelectedName(name); }} />
      {view === 'events' ? <div className="activity-feed" role="region" aria-label="Recent combat events" tabIndex={0}>
        {events.length === 0 && <p className="activity-empty-message">{query ? 'No matching events' : empty}</p>}
        <ol>{events.map(event => <li key={event.key} className={`combat-event ${event.action}`}>
          <header><span className="combat-action"><GameLabel icon={actionIcons[event.action]}>{actionLabels[event.action]}</GameLabel></span>
            {event.explicitlyAi && <span className="combat-ai-label">AI target</span>}
            <time aria-label={`${countLabel(Math.floor(event.time), 'second')} into the battle`}>{eventTime(event.time)}</time>
          </header>
          <div className="combat-parties"><Party party={event.actor} />
            {event.target && <><span className="combat-arrow" aria-label="target">→</span><Party party={event.target} /></>}
          </div>
        </li>)}</ol>
      </div> : <EnemyParticipants participants={enemies} status={activity.status} search={search} selectedName={selectedName} />}
    </section>
  );
}

function Party({ party }: { party: CombatParty }) {
  const team = { ally: 'Ally', enemy: 'Enemy', self: 'You', unknown: 'Team unknown' }[party.team];
  return <span className={`combat-party combat-${party.team}`} title={team}>
    <span className="activity-sr-only">{team}: </span>
    {party.name && <b>{party.name}</b>}
    <span className={party.name ? 'combat-vehicle' : 'combat-unit'}>{party.vehicle}</span>
  </span>;
}
