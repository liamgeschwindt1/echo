# echo

Phone sound labeller v2.2. YAMNet (MediaPipe) and CLAP (transformers.js, Web Worker) run on the device. Audio is never stored or uploaded. Only labels, levels and notes are posted to `POST /api/report` when you tap **View results**, and the server forwards them to Gemini.

## Architecture

npm workspaces monorepo. Four Railway services:

| Service | Code | What it does |
|---|---|---|
| `backend-` | [apps/backend](apps/backend) | Express API: `/api/report` (Gemini), `/api/osm` (OpenStreetMap proxy), `/api/simulations` (saved simulations), `/healthz`. No static files. |
| `sim` | [apps/sim](apps/sim) | Acoustic simulator frontend, served at `/`. Proxies `/api/*` to the backend. |
| `echo` | [apps/echo](apps/echo) | Phone sound labeller frontend, served at `/`. Proxies `/api/*` to the backend. |
| `Postgres` | Railway plugin | Stores saved simulations and their versions. |

Shared code:

- [packages/shared](packages/shared) (`@echo/shared`): catalogue, periods, report core, settings.
- [packages/sim-core](packages/sim-core) (`@echo/sim-core`): simulation engine, its tests, scripts and docs.
- [packages/assets](packages/assets) (`@echo/assets`): `public/` (models, WASM, config, test audio), served by both frontends.
- [packages/web-server](packages/web-server) (`@echo/web-server`): shared Vite config (CSP, `/api` proxy) and the production static + proxy server.

The browser only talks to its own frontend origin. Each frontend server forwards `/api/*` to `BACKEND_URL` and keeps the original `Host` header, so the backend's same-origin check still works.

### Saved simulations

In the sim, **File → Save…** stores the scenario (and, optionally, the latest results) in Postgres. Every save adds a new version; nothing is overwritten. **File → Open saved…** lists all simulations with search, version history, rename and delete. The URL (`?sim=<id>&v=<version>`) points to the open simulation, so it can be reloaded or shared. There is no login: everyone with access to the sim sees every saved simulation.

Saved results come back without rendered audio. Press **Create** to render audio again. Uploaded WAV clips are not stored.

Tables are created by [apps/backend/migrations](apps/backend/migrations) when the backend starts (or with `npm run migrate -w @echo/backend`).

## Develop

```sh
npm install
npm run fetch-models -w @echo/assets      # CLAP audio model (once)
npm run fetch-test-audio -w @echo/assets  # test clips used by the sim (once)
npm run dev                               # backend :8787, echo :5173, sim :5174
```

Without `DATABASE_URL` the backend keeps simulations in memory (lost on restart) and logs a warning. To use Postgres locally:

```sh
docker run -d --name echo-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=echo -p 5432:5432 postgres:16-alpine
DATABASE_URL=postgres://postgres:dev@localhost:5432/echo npm run dev
```

Set `GEMINI_API_KEY` to use Gemini for echo reports.

After editing CLAP prompts in `packages/assets/public/config/labels.json`, run `npm run clap:embed -w @echo/assets` to regenerate `clap_text_embeddings.json`. Priorities are in `packages/assets/public/config/priorities.json`.

## Test

```sh
npm test                                   # every workspace
npm test -w @echo/backend                  # one workspace
TEST_DATABASE_URL=postgres://... npm test -w @echo/backend   # also run store tests on Postgres
```

## Build / run production

```sh
npm run build:sim    && npm run start:sim       # PORT default 8080
npm run build:echo   && npm run start:echo      # PORT default 8080
npm run start:backend                           # PORT default 8787
```

## Deploy to Railway

All services build from the repository root (do not set a root directory; the apps need `packages/`). For each service, set **Settings → Config-as-code** to its file:

| Service | Config file | Variables |
|---|---|---|
| `backend-` | `/apps/backend/railway.json` | `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `PORT=8787`, `NODE_ENV=production`, `GEMINI_API_KEY` |
| `sim` | `/apps/sim/railway.json` | `BACKEND_URL=http://${{backend-.RAILWAY_PRIVATE_DOMAIN}}:${{backend-.PORT}}` |
| `echo` | `/apps/echo/railway.json` | `BACKEND_URL=http://${{backend-.RAILWAY_PRIVATE_DOMAIN}}:${{backend-.PORT}}` |

The backend needs no public domain; the frontends reach it over the private network. `SIM_ENABLED` is no longer used. Health checks use `/healthz` on every service.

Optional backend variables: `GEMINI_MODEL` (default `gemini-3.8-flash`), `GEMINI_THINKING_LEVEL` (default `medium`), `MAX_BODY_BYTES` (default 2 MB, report API), `RATE_LIMIT_PER_MIN` (default 10, report API), `PGSSL=1` (TLS to Postgres, not needed on Railway's private network).

## Assets

- `packages/assets/public/model/yamnet.tflite` and `public/model/yamnet_class_map.csv` — the model and its class names, hosted ourselves (no third-party runtime calls).
- `packages/assets/public/wasm/` — MediaPipe's WASM runtime, copied out of `node_modules` by `packages/assets/scripts/copy-wasm.mjs` (runs on `npm install` via `postinstall`).
- `packages/assets/public/worklet/capture-processor.js` — AudioWorklet that buffers mic samples into overlapping windows in memory only.

See [instructions/instructions_v2.2.md](instructions/instructions_v2.2.md) for the full product brief.

## Sample test rig (internal, non-commercial only)

Tap **Run sample test** to play 13 fixed ESC-50 clips through the **same AudioWorklet,
YAMNet, CLAP, period detector and labelling rules** as microphone capture. No microphone
permission is requested. The graph opens automatically with sample names, relative
levels, model scores, current top-five predictions, progress, stop and JSON export.
Headphones are recommended; playback is audible but the input is wired digitally,
not re-recorded from the speakers. Keep the tab in the foreground.

The checked-in fixtures are selected reproducibly from a pinned ESC-50 revision.
To restore them: `npm run fetch-test-audio -w @echo/assets`. The manifest, metadata and full upstream
licence/individual credits are in [packages/assets/public/test-audio/](packages/assets/public/test-audio/).
**ESC-50 is CC-BY-NC-3.0: do not ship this fixture set as part of a commercial app.**
This is one clip per class, not a representative benchmark or evidence of safety.
ESC-50 is not sourced from AudioSet, but that alone does not prove training-set independence.

Gunshot and human scream are explicitly **missing**, not simulated or counted as
passes. Optionally select your own licensed, non-AudioSet recordings (0.1–15 seconds)
before starting. These local files are decoded only in memory; neither audio nor
file contents are persisted or uploaded. No UrbanSound8K download is included.

Each clip is downmixed to mono and peak-normalized to -6 dBFS without trimming,
compression or repetition. Original durations remain intact. Silence before/between/
after clips lasts the longest enabled model window plus 3 seconds, allowing noise-floor
warmup, period closure and rolling-window clearance. YAMNet still uses 0.975-second
windows; CLAP uses the selected 5/10-second window and existing short-window tiling.
This tests window-boundary handling, not phone acoustics or calibrated loudness.

Tests have a separate IndexedDB database from microphone sessions. **Start** restores
the live session; rerunning the test replaces only the previous test. Download the
test JSON before rerunning. Test reports are built locally and never call the report API.
Settings are locked during a sample run for reproducibility.

The page and server enforce `connect-src 'self' blob:` so that model/runtime
connections stay on our host. This also blocks MediaPipe 1.1.0's periodic Google
telemetry; the library has no public telemetry opt-out. CSP refusal messages for
`odml.pa.googleapis.com` may appear in the console, but no request is sent there.
The intentional same-origin report API remains available for microphone sessions.

Outcomes use **night** priorities explicitly, regardless of the actual clock. They show
top-1/top-5 recognition per model separately from final period labels/priorities and
excess-priority checks. A clip with no model readings is not a recognition pass.
Partial runs mark uncompleted clips rather than scoring them as misses/passes.
Tools alert at night, laughter flags, rain/footsteps are ignored, and fireworks/thunder
may flag but should not alert. Generic engine and door knock have no exact priority
mapping; baby crying has only a no-alert cap. Chainsaw is a broad `drill_saw` proxy.
These ambiguities are left visible, not treated as verified ground truth. A shout is
not interchangeable with a scream; the optional slot is specifically a human scream.

Exports include provenance, normalization gains, exact clip timings, missing slots,
settings, model rows, final detected periods and per-clip scoring. Windows count toward
a clip if their audio interval overlaps it (including trailing windows). Inspect
window counts and final detections; top-five appearance alone is not an alert pass.
Long CLAP inferences may skip hops by design; the test waits up to 60 seconds for the
last in-flight result before finishing and records a timeout as an error.

Run deterministic fixture/scoring/worklet checks with `npm test`.
