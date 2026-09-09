// Conservative parser for the Russian combat messages observed via /hudmsg.
// These are observations, not authoritative player kills or match results.
function participant(text) {
  if (!text.endsWith(')')) return null;
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index--) {
    if (text[index] === ')') depth++;
    if (text[index] !== '(' || --depth !== 0) continue;
    if (text[index - 1] !== ' ') return null;
    const name = text.slice(0, index - 1).trim();
    const vehicle = text.slice(index + 1, -1).trim();
    return name && vehicle ? { name, vehicle } : null;
  }
  return null;
}

function target(text) {
  const explicitlyAi = /^\[(?:ии|ai)\]\s/iu.test(text);
  return {
    text,
    explicitlyAi,
    // Aircraft variants also contain parentheses, e.g. Су-6 (АМ-42).
    // This is only a candidate split, never a verified player identity.
    participantCandidate: explicitlyAi ? null : participant(text),
  };
}

export function parseCombatMessage(message) {
  if (typeof message !== 'string' || message.length > 4096) return null;
  const combat = message.match(/^(.+) (уничтожил|сбил|нанёс критическое повреждение|нанёс фатальное повреждение|destroyed|shot down|critically damaged|severely damaged) (.+)$/u);
  if (combat) {
    const actor = participant(combat[1]);
    if (!actor) return null;
    const actions = {
      'уничтожил': 'destroyed',
      'сбил': 'shot_down',
      'нанёс критическое повреждение': 'critical_damage',
      'нанёс фатальное повреждение': 'severe_damage',
      'destroyed': 'destroyed', 'shot down': 'shot_down', 'critically damaged': 'critical_damage', 'severely damaged': 'severe_damage',
    };
    return {
      action: actions[combat[2]], actor,
      target: target(combat[3]),
    };
  }
  const crashed = message.match(/^(.+) (?:разбился|crashed)$/u);
  if (crashed) {
    const actor = participant(crashed[1]);
    if (actor) return { action: 'crashed', actor, target: null };
  }
  return null;
}

export function collectCombatEvents(snapshots) {
  const seen = new Set();
  const events = [];
  for (const snapshot of snapshots) {
    // Session identity belongs to the caller; retained messages can cross matches.
    if (typeof snapshot.sessionId !== 'string' || !snapshot.sessionId) continue;
    // Only the damage stream has been validated. Other streams may duplicate it.
    for (const record of snapshot.damage ?? []) {
      if (!Number.isInteger(record.id) || typeof record.msg !== 'string') continue;
      // The live feed kept all test-flight messages after a normal battle began.
      // Suppress exact retained records even when the caller's session changes.
      const key = JSON.stringify([record.id, record.time, record.msg]);
      if (seen.has(key)) continue;
      seen.add(key);
      const parsed = parseCombatMessage(record.msg);
      events.push({
        sessionId: snapshot.sessionId, id: record.id, time: record.time,
        message: record.msg, parsed,
      });
    }
  }
  return events;
}
