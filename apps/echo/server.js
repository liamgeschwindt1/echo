import { fileURLToPath } from 'node:url';
import { startFrontendServer } from '@echo/web-server/server.js';

startFrontendServer({ name: 'echo', distDir: fileURLToPath(new URL('./dist', import.meta.url)) });
