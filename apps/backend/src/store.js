// Storage for saved simulations. Postgres in production; an in-memory store with the same behaviour
// backs the tests and local development without a database.
import { randomUUID } from 'node:crypto';

export class NotFoundError extends Error {
  constructor(message = 'not found') {
    super(message);
    this.status = 404;
    this.code = 'not_found';
  }
}

export class ConflictError extends Error {
  constructor(latest) {
    super(`simulation was saved elsewhere; latest version is ${latest}`);
    this.status = 409;
    this.code = 'version_conflict';
    this.latest_version = latest;
  }
}

const SIM_COLUMNS = 'id, name, description, latest_version, summary, created_at, updated_at';
const VERSION_META = 'version, note, summary, size_bytes, created_at, results IS NOT NULL AS has_results';

export function createPgStore(pool) {
  async function tx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async function insertVersion(client, id, version, v) {
    const { rows } = await client.query(
      `INSERT INTO simulation_versions (simulation_id, version, scenario, results, note, summary, size_bytes)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7)
       RETURNING ${VERSION_META}, scenario, results`,
      [id, version, JSON.stringify(v.scenario), v.results == null ? null : JSON.stringify(v.results), v.note, JSON.stringify(v.summary), v.size_bytes]
    );
    return rows[0];
  }

  return {
    kind: 'postgres',
    async ping() {
      await pool.query('SELECT 1');
    },
    async list({ limit = 100, offset = 0, q = '' } = {}) {
      const { rows } = await pool.query(
        `SELECT ${SIM_COLUMNS} FROM simulations
         WHERE $3 = '' OR name ILIKE '%' || $3 || '%'
         ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset, q]
      );
      return rows;
    },
    async create({ name, description, ...v }) {
      return tx(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO simulations (name, description, latest_version, summary) VALUES ($1, $2, 1, $3::jsonb) RETURNING ${SIM_COLUMNS}`,
          [name, description, JSON.stringify(v.summary)]
        );
        const sim = rows[0];
        return { ...sim, version: await insertVersion(client, sim.id, 1, v) };
      });
    },
    async get(id, version) {
      const sim = (await pool.query(`SELECT ${SIM_COLUMNS} FROM simulations WHERE id = $1`, [id])).rows[0];
      if (!sim) throw new NotFoundError('simulation not found');
      const v = (
        await pool.query(`SELECT ${VERSION_META}, scenario, results FROM simulation_versions WHERE simulation_id = $1 AND version = $2`, [id, version ?? sim.latest_version])
      ).rows[0];
      if (!v) throw new NotFoundError('version not found');
      return { ...sim, version: v };
    },
    async versions(id) {
      const sim = (await pool.query('SELECT id FROM simulations WHERE id = $1', [id])).rows[0];
      if (!sim) throw new NotFoundError('simulation not found');
      return (await pool.query(`SELECT ${VERSION_META} FROM simulation_versions WHERE simulation_id = $1 ORDER BY version DESC`, [id])).rows;
    },
    async addVersion(id, { base_version, ...v }) {
      return tx(async (client) => {
        const sim = (await client.query('SELECT latest_version FROM simulations WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!sim) throw new NotFoundError('simulation not found');
        if (base_version != null && base_version !== sim.latest_version) throw new ConflictError(sim.latest_version);
        const next = sim.latest_version + 1;
        const version = await insertVersion(client, id, next, v);
        const { rows } = await client.query(
          `UPDATE simulations SET latest_version = $2, summary = $3::jsonb, updated_at = now() WHERE id = $1 RETURNING ${SIM_COLUMNS}`,
          [id, next, JSON.stringify(v.summary)]
        );
        return { ...rows[0], version };
      });
    },
    async update(id, { name, description }) {
      const { rows } = await pool.query(
        `UPDATE simulations SET name = COALESCE($2, name), description = COALESCE($3, description), updated_at = now()
         WHERE id = $1 RETURNING ${SIM_COLUMNS}`,
        [id, name ?? null, description ?? null]
      );
      if (!rows[0]) throw new NotFoundError('simulation not found');
      return rows[0];
    },
    async remove(id) {
      const { rowCount } = await pool.query('DELETE FROM simulations WHERE id = $1', [id]);
      if (!rowCount) throw new NotFoundError('simulation not found');
    }
  };
}

export function createMemoryStore() {
  const sims = new Map();
  const clone = (x) => (x === undefined ? x : structuredClone(x));
  const meta = (s) => ({ id: s.id, name: s.name, description: s.description, latest_version: s.latest_version, summary: clone(s.summary), created_at: s.created_at, updated_at: s.updated_at });
  const vmeta = (v) => ({ version: v.version, note: v.note, summary: clone(v.summary), size_bytes: v.size_bytes, created_at: v.created_at, has_results: v.results != null });
  const full = (v) => ({ ...vmeta(v), scenario: clone(v.scenario), results: clone(v.results) ?? null });
  const find = (id) => {
    const s = sims.get(id);
    if (!s) throw new NotFoundError('simulation not found');
    return s;
  };
  // Strictly increasing timestamps keep list order deterministic within one millisecond.
  let last = 0;
  const now = () => new Date((last = Math.max(Date.now(), last + 1)));
  const makeVersion = (version, v) => ({ version, scenario: clone(v.scenario), results: clone(v.results) ?? null, note: v.note, summary: clone(v.summary), size_bytes: v.size_bytes, created_at: now() });

  return {
    kind: 'memory',
    async ping() {},
    async list({ limit = 100, offset = 0, q = '' } = {}) {
      const needle = q.toLowerCase();
      return [...sims.values()]
        .filter((s) => !needle || s.name.toLowerCase().includes(needle))
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(offset, offset + limit)
        .map(meta);
    },
    async create({ name, description, ...v }) {
      const t = now();
      const s = { id: randomUUID(), name, description, latest_version: 1, summary: clone(v.summary), created_at: t, updated_at: t, versions: [makeVersion(1, v)] };
      sims.set(s.id, s);
      return { ...meta(s), version: full(s.versions[0]) };
    },
    async get(id, version) {
      const s = find(id);
      const v = s.versions.find((x) => x.version === (version ?? s.latest_version));
      if (!v) throw new NotFoundError('version not found');
      return { ...meta(s), version: full(v) };
    },
    async versions(id) {
      return [...find(id).versions].reverse().map(vmeta);
    },
    async addVersion(id, { base_version, ...v }) {
      const s = find(id);
      if (base_version != null && base_version !== s.latest_version) throw new ConflictError(s.latest_version);
      const created = makeVersion(s.latest_version + 1, v);
      s.versions.push(created);
      s.latest_version = created.version;
      s.summary = clone(v.summary);
      s.updated_at = created.created_at;
      return { ...meta(s), version: full(created) };
    },
    async update(id, { name, description }) {
      const s = find(id);
      if (name != null) s.name = name;
      if (description != null) s.description = description;
      s.updated_at = now();
      return meta(s);
    },
    async remove(id) {
      if (!sims.delete(id)) throw new NotFoundError('simulation not found');
    }
  };
}
