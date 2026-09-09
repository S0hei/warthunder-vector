'use client';
import { useEffect } from 'react';

export function needsAppReload(boot: { version?: string; instance?: string }, payload: unknown) {
  if (!payload || typeof payload !== 'object') return false;
  const next = payload as Record<string, unknown>;
  if (typeof next.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(next.version) ||
    typeof next.instance !== 'string' || !/^[a-f0-9]{32}$/.test(next.instance)) return false;
  return !!boot.version && !!boot.instance && (next.version !== boot.version || next.instance !== boot.instance);
}

export function useAppUpdates() {
  useEffect(() => {
    const boot = window.__VECTOR__;
    // Development and file-only HTML do not update or reload themselves.
    if (!boot?.version || !boot.instance || boot.origin !== location.origin) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 3000);
      try {
        const response = await fetch('/api/version', { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (response.ok && needsAppReload(boot, await response.json()) && !stopped) { location.reload(); return; }
      } catch { /* The local server is briefly unavailable during a restart. */ }
      finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(poll, 15000); }
    };
    timer = setTimeout(poll, 15000);
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);
}
