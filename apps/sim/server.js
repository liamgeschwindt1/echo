import { fileURLToPath } from 'node:url';
import { startFrontendServer } from '@echo/web-server/server.js';

startFrontendServer({ name: 'sim', distDir: fileURLToPath(new URL('./dist', import.meta.url)) });
