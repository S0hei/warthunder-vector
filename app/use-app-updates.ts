'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type AppUpdateStatus = { state: 'idle' | 'ready' | 'restarting' | 'failed'; version: string | null; error: 'battle-active' | 'install-failed' | 'rolled-back' | null };
export function parseUpdateStatus(value: unknown): AppUpdateStatus | null {
  if (!value || typeof value !== 'object') return null;
  const next = value as AppUpdateStatus;
  if (!['idle', 'ready', 'restarting', 'failed'].includes(next.state) ||
    (next.version !== null && (typeof next.version !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(next.version))) ||
    (next.state !== 'idle' && !next.version) ||
    ![null, 'battle-active', 'install-failed', 'rolled-back'].includes(next.error)) return null;
  return { state: next.state, version: next.version, error: next.error };
}

export function needsAppReload(boot: { version?: string; instance?: string }, payload: unknown) {
  if (!payload || typeof payload !== 'object') return false;
  const next = payload as Record<string, unknown>;
  if (typeof next.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(next.version) ||
    typeof next.instance !== 'string' || !/^[a-f0-9]{32}$/.test(next.instance)) return false;
  return !!boot.version && !!boot.instance && (next.version !== boot.version || next.instance !== boot.instance);
}

export function useAppUpdates() {
  const [update, setUpdate] = useState<AppUpdateStatus | null>(null);
  const [requesting, setRequesting] = useState(false), [requestError, setRequestError] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const revision = useRef(0), mounted = useRef(false), request = useRef<AbortController | null>(null);
  useEffect(() => {
    const boot = window.__VECTOR__;
    // Development and file-only HTML do not update or reload themselves.
    if (!boot?.version || !boot.instance || boot.origin !== location.origin) return;
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      const atRevision = revision.current;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 5000);
      try {
        const response = await fetch('/api/version', { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (response.ok && needsAppReload(boot, await response.json()) && !stopped) { stopped = true; location.reload(); return; }
        if (boot.updates && /^[a-f0-9]{64}$/.test(boot.token)) {
          const status = await fetch('/api/updates', { headers: { 'X-Vector-Token': boot.token }, cache: 'no-store', credentials: 'omit', signal: controller.signal });
          const next = status.ok ? parseUpdateStatus(await status.json()) : null;
          if (next && !stopped && revision.current === atRevision && !request.current) {
            setUpdate(next);
            if (next.state === 'restarting') setRequestError(false);
            else setReconnectFailed(false);
          }
        }
      } catch { /* The local server is briefly unavailable during a restart. */ }
      finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(poll, boot.updates ? 3000 : 15000); }
    };
    void poll();
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); controller?.abort(); request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (update?.state !== 'restarting') return;
    const timeout = setTimeout(() => setReconnectFailed(true), 90000);
    return () => clearTimeout(timeout);
  }, [update?.state]);
  const restart = useCallback(async () => {
    const boot = window.__VECTOR__;
    if (!mounted.current || request.current || update?.state !== 'ready' || !boot?.updates || boot.origin !== location.origin || !/^[a-f0-9]{64}$/.test(boot.token)) return;
    revision.current++;
    const controller = new AbortController(); request.current = controller;
    setRequesting(true); setRequestError(false); setReconnectFailed(false);
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/api/updates/restart', { method: 'POST', headers: { 'X-Vector-Token': boot.token }, cache: 'no-store', credentials: 'omit', signal: controller.signal });
      const next = parseUpdateStatus(await response.json());
      if (!next || (!response.ok && response.status !== 409)) throw new Error('Restart not accepted');
      if (mounted.current) setUpdate(next);
    } catch { if (mounted.current) setRequestError(true); }
    finally { clearTimeout(timeout); request.current = null; if (mounted.current) setRequesting(false); }
  }, [update]);
  return { update, requesting, requestError, reconnectFailed, restart };
}
