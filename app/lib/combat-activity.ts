import { parseCombatMessage } from './combat-events.mjs';

export type CombatAction = 'destroyed' | 'shot_down' | 'critical_damage' | 'severe_damage' | 'crashed';
export type CombatTeam = 'ally' | 'enemy' | 'self' | 'unknown';
export type CombatParty = { name: string | null; vehicle: string; team: CombatTeam };
export type CombatRecord = { id: number; time: number; msg: string };
type MapIdentity = { valid: boolean; map_generation?: number };
export type ActivitySample = { before: unknown; after: unknown; hud: unknown };
export type CombatEvent = {
  key: string;
  recordId: number;
  actorKey: string;
  action: CombatAction;
  message: string;
  time: number;
  explicitlyAi: boolean;
  actor: CombatParty;
  target: CombatParty | null;
  observedAt: number;
};
export type CombatRow = Record<CombatAction, number> & {
  key: string;
  name: string;
  vehicle: string;
  team: CombatTeam;
  aiDestroyed: number;
  aiShotDown: number;
  lastObservedAt: number;
};
export type CombatParticipant = CombatParty & {
  name: string;
  time: number;
  recordId: number;
  observedAt: number;
  eventKey: string;
  role: 'actor' | 'target';
  vehicleSince: { time: number; recordId: number };
  lastDamage: { action: CombatAction; time: number; recordId: number; observedAt: number } | null;
};
export type CombatActivity = {
  status: 'waiting' | 'live' | 'paused' | 'offline';
  startedAt: number | null;
  lastUpdate: number | null;
  eventCount: number;
  rows: CombatRow[];
  recent: CombatEvent[];
  participants: CombatParticipant[];
};

export function emptyCombatActivity(): CombatActivity {
  return { status: 'waiting', startedAt: null, lastUpdate: null, eventCount: 0, rows: [], recent: [], participants: [] };
}

function mapIdentity(value: unknown): MapIdentity {
  if (!value || typeof value !== 'object' || !('valid' in value) || typeof value.valid !== 'boolean') {
    throw new Error('Invalid combat map response');
  }
  if (!value.valid) return { valid: false };
  if (!('map_generation' in value) || !Number.isSafeInteger(value.map_generation)) {
    throw new Error('Missing combat map generation');
  }
  return { valid: true, map_generation: value.map_generation as number };
}

function damageRecords(hud: unknown): CombatRecord[] {
  if (!hud || typeof hud !== 'object' || !('damage' in hud) || !Array.isArray(hud.damage)) {
    throw new Error('Invalid combat feed response');
  }
  return hud.damage.filter((record): record is CombatRecord => (
    record != null && typeof record === 'object' &&
    Number.isSafeInteger(record.id) && record.id >= 0 &&
    typeof record.time === 'number' && Number.isFinite(record.time) && record.time >= 0 &&
    typeof record.msg === 'string' && record.msg.length <= 4096
  ));
}

function recordKey(record: CombatRecord) {
  return JSON.stringify([record.id, record.time, record.msg]);
}

// One tracker per open page, not a daily ledger or a final battle scoreboard.
// Full HUD snapshots let a short polling delay recover the game's retained events.
export class CombatActivityTracker {
  private activity = emptyCombatActivity();
  private activeGeneration: number | null = null;
  private needsBaseline = true;
  private highestId = -1;
  private seen = new Set<string>();
  private rows = new Map<string, CombatRow>();
  private participants = new Map<string, CombatParticipant>();

  private observeParticipant(event: CombatEvent, role: 'actor' | 'target', rosterConfirmed = false) {
    const party = event[role];
    if (!party?.name || /^\[(?:ai|ии)\]\s/iu.test(party.name)) return;
    // A target's parentheses alone do not establish a pilot name. Accept a
    // roster-confirmed target, or an exact name already observed as an actor.
    if (role === 'target' && !rosterConfirmed && !this.participants.has(party.name)) return;
    const previous = this.participants.get(party.name);
    const compare = (a: { time: number; recordId: number }, b: { time: number; recordId: number }) => a.time - b.time || a.recordId - b.recordId;
    const received = role === 'target' || event.action === 'crashed';
    const damage = received ? { action: event.action, time: event.time, recordId: event.recordId, observedAt: event.observedAt } : null;
    if (previous && compare(event, previous) < 0) {
      // A delayed team annotation can identify an earlier hit. It may update
      // damage for the same observed aircraft, never a later aircraft/life.
      if (damage && previous.vehicle === party.vehicle && compare(event, previous.vehicleSince) >= 0 &&
          (!previous.lastDamage || compare(event, previous.lastDamage) > 0)) {
        this.participants.set(party.name, { ...previous, lastDamage: damage });
      }
      return;
    }
    if (previous && event.time === previous.time && event.recordId === previous.recordId && previous.eventKey !== event.key) return;
    if (!previous && this.participants.size >= 256) return;
    const sameVehicle = previous?.vehicle === party.vehicle;
    const lastDamage = sameVehicle ? previous.lastDamage : null;
    this.participants.set(party.name, { ...party, name: party.name, time: event.time, recordId: event.recordId,
      observedAt: event.observedAt, eventKey: event.key, role,
      vehicleSince: sameVehicle ? previous.vehicleSince : { time: event.time, recordId: event.recordId },
      lastDamage: damage && (!lastDamage || compare(damage, lastDamage) >= 0) ? damage : lastDamage });
  }

  private participantSnapshot() {
    return [...this.participants.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  snapshot(): CombatActivity {
    return this.activity;
  }

  annotate(payload: unknown): CombatActivity {
    if (!payload || typeof payload !== 'object') return this.activity;
    const p = payload as { schemaVersion?: unknown; sessionId?: unknown; events?: unknown };
    if (p.schemaVersion !== 1 || typeof p.sessionId !== 'string' || !/^[a-f0-9]{8,32}$/.test(p.sessionId) || !Array.isArray(p.events) || p.events.length > 128) return this.activity;
    const valid = p.events.filter((e): e is { message: string; observedAt: string; actorTeam: CombatTeam; targetTeam: CombatTeam; targetInRoster?: boolean } =>
      !!e && typeof e === 'object' && typeof e.message === 'string' && e.message.length <= 4096 &&
      typeof e.observedAt === 'string' && Number.isFinite(Date.parse(e.observedAt)) &&
      ['ally', 'enemy', 'self', 'unknown'].includes(e.actorTeam) && ['ally', 'enemy', 'self', 'unknown'].includes(e.targetTeam));
    const normalized = (s: string) => s.replace(/\s+/gu, ' ').trim();
    const recent = this.activity.recent.map(event => {
      // Match the actual observed message within a narrow wall-clock window.
      // Historical backfills and retained messages cannot color a new sortie.
      const matches = valid.filter(e => normalized(e.message) === normalized(event.message) &&
        Date.parse(e.observedAt) >= (this.activity.startedAt ?? Infinity) - 5000 && Math.abs(Date.parse(e.observedAt) - event.observedAt) < 15000);
      if (!matches.length) return event;
      const actorTeams = new Set(matches.map(e => e.actorTeam)), targetTeams = new Set(matches.map(e => e.targetTeam));
      const annotated = { ...event, actor: { ...event.actor, team: actorTeams.size === 1 ? matches[0].actorTeam : 'unknown' as const },
        target: event.target ? { ...event.target, team: targetTeams.size === 1 ? matches[0].targetTeam : 'unknown' as const } : null };
      this.observeParticipant(annotated, 'actor');
      this.observeParticipant(annotated, 'target', matches.every(e => e.targetInRoster === true));
      return annotated;
    });
    for (const event of recent) {
      const row = this.rows.get(event.actorKey);
      if (row) this.rows.set(event.actorKey, { ...row, team: event.actor.team });
    }
    this.activity = { ...this.activity, recent, rows: this.activity.rows.map(row => this.rows.get(row.key) ?? row), participants: this.participantSnapshot() };
    return this.activity;
  }

  disconnected(): CombatActivity {
    // The game may restart or change maps during an outage. Never join those
    // observations into one apparent battle, even if its generation is reused.
    this.needsBaseline = true;
    this.activity = { ...this.activity, status: 'offline' };
    return this.activity;
  }

  ingest(sample: ActivitySample, now: number): CombatActivity {
    const before = mapIdentity(sample.before);
    const after = mapIdentity(sample.after);
    const records = damageRecords(sample.hud);
    const maximumId = records.reduce((maximum, record) => Math.max(maximum, record.id), -1);
    const coherent = before.valid === after.valid && before.map_generation === after.map_generation;
    const generation = after.valid ? after.map_generation! : null;
    const restarted = maximumId >= 0 && maximumId < this.highestId;
    const baseline = this.needsBaseline || !coherent || generation !== this.activeGeneration || restarted;

    if (generation !== null && baseline) {
      this.rows.clear();
      this.participants.clear();
      this.activity = { ...emptyCombatActivity(), startedAt: now };
    }

    if (baseline) {
      // A first/transition buffer may contain another sortie's messages. Seed
      // deduplication, but do not claim those messages belong to this observation.
      this.seen = new Set(records.map(recordKey));
    } else if (generation !== null) {
      const recent = [...this.activity.recent];
      let eventCount = this.activity.eventCount;
      for (const record of records) {
        const key = recordKey(record);
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        const parsed = parseCombatMessage(record.msg);
        if (!parsed) continue;
        const action = parsed.action as CombatAction;
        const actorKey = JSON.stringify([parsed.actor.name, parsed.actor.vehicle]);
        const previous = this.rows.get(actorKey) ?? {
          key: actorKey, name: parsed.actor.name, vehicle: parsed.actor.vehicle, team: 'unknown' as const,
          destroyed: 0, shot_down: 0, critical_damage: 0, severe_damage: 0, crashed: 0,
          aiDestroyed: 0, aiShotDown: 0, lastObservedAt: now,
        };
        const explicitlyAi = parsed.target?.explicitlyAi ?? false;
        const row = { ...previous, [action]: previous[action] + 1, lastObservedAt: now };
        if (explicitlyAi && action === 'destroyed') row.aiDestroyed++;
        if (explicitlyAi && action === 'shot_down') row.aiShotDown++;
        this.rows.set(actorKey, row);
        const event: CombatEvent = { key, recordId: record.id, actorKey, action, message: record.msg, time: record.time, explicitlyAi, observedAt: now,
          actor: { ...parsed.actor, team: previous.team }, target: parsed.target ? {
            name: parsed.target.participantCandidate?.name ?? null,
            vehicle: parsed.target.participantCandidate?.vehicle ?? parsed.target.text,
            team: 'unknown',
          } : null };
        recent.push(event);
        this.observeParticipant(event, 'actor');
        this.observeParticipant(event, 'target');
        eventCount++;
      }
      this.activity = {
        ...this.activity, eventCount, recent: recent.slice(-60), participants: this.participantSnapshot(),
        rows: [...this.rows.values()].sort((a, b) => b.lastObservedAt - a.lastObservedAt || a.name.localeCompare(b.name)),
      };
    } else {
      // Drain the retained buffer in the hangar without changing the last table.
      for (const record of records) this.seen.add(recordKey(record));
    }

    // Keep the current HUD buffer plus recent fingerprints, not an unbounded log.
    if (this.seen.size > 8192) this.seen = new Set([...this.seen].slice(-8192));
    this.highestId = baseline ? maximumId : Math.max(this.highestId, maximumId);
    this.activeGeneration = generation;
    this.needsBaseline = !coherent;
    this.activity = {
      ...this.activity,
      status: generation === null ? (this.activity.startedAt === null ? 'waiting' : 'paused') : 'live',
      lastUpdate: now,
    };
    return this.activity;
  }
}
