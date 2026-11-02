// /api/library/:kind: user-created mic array and sound models for the simulator.
import express from 'express';
import { validateArrayModel } from '@echo/sim-core/arrays.js';
import { validateSoundModel } from '@echo/sim-core/sounds.js';

const VALIDATORS = { arrays: ['array', validateArrayModel], sounds: ['sound', validateSoundModel] };
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.code = 'invalid_request';
  }
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

export function libraryRouter(store, { maxBodyBytes = 25 * 1024 * 1024 } = {}) {
  const router = express.Router();
  const json = express.json({ limit: maxBodyBytes });

  router.param('kind', (req, res, next, value) => {
    if (!Object.hasOwn(VALIDATORS, value)) return res.status(404).json({ error: 'not_found', message: 'unknown library' });
    req.libKind = VALIDATORS[value][0];
    req.libValidate = VALIDATORS[value][1];
    next();
  });

  router.get('/:kind', wrap(async (req, res) => {
    res.json({ models: await store.listModels(req.libKind) });
  }));

  router.put('/:kind/:id', json, wrap(async (req, res) => {
    if (!ID_RE.test(req.params.id)) throw new BadRequest('invalid model id');
    let model;
    try {
      model = req.libValidate({ ...req.body, id: req.params.id });
    } catch (err) {
      throw new BadRequest(err.message);
    }
    res.json(await store.putModel(req.libKind, model));
  }));

  router.delete('/:kind/:id', wrap(async (req, res) => {
    if (!ID_RE.test(req.params.id)) throw new BadRequest('invalid model id');
    await store.removeModel(req.libKind, req.params.id);
    res.status(204).end();
  }));

  router.use((err, req, res, next) => {
    if (err.status && err.code && err.status < 500) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    next(err);
  });

  return router;
}
