# echo

Two frontends on one backend, in an npm workspaces monorepo:

| Frontend | Code | Reference |
|---|---|---|
| **echo**: phone sound labeller (YAMNet + CLAP on the device; audio never stored or uploaded) | [apps/echo](apps/echo), [packages/shared](packages/shared) | [ECHO.md](ECHO.md) |
| **sim**: 3D acoustic simulator (render, localisation, labelling with the echo stack; simulated results only) | [apps/sim](apps/sim), [packages/sim-core](packages/sim-core) | [SIM.md](SIM.md) |

Shared: [apps/backend](apps/backend) (API, Postgres for saved simulations), [packages/assets](packages/assets) (models, config, clips), [packages/web-server](packages/web-server) (Vite config, CSP, `/api` proxy). Railway settings: [.railway/railway.ts](.railway/railway.ts).

```sh
npm install
npm run fetch-models -w @echo/assets       # CLAP audio model (once)
npm run fetch-test-audio -w @echo/assets   # ESC-50 test clips (once)
npm run dev                                # backend :8787, echo :5173, sim :5174
npm test                                   # every workspace
```

Build, deploy and every detail of what the code does are in the two reference documents.
