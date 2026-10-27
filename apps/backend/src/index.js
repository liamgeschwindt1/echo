import { createApp } from './app.js';
import { createPool, migrate } from './db.js';
import { createMemoryStore, createPgStore } from './store.js';

const PORT = Number(process.env.PORT) || 8787;

let store;
if (process.env.DATABASE_URL) {
  const pool = createPool();
  await migrate(pool);
  store = createPgStore(pool);
} else if (process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is required in production');
} else {
  console.warn('DATABASE_URL is not set: saved simulations are kept in memory and lost on restart');
  store = createMemoryStore();
}

// '::' accepts IPv4 and IPv6, which Railway's private network needs.
createApp({ store }).listen(PORT, '::', () => {
  console.log(`echo backend on :${PORT} (store ${store.kind}, gemini key ${process.env.GEMINI_API_KEY ? 'set' : 'MISSING'})`);
});
