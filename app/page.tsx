'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CombatActivityPanel, { useCombatActivity } from './combat-activity-panel';
import FileBattlesPanel from './file-battles-panel';
import SessionOverview from './session-overview';
import { useFileArchive } from './use-file-archive';
import { useAppUpdates } from './use-app-updates';
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

const WT_ORIGIN = 'http://127.0.0.1:8111';
const MAP_POLL_MS = 100;

type MapObject = {
  type: string;
  color?: string;
  blink?: number;
  icon?: string;
  icon_bg?: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  sx?: number;
  sy?: number;
  ex?: number;
  ey?: number;
};

type MapInfo = {
  valid?: boolean;
  map_generation?: number;
  grid_size?: [number, number];
  grid_steps?: [number, number];
  grid_zero?: [number, number];
  map_min?: [number, number];
  map_max?: [number, number];
  hud_type?: number;
};

type MissionObjective = {
  primary?: boolean;
  status?: string;
  text?: string;
};

type Mission = {
  status?: string;
  objectives?: MissionObjective[];
};

type GameChatRecord = {
  id: number;
  msg: string;
  sender?: string;
  enemy?: boolean;
  mode?: string;
  time?: number;
};

type TeamMessage = GameChatRecord & {
  receivedAt: number;
  referenceTime: number;
};

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

const ENEMY_MEMORY_MS = 90_000;

const defaultInfo: MapInfo = {
  valid: false,
  map_generation: 0,
  grid_size: [65536, 65536],
  grid_steps: [6500, 6500],
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

function actorLabel(object: MapObject) {
  const kind = actorKind(object);
  if (kind === 'air') return isSquadmate(object) ? 'Squadron aircraft' : 'Aircraft';
  if (kind === 'ground') return 'Ground';
  return 'Objective';
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

function objectLabel(object: MapObject) {
  if (isPlayer(object)) return 'Your aircraft';
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
  return labels[object.type] ?? titleCase(object.type);
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

async function readJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1400);
  try {
    const response = await fetch(`${WT_ORIGIN}${path}`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Telemetry returned ${response.status}`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

function useWarThunderFeed() {
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [mapInfo, setMapInfo] = useState<MapInfo>(defaultInfo);
  const [mapInfoUpdatedAt, setMapInfoUpdatedAt] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [everConnected, setEverConnected] = useState(false);
  const [trail, setTrail] = useState<Point[]>([]);
  const [mission, setMission] = useState<Mission>({});
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);
  const lastChatIdRef = useRef(0);
  const mapGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    let stopped = false;
    const timers: number[] = [];

    const runLoop = (task: () => Promise<void>, delay: number) => {
      const run = async () => {
        await task().catch(() => undefined);
        if (!stopped) timers.push(window.setTimeout(run, delay));
      };
      void run();
    };

    runLoop(async () => {
      const nextObjects = await readJson<MapObject[]>('/map_obj.json');
      if (stopped || !Array.isArray(nextObjects)) return;
      setObjects(nextObjects);
      const player = nextObjects.find(isPlayer);
      if (player?.x != null && player.y != null) {
        setTrail((previous) => {
          const last = previous.at(-1);
          if (last && Math.hypot(last.x - player.x!, last.y - player.y!) < 0.00045) return previous;
          return [...previous, { x: player.x!, y: player.y! }].slice(-160);
        });
      }
      setLastUpdate(Date.now());
      setEverConnected(true);
    }, MAP_POLL_MS);

    runLoop(async () => {
      const nextInfo = await readJson<MapInfo>('/map_info.json');
      if (stopped || !nextInfo || typeof nextInfo.valid !== 'boolean') return;
      const nextGeneration = nextInfo.map_generation ?? 0;
      if (mapGenerationRef.current != null && mapGenerationRef.current !== nextGeneration) {
        lastChatIdRef.current = 0;
        setTeamMessages([]);
        setMission({});
        setTrail([]);
      }
      mapGenerationRef.current = nextGeneration;
      setMapInfo(nextInfo);
      setMapInfoUpdatedAt(Date.now());
    }, 2500);

    runLoop(async () => {
      const nextMission = await readJson<Mission>('/mission.json');
      if (stopped || typeof nextMission !== 'object' || nextMission == null) return;
      setMission(nextMission);
    }, 1000);

    runLoop(async () => {
      const records = await readJson<GameChatRecord[]>(`/gamechat?lastId=${lastChatIdRef.current}`);
      if (stopped || !Array.isArray(records) || records.length === 0) return;
      const validRecords = records.filter((record) => Number.isFinite(record.id) && typeof record.msg === 'string');
      if (validRecords.length === 0) return;
      lastChatIdRef.current = Math.max(lastChatIdRef.current, ...validRecords.map((record) => record.id));
      const receivedAt = Date.now();
      const referenceTime = Math.max(...validRecords.map((record) => record.time ?? 0));
      const enriched = validRecords
        .filter((record) => !record.enemy)
        .map((record) => ({ ...record, receivedAt, referenceTime }));
      setTeamMessages((previous) => {
        const known = new Set(previous.map((record) => record.id));
        return [...previous, ...enriched.filter((record) => !known.has(record.id))].slice(-30);
      });
    }, 750);

    return () => {
      stopped = true;
      timers.forEach(window.clearTimeout);
    };
  }, []);

  return { objects, mapInfo, mapInfoUpdatedAt, lastUpdate, everConnected, trail, mission, teamMessages };
}

function useEnemyMemory(objects: MapObject[], generation: number) {
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
    const now = Date.now();
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
  }, [objects]);

  const clearMemory = useCallback(() => {
    setTracks((current) => current.filter((track) => track.active));
  }, []);

  return { tracks, clearMemory };
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
      title={`${team === 'neutral' ? '' : `${titleCase(team)} `}${objectLabel(object)}`}
    />
  );
}

export default function Home() {
  useAppUpdates();
  const { objects, mapInfo, mapInfoUpdatedAt, lastUpdate, everConnected, trail, mission, teamMessages } = useWarThunderFeed();
  const activity = useCombatActivity(readJson);
  const archive = useFileArchive();
  const [selectedAccount, setSelectedAccount] = useState('');
  const accounts = useMemo(() => [...new Map(archive.battles.map(b => [b.accountId, b.player || b.accountId])).entries()], [archive.battles]);
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
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null);
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

  const connected = lastUpdate > 0 && clock - lastUpdate < 1800;
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
  const { tracks: enemyTracks, clearMemory } = useEnemyMemory(objects, generation);
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
        setSelectedIndex(null);
        setSelectedTrackId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [centerPlayer, enableAutoFit, overview, setZoomSafe, toggleFilter, zoom]);

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
      <aside className="brand-rail" aria-label="Vector controls">
        <div className="brand-mark" aria-label="Vector tactical map">V</div>
        {!overview && <button className="rail-button" aria-label="Toggle map contrast" title="Toggle map contrast" onClick={() => setHighContrast((active) => !active)}>◐</button>}
        <button className="rail-button" aria-label="Open full screen" title="Full screen (F)" onClick={() => void document.documentElement.requestFullscreen?.()}>⛶</button>
      </aside>

      <section
        ref={stageRef}
        className={`map-stage ${overview ? 'overview-stage' : ''} ${!overview && isDragging ? 'dragging' : ''}`}
        aria-label={overview ? 'Session results' : 'Live battle map'}
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
            <img className="map-image" src={mapImage} alt="War Thunder tactical map" draggable="false" />
            <div className="map-tint" />
            <div className="grid-overlay" />
            <TrailCanvas trail={trail} />

            {objects.map((object, index) => {
              if (!filters[groupFor(object)]) return null;
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
              const label = `${team && team !== 'neutral' ? `${titleCase(team)} ` : ''}${objectLabel(object)}${gameTarget ? ' · Selected in game' : ''}`;
              return (
                <button
                  key={`${object.type}-${index}`}
                  className={`map-marker ${kind}-contact ${playerMarker ? 'player' : ''} ${isSquadmate(object) ? 'squad' : ''} ${enemy ? 'hostile' : 'ally'} ${geometryMarker ? 'objective' : ''} ${base ? `base base-${team}` : ''} ${object.type === 'ground_model' ? 'ground' : ''} ${object.blink ? 'blinking' : ''} ${selectedIndex === index ? 'selected' : ''} ${gameTarget ? 'game-target' : ''}`}
                  style={{ left: `${object.x * 100}%`, top: `${object.y * 100}%` }}
                  aria-label={label}
                  title={label}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedIndex(index);
                    setSelectedTrackId(null);
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
                  aria-label={`${objectLabel(object)}, last seen ${ageSeconds} seconds ago`}
                  title={`E-${track.id.toString().padStart(2, '0')} · ${objectLabel(object)} · last seen ${ageSeconds}s ago`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedTrackId(track.id);
                    setSelectedIndex(null);
                  }}
                >
                  {object.type === 'aircraft'
                    ? <AircraftSymbol role={aircraftRole(object)} heading={headingFromObject(object)} />
                    : <span className="marker-symbol">{markerGlyph(object)}</span>}
                  <small>E-{track.id.toString().padStart(2, '0')} · {ageSeconds}s</small>
                </button>
              );
            })}

            {teamCues.map((cue) => (
              <button
                key={`team-ping-${cue.id}`}
                className="team-ping-marker"
                style={{ left: `${cue.point.x * 100}%`, top: `${cue.point.y * 100}%` }}
                aria-label={`Team ping ${cue.grid}: ${cue.body}`}
                title={`${cue.grid} · ${cue.body}`}
                onClick={(event) => {
                  event.stopPropagation();
                  focusPoint(cue.point);
                }}
              >
                <span>{cue.grid}</span>
                <small>{cue.age}s</small>
              </button>
            ))}
          </div>
        </div>

        <header className="topbar">
          <div>
            <p className="eyebrow">Vector / Live map</p>
            <h1>Current battle</h1>
          </div>
          <div className={`connection-pill ${connected ? '' : 'offline'}`}>
            <span /> {connected ? 'Live' : 'Game disconnected'}
          </div>
        </header>

        {!connected && (
          <div className="feed-banner" role="status">
            <strong>{everConnected ? 'Game connection lost' : 'Waiting for a battle'}</strong>
            <span>{everConnected ? 'Showing the last known positions.' : 'Enter a battle in War Thunder to connect.'}</span>
          </div>
        )}

        {selectedObject && (
          <article className="selection-card">
            <button aria-label="Close contact details" onClick={() => { setSelectedIndex(null); setSelectedTrackId(null); }}>×</button>
            <p>{selectedTrack && !selectedTrack.active ? `Last seen · ${actorLabel(selectedObject)}` : isEnemy(selectedObject) ? `Enemy · ${actorLabel(selectedObject)}` : `${actorLabel(selectedObject)} contact`}</p>
            <strong>{selectedTrack ? `E-${selectedTrack.id.toString().padStart(2, '0')} · ` : ''}{objectLabel(selectedObject)}</strong>
            <div>
              <span>{selectedDistance == null ? notAvailable : selectedDistance.toFixed(1)} km</span>
              <span>{Math.round(selectedHeading).toString().padStart(3, '0')}° heading</span>
              <span>{gridSquare(selectedObject, mapInfo)}</span>
            </div>
            {selectedTrack && !selectedTrack.active && <small>Last seen {Math.max(1, Math.floor((clock - selectedTrack.lastSeen) / 1000))}s ago</small>}
          </article>
        )}

        <div className="map-tools" aria-label="Map controls">
          <button aria-label="Zoom in" title="Zoom in (+)" onClick={() => setZoomSafe(zoom + 0.25)}>+</button>
          <button aria-label="Zoom out" title="Zoom out (−)" onClick={() => setZoomSafe(zoom - 0.25)}>−</button>
          <button className={autoFit === 'air' ? 'active' : ''} aria-pressed={autoFit === 'air'} aria-label="Fit map to aircraft" title="Fit map to aircraft (0)" onClick={() => enableAutoFit('air')}>⤢</button>
          <button className={autoFit === 'battle' ? 'active' : ''} aria-pressed={autoFit === 'battle'} aria-label="Fit map between airfields" title="Fit map between airfields (B)" onClick={() => enableAutoFit('battle')}>B</button>
          <button aria-label="Center on your aircraft" title="Center on your aircraft (C)" onClick={centerPlayer}>⌖</button>
        </div>

        <div className="filter-bar" aria-label="Map layers">
          <button className={filters.air ? 'active' : ''} aria-pressed={filters.air} onClick={() => toggleFilter('air')}><i className="air-i" /> Aircraft</button>
          <button className={filters.ground ? 'active' : ''} aria-pressed={filters.ground} onClick={() => toggleFilter('ground')}><i className="ground-i" /> Ground</button>
          <button className={filters.objectives ? 'active' : ''} aria-pressed={filters.objectives} onClick={() => toggleFilter('objectives')}><i className="objective-i" /> Objectives</button>
          <button className={filters.airfields ? 'active' : ''} aria-pressed={filters.airfields} onClick={() => toggleFilter('airfields')}><i className="airfield-i" /> Airfields</button>
          <button className={filters.spawns ? 'active' : ''} aria-pressed={filters.spawns} onClick={() => toggleFilter('spawns')}><i className="spawn-i" /> Spawns</button>
          <button className={showMemory ? 'active' : ''} aria-pressed={showMemory} onClick={() => setShowMemory((visible) => !visible)}><i className="memory-i" /> Last positions</button>
        </div>

        <div className="scale-bar"><span /> {gridKm.toFixed(gridKm % 1 ? 1 : 0)} km grid</div>
        </>}
      </section>

      <aside className="intel-panel">
        <div className="panel-heading">
          <p className="eyebrow">{overview ? 'Vector / Session' : 'Vector / Battle'}</p>
          <span className={`status-dot ${connected ? '' : 'offline'}`} />
        </div>
        <h2>{intelTab === 'contacts' ? 'Contacts' : intelTab === 'activity' ? 'Combat activity' : 'Battle results'}</h2>

        <div className="intel-tabs" role="tablist" aria-label="Battle panels">
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
            ><GameIcon name={tab === 'contacts' ? 'target' : tab} />{tab[0].toUpperCase() + tab.slice(1)}{tab === 'activity' && activity.eventCount > 0 && <span className="intel-tab-count">{activity.eventCount}</span>}</button>
          ))}
        </div>

        <div id="intel-panel-contacts" className="intel-tab-panel" role="tabpanel" aria-labelledby="intel-tab-contacts" hidden={intelTab !== 'contacts'} tabIndex={0}>

        <section className="actor-legend" aria-label="Map color legend">
          <span className="air-ally"><i />Allied aircraft</span>
          <span className="air-enemy"><i />Enemy aircraft</span>
          <span className="ground-ally"><i />Allied ground</span>
          <span className="ground-enemy"><i />Enemy ground</span>
        </section>

        <section className="air-role-legend" aria-label="Aircraft role markings">
          {(['fighter', 'assault', 'bomber', 'unknown'] as const).map((role) => (
            <span key={role}><AircraftSymbol role={role} />{AIRCRAFT_MARKS[role].label}</span>
          ))}
        </section>

        <section className="picture-summary">
          <span><b>{airContacts.length}</b> aircraft</span>
          <span><b>{groundContacts.length}</b> ground</span>
          <span><b>{lostEnemyCount}</b> last seen</span>
        </section>

        {missionObjectives.length > 0 && (
          <section className="mission-brief" aria-label="Mission objectives">
            <header><span>Mission</span><small>{titleCase(mission.status ?? 'active')}</small></header>
            {missionObjectives.map((objective, index) => (
              <div key={`${objective.text}-${index}`} className={`mission-objective ${objective.status ?? 'in_progress'}`}>
                <i /><p>{objective.text}</p>
              </div>
            ))}
          </section>
        )}

        {teamCues.length > 0 && (
          <section className="team-cues" aria-label="Recent team map pings">
            <header><span>Team pings</span><small>{teamCues.length} recent</small></header>
            {teamCues.map((cue) => (
              <button key={`team-cue-${cue.id}`} onClick={() => focusPoint(cue.point)}>
                <b>{cue.grid}</b>
                <span>
                  <strong>{cue.body || 'Team callout'}</strong>
                  <small>{[cue.detail, cue.sender, `${cue.age}s ago`].filter(Boolean).join(' · ')}</small>
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="contact-log" aria-label="Last known enemy positions">
          <div className="contact-log-heading">
            <div><span>Enemy aircraft</span><small>Last {ENEMY_MEMORY_MS / 1000}s</small></div>
            <button
              onClick={() => { clearMemory(); setSelectedTrackId(null); }}
              disabled={!contactRows.some((track) => !track.active)}
              title="Clear last known positions"
            >Clear old</button>
          </div>
          <div className="contact-table-wrap">
            <table>
              <thead>
                <tr><th>Contact</th><th>Grid</th><th>Range</th><th aria-label="Bearing" title="Bearing">Brg.</th><th>Seen</th></tr>
              </thead>
              <tbody>
                {contactRows.length === 0 && (
                  <tr className="empty-row"><td colSpan={5}>No enemy aircraft spotted</td></tr>
                )}
                {contactRows.slice(0, 12).map((track) => {
                  const ageSeconds = Math.max(1, Math.floor((clock - track.lastSeen) / 1000));
                  return (
                    <tr
                      key={`track-row-${track.id}`}
                      className={`${track.active ? 'active-track' : 'lost-track'} ${actorKind(track.object)}-track ${selectedTrackId === track.id ? 'selected-track' : ''}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`Enemy track E-${track.id}, ${track.active ? 'live' : `last seen ${ageSeconds} seconds ago`}`}
                      onClick={() => {
                        setSelectedTrackId(track.id);
                        setSelectedIndex(null);
                        focusObject(track.object);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedTrackId(track.id);
                          setSelectedIndex(null);
                          focusObject(track.object);
                        }
                      }}
                    >
                      <td><AircraftSymbol role={aircraftRole(track.object)} /><span>E-{track.id.toString().padStart(2, '0')}</span><small>{actorLabel(track.object)} · {objectLabel(track.object)}</small></td>
                      <td>{gridSquare(track.object, mapInfo)}</td>
                      <td>{track.distance == null ? notAvailable : track.distance.toFixed(1)}<small>km</small></td>
                      <td>{track.bearing == null ? notAvailable : Math.round(track.bearing).toString().padStart(3, '0')}<small>°</small></td>
                      <td><b>{track.active ? 'Live' : `${ageSeconds}s`}</b></td>
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

        <footer className="panel-footer"><span>WT :8111</span><span>Local / Read-only</span></footer>
      </aside>
    </main>
  );
}
