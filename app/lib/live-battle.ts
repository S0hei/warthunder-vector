export type LiveBattleStatus = { alliesAlive: number | null; enemiesAlive: number | null; clockStartedAt: number | null; scannedAt: number };
type RecordTime = { id: number; time: number; msg: string };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown) => typeof v === 'string' && v.length <= 40 ? Date.parse(v) : NaN;
const count = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 256);
const normalized = (s: string) => s.replace(/\s+/gu, ' ').trim();
export const BATTLE_STATUS_FRESH_MS = 15000;

// Ephemeral roster and mission-clock information. Never count map markers or
// treat a browser's launch time as the beginning of the battle.
export class LiveBattleTracker {
  private generation: number | null | undefined;
  private session: string | null = null;
  private blockedSession: string | null = null;
  private records: RecordTime[] = [];
  private highestRecordId = -1;
  private status: LiveBattleStatus | null = null;
  observe(before: unknown, hud: unknown, after: unknown) {
    const validMap = (v: unknown) => object(v) && v.valid === true && typeof v.map_generation === 'number' && Number.isSafeInteger(v.map_generation) && v.map_generation >= 0;
    const generation = validMap(before) && validMap(after) && (before as Record<string, unknown>).map_generation === (after as Record<string, unknown>).map_generation
      ? (after as { map_generation: number }).map_generation : null;
    if (this.generation !== undefined && generation !== this.generation) {
      this.blockedSession = this.session; this.status = null; this.highestRecordId = -1;
    }
    this.generation = generation;
    this.records = [];
    if (generation === null) { this.status = null; return; }
    if (!object(hud)) return;
    for (const key of ['events', 'damage']) {
      const values = hud[key];
      if (!Array.isArray(values) || values.length > 10000) continue;
      for (const value of values) {
        if (object(value) && Number.isSafeInteger(value.id) && typeof value.time === 'number' && Number.isFinite(value.time) && value.time >= 0 && value.time <= 86400 &&
          typeof value.msg === 'string' && value.msg.length <= 4096) this.records.push(value as RecordTime);
      }
    }
    const highest = this.records.reduce((id, record) => Math.max(id, record.id), -1);
    if (highest >= 0 && highest < this.highestRecordId) { this.blockedSession = this.session; this.status = null; }
    if (highest >= 0) this.highestRecordId = highest;
  }
  annotate(payload: unknown, now: number) {
    if (this.generation == null || !object(payload) || payload.schemaVersion !== 1 || typeof payload.sessionId !== 'string' || !/^[a-f0-9]{8,32}$/.test(payload.sessionId)) return;
    const summary = payload.summary, scannedAt = date(payload.scannedAt);
    if (payload.sessionId === this.blockedSession || !object(summary) || summary.active !== true || !count(summary.alliesAlive) || !count(summary.enemiesAlive) ||
      !Number.isFinite(scannedAt) || scannedAt > now + 2000 || now - scannedAt > BATTLE_STATUS_FRESH_MS) { this.status = null; return; }
    const joinedAt = date(summary.joinedAt);
    if (!Number.isFinite(joinedAt) || joinedAt > now + 2000 || now - joinedAt > 86400000) { this.status = null; return; }
    let clockStartedAt = payload.sessionId === this.session ? this.status?.clockStartedAt ?? null : null;
    let newest = -Infinity;
    if (Array.isArray(payload.events) && payload.events.length <= 128) {
      for (const event of payload.events) {
        if (!object(event) || typeof event.message !== 'string' || event.message.length > 4096) continue;
        const observedAt = date(event.observedAt);
        if (!Number.isFinite(observedAt) || observedAt < joinedAt || observedAt > now + 2000 || observedAt < newest) continue;
        const message = normalized(event.message);
        const matches = this.records.filter(r => normalized(r.msg) === message);
        if (!matches.length) continue;
        const record = matches.reduce((a, b) => a.id > b.id ? a : b);
        const start = observedAt - record.time * 1000;
        if (start > now + 2000 || now - start > 86400000) continue;
        newest = observedAt; clockStartedAt = start;
      }
    }
    this.session = payload.sessionId;
    this.status = { alliesAlive: summary.alliesAlive, enemiesAlive: summary.enemiesAlive, clockStartedAt, scannedAt };
  }
  snapshot(now: number) { return this.status && now - this.status.scannedAt <= BATTLE_STATUS_FRESH_MS ? this.status : null; }
  disconnected() { this.status = null; this.records = []; }
}

export function battleClock(startedAt: number | null, now: number): string | null {
  if (startedAt === null || !Number.isFinite(startedAt) || !Number.isFinite(now) || now < startedAt - 2000 || now - startedAt > 86400000) return null;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
