// /api/simulations: save, list, open and version simulator scenarios together with their last results.
import express from 'express';
import { validateScenario } from '@echo/sim-core/scenario.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = 'invalid_request';
  }
}

function text(value, field, { required = false, max }) {
  if (value == null) {
    if (required) throw new BadRequest(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new BadRequest(`${field} must be a string`);
  const out = value.trim();
  if (required && !out) throw new BadRequest(`${field} must not be empty`);
  if (out.length > max) throw new BadRequest(`${field} must be at most ${max} characters`);
  return out;
}

function scenarioOf(raw) {
  try {
    return validateScenario(raw);
  } catch (err) {
    throw new BadRequest(`scenario: ${err.message}`);
  }
}

function resultsOf(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw) || !raw.every((r) => r && typeof r === 'object' && typeof r.source_id === 'string')) {
    throw new BadRequest('results must be an array of per-source results');
  }
  return raw;
}

export function summarise(scenario, results) {
  const env = scenario.environment;
  return {
    nodes: scenario.nodes.length,
    sources: scenario.sources.length,
    buildings: scenario.buildings.length,
    environment: env ? { kind: env.kind, name: env.name ?? null, lat: env.lat, lon: env.lon } : null,
    has_results: !!results,
    located: results ? results.filter((r) => r.error_3d_m != null).length : null
  };
}

function versionInput(body) {
  const scenario = scenarioOf(body.scenario);
  const results = resultsOf(body.results);
  const note = text(body.note, 'note', { max: 500 }) ?? '';
  const size_bytes = Buffer.byteLength(JSON.stringify(scenario)) + (results ? Buffer.byteLength(JSON.stringify(results)) : 0);
  return { scenario, results, note, summary: summarise(scenario, results), size_bytes };
}

function idParam(req) {
  if (!UUID.test(req.params.id)) throw new BadRequest('invalid simulation id');
  return req.params.id;
}

function versionParam(value) {
  if (value == null) return undefined;
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1) throw new BadRequest('version must be a positive integer');
  return v;
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export function simulationsRouter(store, { maxBodyBytes = 25 * 1024 * 1024 } = {}) {
  const router = express.Router();
  const json = express.json({ limit: maxBodyBytes });

  router.get('/', wrap(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const q = text(req.query.q, 'q', { max: 200 }) ?? '';
    res.json({ simulations: await store.list({ limit, offset, q }) });
  }));

  router.post('/', json, wrap(async (req, res) => {
    const body = req.body ?? {};
    const name = text(body.name, 'name', { required: true, max: 200 });
    const description = text(body.description, 'description', { max: 2000 }) ?? '';
    res.status(201).json(await store.create({ name, description, ...versionInput(body) }));
  }));

  router.get('/:id', wrap(async (req, res) => {
    res.json(await store.get(idParam(req), versionParam(req.query.version)));
  }));

  router.patch('/:id', json, wrap(async (req, res) => {
    const id = idParam(req);
    const body = req.body ?? {};
    const name = text(body.name, 'name', { max: 200 });
    if (name === '') throw new BadRequest('name must not be empty');
    const description = text(body.description, 'description', { max: 2000 });
    res.json(await store.update(id, { name, description }));
  }));

  router.delete('/:id', wrap(async (req, res) => {
    await store.remove(idParam(req));
    res.status(204).end();
  }));

  router.get('/:id/versions', wrap(async (req, res) => {
    res.json({ versions: await store.versions(idParam(req)) });
  }));

  router.get('/:id/versions/:version', wrap(async (req, res) => {
    res.json(await store.get(idParam(req), versionParam(req.params.version)));
  }));

  router.post('/:id/versions', json, wrap(async (req, res) => {
    const id = idParam(req);
    const body = req.body ?? {};
    const base_version = body.base_version == null ? undefined : versionParam(body.base_version);
    res.status(201).json(await store.addVersion(id, { base_version, ...versionInput(body) }));
  }));

  router.use((err, req, res, next) => {
    if (err.status && err.code && err.status < 500) {
      res.status(err.status).json({ error: err.code, message: err.message, ...(err.latest_version ? { latest_version: err.latest_version } : {}) });
      return;
    }
    next(err);
  });

  return router;
}
