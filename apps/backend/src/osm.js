import express from 'express';
import { mapArea, mapBounds, osmQuery } from '@echo/sim-core/osm.js';

const ENDPOINTS = ['https://api.openstreetmap.org/api/0.6/map.json', 'https://overpass-api.de/api/interpreter'];

export function createOsmApp({ fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin map requests are not allowed.' });
      } catch {
        return res.status(403).json({ error: 'Invalid request origin.' });
      }
    }
    next();
  });
  app.post('/', express.json({ limit: '2kb' }), async (req, res) => {
    let area;
    try {
      if (!req.body || !['lat', 'lon', 'size'].every(key => Number.isFinite(req.body[key]))) {
        throw new Error('Provide numeric latitude, longitude and tile size.');
      }
      area = mapArea(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const failures = [];
    let upstream = null;
    const onClose = () => {
      if (!res.writableEnded) upstream?.abort(new DOMException('Client disconnected', 'AbortError'));
    };
    res.on('close', onClose);
    try {
      for (const endpoint of ENDPOINTS) {
        if (res.destroyed) return;
        const controller = new AbortController();
        upstream = controller;
        const timeout = setTimeout(() => controller.abort(new DOMException('Map request timed out', 'TimeoutError')), timeoutMs);
        let onAbort;
        const aborted = new Promise((resolve, reject) => {
          onAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
          // Cover both headers and response body, even if an upstream ignores abort.
          const data = await Promise.race([aborted, (async () => {
            const url = new URL(endpoint);
            if (url.hostname === 'api.openstreetmap.org') {
              const [south, west, north, east] = mapBounds(area);
              url.searchParams.set('bbox', [west, south, east, north].join(','));
            } else {
              url.searchParams.set('data', osmQuery(area));
            }
            const response = await fetchImpl(url, {
              headers: { Accept: 'application/json', 'User-Agent': 'echo-acoustics-simulator/1.0' },
              signal: controller.signal
            });
            controller.signal.throwIfAborted();
            if (!response.ok) {
              await response.body?.cancel();
              throw new Error(`HTTP ${response.status}`);
            }
            const chunks = [];
            let bytes = 0;
            for await (const chunk of response.body) {
              controller.signal.throwIfAborted();
              bytes += chunk.length;
              if (bytes > 16 * 1024 * 1024) throw new Error('Map response exceeds 16 MB. Choose a smaller tile.');
              chunks.push(chunk);
            }
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!Array.isArray(data?.elements)) throw new Error('Invalid map response');
            if (data.remark) throw new Error('Overpass query incomplete. Try a smaller tile.');
            return data;
          })()]);
          if (res.destroyed) return;
          return res.set('Cache-Control', 'no-store').json(data);
        } catch (err) {
          if (res.destroyed) return;
          const reason = err.name === 'TimeoutError' ? 'timed out' : err.message;
          const failure = `${new URL(endpoint).hostname}: ${reason}`;
          console.warn(`OpenStreetMap request failed (${failure})`);
          failures.push(failure);
        } finally {
          clearTimeout(timeout);
          controller.signal.removeEventListener('abort', onAbort);
        }
      }
      res.status(502).json({ error: `OpenStreetMap servers unavailable (${failures.join('; ')}). Try again or choose a smaller tile.` });
    } finally {
      res.removeListener('close', onClose);
    }
  });
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Map request is too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid map request JSON.' });
    next(err);
  });
  return app;
}
