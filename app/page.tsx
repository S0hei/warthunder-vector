'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CombatActivityPanel, { useCombatActivity } from './combat-activity-panel';
import FileBattlesPanel from './file-battles-panel';
import SessionOverview from './session-overview';
import { useFileArchive } from './use-file-archive';
import { useAppUpdates } from './use-app-updates';
import { LanguageProvider, LanguageSelector, useTranslation } from './language-provider';
import { showSessionOverview } from './lib/session-overview';
import AircraftSymbol from './aircraft-symbol';
import { notAvailable } from './lib/ui-text';
import { GameIcon } from './game-icon';
import TargetReticle from './target-reticle';
import BaseSymbol from './base-symbol';
import { baseKind, baseTeam } from './lib/base-markers';
import { isGameSelectedTarget } from './lib/game-target';
import { AIRCRAFT_MARKS, aircraftRole, aircraftRoleLabel } from './lib/aircraft-roles';
import { airfieldBattleArea, fitMapArea, MIN_MAP_ZOOM, MAX_MAP_ZOOM } from './lib/map-fit';
import type { AutoFitMode } from './lib/map-fit';
import { WT_ORIGIN, readJson } from './lib/telemetry';
import type { MapObject, MapInfo } from './lib/telemetry';
import { useWarThunderFeed } from './use-war-thunder-feed';
import type { TeamMessage } from './use-war-thunder-feed';
import { battleAccounts } from './lib/file-battles';
import MapImage from './map-image';
import { ENEMY_MEMORY_MS, MAP_FRESH_MS, visibleEnemyTracks } from './lib/enemy-memory';

type Filters = {
  air: boolean;
  ground: boolean;
  objectives: boolean;
  airfields: boolean;
  spawns: boolean;
};
type Point = { x: number; y: number };
type EnemyTrack = {
  id: number;
  object: MapObject;
  firstSeen: number;
  lastSeen: number;
  active: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function titleCase(value?: string) {
  if (!value) return 'Unknown vehicle';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isEnemy(object: MapObject) {
  const color = (object.color ?? '').toLowerCase();
  return color.startsWith('#fa0') || color.startsWith('#f20') || color.startsWith('#f00') || color.startsWith('#e2');
}

function isPlayer(object: MapObject) {
  return object.icon?.toLowerCase() === 'player';
}

function isSquadmate(object: MapObject) {
  return (object.color ?? '').toLowerCase().startsWith('#39d');
}

function actorKind(object: MapObject): 'air' | 'ground' | 'objective' {
  if (object.type === 'aircraft') return 'air';
  if (object.type === 'ground_model') return 'ground';
  return 'objective';
}

function actorLabel(object: MapObject, t: (text: string) => string) {
  const kind = actorKind(object);
  if (kind === 'air') return t(isSquadmate(object) ? 'Squadron aircraft' : 'Aircraft');
  if (kind === 'ground') return t('Ground');
  return t('Objective');
}

function isSpawnPoint(object: MapObject) {
  return object.type.startsWith('respawn');
}

function groupFor(object: MapObject): keyof Filters {
  if (actorKind(object) === 'air') return 'air';
  if (actorKind(object) === 'ground') return 'ground';
  if (object.type === 'airfield') return 'airfields';
  if (isSpawnPoint(object)) return 'spawns';
  return 'objectives';
}

function objectLabel(object: MapObject, t: (text: string) => string) {
  if (isPlayer(object)) return t('Your aircraft');
  const labels: Record<string, string> = {
    aircraft: aircraftRoleLabel(aircraftRole(object)),
    ground_model: object.icon ? titleCase(object.icon) : 'Ground contact',
    airfield: 'Airfield',
    bombing_point: 'Bombing base',
    defending_point: 'Defended base',
    respawn_base_bomber: 'Bomber spawn',
    respawn_base_fighter: 'Fighter spawn',
    capture_zone: 'Capture zone',
  };
  return t(labels[object.type] ?? titleCase(object.type));
}

function markerGlyph(object: MapObject) {
  if (object.type === 'ground_model') {
    return object.icon?.toLowerCase().includes('airdefence') ? '+' : '●';
  }
  if (object.type === 'respawn_base_bomber') return 'B';
  if (object.type === 'respawn_base_fighter') return 'F';
  return '◆';
}

function headingFromObject(object?: MapObject) {
  if (!object || typeof object.dx !== 'number' || typeof object.dy !== 'number') return 0;
  return (Math.atan2(object.dx, -object.dy) * 180 / Math.PI + 360) % 360;
}

function rangeKm(a: MapObject | undefined, b: MapObject | undefined, info: MapInfo) {
  if (!a || !b || a.x == null || a.y == null || b.x == null || b.y == null) return null;
  const [width, height] = info.grid_size ?? [65536, 65536];
  return Math.hypot((a.x - b.x) * width, (a.y - b.y) * height) / 1000;
}

function bearingTo(a?: MapObject, b?: MapObject) {
  if (!a || !b || a.x == null || a.y == null || b.x == null || b.y == null) return null;
  return (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI + 360) % 360;
}

function gridSquare(object: MapObject, info: MapInfo) {
  if (object.x == null || object.y == null) return notAvailable;
  const [fallbackWidth, fallbackHeight] = info.grid_size ?? [65536, 65536];
  const width = info.map_min && info.map_max ? info.map_max[0] - info.map_min[0] : fallbackWidth;
  const height = info.map_min && info.map_max ? info.map_max[1] - info.map_min[1] : fallbackHeight;
  const [stepX, stepY] = info.grid_steps ?? [6500, 6500];
  const columns = Math.max(1, Math.ceil(width / stepX));
  const rows = Math.max(1, Math.ceil(height / stepY));
  const column = clamp(Math.floor(object.x * columns) + 1, 1, columns);
  let row = clamp(Math.floor(object.y * rows), 0, rows - 1);
  let letter = '';
  do {
    letter = String.fromCharCode(65 + row % 26) + letter;
    row = Math.floor(row / 26) - 1;
  } while (row >= 0);
  return `${letter}${column}`;
}

function cleanGameText(value: string) {
  return value
    .replace(/<color=[^>]+>/gi, '')
    .replace(/<\/color>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function gridPoint(grid: string, info: MapInfo): Point | null {
  const match = grid.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const [fallbackWidth, fallbackHeight] = info.grid_size ?? [65536, 65536];
  const width = info.map_min && info.map_max ? info.map_max[0] - info.map_min[0] : fallbackWidth;
  const height = info.map_min && info.map_max ? info.map_max[1] - info.map_min[1] : fallbackHeight;
  const [stepX, stepY] = info.grid_steps ?? [6500, 6500];
  const columns = Math.max(1, Math.ceil(width / stepX));
  const rows = Math.max(1, Math.ceil(height / stepY));
  const row = match[1].split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  const column = Number(match[2]) - 1;
  if (row < 0 || row >= rows || column < 0 || column >= columns) return null;
  return { x: (column + 0.5) / columns, y: (row + 0.5) / rows };
}

function parseTeamCue(message: TeamMessage, info: MapInfo) {
  const clean = cleanGameText(message.msg);
  const match = clean.match(/\[([A-Z]+\d+)(?:,\s*([^\]]+))?\]/i);
  if (!match) return null;
  const point = gridPoint(match[1], info);
  if (!point) return null;
  return {
    ...message,
    grid: match[1].toUpperCase(),
    detail: match[2]?.trim() ?? '',
    body: clean.replace(match[0], '').trim(),
    point,
  };
}

function teamMessageAge(message: TeamMessage, now: number) {
  const ageAtReceipt = Math.max(0, message.referenceTime - (message.time ?? message.referenceTime));
  return Math.floor(ageAtReceipt + (now - message.receivedAt) / 1000);
}

function useEnemyMemory(objects: MapObject[], generation: number, observedAt: number, now: number) {
  const [tracks, setTracks] = useState<EnemyTrack[]>([]);
  const sequenceRef = useRef(1);
  const generationRef = useRef(generation);

  useEffect(() => {
    if (generationRef.current === generation) return;
    generationRef.current = generation;
    sequenceRef.current = 1;
    setTracks([]);
  }, [generation]);

  useEffect(() => {
    const now = observedAt;
    const currentEnemies = objects.filter((object) =>
      isEnemy(object) &&
      (object.type === 'aircraft' || object.type === 'ground_model') &&
      object.x != null &&
      object.y != null
    );

    setTracks((previous) => {
      const claimed = new Set<number>();
      const activeTracks = currentEnemies.map((object) => {
        let bestIndex = -1;
        let bestDistance = Number.POSITIVE_INFINITY;

        previous.forEach((track, index) => {
          if (claimed.has(index) || track.object.type !== object.type || track.object.icon !== object.icon) return;
          if (track.object.x == null || track.object.y == null || object.x == null || object.y == null) return;
          const distance = Math.hypot(track.object.x - object.x, track.object.y - object.y);
          const matchRadius = object.type === 'aircraft' ? 0.035 : 0.018;
          if (distance < matchRadius && distance < bestDistance) {
            bestIndex = index;
            bestDistance = distance;
          }
        });

        if (bestIndex >= 0) {
          claimed.add(bestIndex);
          const match = previous[bestIndex];
          return { ...match, object, lastSeen: now, active: true };
        }

        return {
          id: sequenceRef.current++,
          object,
          firstSeen: now,
          lastSeen: now,
          active: true,
        };
      });

      const rememberedTracks = previous
        .filter((track, index) => !claimed.has(index) && now - track.lastSeen <= ENEMY_MEMORY_MS)
        .map((track) => ({ ...track, active: false }));

      return [...activeTracks, ...rememberedTracks];
    });
  }, [objects, observedAt]);

  const clearMemory = useCallback(() => {
    setTracks((current) => visibleEnemyTracks(current, observedAt, now).filter((track) => track.active));
  }, [observedAt, now]);

  return { tracks: visibleEnemyTracks(tracks, observedAt, now), clearMemory };
}

function TrailCanvas({ trail }: { trail: Point[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, 1000, 1000);
    if (trail.length < 2) return;

    const gradient = context.createLinearGradient(0, 0, 1000, 1000);
    gradient.addColorStop(0, 'rgba(184, 239, 70, 0)');
    gradient.addColorStop(1, 'rgba(184, 239, 70, .72)');
    context.beginPath();
    trail.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x * 1000, point.y * 1000);
      else context.lineTo(point.x * 1000, point.y * 1000);
    });
    context.strokeStyle = gradient;
    context.lineWidth = 1.25;
    context.setLineDash([5, 7]);
    context.stroke();
  }, [trail]);

  return <canvas ref={canvasRef} className="trail-canvas" width="1000" height="1000" aria-hidden="true" />;
}

function Runway({ object }: { object: MapObject }) {
  const { t } = useTranslation();
  if (object.sx == null || object.sy == null || object.ex == null || object.ey == null) return null;
  const length = Math.hypot(object.ex - object.sx, object.ey - object.sy) * 100;
  const angle = Math.atan2(object.ey - object.sy, object.ex - object.sx) * 180 / Math.PI;
  const team = baseTeam(object);
  return (
    <span
      className={`runway ${team}`}
      style={{
        left: `${((object.sx + object.ex) / 2) * 100}%`,
        top: `${((object.sy + object.ey) / 2) * 100}%`,
        width: `${length}%`,
        transform: `translate(-50%, -50%) rotate(${angle}deg)`,
      }}
      title={`${team === 'neutral' ? '' : `${t(titleCase(team))} `}${objectLabel(object, t)}`}
    />
  );
}

export default function Home() {
  return <LanguageProvider><VectorApp /></LanguageProvider>;
}

function VectorApp() {
  const { t, number, notAvailable: unavailable } = useTranslation();
  useAppUpdates();
  const { objects, mapInfo, mapInfoUpdatedAt, mapRevision, lastUpdate, everConnected, trail, mission, teamMessages } = useWarThunderFeed();
  const activity = useCombatActivity(readJson);
  const archive = useFileArchive();
  const [selectedAccount, setSelectedAccount] = useState('');
  const accounts = useMemo(() => battleAccounts(archive.battles), [archive.battles]);
  const account = accounts.some(([id]) => id === selectedAccount) ? selectedAccount : accounts[0]?.[0];
  const [intelTab, setIntelTab] = useState<'contacts' | 'activity' | 'results'>('contacts');
  const [clock, setClock] = useState(() => Date.now());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [filters, setFilters] = useState<Filters>({
    air: true,
    ground: true,
    objectives: true,
    airfields: true,
    spawns: false,
  });
  const [selection, setSelection] = useState<{ revision: number; index: number | null; track: number | null }>({ revision: mapRevision, index: null, track: null });
  const selectedIndex = selection.revision === mapRevision ? selection.index : null;
  const selectedTrackId = selection.revision === mapRevision ? selection.track : null;
  const selectContact = useCallback((index: number | null, track: number | null) => setSelection({ revision: mapRevision, index, track }), [mapRevision]);
  const [showMemory, setShowMemory] = useState(true);
  const [highContrast, setHighContrast] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [autoFit, setAutoFit] = useState<AutoFitMode | null>('air');
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const connected = lastUpdate > 0 && clock - lastUpdate < MAP_FRESH_MS;
  const overview = showSessionOverview(mapInfo.valid, mapInfoUpdatedAt, lastUpdate, clock);
  useEffect(() => {
    // Releasing capture emits lostpointercapture, which ends the drag through
    // the normal pointer handler even if the map disappears mid-gesture.
    const drag = dragRef.current, stage = stageRef.current;
    if (overview && drag && stage?.hasPointerCapture(drag.pointerId)) stage.releasePointerCapture(drag.pointerId);
  }, [overview]);
  const player = useMemo(() => objects.find(isPlayer), [objects]);
  const selected = selectedIndex == null ? undefined : objects[selectedIndex];
  const generation = mapInfo.map_generation ?? 0;
  const { tracks: enemyTracks, clearMemory } = useEnemyMemory(objects, mapRevision, lastUpdate, clock);
  const selectedTrack = selectedTrackId == null ? undefined : enemyTracks.find((track) => track.id === selectedTrackId);
  const selectedObject = selectedTrack?.object ?? selected;
  const mapImage = `${WT_ORIGIN}/map.img?generation=${generation}`;
  const airContacts = objects.filter((object) => object.type === 'aircraft');
  const groundContacts = objects.filter((object) => object.type === 'ground_model');
  const missionObjectives = useMemo(() => {
    return [...(mission.objectives ?? [])]
      .filter((objective) => objective.status !== 'undefined' && Boolean(objective.text))
      .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)))
      .slice(0, 3);
  }, [mission]);
  const teamCues = useMemo(() => {
    if (mission.status && mission.status !== 'running') return [];
    return teamMessages.flatMap((message) => {
      const cue = parseTeamCue(message, mapInfo);
      const age = teamMessageAge(message, clock);
      return cue && age <= 180 ? [{ ...cue, age }] : [];
    }).slice(-3).reverse();
  }, [clock, mapInfo, mission.status, teamMessages]);
  const activeAirArea = useMemo(() => {
    const vehicles = objects.filter((object) =>
      object.type === 'aircraft' && object.x != null && object.y != null
    );
    if (vehicles.length === 0) return null;
    const xs = vehicles.map((object) => object.x!);
    const ys = vehicles.map((object) => object.y!);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }, [objects]);
  const battleArea = useMemo(() => airfieldBattleArea(objects), [objects]);

  const contactRows = useMemo(() => {
    return enemyTracks
      .filter((track) => track.object.type === 'aircraft')
      .map((track) => ({
        ...track,
        distance: rangeKm(player, track.object, mapInfo),
        bearing: bearingTo(player, track.object),
      }))
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
  }, [enemyTracks, mapInfo, player]);

  const gridKm = (mapInfo.grid_steps?.[0] ?? 10000) / 1000;
  const lostEnemyCount = contactRows.filter((track) => !track.active).length;

  const setZoomSafe = useCallback((next: number) => {
    setAutoFit(null);
    setZoom(clamp(next, MIN_MAP_ZOOM, MAX_MAP_ZOOM));
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setStageSize((current) => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const fitArea = useCallback((mode: AutoFitMode) => {
    const view = fitMapArea(mode === 'battle' ? battleArea : activeAirArea, stageSize, mode);
    if (!view) return;
    setZoom((current) => Math.abs(current - view.zoom) > 0.015 ? view.zoom : current);
    setPan((current) => Math.hypot(current.x - view.pan.x, current.y - view.pan.y) > 1 ? view.pan : current);
  }, [activeAirArea, battleArea, stageSize]);

  useEffect(() => {
    if (!autoFit) return;
    const frame = window.requestAnimationFrame(() => fitArea(autoFit));
    return () => window.cancelAnimationFrame(frame);
  }, [autoFit, fitArea, generation]);

  const enableAutoFit = useCallback((mode: AutoFitMode) => {
    setAutoFit(mode);
    fitArea(mode);
  }, [fitArea]);

  const centerPlayer = useCallback(() => {
    setAutoFit(null);
    if (!player || player.x == null || player.y == null || !stageRef.current) {
      setPan({ x: 0, y: 0 });
      return;
    }
    const size = Math.min(stageRef.current.clientWidth, stageRef.current.clientHeight);
    setPan({
      x: -(player.x - 0.5) * size * zoom,
      y: -(player.y - 0.5) * size * zoom,
    });
  }, [player, zoom]);

  const focusPoint = useCallback((point: Point) => {
    if (!stageRef.current) return;
    setAutoFit(null);
    const nextZoom = Math.max(zoom, 1.75);
    const size = Math.min(stageRef.current.clientWidth, stageRef.current.clientHeight);
    setZoom(nextZoom);
    setPan({
      x: -(point.x - 0.5) * size * nextZoom,
      y: -(point.y - 0.5) * size * nextZoom,
    });
  }, [zoom]);

  const focusObject = useCallback((object: MapObject) => {
    if (object.x == null || object.y == null) return;
    focusPoint({ x: object.x, y: object.y });
  }, [focusPoint]);

  const toggleFilter = useCallback((key: keyof Filters) => {
    setFilters((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'f') void document.documentElement.requestFullscreen?.();
      if (overview) return;
      if (event.key === '+' || event.key === '=') setZoomSafe(zoom + 0.25);
      if (event.key === '-') setZoomSafe(zoom - 0.25);
      if (event.key === '0') enableAutoFit('air');
      if (event.key.toLowerCase() === 'b') enableAutoFit('battle');
      if (event.key.toLowerCase() === 'c') centerPlayer();
      if (event.key === '1') toggleFilter('air');
      if (event.key === '2') toggleFilter('ground');
      if (event.key === '3') toggleFilter('objectives');
      if (event.key === '4') toggleFilter('airfields');
      if (event.key === '5') toggleFilter('spawns');
      if (event.key.toLowerCase() === 'm') setShowMemory((visible) => !visible);
      if (event.key === 'Escape') {
        selectContact(null, null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [centerPlayer, enableAutoFit, overview, selectContact, setZoomSafe, toggleFilter, zoom]);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setAutoFit(null);
    setIsDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + event.clientX - dragRef.current.x,
      y: dragRef.current.panY + event.clientY - dragRef.current.y,
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const selectedDistance = rangeKm(player, selectedObject, mapInfo);
  const selectedHeading = headingFromObject(selectedObject);

  return (
    <main className={`tactical-shell ${highContrast ? 'high-contrast' : ''} ${overview ? 'session-mode' : ''}`}>
      <aside className="brand-rail" aria-label={t("Vector controls")}>
        <div className="brand-mark" aria-label={t("Vector tactical map")}>V</div>
        {!overview && <button className="rail-button" aria-label={t("Toggle map contrast")} title={t("Toggle map contrast")} onClick={() => setHighContrast((active) => !active)}>◐</button>}
        <button className="rail-button" aria-label={t("Open full screen")} title={t("Full screen (F)")} onClick={() => void document.documentElement.requestFullscreen?.()}>⛶</button>
      </aside>

      <section
        ref={stageRef}
        className={`map-stage ${overview ? 'overview-stage' : ''} ${!overview && isDragging ? 'dragging' : ''}`}
        aria-label={overview ? t("Session results") : t("Live battle map")}
        onPointerDown={overview ? undefined : onPointerDown}
        onPointerMove={overview ? undefined : onPointerMove}
        onPointerUp={overview ? undefined : onPointerUp}
        onPointerCancel={() => { dragRef.current = null; setIsDragging(false); }}
        onLostPointerCapture={() => { dragRef.current = null; setIsDragging(false); }}
        onDoubleClick={overview ? undefined : centerPlayer}
        onWheel={(event) => {
          if (overview) return;
          event.preventDefault();
          setZoomSafe(zoom + (event.deltaY < 0 ? 0.2 : -0.2));
        }}
      >
        {overview ? <SessionOverview archive={archive} account={account} accounts={accounts} onAccountChange={setSelectedAccount}
          onHistory={() => { setIntelTab('results'); document.getElementById('intel-tab-results')?.focus(); }} telemetryOnline={connected} /> : <>
        <div className="map-ambient" style={{ backgroundImage: `url(${mapImage})` }} />
        <div className="map-pan-layer" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0)` }}>
          <div className="map-content" style={{ transform: `translate(-50%, -50%) scale(${zoom})` }}>
            <MapImage key={mapImage} source={mapImage} alt={t("War Thunder tactical map")} />
            <div className="map-tint" />
            <div className="grid-overlay" />
            <TrailCanvas trail={trail} />

            {objects.map((object, index) => {
              if (!filters[groupFor(object)]) return null;
              if (!connected && isEnemy(object) && (object.type === 'aircraft' || object.type === 'ground_model')) return null;
              if (object.type === 'airfield') return <Runway key={`runway-${index}`} object={object} />;
              if (object.x == null || object.y == null) return null;
              const playerMarker = isPlayer(object);
              const enemy = isEnemy(object);
              const base = baseKind(object);
              const team = base ? baseTeam(object) : null;
              const geometryMarker = !base && (groupFor(object) === 'objectives' || groupFor(object) === 'spawns');
              const kind = actorKind(object);
              const rotation = object.type === 'aircraft' ? headingFromObject(object) : 0;
              const gameTarget = isGameSelectedTarget(object, connected);
              const label = `${team && team !== 'neutral' ? `${t(titleCase(team))} ` : ''}${objectLabel(object, t)}${gameTarget ? t(' · Selected in game') : ''}`;
              return (
                <button
                  key={`${object.type}-${index}`}
                  className={`map-marker ${kind}-contact ${playerMarker ? 'player' : ''} ${isSquadmate(object) ? 'squad' : ''} ${enemy ? 'hostile' : 'ally'} ${geometryMarker ? 'objective' : ''} ${base ? `base base-${team}` : ''} ${object.type === 'ground_model' ? 'ground' : ''} ${object.blink ? 'blinking' : ''} ${selectedIndex === index ? 'selected' : ''} ${gameTarget ? 'game-target' : ''}`}
                  style={{ left: `${object.x * 100}%`, top: `${object.y * 100}%` }}
                  aria-label={label}
                  title={label}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectContact(index, null);
                  }}
                >
                  {object.type === 'aircraft'
                    ? <AircraftSymbol role={aircraftRole(object)} heading={rotation} />
                    : base ? <BaseSymbol kind={base} />
                      : <span className="marker-symbol">{markerGlyph(object)}</span>}
                  {gameTarget && <TargetReticle />}
                </button>
              );
            })}

            {showMemory && enemyTracks.filter((track) => !track.active).map((track) => {
              const object = track.object;
              if (!filters[groupFor(object)] || object.x == null || object.y == null) return null;
              const ageSeconds = Math.max(1, Math.floor((clock - track.lastSeen) / 1000));
              const memoryOpacity = clamp(1 - (clock - track.lastSeen) / ENEMY_MEMORY_MS, 0.28, 0.72);
              return (
                <button
                  key={`memory-${track.id}`}
                  className={`map-marker ${actorKind(object)}-contact hostile memory ${object.type === 'ground_model' ? 'ground' : ''} ${selectedTrackId === track.id ? 'selected' : ''}`}
                  style={{ left: `${object.x * 100}%`, top: `${object.y * 100}%`, opacity: memoryOpacity }}
                  aria-label={t('{contact}, last seen {seconds}s ago', { contact: objectLabel(object, t), seconds: ageSeconds })}
                  title={`E-${track.id.toString().padStart(2, '0')} · ${objectLabel(object, t)} · ${t('Last seen {seconds}s ago', { seconds: ageSeconds })}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectContact(null, track.id);
                  }}
                >
                  {object.type === 'aircraft'
                    ? <AircraftSymbol role={aircraftRole(object)} heading={headingFromObject(object)} />
                    : <span className="marker-symbol">{markerGlyph(object)}</span>}
                  <small>E-{track.id.toString().padStart(2, '0')} · {t('{seconds}s', { seconds: ageSeconds })}</small>
                </button>
              );
            })}

            {teamCues.map((cue) => (
              <button
                key={`team-ping-${cue.id}`}
                className="team-ping-marker"
                style={{ left: `${cue.point.x * 100}%`, top: `${cue.point.y * 100}%` }}
                aria-label={t('Team ping {grid}: {message}', { grid: cue.grid, message: cue.body })}
                title={`${cue.grid} · ${cue.body}`}
                onClick={(event) => {
                  event.stopPropagation();
                  focusPoint(cue.point);
                }}
              >
                <span>{cue.grid}</span>
                <small>{t('{seconds}s', { seconds: cue.age })}</small>
              </button>
            ))}
          </div>
        </div>

        <header className="topbar">
          <div>
            <p className="eyebrow">{t("Vector / Live map")}</p>
            <h1>{t("Current battle")}</h1>
          </div>
          <div className={`connection-pill ${connected ? '' : 'offline'}`}>
            <span /> {connected ? t("Live") : t("Game disconnected")}
          </div>
        </header>

        {!connected && (
          <div className="feed-banner" role="status">
            <strong>{everConnected ? t("Game connection lost") : t("Waiting for a battle")}</strong>
            <span>{everConnected ? t("Showing the last known positions.") : t("Enter a battle in War Thunder to connect.")}</span>
          </div>
        )}

        {selectedObject && (
          <article className="selection-card">
            <button aria-label={t("Close contact details")} onClick={() => { selectContact(null, null); }}>×</button>
            <p>{selectedTrack && !selectedTrack.active ? `${t('Last seen')} · ${actorLabel(selectedObject, t)}` : isEnemy(selectedObject) ? `${t('Enemy')} · ${actorLabel(selectedObject, t)}` : t('{kind} contact', { kind: actorLabel(selectedObject, t) })}</p>
            <strong>{selectedTrack ? `E-${selectedTrack.id.toString().padStart(2, '0')} · ` : ''}{objectLabel(selectedObject, t)}</strong>
            <div>
              <span>{number(selectedDistance, 1)}{' '}{t("km")}</span>
              <span>{Math.round(selectedHeading).toString().padStart(3, '0')}{t("° heading")}</span>
              <span>{t(gridSquare(selectedObject, mapInfo))}</span>
            </div>
            {selectedTrack && !selectedTrack.active && <small>{t('Last seen {seconds}s ago', { seconds: Math.max(1, Math.floor((clock - selectedTrack.lastSeen) / 1000)) })}</small>}
          </article>
        )}

        <div className="map-tools" aria-label={t("Map controls")}>
          <button aria-label={t("Zoom in")} title={t("Zoom in (+)")} onClick={() => setZoomSafe(zoom + 0.25)}>+</button>
          <button aria-label={t("Zoom out")} title={t("Zoom out (−)")} onClick={() => setZoomSafe(zoom - 0.25)}>−</button>
          <button className={autoFit === 'air' ? 'active' : ''} aria-pressed={autoFit === 'air'} aria-label={t("Fit map to aircraft")} title={t("Fit map to aircraft (0)")} onClick={() => enableAutoFit('air')}>⤢</button>
          <button className={autoFit === 'battle' ? 'active' : ''} aria-pressed={autoFit === 'battle'} aria-label={t("Fit map between airfields")} title={t("Fit map between airfields (B)")} onClick={() => enableAutoFit('battle')}>B</button>
          <button aria-label={t("Center on your aircraft")} title={t("Center on your aircraft (C)")} onClick={centerPlayer}>⌖</button>
        </div>

        <div className="filter-bar" aria-label={t("Map layers")}>
          <button className={filters.air ? 'active' : ''} aria-pressed={filters.air} onClick={() => toggleFilter('air')}><i className="air-i" />{' '}{t("Aircraft")}</button>
          <button className={filters.ground ? 'active' : ''} aria-pressed={filters.ground} onClick={() => toggleFilter('ground')}><i className="ground-i" />{' '}{t("Ground")}</button>
          <button className={filters.objectives ? 'active' : ''} aria-pressed={filters.objectives} onClick={() => toggleFilter('objectives')}><i className="objective-i" />{' '}{t("Objectives")}</button>
          <button className={filters.airfields ? 'active' : ''} aria-pressed={filters.airfields} onClick={() => toggleFilter('airfields')}><i className="airfield-i" />{' '}{t("Airfields")}</button>
          <button className={filters.spawns ? 'active' : ''} aria-pressed={filters.spawns} onClick={() => toggleFilter('spawns')}><i className="spawn-i" />{' '}{t("Spawns")}</button>
          <button className={showMemory ? 'active' : ''} aria-pressed={showMemory} onClick={() => setShowMemory((visible) => !visible)}><i className="memory-i" />{' '}{t("Last positions")}</button>
        </div>

        <div className="scale-bar"><span /> {number(gridKm, gridKm % 1 ? 1 : 0)}{' '}{t("km grid")}</div>
        </>}
      </section>

      <aside className="intel-panel">
        <div className="panel-heading">
          <p className="eyebrow">{overview ? t("Vector / Session") : t("Vector / Battle")}</p>
          <LanguageSelector />
          <span className={`status-dot ${connected ? '' : 'offline'}`} />
        </div>
        <h2>{intelTab === 'contacts' ? t("Contacts") : intelTab === 'activity' ? t("Combat activity") : t("Battle results")}</h2>

        <div className="intel-tabs" role="tablist" aria-label={t("Battle panels")}>
          {(['contacts', 'activity', 'results'] as const).map((tab) => (
            <button
              key={tab}
              id={`intel-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={intelTab === tab}
              aria-controls={`intel-panel-${tab}`}
              tabIndex={intelTab === tab ? 0 : -1}
              onClick={() => setIntelTab(tab)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const tabs = ['contacts', 'activity', 'results'] as const;
                const next = event.key === 'Home' ? 'contacts' : event.key === 'End' ? 'results' : tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % tabs.length];
                setIntelTab(next);
                document.getElementById(`intel-tab-${next}`)?.focus();
              }}
            ><GameIcon name={tab === 'contacts' ? 'target' : tab} />{t(tab[0].toUpperCase() + tab.slice(1))}{tab === 'activity' && activity.eventCount > 0 && <span className="intel-tab-count">{activity.eventCount}</span>}</button>
          ))}
        </div>

        <div id="intel-panel-contacts" className="intel-tab-panel" role="tabpanel" aria-labelledby="intel-tab-contacts" hidden={intelTab !== 'contacts'} tabIndex={0}>

        <section className="actor-legend" aria-label={t("Map color legend")}>
          <span className="air-ally"><i />{t("Allied aircraft")}</span>
          <span className="air-enemy"><i />{t("Enemy aircraft")}</span>
          <span className="ground-ally"><i />{t("Allied ground")}</span>
          <span className="ground-enemy"><i />{t("Enemy ground")}</span>
        </section>

        <section className="air-role-legend" aria-label={t("Aircraft role markings")}>
          {(['fighter', 'assault', 'bomber', 'unknown'] as const).map((role) => (
            <span key={role}><AircraftSymbol role={role} />{t(AIRCRAFT_MARKS[role].label)}</span>
          ))}
        </section>

        <section className="picture-summary">
          <span>{t("Aircraft")}{' '}<b>{airContacts.length}</b></span>
          <span>{t("Ground")}{' '}<b>{groundContacts.length}</b></span>
          <span>{t("Last seen")}{' '}<b>{lostEnemyCount}</b></span>
        </section>

        {missionObjectives.length > 0 && (
          <section className="mission-brief" aria-label={t("Mission objectives")}>
            <header><span>{t("Mission")}</span><small>{t(titleCase(mission.status ?? 'active'))}</small></header>
            {missionObjectives.map((objective, index) => (
              <div key={`${objective.text}-${index}`} className={`mission-objective ${objective.status ?? 'in_progress'}`}>
                <i /><p>{objective.text}</p>
              </div>
            ))}
          </section>
        )}

        {teamCues.length > 0 && (
          <section className="team-cues" aria-label={t("Recent team map pings")}>
            <header><span>{t("Team pings")}</span><small>{teamCues.length}{' '}{t("recent")}</small></header>
            {teamCues.map((cue) => (
              <button key={`team-cue-${cue.id}`} onClick={() => focusPoint(cue.point)}>
                <b>{cue.grid}</b>
                <span>
                  <strong>{cue.body || t("Team callout")}</strong>
                  <small>{[cue.detail, cue.sender, t('{seconds}s ago', { seconds: cue.age })].filter(Boolean).join(' · ')}</small>
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="contact-log" aria-label={t("Last known enemy positions")}>
          <div className="contact-log-heading">
            <div><span>{t("Enemy aircraft")}</span><small>{t('Last {seconds}s', { seconds: ENEMY_MEMORY_MS / 1000 })}</small></div>
            <button
              onClick={() => { clearMemory(); selectContact(selectedIndex, null); }}
              disabled={!contactRows.some((track) => !track.active)}
              title={t("Clear last known positions")}
            >{t("Clear old")}</button>
          </div>
          <div className="contact-table-wrap">
            <table>
              <thead>
                <tr><th>{t("Contact")}</th><th>{t("Grid")}</th><th>{t("Range")}</th><th aria-label={t("Bearing")} title={t("Bearing")}>{t("Brg.")}</th><th>{t("Seen")}</th></tr>
              </thead>
              <tbody>
                {contactRows.length === 0 && (
                  <tr className="empty-row"><td colSpan={5}>{t("No enemy aircraft spotted")}</td></tr>
                )}
                {contactRows.slice(0, 12).map((track) => {
                  const ageSeconds = Math.max(1, Math.floor((clock - track.lastSeen) / 1000));
                  return (
                    <tr
                      key={`track-row-${track.id}`}
                      className={`${track.active ? 'active-track' : 'lost-track'} ${actorKind(track.object)}-track ${selectedTrackId === track.id ? 'selected-track' : ''}`}
                      tabIndex={0}
                      role="button"
                      aria-label={t('Enemy track E-{id}, {status}', { id: track.id, status: track.active ? t('Live') : t('Last seen {seconds}s ago', { seconds: ageSeconds }) })}
                      onClick={() => {
                        selectContact(null, track.id);
                        focusObject(track.object);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          selectContact(null, track.id);
                          focusObject(track.object);
                        }
                      }}
                    >
                      <td><AircraftSymbol role={aircraftRole(track.object)} /><span>E-{track.id.toString().padStart(2, '0')}</span><small>{actorLabel(track.object, t)} · {objectLabel(track.object, t)}</small></td>
                      <td>{t(gridSquare(track.object, mapInfo))}</td>
                      <td>{number(track.distance, 1)}<small>{t("km")}</small></td>
                      <td>{track.bearing == null ? unavailable : Math.round(track.bearing).toString().padStart(3, '0')}<small>°</small></td>
                      <td><b>{track.active ? t("Live") : t('{seconds}s', { seconds: ageSeconds })}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        </div>

        <div id="intel-panel-activity" className="intel-tab-panel" role="tabpanel" aria-labelledby="intel-tab-activity" hidden={intelTab !== 'activity'} tabIndex={0}>
          <CombatActivityPanel activity={activity} />
        </div>

        <div id="intel-panel-results" className="intel-tab-panel" role="tabpanel" aria-labelledby="intel-tab-results" hidden={intelTab !== 'results'} tabIndex={0}>
          <FileBattlesPanel archive={archive} account={account} accounts={accounts} onAccountChange={setSelectedAccount} />
        </div>

        <footer className="panel-footer"><span>{t("WT :8111")}</span><span>{t("Local / Read-only")}</span></footer>
      </aside>
    </main>
  );
}
