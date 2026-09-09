// Development-only, same-origin proxy to the installed local collector. Never
// forward a browser-selected destination, credentials, filesystem path or headers.
export function allowedVectorRequest(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) return false;
  return (!req.headers.origin || req.headers.origin === `http://${host}`) && req.headers['sec-fetch-site'] !== 'cross-site';
}
export function vectorDevBridge() {
  return { name: 'vector-local-collector', apply: 'serve', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const route = { '/api/vector/battles': '/api/battles', '/api/vector/activity-teams': '/api/activity-teams', '/api/vector/language': '/api/language' }[req.url];
      if (!route) return next();
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method !== 'GET' || !allowedVectorRequest(req)) { res.statusCode = 403; res.end(); return; }
      try {
        const origin = 'http://127.0.0.1:8112';
        const bootstrap = await fetch(origin, { signal: AbortSignal.timeout(2000), redirect: 'error' });
        if (!bootstrap.ok) throw new Error('Collector offline');
        const html = await bootstrap.text();
        const token = /window\.__VECTOR__=\{origin:'http:\/\/127\.0\.0\.1:8112',token:'([a-f0-9]{64})'(?=[,}])/.exec(html)?.[1];
        if (!token) throw new Error('No collector bootstrap');
        const result = await fetch(`${origin}${route}`, { headers: { 'X-Vector-Token': token }, signal: AbortSignal.timeout(2000), redirect: 'error' });
        if (!result.ok) throw new Error('Collector not updated');
        res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(await result.text());
      } catch { res.statusCode = 503; res.end('{"error":"collector-offline"}'); }
    });
  } };
}
