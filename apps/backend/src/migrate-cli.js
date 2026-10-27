import { createPool, migrate } from './db.js';

const pool = createPool();
try {
  const applied = await migrate(pool);
  console.log(applied.length ? `applied ${applied.length} migration(s)` : 'database is up to date');
} finally {
  await pool.end();
}
