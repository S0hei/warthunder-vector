'use client';
import { useEffect, useState } from 'react';
import { parseGameChat, parseMapInfo, parseMapObjects, parseMission, readJson, startPolling } from './lib/telemetry';
import type { GameChatRecord, MapInfo, MapObject, Mission } from './lib/telemetry';

export type TeamMessage = GameChatRecord & { receivedAt: number; referenceTime: number };

export function useWarThunderFeed() {
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [mapInfo, setMapInfo] = useState<MapInfo>({ valid: false, map_generation: 0 });
  const [mapInfoUpdatedAt, setMapInfoUpdatedAt] = useState(0);
  const [mapRevision, setMapRevision] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [everConnected, setEverConnected] = useState(false);
  const [trail, setTrail] = useState<{ x: number; y: number }[]>([]);
  const [mission, setMission] = useState<Mission>({});
  const [teamMessages, setTeamMessages] = useState<TeamMessage[]>([]);

  useEffect(() => {
    let lastChatId = 0, revision = 0;
    let currentMap: { generation: number; valid: boolean } | null = null;
    const stopObjects = startPolling(async signal => {
      const requestedRevision = revision;
      const payload = await readJson('/map_obj.json', signal);
      if (signal.aborted || requestedRevision !== revision) return;
      const nextObjects = currentMap?.valid === false ? [] : parseMapObjects(payload);
      setObjects(nextObjects);
      const player = nextObjects.find(object => object.icon?.toLowerCase() === 'player');
      if (player?.x != null && player.y != null) {
        const point = { x: player.x, y: player.y };
        setTrail(previous => {
          const last = previous.at(-1);
          return last && Math.hypot(last.x - point.x, last.y - point.y) < 0.00045 ? previous : [...previous, point].slice(-160);
        });
      }
      setLastUpdate(Date.now()); setEverConnected(true);
    }, 100);

    const stopInfo = startPolling(async signal => {
      const nextInfo = parseMapInfo(await readJson('/map_info.json', signal));
      if (signal.aborted) return;
      const nextMap = { generation: nextInfo.map_generation ?? 0, valid: nextInfo.valid === true };
      if (!currentMap || currentMap.generation !== nextMap.generation || currentMap.valid !== nextMap.valid) {
        // Discard responses already in flight when the game changes maps or enters the hangar.
        revision++; lastChatId = 0; setMapRevision(revision);
        setObjects([]); setTeamMessages([]); setMission({}); setTrail([]);
      }
      currentMap = nextMap;
      setMapInfo(nextInfo); setMapInfoUpdatedAt(Date.now());
    }, 2500);

    const stopMission = startPolling(async signal => {
      const requestedRevision = revision;
      const nextMission = parseMission(await readJson('/mission.json', signal));
      if (!signal.aborted && requestedRevision === revision) setMission(nextMission);
    }, 1000);

    const stopChat = startPolling(async signal => {
      const requestedRevision = revision;
      const records = parseGameChat(await readJson(`/gamechat?lastId=${lastChatId}`, signal));
      if (signal.aborted || requestedRevision !== revision || records.length === 0) return;
      lastChatId = records.reduce((last, record) => Math.max(last, record.id), lastChatId);
      const receivedAt = Date.now();
      const referenceTime = records.reduce((last, record) => Math.max(last, record.time ?? 0), 0);
      const enriched = records.filter(record => !record.enemy).map(record => ({ ...record, receivedAt, referenceTime }));
      setTeamMessages(previous => {
        const known = new Set(previous.map(record => record.id));
        return [...previous, ...enriched.filter(record => {
          if (known.has(record.id)) return false;
          known.add(record.id); return true;
        })].slice(-30);
      });
    }, 750);
    return () => { stopObjects(); stopInfo(); stopMission(); stopChat(); };
  }, []);
  return { objects, mapInfo, mapInfoUpdatedAt, mapRevision, lastUpdate, everConnected, trail, mission, teamMessages };
}
