declare global {
  interface Window { __VECTOR__?: { origin: string; token: string; version?: string; instance?: string; language?: unknown } }
}

export function vectorEndpoint(route: 'battles' | 'activity-teams' | 'language'): { url: string; headers: Record<string, string> } | null {
  const bridge = window.__VECTOR__;
  if (bridge && bridge.origin === location.origin && /^[a-f0-9]{64}$/.test(bridge.token)) {
    return { url: `/api/${route}`, headers: { 'X-Vector-Token': bridge.token } };
  }
  if (process.env.NODE_ENV === 'development') return { url: `/api/vector/${route}`, headers: {} };
  return null;
}
