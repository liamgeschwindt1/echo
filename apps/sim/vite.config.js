import { defineConfig } from 'vite';
import { frontendConfig } from '@echo/web-server/vite.js';

export default defineConfig(frontendConfig({ port: 5174 }));
