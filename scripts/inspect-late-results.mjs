// Opt-in read-only diagnostic. Never prints or saves decoded lines, credentials,
// account identities, player names, notification bodies, or network payloads.
import { readFile, readdir, lstat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const resultFields = ['wpEarned', 'xpEarned', 'rpEarned', 'EULT_SESSION_RESULT',
  'session_result', 'BattleEnded', 'roomId', 'UserLogStorage', 'getUserLogsList'];

export function inspectDecodedLog(decoded) {
  const lines = decoded.split(/\r?\n/);
  const fields = Object.fromEntries(resultFields.map(field => [field, 0]));
  const matches = [], byId = new Map(), unattributedRewards = [];
  let current = null, ended = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (const field of resultFields) if (line.includes(field)) fields[field]++;
    const stamp = /^\s*([0-9]+\.[0-9]+)\s/.exec(line);
    if (!stamp) continue;
    const seconds = Number(stamp[1]);
    const joinMatch = /AcesMpContext: AcesApp::onJoinMatch : sessionId:([0-9a-f]{8,32})\s*$/.exec(line);
    if (joinMatch) {
      current = { id: joinMatch[1], joined: seconds, ended: null, endingCode: null, rewards: [], statuses: [], lastReference: seconds, lateReferences: 0, lateFields: {} };
      const decimal = BigInt(`0x${current.id}`).toString();
      const reference = new RegExp(`(^|[^A-Za-z0-9_])(?:${current.id}|${decimal})($|[^A-Za-z0-9_])`);
      byId.set(current.id, { match: current, reference }); matches.push(current); ended = null;
    }
    for (const { match, reference } of byId.values()) {
      if (!reference.test(line)) continue;
      match.lastReference = seconds;
      if (match.ended !== null && seconds > match.ended + 3) {
        match.lateReferences++;
        for (const field of resultFields) if (line.includes(field)) match.lateFields[field] = (match.lateFields[field] ?? 0) + 1;
      }
    }
    const target = current ?? (ended && seconds >= ended.ended && seconds - ended.ended < 3 ? ended : null);
    const reward = /\[D\]\s+received SessionStats sum (WP|EXP):.*\btotal\[(-?[0-9]{1,10})\]\s*$/.exec(line);
    if (reward) {
      const value = { seconds, currency: reward[1], total: Number(reward[2]) };
      (target ? target.rewards : unattributedRewards).push(value);
    }
    const end = /\[D\]\s+AcesMission::endFinally ([0-9]+) /.exec(line);
    if (end && target) { target.ended = seconds; target.endingCode = Number(end[1]); ended = target; current = null; }
    const status = /\[D\]\s+AcesMission::setStatus MISSION_STATUS_RUNNING -> MISSION_STATUS_(SUCCESS|FAIL)\s*$/.exec(line);
    if (status && target) target.statuses.push({ seconds, outcome: status[1] });
  }
  return { lineCount: lines.length, fields, matches, unattributedRewards };
}

async function main() {
  const folder = process.argv[2];
  if (!folder) throw new Error('Provide the game .game_logs directory');
  if (basename(resolve(folder)) !== '.game_logs') throw new Error('Only a .game_logs directory may be inspected');
  const source = await readFile(new URL('../native/GameFiles.cs', import.meta.url), 'utf8');
  const key = source.match(/XorKey = \{ ([0-9,]+) \}/)?.[1].split(',').map(Number);
  if (!key || key.length !== 128) throw new Error('Published log-format key unavailable');
  const files = [];
  for (const name of await readdir(folder)) {
    if (!/^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}__\d+\.clog$/.test(name)) continue;
    const stat = await lstat(join(folder, name));
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 128 * 1024 * 1024) continue;
    files.push({ name, modified: stat.mtimeMs });
  }
  for (const file of files.sort((a, b) => b.modified - a.modified).slice(0, 8)) {
    const data = await readFile(join(folder, file.name));
    for (let index = 0; index < data.length; index++) data[index] ^= key[index % key.length];
    const result = inspectDecodedLog(data.toString('utf8'));
    data.fill(0);
    process.stdout.write(JSON.stringify({ file: file.name, ...result }) + '\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
