export const WT_ORIGIN = 'http://127.0.0.1:8111';

export type MapObject = {
  type: string; color?: string; blink?: number; icon?: string; icon_bg?: string;
  x?: number; y?: number; dx?: number; dy?: number; sx?: number; sy?: number; ex?: number; ey?: number;
};
export type MapInfo = {
  valid?: boolean; map_generation?: number; grid_size?: [number, number]; grid_steps?: [number, number];
  grid_zero?: [number, number]; map_min?: [number, number]; map_max?: [number, number]; hud_type?: number;
};
export type Mission = { status?: string; objectives?: { primary?: boolean; status?: string; text?: string }[] };
export type GameChatRecord = { id: number; msg: string; sender?: string; enemy?: boolean; time?: number };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, limit = 128): v is string => typeof v === 'string' && v.length <= limit;
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(finite);

export function parseMapObjects(value: unknown): MapObject[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid map objects');
  return value.filter((v): v is MapObject => record(v) && text(v.type) && v.type.length > 0 &&
    ['color', 'icon', 'icon_bg'].every(k => v[k] === undefined || text(v[k])) &&
    ['blink', 'x', 'y', 'dx', 'dy', 'sx', 'sy', 'ex', 'ey'].every(k => v[k] === undefined || finite(v[k])));
}

export function parseMapInfo(value: unknown): MapInfo {
  // Hangar snapshots may omit geometry or report zero-sized placeholders.
  if (record(value) && value.valid === false) return { valid: false,
    map_generation: Number.isSafeInteger(value.map_generation) && Number(value.map_generation) >= 0 ? Number(value.map_generation) : undefined };
  if (!record(value) || typeof value.valid !== 'boolean' ||
    (value.map_generation !== undefined && (!Number.isSafeInteger(value.map_generation) || Number(value.map_generation) < 0)) ||
    ['grid_size', 'grid_steps', 'grid_zero', 'map_min', 'map_max'].some(k => value[k] !== undefined && !pair(value[k])) ||
    ['grid_size', 'grid_steps'].some(k => pair(value[k]) && value[k].some(n => n <= 0)) ||
    (pair(value.map_min) && pair(value.map_max) && value.map_max.some((n, i) => n <= (value.map_min as number[])[i]))) {
    throw new Error('Invalid map info');
  }
  const info = value as MapInfo;
  const size = info.map_min && info.map_max ? info.map_max.map((n, i) => n - info.map_min![i]) : info.grid_size ?? [65536, 65536];
  const steps = info.grid_steps ?? [6500, 6500];
  if (size.some((n, i) => !Number.isFinite(n / steps[i]) || Math.ceil(n / steps[i]) > 1000000)) throw new Error('Invalid map grid');
  return info;
}

export function parseMission(value: unknown): Mission {
  if (!record(value) || (value.status !== undefined && !text(value.status)) ||
    (value.objectives !== undefined && (!Array.isArray(value.objectives) || value.objectives.length > 1000))) throw new Error('Invalid mission');
  return { status: value.status as string | undefined, objectives: (value.objectives ?? []).filter(v => record(v) &&
    (v.text === undefined || text(v.text, 8192)) && (v.status === undefined || text(v.status)) &&
    (v.primary === undefined || typeof v.primary === 'boolean')) };
}

export function parseGameChat(value: unknown): GameChatRecord[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid game chat');
  return value.filter((v): v is GameChatRecord => record(v) && Number.isSafeInteger(v.id) && Number(v.id) >= 0 &&
    text(v.msg, 8192) && (v.sender === undefined || text(v.sender)) &&
    (v.enemy === undefined || typeof v.enemy === 'boolean') && (v.time === undefined || finite(v.time)));
}

export async function readJson<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 1400);
  try {
    const response = await fetch(`${WT_ORIGIN}${path}`, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`Telemetry returned ${response.status}`);
    return await response.json() as T;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); }
}

// One pending timer per loop, independent of how many hours Vector stays open.
export function startPolling(task: (signal: AbortSignal) => Promise<void>, delay: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    try { if (!controller.signal.aborted) await task(controller.signal); }
    catch { /* A transient local feed failure is retried on the next poll. */ }
    finally { if (!controller.signal.aborted) timer = setTimeout(run, delay); }
  };
  void run();
  return () => { controller.abort(); clearTimeout(timer); };
}
