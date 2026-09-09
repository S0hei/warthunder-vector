'use client';
import { useTranslation } from './language-provider';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CombatParticipant, CombatActivity } from './lib/combat-activity';
import { matchingParticipants } from './lib/activity-search';
import AircraftNames from './aircraft-name';

const teamLabels = { ally: 'Ally', enemy: 'Enemy', self: 'You', unknown: 'Team unknown' };

export default function ActivityPlayerPicker({ participants = [], status, search, selectedName, onChange, compact = false }: {
  participants: CombatParticipant[]; status: CombatActivity['status']; search: string; selectedName: string | null;
  onChange: (query: string, name: string | null) => void;
  compact?: boolean;
}) {
  const { t, locale } = useTranslation();
  const [open, setOpen] = useState(false), [activeName, setActiveName] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null);
  const id = useId();
  const selected = participants.find(p => p.name === selectedName);
  const matches = useMemo(() => matchingParticipants(participants, selected ? '' : search), [participants, search, selected]);
  const active = matches.findIndex(p => p.name === activeName);
  const activeIndex = active >= 0 ? active : matches.length ? 0 : -1;
  const expanded = open && status !== 'waiting';
  useEffect(() => {
    if (expanded && activeIndex >= 0) list.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [expanded, activeIndex]);
  const choose = (participant: CombatParticipant) => {
    onChange(participant.name, participant.name); setOpen(false); setActiveName(participant.name);
  };

  return <div className="activity-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label className="activity-picker-label" htmlFor={id}>{t("Find participant")}</label>
    <div className="activity-picker-control">
    <div className="activity-picker-input">
      <input ref={input} id={id} className="activity-search" type="text" role="combobox" aria-autocomplete="list"
        aria-expanded={expanded} aria-controls={`${id}-list`} aria-activedescendant={expanded && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        placeholder={t("Name or aircraft")} value={search} autoComplete="off" spellCheck={false}
        onFocus={() => setOpen(true)} onChange={event => { onChange(event.target.value, null); setOpen(true); setActiveName(null); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            const index = !expanded ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
              : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
            setActiveName(matches[index]?.name ?? null);
          } else if (event.key === 'Enter' && expanded && activeIndex >= 0) {
            event.preventDefault(); choose(matches[activeIndex]);
          }
        }} />
      {search && <button type="button" aria-label={t("Clear participant filter")} onClick={() => { onChange('', null); setActiveName(null); input.current?.focus(); setOpen(true); }}>×</button>}
      <button type="button" aria-label={t("Browse participants")} aria-expanded={expanded} aria-controls={`${id}-list`}
        onClick={() => { input.current?.focus(); setOpen(!expanded); }}><span aria-hidden="true">⌄</span></button>
    </div>
    {expanded && <div className="activity-picker-menu">
      <div className="activity-picker-menu-heading">{status === 'live' ? t("This flight") : t("Last flight")}<span>{matches.length}</span></div>
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label={t("Observed participants")}>
        {matches.map((participant, index) => <li key={participant.name} id={`${id}-option-${index}`} role="option"
          aria-selected={index === activeIndex} className={`combat-${participant.team}`}
          onMouseDown={event => event.preventDefault()} onMouseMove={() => setActiveName(participant.name)} onClick={() => choose(participant)}>
          <div><strong>{participant.name}</strong><span>{t(teamLabels[participant.team])}</span></div>
          <AircraftNames vehicles={[participant.vehicle]} />
        </li>)}
      </ul>
      {matches.length === 0 && <p role="status">{search ? t("No matching participants") : t("No participants observed yet")}</p>}
    </div>}
    </div>
    {selected && !compact && <div className={`activity-picked combat-${selected.team}`}>
      <div><strong>{selected.name}</strong><span>{t(teamLabels[selected.team])}</span></div>
      <span className="activity-picked-label">{t("Last observed aircraft")}</span>
      <AircraftNames vehicles={[selected.vehicle]} />
      <time dateTime={new Date(selected.observedAt).toISOString()}>{new Date(selected.observedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}{status !== 'live' ? t(" · Last flight") : ''}</time>
    </div>}
  </div>;
}
