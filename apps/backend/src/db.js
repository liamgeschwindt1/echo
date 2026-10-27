// Postgres connection and a small forward-only migration runner.
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
// Arbitrary constant so concurrent instances never run migrations at the same time.
const MIGRATION_LOCK = 724_381_006;

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const ssl = process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString, ssl, max: Number(process.env.PG_POOL_MAX) || 10 });
  pool.on('error', (err) => console.error(`postgres pool error: ${err.code || err.message}`));
  return pool;
}

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: readFileSync(dir + name, 'utf8') }));
}

export async function migrate(pool, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const applied = [];
    for (const m of migrationFiles(dir)) {
      if (done.has(m.name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${m.name} failed: ${err.message}`);
      }
      applied.push(m.name);
      log(`applied migration ${m.name}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}
