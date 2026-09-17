'use client';

import { useEffect, useState } from 'react';
import { decodeFileBattles } from './lib/file-battles';
import type { FileBattle } from './lib/file-battles';
import { vectorEndpoint } from './lib/vector-bridge';

export type FileArchive = { connection: 'connecting' | 'connected' | 'offline' | 'standalone'; status: string; paused: boolean;
  startedAt: string | null; unreadable: number; rejected: number; skippedReplays?: number; battles: FileBattle[] };

export function useFileArchive() {
  const [archive, setArchive] = useState<FileArchive>({ connection: 'connecting', status: 'searching', paused: false, startedAt: null, unreadable: 0, rejected: 0, battles: [] });
  useEffect(() => {
    const endpoint = vectorEndpoint('battles');
    let stopped = false, etag = ''; let timer: ReturnType<typeof setTimeout>; let controller: AbortController;
    const poll = async () => {
      if (!endpoint) { if (!stopped) setArchive(old => ({ ...old, connection: 'standalone' })); return; }
      controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(endpoint.url, {
          headers: { ...endpoint.headers, ...(etag ? { 'If-None-Match': etag } : {}) },
          signal: controller.signal, cache: 'no-store', credentials: 'omit',
        });
        if (stopped) return;
        if (response.status === 304) { setArchive(old => ({ ...old, connection: 'connected' })); return; }
        if (!response.ok) throw new Error('Collector unavailable');
        const payload = await response.json();
        if (!payload || typeof payload !== 'object') throw new Error('Invalid collector response');
        const p = payload as Record<string, unknown>;
        if (p.schemaVersion !== 1 || typeof p.status !== 'string' || typeof p.paused !== 'boolean' ||
          typeof p.startedAt !== 'string' || !Number.isFinite(Date.parse(p.startedAt)) || typeof p.unreadable !== 'number' || !Number.isSafeInteger(p.unreadable) || p.unreadable < 0) throw new Error('Invalid collector response');
        const decoded = decodeFileBattles(p.battles);
        const skippedReplays = p.skippedReplays === undefined ? 0 : p.skippedReplays;
        if (typeof skippedReplays !== 'number' || !Number.isSafeInteger(skippedReplays) || skippedReplays < 0 || skippedReplays > 200) throw new Error('Invalid collector response');
        if (!stopped) { etag = response.headers.get('ETag') ?? ''; setArchive({ connection: 'connected', status: p.status, paused: p.paused, startedAt: p.startedAt, unreadable: p.unreadable, skippedReplays, ...decoded }); }
      } catch { if (!stopped) setArchive(old => ({ ...old, connection: 'offline' })); }
      finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(poll, 3000); }
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  return archive;
}
