# echo-sim: the 3D acoustic simulator

The one reference document for the **sim** frontend ([apps/sim](apps/sim)) and its engine ([packages/sim-core](packages/sim-core)): what every stage computes, the formulas, the settings and their defaults, the results schema, the tests, the validation records and the limits. The code is the source of truth; where an older brief disagreed with it, this document follows the code and says so. The phone labeller is documented in [ECHO.md](ECHO.md).

**Everything here is simulated.** Physics constants that are not measured are marked **placeholder**, as they are in the code and the export. No result in this document is a real-world accuracy claim.

Coordinates: metres, x east, y north, z up. Time: seconds of scenario time. Inside the physics, pressure is in pascals; digital floats appear only at the microphone output. Angles in the code are in radians unless the name ends in `_deg`.

## Reproducible Testing engine (schema 0.8)

`npm run benchmark -- --experiment smoke --out baselines/smoke.json` runs the shared
`packages/sim-core/src/benchmark/` engine. CLI and Testing use identical experiment
expansion, variable transforms, cache keys, scoring and aggregation. JSON, CSV and
standalone HTML are written together. Use `--compare baseline.json --fail-on-regress`
for deterministic metric regression checks. Runtime is recorded but not gated.

Experiments default to `measured_only`; the existing editor retains
`truth_assisted` for compatibility. The latter uses true per-source windows,
SNR, overlap, path selection and track dominance. It is an optimistic upper
bound, not deployable inference. Measured-only uses the existing horizontal
mixture-only `measured.js` pipeline, not the source-window solver. Its elevation,
3D error and labelling accuracy are **unavailable**, not zero. Scoring uses
truth only after inference. Unmatched fixes count as wrong. Model labelling is
not run by benchmarks.

Seeds `[1, 2, 101]` have `101` held out. Eight of 25 scene IDs are held-out random
sites; the split is fixed before baseline and held-out data is reporting-only.
Reports separate train/held-out, realism off/on (2.5 deg heading, 1 dB gain,
5 mm position, correlation 0.3), and analysis modes. Bootstrap resamples complete
scene/seed runs; within-site seeds remain correlated. See [Testing](docs/testing.md)
and [overnight log](docs/overnight-log.md) for limitations and retained steps.

### Measured quality and reproducibility (schema 0.8)

Measured-only `min_peak=0.25` applies to dimensionless PHAT coherence. Each raw
peak is divided by `2 * in_band_bins / (FFT_length * upsample_factor)`, the fully
coherent peak. Previously the raw maximum was below 0.015 in the default band,
so even perfectly coherent windows failed the gate. The threshold is unchanged
and remains an uncalibrated placeholder. Raw peaks, TDOAs, rendered signals and
truth-assisted bearings are unchanged.

Integer seed counts reserve at least 30% held-out seeds (with two or more seeds);
explicit seed lists retain their declared split. Single-seed pilots are not
held-out validation. Resume checks exact job/custom-scene settings, scoring target,
source code, runtime and audio hashes. OAT retains requested values even when
they equal a registry default: actual bases differ by scene and realism state.
Geometry transforms precede source ranges in fixed order. Regression comparisons
match variable values and reject different scene/seed populations or scoring targets.

Browser/Node testing exposed a legacy consensus tie where
count-equal pair costs near machine zero chose different node pairs and later
track windows. Recorded audio hashes and whole-event bearings matched. Schema
numbers did not cause that difference. Engine/runtime provenance matters. A
weight-aware repair was rejected because suspect precision and recall regressed;
see the overnight log. No solver upgrade is claimed.

### Simulated, measured and assumed

| Quantity | Status and permitted use |
|---|---|
| Microphone pressure, propagation paths, true geometry and source tracks | Simulated. True geometry, paths and source tracks are scoring/audit inputs, never measured-only inference inputs. |
| Measured-only onsets, PHAT coherence, bearings and tracks | Estimated from simulated microphone mixtures and nominal geometry, not validated real measurements. |
| Truth-assisted windows, containment, SNR, overlap, picked path, multipath and dominance | Simulator truth. Kept only as the editor's compatibility pipeline and an explicitly labelled benchmark upper bound. |
| Heading/gain/position error and noise correlation | Assumed distributions controlled by settings; realism-on is a stress test, not a measured hardware profile. |
| Bearing sigmas, association gates, benchmark targets and numerical thresholds | Uncalibrated placeholders. Coverage/calibration must be reported with conditional error. |
| Flat-array elevation | Sign/height assumption, not resolved up/down. Measured-only elevation and 3D error remain unavailable. |
| Labelling | Actual YAMNet/CLAP results only after runners finish. Benchmark accuracy remains unavailable because benchmarks do not execute labelling. |

Contents:

- 1. Purpose, pipeline and layout
- 2. Scenario data model (scenario.js)
- 3. Physics, random numbers, noise and realism
- 4. Microphone arrays
- 5. Geometry and path finding
- 6. Render
- 7. Analysis: from rendered audio to bearings, fixes, tracks, candidates and labels
- 8. Heatmap, reach map, sweeps, sound library, OSM and DSP helpers
- 9. UI layer (apps/sim)
- 10. Validation, decisions and roadmap
- 11. Tests and scripts
- 12. Known limits
- 13. Schema 0.4 localisation upgrade (Nov 2026): brief, verification and results
- 13.8. Schema 0.5 trusted-elevation fixes and aerial tracking

---

## 1. Purpose, pipeline and layout

### 1.1 Purpose

The simulator is a design tool. It answers questions the phone rig cannot: how far away a node can still hear a sound well enough to take a bearing, and how accurately a few nodes can place a sound on a map. Given a scenario (nodes carrying microphone arrays, sound sources playing clips, optional buildings or an OpenStreetMap tile, and air and noise settings), it:

1. finds every sound path from each source to each microphone: direct, ground bounce, wall reflections up to order 2, and edge diffraction (UTD wedge, orders 1 and 2);
2. renders the multichannel signal of every node in the frequency domain, with delay, spreading, air absorption, reflection and diffraction filters, noise and the digital conversion;
3. measures per-source in-band activity at each node;
4. analyses the render (windows, bearings, fixes, back-trace, uncertainty; **see §7**);
5. optionally computes a time-resolved heatmap, an energetic reach map and side view, repeated trials and parameter sweeps.

It is not validation. Free field plus specular geometry plus wedge diffraction is optimistic, and several constants are placeholders. These are listed in `simConstants()` and written into every results export.

### 1.2 Pipeline

```
scenario (scenario.js)                         nodes, sources (keyframes), buildings, environment, settings
  │ validateScenario / placementErrors
  ▼
path finding (geometry.js + edges.js + diffraction.js)
  │ computePathTable: per node, per mic and array centre, per source -> findPaths()
  │   direct, image-source reflections (order <= 2), wedge chains E / SE / ES / EE, pruning, cap, audit of drops
  ▼
render (render.js)                             renderScenario(): per mic, Σ_sources Σ_paths X(f)·H_path(f)·e^{-jωτ} -> irfft
  │ + ambient pink and self white noise (rng.js), × digitalPerPa × mic gain
  ▼
activity (activity.js)                         per node, per source: 10 ms in-band power at mic 0 (all paths, direct only), noise band power
  ▼
analysis (analyse.js, §7)                     per node: containment, window policy, GCC-PHAT bearing, uncertainty, path report;
  │                                            per source: robust fix (fix.js), track (track.js), back-trace (backtrace.js)
  ▼
labelling (labelling.js, §7.12, optional)       echo app stack on omni + beamformed audio, scored against the manifest
  ▼
UI (apps/sim)                                  map, 3D view, inspector, timeline, mic's-eye view, playback
```

Running beside this and independent of Create: the heatmap (`field.js`), the reach map and side view (`reach.js`), the wavefront rings (`wavefront.js`) and the sweeps (`sweep.js`, which call render and analysis once per seed). All of them use the same `findPaths`, so render, rings, reach map, heatmap, path diagnostics and mic view cannot disagree about which paths exist.

### 1.3 Monorepo layout (simulator parts)

```
apps/sim/                         the simulator frontend (Vite app, service "sim")
  index.html                      page shell: top bar, side nav, map canvases, inspector, panels, dialogs
  server.js                       production server: startFrontendServer({ name: 'sim', distDir })
  vite.config.js                  frontendConfig({ port: 5174 }) from @echo/web-server
  src/main.js                     UI controller (one module, ~2700 lines): state, map, rings, reach, picking, inspector,
                                  timeline, sweeps, playback, loop, workspaces, heatmap glue
  src/renderWorker.js             worker: render + analyse, components, field (heatmap), reach / section
  src/sweepWorker.js              worker: repeats and sweeps
  src/models.js                   YAMNet + CLAP runners: MediaPipe YAMNet and the echo app's clapWorker (labelling, §7.12)
  src/style.css
  src/ui/library.js               saved simulations client, File menu, save/open dialogs, URL state
  src/ui/scenes.js                Scenes workspace (cards of saved simulations)
  src/ui/arrays.js                Mic arrays workspace (list, 3D preview, builder, derived figures)
  src/ui/sounds.js                Sound library workspace (list, level-contour preview, upload/synthesis, 1 m calibration)
  src/ui/modelapi.js              client for /api/library (array and sound models)
  src/ui/objectview.js            small orbit viewer for one library object
  src/ui/heatmap.js               heatmap controller (pulse / peak-hold / level), turbo colour map
  src/ui/micview.js               mic's-eye view (traces, spectrogram, arrivals, audit, GCC curve, WAV/CSV export)
  src/ui/view3d.js                orbit camera, perspective projector, 3D drawing (2D canvas, no WebGL)
  src/ui/particles.js             particle display of the wavefronts, per-source colours
  src/ui/tracking.js              rolling-fix ring and trail on both canvases
  src/ui/osm.js                   OSM load button state machine (countdown, cancel, timeout)
  test/*.test.js                  UI-side tests (section 10)

packages/sim-core/                pure, DOM-free simulation code, imported as @echo/sim-core/<file>.js
  src/*.js                        scenario, physics, rng, mics, arrays, geometry, edges, diffraction, wavefront, render,
                                  motion, activity, components, field, reach, sweep, clips, sounds, osm, spectro, dsp,
                                  profile, wav, attribution, and the analysis modules (see §7)
  docs/*.md                       generated validation and performance records (section 9)
  scripts/*.mjs                   acceptance, calibration and report scripts (section 10)
  test/                           node:test suites, golden data, reference renderer, BTM reference (section 10)

packages/assets/                  static files served as the Vite publicDir
  public/test-audio/              ESC-50 clips, manifest.json, esc50.csv, LICENSE.esc50
  public/config, model, wasm ...  classifier assets (shared with the echo app)
  scripts/fetch-test-audio.mjs    downloads the clips at a pinned ESC-50 revision

packages/web-server/              shared frontend server and Vite config
  src/server.js                   static files + /api proxy + security headers + /healthz
  src/vite.js                     CSP, publicDir, dev /api proxy, worker format 'es'

apps/backend/                     API service (no pages)
  src/simulations.js              /api/simulations (save, list, open, versions)
  src/library.js                  /api/library/:kind (user mic arrays and sounds)
  src/osm.js                      /api/osm (OpenStreetMap proxy)
  src/store.js                    Postgres store and an in-memory store with the same behaviour
  migrations/001_simulations.sql, 002_library_models.sql
```

Design rule: everything in `packages/sim-core/src/` except `clips.js` (fetch, `OfflineAudioContext`) is pure and deterministic given the scenario and seed. It has no DOM and no global mutable state apart from caches keyed by geometry (`edgeCache`, the polygon `WeakMap`, the grid `WeakMap`, FFT twiddles). The same code therefore runs in the Web Worker, on the UI thread and in Node tests.

**Deployment.** There are four Railway services ([.railway/railway.ts](.railway/railway.ts)): `backend` (port 8787, `DATABASE_URL` from Postgres), `sim` and `echo` (static frontends whose `BACKEND_URL` is the backend's private domain), and Postgres. `npm run build:sim` runs `fetch-models` and `fetch-test-audio` in `@echo/assets`, then `vite build`. `npm run start:sim` runs `apps/sim/server.js`. The root [scripts/service.mjs](scripts/service.mjs) picks the app from `ECHO_APP` or `RAILWAY_SERVICE_NAME`. In development, [scripts/dev.mjs](scripts/dev.mjs) starts backend, echo and sim together, and the sim is served on port 5174.

**Frontend server** ([packages/web-server/src/server.js](packages/web-server/src/server.js)). It serves `dist/` with a 1 h cache and an SPA fallback to `index.html`, and `/healthz`. `/api/*` is proxied to `BACKEND_URL` (default `http://localhost:8787`) with hop-by-hop headers removed, `x-forwarded-host/proto/for` set and a 120 s timeout; if the backend is down it answers 502 `backend_unavailable`. Security headers: `Content-Security-Policy: connect-src 'self' blob:`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: microphone=(self), geolocation=(self)`. The browser only ever talks to its own origin.

**Backend endpoints the simulator uses** ([apps/backend/src/app.js](apps/backend/src/app.js)). All are mounted behind a same-origin check, which refuses a cross-site `Origin` with 403.

| Mount | Rate limit (per IP per minute) | Body limit | Purpose |
|---|---|---|---|
| `/api/simulations` | `SIM_RATE_LIMIT_PER_MIN` = 240 | `SIM_MAX_BODY_BYTES` = 25 MB | saved simulations, section 8.9 |
| `/api/library/:kind` (`arrays`, `sounds`) | 240 | 25 MB | user mic array and sound models, sections 4.6 and 8.4 |
| `/api/osm` | `RATE_LIMIT_PER_MIN` = 10 | 2 kB | OpenStreetMap proxy, section 7.5 |

**Postgres schema** ([apps/backend/migrations](apps/backend/migrations)):

- `simulations(id uuid pk default gen_random_uuid(), name text 1..200, description text <= 2000, latest_version int, summary jsonb, created_at, updated_at)`, with an index on `updated_at desc`.
- `simulation_versions(simulation_id fk on delete cascade, version int >= 1, scenario jsonb, results jsonb null, note text <= 500, summary jsonb, size_bytes int, created_at, pk(simulation_id, version))`. Versions are append-only.
- `library_models(kind 'array'|'sound', id text ~ '^[a-z0-9][a-z0-9_-]{0,63}$', name 1..120, body jsonb, created_at, updated_at, pk(kind, id))`.

`createMemoryStore()` implements the same interface for tests and for development without a database.

---

## 2. Scenario data model ([scenario.js](packages/sim-core/src/scenario.js))

```js
scenario = {
  version: '0.2',
  settings: { ...DEFAULT_SETTINGS },
  nodes:     [{ id, position:[x,y,z], rotation_deg, mic_layout, mic_spacing_m, ...layout params }],
  sources:   [{ id, clip, keyframes:[{ t, position:[x,y,z] }, ...], level_1m_db, start_s }],
  buildings: [{ id, position:[cx,cy], size:[w,d,h], rotation_deg:0, footprint?, name?, osm_id?, height_estimated? }],
  environment?: { kind:'osm', lat, lon, size, name, attribution, features, fetched_at }
}
```

### 2.1 Nodes

`newNode(id, x, y)` returns `{ id, position:[x, y, 5], rotation_deg:0, mic_layout:'flat_square', mic_spacing_m:0.1 }`.

| Field | Meaning |
|---|---|
| `position` | array centre `[x, y, z]`, default height 5 m (lamp post) |
| `rotation_deg` | rotation of the layout about +z, anticlockwise, applied before translation |
| `mic_layout` | `flat_square`, `tetrahedron`, `stagger_8` or `custom` (section 4) |
| `mic_spacing_m` | edge length for `flat_square` and `tetrahedron` (default 0.10 m) |
| `mic_radius_lower_m`, `mic_radius_upper_m`, `mic_ring_height_m`, `mic_per_ring` | optional `stagger_8` parameters (defaults 0.06, 0.12, 0.06, 4) |
| `mic_offsets_m`, `mic_array`, `mic_array_name` | `custom` layout: 2 to 64 offsets in metres, the library id and name they were copied from |

### 2.2 Sources and keyframes

`newSource(id, clip, x, y, level)` returns `{ id, clip, keyframes:[{ t:0, position:[x, y, 1.5] }], level_1m_db, start_s: 3 }`. New sources start at 3 s because the detector needs about 2 s of history to learn the noise floor.

| Field | Meaning |
|---|---|
| `clip` | clip id: library manifest id, upload id or user sound model id |
| `level_1m_db` | level at 1 m in dB SPL; sets the loudest 125 ms window of the clip (section 6.1) |
| `start_s` | scenario time at which the clip starts |
| `keyframes` | one keyframe is a static source. Two or more with strictly increasing `t` (scenario seconds) make a moving source that walks the polyline with linear interpolation, waiting at the first keyframe before `t0` and at the last after `t_last` (section 6.6) |

`sourcePosition(src)` returns `keyframes[0].position`: the static position, or the start of a path.

### 2.3 Buildings

`newBuilding(id, x, y, w = 20, d = 12, h = 15)` returns an axis-aligned box with its footprint centred on `position`. `DEFAULT_BUILDING_HEIGHT_M` is 15 m. `rotation_deg` must be 0: `validateScenario` rejects any other value ("rotation is not supported yet").

A building with a `footprint` (from the OpenStreetMap import) is a vertical prism over its outer ring instead of a box. `footprint` holds rings of points normalised to the bounding box: a world point is `[cx + u·w, cy + v·d]`. Only ring 0 (the outer ring) is acoustic. Inner rings (courtyards) are treated as solid. For acoustics the ring is simplified (section 5.1). The views draw the full outline (`buildingFootprint` in [osm.js](packages/sim-core/src/osm.js)). `name`, `osm_id` and `height_estimated` are carried through unchanged.

### 2.4 Environment

This field is present only after an OSM import: `{ kind:'osm', lat, lon, size, name, attribution:'© OpenStreetMap contributors', features:[{ kind:'water'|'road'|'rail'|'tree'|'land', type:'polygon'|'line'|'point', points, width? }], fetched_at }`. Acoustically it does nothing; the features are drawn under the map and in 3D. `validateScenario` requires `kind === 'osm'`, an array `features` and finite `lat` and `lon`.

### 2.5 Versions and migration

- `SCENARIO_VERSION = '0.2'`. Loadable versions are `'0.1'` and `'0.2'`. A 0.1 file has no buildings and loads as 0.2 with `buildings: []`. The output version is always `'0.2'`.
- `validateScenario(s)` merges `settings` over `DEFAULT_SETTINGS`, so missing keys take today's defaults. It checks:
  - node positions are finite 3-vectors;
  - `custom` layouts have 2 to 64 finite 3-vectors;
  - every source has at least one keyframe with a position, and with more than one keyframe the times are finite and strictly increasing;
  - building positions are finite 2-vectors, sizes are three positive numbers and rotation is 0;
  - the environment has the shape in 2.4;
  - `placementErrors` returns no errors.

  Extra fields on nodes, sources and buildings pass through untouched.
- `scenarioNotices(raw)` runs before the merge. A file without `settings.diffraction_order` gets the notice that it now uses the wedge model at order 2, so levels behind buildings differ from before. The UI shows it in the load notice.

### 2.6 Placement validation

`placementErrors(scenario)` returns one message for:

- every node inside a building below its roofline;
- every source whose first keyframe is inside a building;
- every moving source whose path, sampled every 0.5 m (`samplePath`), enters a building.

"Inside" is `insideBox` (section 5.1): strictly inside the footprint, and `z < h`. A node or source above the roofline is allowed. The UI also refuses to place, drag, resize or draw anything that would end up inside a building, and refuses a building that would cover a node or source.

### 2.7 Scenario length and render length

- `scenarioLengthS(scenario, clipDurations)` is the maximum over sources of `start_s + clip duration`, and of the end of motion for moving sources. Playback and the timeline end exactly there. The UI uses `max(1, scenarioLengthS)`.
- `renderLengthS` = `scenarioLengthS + travel + 0.5 s`, plus another 0.5 s when any building exists, where `travel = max over sources, keyframes, nodes of |keyframe − node centre| / c`. The render runs longer than playback so that sound still travelling to the farthest mic, and late reflections, are not cut off. Because the render uses circular FFTs, this padding is what keeps wrap-around in silence (section 6.2).

### 2.8 Settings (`DEFAULT_SETTINGS`)

| Key | Default | Unit | Meaning | In UI (`s_<key>`) |
|---|---|---|---|---|
| `temperature_c` | 15 | °C | speed of sound `c = 331.3 + 0.606 T` (340.39 m/s at 15 °C), air absorption | yes |
| `humidity_pct` | 70 | % RH | air absorption | yes |
| `pressure_kpa` | 101.325 | kPa | air absorption | no |
| `noise_floor_db_spl` | 45 | dB SPL | broadband RMS of the ambient pink noise at every mic | yes |
| `mic_self_noise_db_spl` | 30 | dB SPL | broadband RMS of the white self-noise per mic | no |
| `ground_reflectivity` | 0.8 | 0..1 | real, frequency-independent pressure reflection coefficient of the ground (**placeholder** for hard ground). 0 removes the ground from every reflection sequence | yes |
| `slice_height_m` | 1.5 | m | display plane for rings, heatmap and reach map (UI only) | yes, plus slider |
| `seed` | 1 | – | root of every random stream (section 3.4) | yes |
| `render_sample_rate` | 48000 | Hz | render rate. The UI always decodes clips at 48 kHz (`FS`), so it must stay 48000 there | no |
| `reflection_order` | 1 | – | maximum specular order: 0 = single ground bounce only, 1 or 2 = all surfaces | yes (0, 1, 2) |
| `block_direct_behind_buildings` | true | bool | without wedge diffraction, removes a direct path that passes through a building. With `false` the blocked direct path is kept | yes |
| `diffraction_model` | `'wedge'` | – | `'wedge'` (UTD rigid wedge) or `'maekawa'` (legacy formula, kept for comparison and regression) | yes |
| `diffraction_order` | 2 | – | 0 off, 1 one edge, 2 adds edge-edge, reflection+edge and edge+reflection | yes |
| `heatmap_backdrop` | 0.25 | 0..1 | opacity of the level map shown under the Pulse heatmap | yes |
| `path_prune_db` | 50 | dB | wedge model only: drop a path more than this far below the strongest at all of 250 Hz, 1 kHz and 4 kHz | yes |
| `heading_error_sigma_deg` | 0 | ° (1σ) | realism: per-node rotation error of the rendered array (section 3.6) | no |
| `mic_gain_sigma_db` | 0 | dB (1σ) | realism: per-mic gain error | no |
| `mic_position_sigma_mm` | 0 | mm (1σ per axis) | realism: per-mic position error of the rendered array | no |
| `noise_correlation` | 0 | 0..1 | ρ: share of the ambient noise power that is common to all mics of a node | no |
| `air_absorption` | true | bool | ISO 9613-1 absorption on or off everywhere | no |
| `spl_ref_db` | 94 | dB SPL | digital reference: `spl_ref_db` maps to `dbfs_ref_db` (assumed MEMS spec, **placeholder**) | no |
| `dbfs_ref_db` | −26 | dBFS | see above | no |
| `noise_enabled` | true | bool | test switch: `false` renders exact silence apart from the sources | yes |
| `reach_cell_m` | 2 | m | reach map cell, and the heatmap's fine cell (min 0.5) | yes |
| `reach_reflection_order` | 2 | – | reflection order used by the reach map, side view and heatmap (independent of the render) | yes |
| `localisation_band_hz`, `detection_band_hz`, `min_snr_db`, `picked_path_*`, `window_*`, `min_window_ms`, `onset_*`, `trigger_*`, `adaptive_*`, `reflector_*`, `multipath_*`, `overlap_sigma_deg`, `fix_*`, `source_height_prior_m`, `track_*`, `backtrace_*`, `label*` | – | – | analysis thresholds, all placeholders: **see §7.14** for every default. UI: `s_min_snr_db`, `s_picked_path_tolerance_deg`, `s_window_policy`, `s_source_height_prior_m`, the band select (`locBand`) and the Labelling card. `localisation_band_hz` (default `[200, 1600]`) is also read by the activity pass (6.7), the reach map and heatmap localisation band (8.1, 8.2) and the noise band power; `min_snr_db` also draws the contour on the heatmap and reach map | partly |

Optional keys that are not in `DEFAULT_SETTINGS`: `concrete_absorption` overrides the placeholder `CONCRETE_ABSORPTION` = 0.03; it is used by the sensitivity script, and when unset the behaviour is exactly the constant. Code paths that receive a settings object without `diffraction_model` behave as the legacy model; scenario files always get the merged defaults through `validateScenario`.

---

## 3. Physics, random numbers, noise and realism

### 3.1 Units and conversions ([physics.js](packages/sim-core/src/physics.js))

- `P_REF_PA = 20e-6` Pa.
- `speedOfSound(T) = 331.3 + 0.606·T` m/s. One function is used by path delays, rings, markers, render length and the solver (scaling from 0 to 25 °C is about 4.4 %, which is tested).
- `dbToPa(L) = 20e-6 · 10^(L/20)` Pa (RMS); `paToDb(p) = 20·log10(max(p, 1e-12)/20e-6)`.
- `distance(a, b)` is the 3D Euclidean distance.

### 3.2 Digital scaling

```
digitalPerPa(splRef = 94, dbfsRef = −26) = 10^(dbfsRef/20) / dbToPa(splRef)
```

With the defaults, 94 dB SPL = 1 Pa RMS maps to −26 dBFS, so `digitalPerPa ≈ 0.0501` full-scale units per Pa. This is an assumed MEMS microphone spec (**placeholder**), editable through `spl_ref_db` and `dbfs_ref_db`. The phone rig's calibration is different. Every mic output is `(signal_Pa + noise_Pa) · digitalPerPa · micGain`.

### 3.3 Air absorption (ISO 9613-1)

`airAbsorptionDbPerM(f, T_C, RH, p_kPa = 101.325)` is the pure-tone attenuation coefficient α in dB/m:

```
T   = T_C + 273.15            T0 = 293.15 K        T01 = 273.16 K         p_r = 101.325 kPa
p_rel = p_kPa / p_r
psat_rel = 10^C,  C = −6.8346·(T01/T)^1.261 + 4.6151
h   = RH · psat_rel / p_rel                                        (molar concentration of water vapour, %)
frO = p_rel · (24 + 4.04e4 · h · (0.02 + h) / (0.391 + h))         (oxygen relaxation frequency, Hz)
frN = p_rel · (T/T0)^(−1/2) · (9 + 280 · h · exp(−4.170·((T/T0)^(−1/3) − 1)))   (nitrogen, Hz)
α   = 8.686 · f² · [ 1.84e-11 · p_rel^(−1) · (T/T0)^(1/2)
                   + (T/T0)^(−5/2) · ( 0.01275·e^(−2239.1/T) / (frO + f²/frO)
                                     + 0.1068 ·e^(−3352/T)   / (frN + f²/frN) ) ]      dB/m
```

On a path of length L, the pressure factor at frequency f is `10^(−α(f)·L/20)`. In the renderer this is written as `exp(−α·L·ln10/20)`, with α tabulated once per render bin. Checked values: at 20 °C, 70 %, 1 kHz, α ≈ 0.0045 dB/m. Over 80 m the losses at 250 / 1000 / 4000 Hz are 0.09 / 0.33 / 2.13 dB, matching the formula (`test/sim-fidelity.test.js`). `air_absorption: false` sets α = 0 everywhere.

### 3.4 Random streams ([rng.js](packages/sim-core/src/rng.js))

- `mulberry32(seed)` is a 32-bit generator with output in [0, 1):
  `a += 0x6d2b79f5; t = imul(a ^ a>>>15, a | 1); t ^= t + imul(t ^ t>>>7, t | 61); return (t ^ t>>>14)>>>0 / 2^32`.
- `streamFor(seed, ...parts)` gives one independent stream per tuple. It starts from `h = seed ^ 0x9e3779b9`, and for each part `h = imul(h ^ part, 0x85ebca6b) ^ (h_old >>> 13)`; the result seeds `mulberry32(h)`.
- Stream tuples in use (`kind` is the last part):

| Tuple | Use |
|---|---|
| `(seed, ni, mi, 1)` | ambient pink noise of node ni, mic mi |
| `(seed, ni, mi, 2)` | self white noise |
| `(seed, ni, 0, 11)` | heading error of node ni (one draw) |
| `(seed, ni, mi, 12)` | position error of mic mi (three draws) |
| `(seed, ni, mi, 13)` | gain error of mic mi (one draw) |
| `(seed, ni, 0, 14)` | node-wide common pink noise (correlated noise) |
| `(seed, 0, 0, 1)`, `(seed, 0, 0, 2)` | reference noise for `noiseBandPowerPa2` (reach map, heatmap) |

  The same scenario and seed give a bit-identical render in every environment.
- `gaussian(rng)` uses Box–Muller: `sqrt(−2 ln max(u1, 1e-12)) · cos(2π u2)`.
- `whiteNoise(rng, n, rms)` returns `rms · N(0,1)` per sample. It is not rescaled, so the RMS is exact only in expectation.
- `pinkNoise(rng, n, rms)` uses Paul Kellet's refined filter on white `w = N(0,1)`:

```
b0 = 0.99886 b0 + 0.0555179 w      b1 = 0.99332 b1 + 0.0750759 w     b2 = 0.96900 b2 + 0.1538520 w
b3 = 0.86650 b3 + 0.3104856 w      b4 = 0.55000 b4 + 0.5329522 w     b5 = −0.7616 b5 − 0.0168980 w
v  = b0 + b1 + b2 + b3 + b4 + b5 + b6 + 0.5362 w ;   b6 = 0.115926 w
```

  The sequence is then rescaled so that its sample RMS over the whole buffer equals `rms` exactly: `k = rms / sqrt(mean(v²))`. The slope is about −3 dB per octave.

### 3.5 Noise model ([render.js](packages/sim-core/src/render.js) `noiseForMic`, `commonNoise`)

Per mic and per sample, in pascals:

```
amb_own  = pinkNoise(stream(seed, ni, mi, 1), total, dbToPa(noise_floor_db_spl))
common   = pinkNoise(stream(seed, ni, 0, 14), total, dbToPa(noise_floor_db_spl))     only when ρ = noise_correlation > 0
amb      = sqrt(ρ)·common + sqrt(1 − ρ)·amb_own                                       (ρ = 0: amb = amb_own)
self     = whiteNoise(stream(seed, ni, mi, 2), total, dbToPa(mic_self_noise_db_spl))
mic      = (Σ sources + amb + self) · digitalPerPa · micGain(ni, mi)
```

With the defaults the ambient RMS is 45 dB SPL = 3.56 mPa and the self-noise RMS is 30 dB SPL = 0.63 mPa, both broadband. Because `common` and `amb_own` have the same RMS and are independent, the mixed ambient keeps its RMS, and the correlation coefficient of the ambient noise between two mics of a node is ρ. Self-noise is never correlated. Noise is independent between nodes. Independent noise per mic (ρ = 0, the default) is pessimistic for localisation. With `noise_enabled: false` both noise buffers are zero, so the render without sources is exact digital silence. The mic gain error multiplies noise and signal alike.

### 3.6 Realism toggles: rendered array vs assumed array

`trueMicPositions(node, ni, settings)` builds the array the renderer actually uses. The nominal layout from `micPositions(node)` is what the estimator assumes and what the results report as `mic_positions`. All three toggles default to 0, which makes the two identical.

- **Heading error**: one draw per node, `Δθ = heading_error_sigma_deg · N(0,1)` from stream 11. The rendered layout is `micPositions({ ...node, rotation_deg: rotation_deg + Δθ })`, a rigid rotation about the node's vertical axis.
- **Mic position error**: per mic, three independent draws from stream 12: `p_true = p + σ·(N, N, N)` with `σ = mic_position_sigma_mm / 1000` m. It is added after the heading rotation.
- **Mic gain error**: per mic, `g = 10^(mic_gain_sigma_db · N(0,1) / 20)` from stream 13, applied to the whole mic output (signal and noise). `micGainFor(ctx, ni, mi) = digitalPerPa · g`.

The path table, the render and the activity pass all use the true positions (`ctx.truePositions`). `rendered.nodes[i]` exposes both `mic_positions` (nominal, assumed) and `mic_positions_true` (rendered), and the results export writes both (`mic_positions_assumed`, `mic_positions_rendered`). So the analysis sees a calibration error it does not know about.

---

## 4. Microphone arrays

### 4.1 Conventions

Inside a node (`mics.js`) offsets are in metres. In the library (`arrays.js`) they are in millimetres. The origin is the array centre (the ball centre for the node), z is up, and x east / y north when the node is not rotated. In the library, coordinates are the port mouth on the outer surface. Azimuth is in degrees anticlockwise from +x seen from above; latitude is in degrees above the horizontal plane. World positions are `micPositions(node)`: offsets rotated about z by `rotation_deg`, then translated to `node.position`:

```
x = nx + ox·cos r − oy·sin r,   y = ny + ox·sin r + oy·cos r,   z = nz + oz
```

`micPairs(n)` lists all `n(n−1)/2` pairs i < j. `MIC_PAIRS = micPairs(4)` gives the 6 pairs of a 4-mic node.

### 4.2 Node layouts ([mics.js](packages/sim-core/src/mics.js))

`MIC_LAYOUTS = ['flat_square', 'tetrahedron', 'stagger_8']`, plus `custom`.

| Layout | Offsets (s = `mic_spacing_m`, default 0.1 m) | Notes |
|---|---|---|
| `flat_square` | `h = s/2`: mic 1 (−h, −h, 0), mic 2 (h, −h, 0), mic 3 (h, h, 0), mic 4 (−h, h, 0) | coplanar, side s, diagonal s√2. Cannot tell up from down (see §7) |
| `tetrahedron` | `a = s/(2√2)`: (a, a, a), (a, −a, −a), (−a, a, −a), (−a, −a, a) | regular tetrahedron with all 6 edges equal to s; vertical extent 2a = 70.7 mm at s = 0.1 |
| `stagger_8` | lower ring of n mics at z = 0, radius `lower`, azimuth `2πk/n`; upper ring at z = `height`, radius `upper`, azimuth `2π(k + 0.5)/n` | `STAGGER_DEFAULTS`: lower 0.06 m, upper 0.12 m, height 0.06 m, n = 4 per ring (8 mics). n is rounded and at least 2. Node fields override |
| `custom` | `node.mic_offsets_m` as given (2..64) | written by `applyArrayToNode` from the library, so a saved scenario renders without the library |

Derived figures at the defaults (`arrayMetrics`, c at 20 °C = 343.42 m/s):

| Layout | Mics | Nearest / longest | Vertical baseline | Aliasing c/(2 d_min) | Geometry-only error az / el at el = 0°, 20°, 40°, 60° |
|---|---|---|---|---|---|
| `flat_square` (0.1 m) | 4 | 100.0 / 141.4 mm | 0 | 1.72 kHz | 2.05/∞, 2.18/5.98, 2.67/3.18, 4.09/2.36° |
| `tetrahedron` (0.1 m) | 4 | 100.0 / 100.0 mm | 70.7 mm | 1.72 kHz | 2.89/2.89, 3.08/2.89, 3.78/2.89, 5.79/2.89° |
| `stagger_8` (defaults) | 8 | 84.9 / 240.0 mm | 60.0 mm | 2.02 kHz | 1.08/2.41, 1.15/2.30, 1.41/1.97, 2.16/1.53° |

### 4.3 Array library ([arrays.js](packages/sim-core/src/arrays.js))

This replaces the former `micarrays.md`. A model is `{ id, name, status, source, assumed, notes, mics: { name: [x, y, z] mm } }`. The constants are `TIMING_SIGMA_S = 10.4e-6` s (one sample at 96 kHz), `MAX_ARRAY_MICS = 64` and `MAX_COORD_MM = 2000`.

**Summary of the built-in arrays** (figures computed by `arrayMetrics` from the stored coordinates):

| ID | Name | Mics | Nearest / longest | Vertical baseline | Aliasing | Status |
|---|---|---|---|---|---|---|
| `flat4_100` | Flat 4-mic square, 100 mm | 4 | 100.0 / 141.4 mm | 0 | 1.72 kHz | Current simulator array, layout assumed, confirm |
| `ball12_d180` | 12-mic icosahedral ball, D180 | 12 | 94.6 / 180.1 mm | 143.0 mm | 1.82 kHz | Baseline node, draft rev A (30 Oct 2026) |
| `ball12_d180_sub4` | 4-mic subset of the D180 ball | 4 | 94.6 / 180.0 mm | 143.0 mm | 1.81 kHz | open item 3 test array, farthest-point subset |
| `ball12_d180_sub6` | 6-mic subset | 6 | 94.6 / 180.0 mm | 143.0 mm | 1.81 kHz | same |
| `ball12_d180_sub8` | 8-mic subset | 8 | 94.6 / 180.1 mm | 143.0 mm | 1.81 kHz | same |
| `dome12_d230` | 12-mic downward dome, D230 (assumed) | 12 | 66.0 / 216.2 mm | 54.9 mm | 2.60 kHz | candidate, coordinates assumed |
| `puck12_d210` | 12-mic squat puck, D210 (assumed) | 12 | 80.0 / 224.7 mm | 80.0 mm | 2.15 kHz | candidate, coordinates assumed |

**`flat4_100`: flat 4-mic square, 100 mm.** The array the simulator uses by default (`flat_square`, s = 0.1 m), entered as "layout assumed, confirm": the old project notes only said "flat 4-mic, 10 cm". Known behaviour in the simulator (unvalidated): biased, steep elevations and positions below ground.

| Mic | Latitude ° | Azimuth ° | r from axis | x | y | z |
|---|---|---|---|---|---|---|
| M1 | 0 | 45 | 70.7 | +50.0 | +50.0 | 0.0 |
| M2 | 0 | 135 | 70.7 | −50.0 | +50.0 | 0.0 |
| M3 | 0 | 225 | 70.7 | −50.0 | −50.0 | 0.0 |
| M4 | 0 | 315 | 70.7 | +50.0 | −50.0 | 0.0 |

The geometry is the same as `mics.js` `flat_square`, but the mic order differs. `flat_square` numbers SW, SE, NE, NW (mic 1 at (−50, −50)); `flat4_100` numbers NE, NW, SW, SE. It matters only when mics are compared by number. Spacings: 100.0 mm (4 pairs) and 141.4 mm (2 pairs). Geometry-only error: azimuth 2.05° at the horizon. Elevation is unobservable at the horizon (no vertical baseline) and poor above it: 5.98° at 20°, 3.18° at 40°, 2.36° at 60°. The elevation sign (above or below) is ambiguous, which matches the steep elevations and below-ground positions seen so far.

**`ball12_d180`: 12-mic icosahedral ball, Ø180.** Source: `node_design_sheet_d180.pdf` rev A, 30 Oct 2026 (draft, untested). It is a hanging sealed Ø180 ball with a face-up icosahedral array, PoE over one Ethernet cable, and was decided as the baseline node on 28 Oct 2026. There are four layers: A at latitude +52.6°, B +10.8°, C −10.8°, D −52.6°. Layers A and C sit at azimuths 0, 120, 240 and layers B and D at 60, 180, 300, so there are 6 distinct azimuths, each used by two mics at different heights, and neighbouring layers are offset by 60°.

| Mic | Layer | Latitude ° | Azimuth ° | r from axis | x | y | z |
|---|---|---|---|---|---|---|---|
| A1 | A | +52.6 | 0 | 54.6 | +54.6 | 0.0 | +71.5 |
| A2 | A | +52.6 | 120 | 54.6 | −27.3 | +47.3 | +71.5 |
| A3 | A | +52.6 | 240 | 54.6 | −27.3 | −47.3 | +71.5 |
| B1 | B | +10.8 | 60 | 88.4 | +44.2 | +76.6 | +16.9 |
| B2 | B | +10.8 | 180 | 88.4 | −88.4 | 0.0 | +16.9 |
| B3 | B | +10.8 | 300 | 88.4 | +44.2 | −76.6 | +16.9 |
| C1 | C | −10.8 | 0 | 88.4 | +88.4 | 0.0 | −16.9 |
| C2 | C | −10.8 | 120 | 88.4 | −44.2 | +76.6 | −16.9 |
| C3 | C | −10.8 | 240 | 88.4 | −44.2 | −76.6 | −16.9 |
| D1 | D | −52.6 | 60 | 54.6 | +27.3 | +47.3 | −71.5 |
| D2 | D | −52.6 | 180 | 54.6 | −54.6 | 0.0 | −71.5 |
| D3 | D | −52.6 | 300 | 54.6 | +27.3 | −47.3 | −71.5 |

Exact generation (`icosaBall(D)`): R = D/2, layer heights z = ±0.7946545 R (A, D) and ±0.1875925 R (B, C), r = √(R² − z²), coordinates rounded to 0.1 mm. Derived figures (they match the design sheet within the 0.1 mm rounding): spacings 94.6 mm (30 pairs), 153.1 mm (30 pairs) and 180.0 mm (6 pairs); vertical baseline 143.0 mm; aliasing limit about 1.81 kHz with c = 343 m/s (the code reports 1.82 kHz at c(20 °C) = 343.42 m/s). Geometry-only error: 1.14° in elevation at every elevation; azimuth 1.14° at the horizon, growing as 1/cos(el) (1.21, 1.48, 2.27° at 20, 40, 60°). Design-sheet details: mic port Ø8 with an ePTFE membrane, shell wall 5 mm, mic boards held by a rigid frame to ±0.3 mm, 96 kHz 24-bit sampling on one clock across all 12 channels. The port ellipses and mic labels on the sheet are drawn for the front elevation only; they are not extra mics. Diffraction around the shell is not modelled; the mics are free-field points.

Open items from the sheet, not settled before a build:

1. Ball diameter: sweep Ø240, Ø200, Ø180, Ø150, on tonal and impulsive sources separately.
2. Shape: compare against a downward-facing dome and a squat two-ring puck with the same mic count.
3. Mic count: test 4-, 6- and 8-mic subsets on raw 12-channel recordings.
4. Shell: model diffraction around the ball. Until then the simulator treats the mics as free-field points.

**Subsets `ball12_d180_sub4/6/8`** (open item 3): `farthestSubset(BALL_MICS, n)` keeps the first mic (A1), then repeatedly adds the mic whose minimum distance to those already chosen is largest (ties keep the earlier name). The output keeps the original mic order.

- sub4 = {A1, B2, C1, D2}
- sub6 = {A1, B1, B2, B3, C1, D2}
- sub8 = {A1, B1, B2, B3, C1, C2, C3, D2}

Geometry-only error at el 0/20/40/60°: sub6 1.89/2.07, 2.01/2.16, 2.47/2.08, 3.78/1.86°; sub8 1.34/2.06, 1.42/2.16, 1.74/2.08, 2.67/1.82°. **sub4 is degenerate**: all four mics lie in the vertical plane y = 0, so the position scatter matrix is singular and `bearingError` returns ∞ for azimuth and elevation at every elevation. The subset has a vertical baseline, but it cannot observe the y component of the direction. The farthest-point rule is the cause; a 4-mic subset worth testing needs a different choice.

**`dome12_d230`** (assumed): `dome(230, 6)` places two rings of 6 on a sphere of R = 115 mm at latitudes −20° (U ring, azimuths 60k°) and −55° (L ring, offset half a step). The latitudes are a guess. Replace them with `designs/node_geometry_designs.py`.

| Ring | Mics (x, y, z) mm |
|---|---|
| U (−20°) | U1 (108.1, 0, −39.3), U2 (54.0, 93.6, −39.3), U3 (−54.0, 93.6, −39.3), U4 (−108.1, 0, −39.3), U5 (−54.0, −93.6, −39.3), U6 (54.0, −93.6, −39.3) |
| L (−55°) | L1 (57.1, 33.0, −94.2), L2 (0, 66.0, −94.2), L3 (−57.1, 33.0, −94.2), L4 (−57.1, −33.0, −94.2), L5 (0, −66.0, −94.2), L6 (57.1, −33.0, −94.2) |

Geometry-only error: 0.93/2.15, 0.99/2.05, 1.22/1.75, 1.87/1.35°.

**`puck12_d210`** (assumed): `puck(210, 4, 40)` places three rings of 4 at radius 105 mm, at z = +40 (T), 0 (M, offset half a step) and −40 (B). The 40 mm ring gap is a guess.

| Ring | Mics (x, y, z) mm |
|---|---|
| T (z = 40) | T1 (105, 0), T2 (0, 105), T3 (−105, 0), T4 (0, −105) |
| M (z = 0) | M1 (74.2, 74.2), M2 (−74.2, 74.2), M3 (−74.2, −74.2), M4 (74.2, −74.2) |
| B (z = −40) | B1 (105, 0), B2 (0, 105), B3 (−105, 0), B4 (0, −105) |

Geometry-only error: 0.80/1.81, 0.85/1.72, 1.04/1.48, 1.59/1.14°.

### 4.4 Generators (`GENERATORS`, used by the builder)

| Generator | Parameters (defaults) | Layout |
|---|---|---|
| `flat_square` | side_mm 100 | M1..M4 at (±side/2, ±side/2, 0), order NE, NW, SW, SE |
| `ring` | count 6, radius_mm 60 | M_k at azimuth 2πk/count, z = 0 |
| `stagger` | per_ring 4, lower_mm 60, upper_mm 120, height_mm 60 | L_k at 2πk/n, z = 0; U_k at 2π(k+½)/n, z = height |
| `dome` | diameter_mm 230, per_ring 6 | two rings at −20° and −55° latitude, offset half a step |
| `puck` | diameter_mm 210, per_ring 4, gap_mm 40 | three rings at z = +gap, 0, −gap, middle ring offset half a step |
| `icosa_ball` | diameter_mm 180 | the 12-mic ball above |

Coordinates are rounded to 0.1 mm (`r1`).

### 4.5 Derived figures (`arrayMetrics`, `bearingError`)

`arrayMetrics(mics, { tempC = 20 })` returns:

- `count`;
- all pair spacings `|p_i − p_j|`, with `nearest_mm`, `longest_mm` and `spacing_groups` (spacings rounded to 0.1 mm, with pair counts);
- `vertical_baseline_mm = max z − min z`;
- `aliasing_hz = c / (2·d_min)` with c = `speedOfSound(tempC)`. This limits phase methods only; timing methods do not have it;
- `bearing`: the geometry-only 1σ error at elevations 0, 20, 40 and 60°.

**Geometry-only bearing error method** (as in `designs/node_geometry_designs.py`). It assumes a far-field plane wave and independent timing noise σ_t = 10.4 µs per mic (one sample at 96 kHz). It ignores reflections, shell diffraction, mic mismatch and clock drift. The arrival time is `t_k = t_0 − (p_k·u)/c + ε_k`. A least-squares fit of `t` against centred positions gives

```
S = Σ_k (p_k − p̄)(p_k − p̄)ᵀ                    (mm²)
Cov(û) = κ · S⁻¹,   κ = (σ_t · c · 1000)²         (mm², so Cov is dimensionless)
```

For a source on +x at elevation el, with `e_az = (0, 1, 0)` and `e_el = (−sin el, 0, cos el)`:

```
σ_az = sqrt(κ · e_azᵀ S⁻¹ e_az) / max(cos el, 1e-6)        (rad, reported in degrees)
σ_el = sqrt(κ · e_elᵀ S⁻¹ e_el)
```

A **flat** layout (`S_zz < 1e-9·max(S_xx, S_yy, 1)`) uses the 2×2 horizontal block and the unit-length constraint: `σ_tan = sqrt(κ (S_xy⁻¹)_yy)`, `σ_rad = sqrt(κ (S_xy⁻¹)_xx)`, `σ_az = σ_tan / cos el`, `σ_el = σ_rad / |sin el|`, which is ∞ at the horizon. A singular S (det < 1e-12, or 1e-9 for the 2D block) returns ∞. The error is evaluated only for a source on +x; it is not averaged over azimuth. The ball is isotropic, so for it the direction does not matter; for other layouts it can.

### 4.6 Validation, import and node binding

- `validateArrayModel(m)`:
  - id matches `^[a-z0-9][a-z0-9_-]{0,63}$`;
  - name is 1..120 characters;
  - 2..64 mics, each named `^[A-Za-z0-9_-]{1,12}$` with three finite numbers within ±2000 mm;
  - `status` and `source` are truncated to 200 characters, `notes` to 2000;
  - `assumed` defaults to true.
- Import file (`parseArrayImport`): one entry per array, keyed by id; keys starting with `_` are ignored. The file can also hold a single array with `mics`. Each entry takes `units` `mm` (default), `cm` or `m`, applied to every coordinate. `arrayImportTemplate()` is the downloadable example (`_readme`, `_fields`, `_conventions`, `my_array`). A bad entry reports its key.
- `applyArrayToNode(node, model)` sets `mic_layout = 'custom'`, `mic_array`, `mic_array_name` and `mic_offsets_m = mm / 1000`. The layout is copied into the node, so the scenario renders without the library.
- User arrays are stored through `PUT /api/library/arrays/:id` (validated with the same function) and listed with `GET /api/library/arrays`. The built-in arrays are read only.

To add an array, give an ID, a source (design sheet or file), a status, a full coordinate table in the conventions above, the derived figures, and a note on how it behaved in the simulator.

---

## 5. Geometry and path finding

All path logic is in `findPaths` ([geometry.js](packages/sim-core/src/geometry.js)). The render, the wavefront rings, the reach map, the heatmap, the path diagnostics and the mic-view audit all call it.

### 5.1 Solids and surfaces

**Box** (`buildingBox(b)`): `min = [cx − w/2, cy − d/2, 0]`, `max = [cx + w/2, cy + d/2, h]`, and `poly = buildingPolygon(b)` (null for a plain box).

**Footprint polygon** (`buildingPolygon`, cached per building object). It denormalises ring 0, then applies `simplifyRing(ring, FOOTPRINT_SIMPLIFY_M = 1 m)`:

1. drop consecutive duplicates (< 1e-6 m) and the closing duplicate;
2. while more than 3 points remain, remove the vertex with the smallest distance to the line through its two neighbours, if that distance is below 1 m;
3. reject a ring with fewer than 3 points or |area| < 1e-6;
4. return it counter-clockwise (positive signed area).

**Inside tests.**

- `insideBox(p, box)`: strictly inside the box in x and y and `z < h`; for a footprint, also strictly inside the outline (point in polygon and more than `SHRINK` = 1e-6 m from every edge). Points on a wall count as outside, so grazing is not blocking.
- `insideBuilding(p, buildings)` returns the first building that contains p.

**Segment blocking** (`segmentBlocked(a, b, boxes)`).

- *Box*: a slab test against the box shrunk by `SHRINK` on every side returns the parameter range [t0, t1] inside the box, or null.
- *Footprint*: the part of the segment inside the box height range is split where its plan projection crosses the outline (`crossings`). Each piece is inside or outside according to the crossing direction at its ends (entering or leaving a CCW ring). When that is ambiguous (a vertex hit or coincident crossings), a midpoint point-in-polygon test decides, and the strict test is used when the segment runs along a wall.
- With 12 or more buildings, a uniform plan grid of 20 m cells (`GRID_CELL_M`) is built once per boxes array, and a DDA traversal tests only the buildings in the cells the segment crosses. Stamps avoid testing a building twice.

`planRanges(a, b, box)` returns the plan intervals of a segment inside an outline; it is used by the UI side view.

**Reflecting surfaces** (`buildSurfaces`):

- `ground`: z = 0, an infinite plane with normal (0, 0, 1).
- Box walls: four axis-aligned faces per box, `bN:west`, `:east`, `:south`, `:north`, with `axis`, `offset`, `sign`, outward `normal` and `bounds` (the other horizontal axis over the face width, z ∈ [0, h]).
- Footprint walls: one general vertical plane per outline edge, `bN:wall-i`, with `normal = (dir_y, −dir_x, 0)` (outward for a CCW ring), `offset = normal·p`, start `a`, unit `dir`, `len` and `h`.
- **Roofs do not reflect.** They block sound and diffract at their edges, but there is no top face (`ROOF_STUB` marks where one would go). Building undersides and roofs never produce a reflection path.

`planeSide(p, s)` is the signed distance, positive on the outward side. `mirror(p, s)` reflects a point in the plane.

### 5.2 Image-source reflections

**Sequences** (`reflectionSequences(settings, surfaces)`), the single enumeration shared by the render, rings, reach map and diagnostics:

- `reflection_order` 0: only the single ground bounce, and only when `ground_reflectivity > 0`.
- Order 1 or 2: every ordered sequence of 1..order surfaces with no immediate repeat (the same surface twice in a row), drawn from all surfaces. The ground is excluded when `ground_reflectivity = 0`. With N usable surfaces there are `N + N(N−1)` sequences at order 2. A box adds 4 surfaces.

**Images**: `imagesFor(src, seq)` = `[src, m1(src), m2(m1(src)), ...]`, mirroring across each surface in turn. They are cached per source and sequence by callers with many receivers (`imagesCache`).

**Trace** (`traceReflection(src, mic, seq, images, boxes)`): walk backwards from the mic. The specular point on surface k is where the segment from the current point to image k+1 meets the plane (`hit`). A hit must have a parameter in (1e-9, 1 − 1e-9) and lie on the finite face: within `bounds` for a box wall, `u ∈ [0, len]` and z ∈ [0, h] for a footprint wall, anywhere for the ground. Then:

1. every surface must have the points before and after it on its outward side (`outward`, more than 1e-9);
2. no leg `src → h1 → ... → mic` may be blocked by any building.

The path is then `{ type, surfaces, length = |final image − mic|, gain = Π surfaceGain, image, hits }`. `type` is `'wall'` if any surface in the sequence is a wall, otherwise `'ground'`. A rejected sequence is recorded as `off_face` (no specular point on the finite face, or the wrong side) or `blocked` (a leg hits a building).

**Gains** (`surfaceGain`):

- ground: `ground_reflectivity` (real, frequency independent);
- wall: `wallFactor(settings) = sqrt(1 − concrete_absorption)`, default `WALL_PRESSURE_FACTOR = sqrt(1 − 0.03) = 0.98489`.

`CONCRETE_ABSORPTION = 0.03` is one broadband energy absorption coefficient for every concrete face (**placeholder**, not measured). Reflections are specular, frequency independent and phase-preserving (rigid).

### 5.3 Direct path

The direct path is `{ type:'direct', length = |src − mic|, gain: 1, image: src }`. It is kept unless the segment is blocked by a building **and** either the wedge model is on (`diffraction_model 'wedge'` and `diffraction_order >= 1`) or `block_direct_behind_buildings` is true. With wedge diffraction on, the shadow-zone field comes from the diffracted paths and the direct path is dropped as `blocked`. `block_direct_behind_buildings` therefore matters only at order 0 or with the legacy model. With it false, a blocked direct path passes through the building: a test option, not physics.

### 5.4 Edges ([edges.js](packages/sim-core/src/edges.js))

Each edge is a rigid wedge with a local frame: tangent `t`; outward normal `n0` of face 0; `e0`, the direction along face 0 away from the edge; the exterior wedge angle `nπ`; pressure reflection coefficients `r0` (face 0) and `rn` (face n); and `building`.

**Box edges** (`boxEdges`, n = `WEDGE_N` = 3/2, exterior angle 3π/2 = 270°):

- 4 vertical corners `bN:edge:SW|SE|NE|NW` from z = 0 to h, with face 0 and face n the two walls meeting there (r0 = rn = wall factor);
- 4 roof edges `bN:roof:south|north|west|east`, with face 0 the roof (n0 = +z, r0 = 0 because roofs do not reflect) and face n the wall (rn = wall factor).

**Footprint edges** (`polygonEdges`):

- At every vertex the signed turn `θ = atan2(d1 × d2, d1 · d2)` between the incoming and outgoing edge directions decides. A convex corner turning at least `MIN_CORNER_TURN_DEG` = 10° gets a vertical edge `bN:edge:i` with `n = 1 + θ/π` (its own exterior angle), `n0 = (d1_y, −d1_x, 0)` and `e0 = −d1`.
- Concave corners and near-straight corners do not diffract.
- Every wall gets a roof edge `bN:roof:i` (n = 3/2).

**Buried edges** (`buriedEdge`) are left out: edges whose exterior next to them is filled by neighbouring buildings (terraces, `building:part` pieces). A vertical edge is buried when 5 probes at 0.05 m from the corner, at angles `k/6·nπ` (k = 1..5) through the exterior and 0.01 m below the top, are all inside other buildings. A roof edge is buried when probes at 25, 50 and 75 % along it, 0.05 m outward and 0.01 m below the roof, are all inside other buildings. `edgesFor(buildings, wallR)` caches the edge list (and later the edge adjacency) by geometry and wall factor, and clears the cache when it holds more than 16 entries.

**Wedge angle** of a direction v leaving the edge (`wedgeAngle`): project v onto the plane perpendicular to t, then `φ = atan2(v·n0, v·e0)` mapped to [0, 2π). Values within 1e-7 of 2π wrap to just below 0. The exterior is `0 < φ < nπ`. Directions into the solid land above nπ.

**Stationary point** (`stationaryU(e, Q, R)`): the point on the infinite edge line where the path Q → P → R is shortest, which is where the incident and diffracted rays make equal angles with the edge (the Keller cone):

```
u_q = (Q − a)·t,  u_r = (R − a)·t,  a_q = |(Q − a) − u_q t|,  a_r = |(R − a) − u_r t|
u*  = (a_r·u_q + a_q·u_r) / (a_q + a_r)
```

It is null when Q or R is on the edge line. A u* outside [0, len] (tolerance 1e-9) is `off_face`.

**Diffraction angles** (`diffractionAngles(e, P, Q, R, graze)`):

- `s_in = |Q − P|`, `s_out = |R − P|`;
- `φ' = wedgeAngle(Q − P)` (source side), `φ = wedgeAngle(R − P)` (receiver side);
- `β = acos(((Q − P)·t)/s_in)`, the angle between the incident ray and the edge.

It rejects a ray when either end is outside the exterior, or when `sin β < 1e-6`. With `graze = true` (the two-edge chain round the same building) an end lying on a face (within 1e-7) is allowed and halves the coefficient (`scale *= 0.5` per grazing end): the standard UTD rule for incidence along a face.

### 5.5 UTD rigid-wedge coefficient ([diffraction.js](packages/sim-core/src/diffraction.js))

The time convention is e^{+jωt}, so a delay τ is the factor e^{−jωτ}, the same as the renderer. The coefficient is Kouyoumjian–Pathak (1974) with the Fresnel transition function, for a rigid (acoustically hard) wedge with spherical incidence:

```
k  = 2π·max(f, 1 Hz) / c
L  = s·s' / (s + s') · sin²β                          (s' = s_in, s = s_out; spherical-wave distance parameter)
D(φ, φ'; β) = − e^{−jπ/4} · scale / (2n·sqrt(2πk)·sin β) ·
     [   cot((π + (φ − φ'))/(2n)) · F(kL·a⁺(φ − φ'))
       + cot((π − (φ − φ'))/(2n)) · F(kL·a⁻(φ − φ'))
       + R0 · cot((π − (φ + φ'))/(2n)) · F(kL·a⁻(φ + φ'))
       + Rn · cot((π + (φ + φ'))/(2n)) · F(kL·a⁺(φ + φ')) ]
```

In code each term is `cotF(arg, n, kL)`. With `m = round(arg/π)` and `ε = arg − mπ` (the signed distance of the cot argument from the nearest multiple of π), the term is

```
cot(ε) · F(kL · 2 sin²(n ε))
```

which is the standard `a^±(β) = 2 cos²((2nπN^± − β)/2)` with N^± the nearest integer. On a shadow or reflection boundary (|ε| < 1e-7) the product tends to the finite limit `n·sqrt(2πkL)·e^{jπ/4}·sgn(ε)`, which the code uses. Its sign follows the side the receiver is really on, so the coefficient jumps across each boundary by exactly the geometrical-optics field that switches off there, and the total field (geometrical optics plus diffracted) is continuous.

`R0` and `Rn` are the face pressure reflection coefficients: the wall factor for walls, 0 for roofs. With R0 = 0 there is no roof-reflection boundary.

**Transition function** (`fresnelF(x)`):

```
F(x) = 2j·sqrt(x)·e^{jx} · ∫_{√x}^{∞} e^{−jτ²} dτ
```

- For 0 < x < 15 it is evaluated through the Fresnel integrals: with `s = sqrt(2x/π)`, `∫_{√x}^{∞} e^{−jτ²}dτ = (√π/2)e^{−jπ/4} − sqrt(π/2)·(C(s) − jS(s))`, where C and S (argument convention cos(πt²/2)) come from their power series (up to 60 terms, accurate to about 1e-10 for s ≤ 3.1).
- For x ≥ 15 the asymptotic series `F ≈ Σ_{m=0}^{12} (2m−1)!! · (j/(2x))^m` is used (that is, `(−2jx)^{−m}`).
- F(x ≤ 0) = 0. The limits are F → 0 as x → 0 and F → 1 as x → ∞; the switch is continuous (tested).

**Chain response** (`diffractionResponse`): the complex product of the edge coefficients of a chain, `D_chain(f) = Π_i D_i(f)`.

**Pressure of a wedge path.** For a single edge the field at the receiver is `(e^{−jks'}/s')·D·sqrt(s'/(s(s+s')))·e^{−jks}`. The path stores `gain = bounceGain · spread · length`, so the renderer's usual `gain / max(length, 1)` factor gives `bounceGain · spread` with

```
order 1 (E, SE, ES):   spread = 1 / sqrt(s_in · s_out · (s_in + s_out))         (= (1/s')·sqrt(s'/(s(s+s'))))
order 2 (EE):          spread = 1 / sqrt(s0 · s1 · s2 · (s0 + s1 + s2))         (parallel-edge approximation)
```

The delay is `length / c` with `length` the unfolded path length.

**Frequency grid.** The coefficient is evaluated once per path on a 1/12-octave grid from 1 Hz up to and including Nyquist (`diffractionGrid(fs)`: `count = ceil(12·log2(fs/2)) + 2` points at `2^(i/12)` Hz) and interpolated linearly in log frequency to the render bins (`gridMap`; bins at or below 1 Hz use the first grid point). Starting at 1 Hz instead of 10 Hz was a measured fix: clamping below 10 Hz added a −47 dB pre-arrival plateau.

`WEDGE_DESCRIPTION` and `diffractionConstants()` (exported in `simConstants`) state the method, the orders, what is not modelled (facade scattering, ground effects at edges, slope diffraction, vertex diffraction), `placeholder: true` and the references:

- Kouyoumjian and Pathak 1974;
- Keller 1962;
- Biot–Tolstoy 1957 and Medwin 1981 (BTM, the exact reference used in tests);
- Svensson, Fred and Vanderkooy 1999.

### 5.6 The source graph and chain enumeration

The wedge search handles chains of at most two interactions, each an edge diffraction (E) or a single reflection (S):

| Chain | Path | Distance parameters |
|---|---|---|
| `E` | src → P → mic | `L = s_in s_out/(s_in + s_out) · sin²β` |
| `SE` | src → H (reflection on S) → P → mic; the edge sees the image of the source | as E, with `s_in` = image → P (unfolded) |
| `ES` | src → P → H → mic; the edge sees the image of the mic | as E, with `s_out` = P → mic image (unfolded) |
| `EE` | src → P1 → P2 → mic (different buildings, or round the same one with grazing legs) | `L1 = s0 s1/(s0 + s1) sin²β1`, `L2 = (s0 + s1) s2/(s0 + s1 + s2) sin²β2` |

Order 1 enumerates `E` only; order 2 adds `SE`, `ES` and `EE`. The single reflections S are the length-1 sequences of `reflectionSequences`: at `reflection_order` 0 this is only the ground, otherwise every surface. SE and ES chains multiply in the surface gain.

**Source graph** (`buildSourceGraph(src, ...)`), built once per source and shared by every node and mic of the render table, and by every cell of the reach map and heatmap. Visibility is sampled at `EDGE_SAMPLES` = 9 points per edge at `u = (i + ½)/9 · len`:

- `seen`: edges with at least one sample whose wedge angles put the source in the exterior and whose segment from the source is unblocked;
- `reflectEdge`: pairs (single reflection S, edge e) where the source is outward of S and a sample P is outward of S, sees the image in its exterior, and has a specular point H on the finite face with src → H and H → P unblocked;
- `adjacency` (only for `diffraction_order >= 2`): edge-to-edge visibility with `PAIR_SAMPLES` = 5 × 5 samples per pair, both angles in the exterior (grazing allowed on the same building), P1 → P2 unblocked. It is computed on demand, only for rows of edges the source sees, and cached per geometry.

**Per receiver** (`wedgeCandidates`), only the receiver-side legs are tested, and every accepted path is re-checked exactly:

- `E`: `edgeHop(e, src, mic)` (stationary point, finite edge, angles), then src → P and P → mic unblocked.
- `SE`: `edgeHop(e, image, mic)`, then H = specular point between P and the image on S, then src → H, H → P and P → mic unblocked.
- `ES`: for every S with the mic outward, `edgeHop(e, src, mirror(mic, S))`, then H between P and the mic image, then src → P, P → H and H → mic unblocked.
- `EE`: `twoEdgeHops`. Starting at the edge midpoints, it alternates the closed-form single-edge minimiser (u1 given P2, then u2 given P1) up to 80 times until the move is below 1e-10 m; the length is convex in (u1, u2). A clamped optimum (the free stationary point lies off either edge) is a corner path, not a Keller ray, and is dropped as `off_face`. Then the angles are checked (grazing allowed on the same building) and all three legs must be unblocked.

The graph is conservative only to within its sampling: a visible slit narrower than about 1/9 of an edge could be missed, but nothing wrong is ever accepted. The chains the graph never evaluated are counted as `chainSpace − evaluated`, with `chainSpace = n_E + (order >= 2 ? 2·n_S·n_E + n_E(n_E − 1) : 0)`, and recorded as one aggregated `dropped` entry `{ reason:'blocked', count, note:'not visible from the source (visibility graph)' }`.

**Lit zone.** With the wedge model, edge terms are added for every edge visible from both ends, including when the direct path is clear. They are the transition terms that keep the field continuous at the shadow boundary; pruning removes the negligible ones.

**Arrival direction** of a diffracted path: from the mic to the last point before it, which is the last edge point, or the reflection point after it for ES. A bearing that follows a diffracted path points at the edge, not at the source.

**Limit**: a single wedge cannot connect a source and a receiver on opposite sides of a building, so at order 1 such a receiver gets no diffracted path. Over-the-roof and round-the-ends paths are two-edge chains and need order 2.

### 5.7 Legacy Maekawa-type model (`diffraction_model: 'maekawa'`)

This model is kept for comparison and regression and is bit-identical to the old code. It runs only when the direct path is blocked and `diffraction_order >= 1`:

- For every building, each of its edges (box: 4 corners `bN:corner-sw|se|ne|nw` and 4 roof edges `bN:roof-south|north|west|east`; footprint: `bN:corner-i` at every vertex and `bN:roof-i` on every wall) gets the point that minimises src → point → mic, found by golden-section search (50 iterations; the sum of distances is convex along the edge).
- The legs are checked against the **other** buildings only: the diffracting building acts as a screen at that edge, so for a thick box a leg may pass through its own volume.
- The path is `{ type:'diffracted', length = |src − E| + |E − mic|, gain: 1, direct_distance = |src − mic| }`.
- The loss is applied as a real magnitude filter per frequency:

```
δ = length − direct_distance,   N = 2δ·f / c
loss_dB(f) = min(10·log10(3 + 20N), 20)              (DIFFRACTION_CAP_DB = 20)
```

This is ISO 9613-2-style single diffraction `Dz = 10 lg(3 + (C2/λ)·C3·z)` with C2 = 40 (no separate ground bounce on diffracted paths), C3 = 1 and the 20 dB single-diffraction cap. These constants were taken from memory of the standard and never checked against the text (**placeholder**). The loss is 4.77 dB at N = 0, and the model gives a level step at the shadow boundary because it applies only to blocked paths. The cap is 64 paths (`LEGACY_MAX_PATHS`), with no pruning.

### 5.8 Pruning, cap and the audit of drops

- `pathPressure(path, f, c)`: `g0 = gain / max(length, 1)`, times `|D_chain(f)|` for a wedge path, or times `10^(−loss_dB(f)/20)` for a legacy diffracted path. Air absorption is not included.
- **Pruning** (wedge model only, `prunePaths`): at 250 Hz, 1 kHz and 4 kHz, `level_i(f) = pathPressure(f) · 10^(−α(f)·L/20)`. A path is dropped (`pruned`) when `level_i(f) < max_j level_j(f) · 10^(−path_prune_db/20)` at **all three** frequencies.
- **Cap**: `MAX_PATHS_PER_MIC` = 128 for the wedge model (a safety cap; pruning is the main limiter), 64 for the legacy model. The direct path is always kept. When the other paths exceed `cap − direct`, the wedge model keeps the strongest by `pathPressure(1 kHz)` and the legacy model the shortest; the rest are `path_cap`. Kept non-direct paths are in order of length. A cap hit logs a console warning.
- **Result**: `findPaths` returns `{ paths, directBlocked, capped, dropped }`, with each path carrying `delay_s = length / c`. Every rejected candidate is in `dropped` with a reason (`off_face`, `blocked`, `path_cap`, `pruned`). Nothing is dropped silently.

**Path table** (`computePathTable(scenario, micPositionsOf, c, positionOf)`): per node, `perMic[mi][si]` (one `findPaths` result per true mic position and source) and `centre[si]` (to the node centre, used by diagnostics and windows). `positionOf` defaults to the first keyframe; the render passes the mid-clip reference position for moving sources (6.6).

**`simConstants()`** is written into every results export:

- `diffraction`: `diffractionConstants()`;
- `diffraction_legacy`: formula, `c2_equivalent` 40, cap 20 dB, placeholder;
- `concrete_absorption` 0.03 (placeholder);
- `wall_pressure_factor` (placeholder);
- `max_paths_per_mic` 128;
- `path_prune_db` default 50 with its rule.

### 5.9 Wavefront rings ([wavefront.js](packages/sim-core/src/wavefront.js))

The rings are a loudness display, not true wavelengths.

**Clip analysis** (`analyseClip`), computed once per clip in 10 ms frames (hop = round(0.01·fs)):

- `rms` over the hop;
- spectral `centroid = Σ p_k f_k / Σ p_k`;
- `flatness = exp(mean ln p_k) / mean p_k`.

The last two come from a 512-point Hann FFT centred on the frame, over bins 1..255.

**Rings at time t** (`wavefrontRings`), for every frame f that has left the source (`age = t − start_s`, emitted at `start_s + f·0.01`):

```
r3   = c·(age − f·0.01)                      3D radius of that frame's sphere
ρ    = sqrt(r3² − dz²)                       its cross-section on the slice plane (dz = source z − slice z); none if r3 < |dz|
amp  = rms_f · gainPa / max(r3, 1)           same 1/r law and 1 m floor as the render (gainPa = clipGainPa)
```

Rings with `amp < floorPa = dbToPa(noise_floor_db_spl)` are culled. Beyond `maxRings` the list is thinned by a stride, keeping the loudest ring in each group.

**UI styling** (main.js):

- `alpha = min(1, 20·log10(amp/floor)/60) · scale`;
- with "Tone and grain" on, `lineWidth = 1 + 3·(1 − min(centroid, 4000)/4000)` px and a dash `[2, 1 + 4·flatness]` px when `flatness > 0.2`;
- `maxRings = max(20, round(150/max(1, speed)))`, or 24 for particles.

Direct rings are clipped where the line from the source to the ring point is blocked (no diffraction). **Reflected rings** use `reflectionImages` (the same sequences and gains as `findPaths`, ground image at −z_src included): the ring is centred on the image, scaled by the bounce gain, uses `dz = image z − slice`, and exists only where `traceReflection` finds a valid specular point for that ring point. Reflected rings are drawn at 0.7 (ground) or 0.85 (walls) alpha. A moving source draws each ring centred where the source was when that frame left it (`positionAt(src, emit_s)`) and has no reflected rings. The rings do not diffract.

---

## 6. Render

### 6.1 Clip level calibration

`loudestWindowRms(samples, fs)` is the largest RMS over a sliding 125 ms window (`LEVEL_WINDOW_S`, 6000 samples at 48 kHz), computed with a prefix sum of squares; a clip shorter than the window uses its whole-clip RMS. Then

```
clipGainPa = dbToPa(level_1m_db) / loudestWindowRms          (Pa per clip unit)
```

so the loudest 125 ms of the clip is `level_1m_db` at 1 m. The renderer, rings, reach map and heatmap all use this gain. For an impulsive clip the whole-clip mean (reach map, heatmap level mode) reads below the loudest moment.

### 6.2 Frequency-domain rendering per mic (`prepareRender`, `addSourceSpectrum`, `addPath`)

**Setup** (`prepareRender`):

- `fs = render_sample_rate`, `total = ceil(lengthS·fs)`, `n = nextPow2(total)`, `bins = n/2 + 1`, `c = speedOfSound(T)`;
- each source clip is scaled by `clipGainPa`, giving a signal in Pa at 1 m;
- a static source gets one forward FFT of size n (`rfft`, zero-padded); a moving source gets none (6.6);
- the absorption table `α_k = α(k·fs/n)` is computed once (zero when absorption is off);
- the true mic positions (3.6), the reference source positions (moving: mid clip) and the path table are prepared;
- `toDigital = digitalPerPa(spl_ref_db, dbfs_ref_db)`.

**Per path**, with τ = `start_s + delay_s` and for bins k = 1..min(kMax, n/2 − 1):

```
Y_k += X_k · g0 · 10^(−α_k·L/20) · H_k · e^{−j2π·k·fs·τ/n}
g0  = gain / max(L, 1)                              spreading 1/r with a 1 m floor; gain = product of bounce gains
H_k = 1                                             direct, ground, wall
H_k = 10^(−loss_dB(f_k)/20)                         legacy diffracted (real)
H_k = D_chain interpolated from the 1/12-octave grid    wedge paths (complex), section 5.5
```

The delay is an exact phase ramp, so any fractional delay is applied with no interpolator. The rotation `e^{−jkΔ}`, `Δ = 2π·fs·τ/n`, is advanced by complex multiplication and re-anchored with an exact `cos/sin(kΔ)` every 1024 bins (at k = 1, 1025, 2049, ...) to keep rounding drift negligible. The Nyquist bin (k = n/2) is never written and stays 0.

**DC handling.** DC goes through the same filter chain: for non-wedge paths `Y_0 += X_0 · g0 · 10^(−α_0 L/20) · H_0`; for wedge paths `Y_0` takes the real part of `X_0 · w_0`. Skipping the losses at DC (the original code added `X_0·g0`) put a single-bin step into the magnitude response, which spreads as a constant pedestal across the whole impulse response (measured −32 dB tail). The independent reference renderer found it, and the fix moved the diffraction-scene agreement from −42 to −68 dB.

**Summation and output** (`renderScenario`), per node and mic:

1. accumulate every source through its paths at that mic into one complex half-spectrum;
2. `irfft` at size n and keep the first `total` samples;
3. add `amb + self` (3.5);
4. multiply by `toDigital · micGain`.

Progress is reported per mic (the worker scales it to 90 %). The return value is

```
{ sample_rate, length: total, nodes: [{ id, mic_positions, mic_positions_true, mics: Float32Array[N] }],
  paths: table, source_positions, activity, audit }
```

Because the transforms are circular, a path arriving after n/fs would wrap to the start. The render length padding (2.7) plus the power-of-two rounding of n keeps the wrap in silence; this is tested with a path arriving at 94 % of the buffer.

**Audit records.** When `record` is given (the main render does this for every static source), each applied path is pushed as the render stage applies it:

```
{ type, surfaces, delay_samples: τ·fs, gain_db_1khz: 20·log10(|g0 · air(1 kHz) · H(1 kHz)|) at bin round(1000·n/fs), filter: text }
```

The audit reads what the renderer did, never the geometry. The mic view compares it with an independent `findPaths` recomputation and flags differences above 0.05 samples or 0.05 dB (9.7). Moving sources record nothing.

`pathsTo(src, mic, settings)` is a free-field helper: direct path plus a single ground bounce, no buildings.

### 6.3 Components ([components.js](packages/sim-core/src/components.js))

`renderComponents(scenario, clips, lengthS, nodeIndex, mode)` re-renders one node with the same code and seed. `COMPONENT_MODES`:

- `by_source`: one series per source, plus noise;
- `by_path`: one series per path type `direct`, `ground`, `wall`, `diffracted` (all sources), using a path filter;
- `noise`: ambient plus self noise only.

Values are digital floats (times `micGainFor`). By-source components plus noise equal the total render to a relative error below 1e-6. The mic view uses this through the worker.

### 6.4 Motion helpers ([motion.js](packages/sim-core/src/motion.js))

- `isMoving(src)`: more than one keyframe. `motionSpan(src) = [t_first, t_last]`. `pathLength` is the sum of segment lengths. `pathSpeed = pathLength / (t_last − t_first)` (mean speed).
- `positionAt(src, t)`: the first keyframe before t_first, the last after t_last, and in between linear interpolation within the segment `[k_{i−1}, k_i]` that contains t: `p = a + u(b − a)`, `u = (t − t_a)/(t_b − t_a)`.
- `keyframesAlong(points, t0, t1)`: times proportional to cumulative distance, so the speed is constant along the whole polyline.
- `retime(src, t0, t1)` rescales all times linearly, keeping the trip at least `MIN_MOTION_S` = 0.1 s long. `shiftTimes(src, dt)` shifts them, never before 0. `translatePath(src, dx, dy)` and `setPathHeight(src, z)` move positions in place.
- `samplePath(src, step = 0.5)` returns points at most 0.5 m apart, for placement checks.
- `referencePosition(src, clipDuration)` is the keyframe for a static source, or `positionAt(src, start_s + clipDuration/2)` for a moving one. It is used for the path table and diagnostics.
- `emittedPosition(src, receiver, tArrival, c)` is the position that emitted the sound reaching `receiver` at `tArrival`, found by fixed-point iteration on the retarded time:

```
p_0 = positionAt(t_arr);   p_{i+1} = positionAt(t_arr − |p_i − receiver| / c)      (≤ 50 iterations, stop when |Δp| < 1e-9 m)
```

  It converges because the source speed is far below c.

### 6.5 Knots and crossfades

`motionKnots(src, clipStart, clipEnd, { stepM = 0.25, minHopS = 0.01, maxHopS = 0.1, maxKnots = 300 })`:

- the knots always include the clip ends;
- inside the overlap [a, b] of the clip and the motion span, `hop = clamp(stepM / v, 0.01, 0.1)` s with v the mean speed. If `(b − a)/hop > maxKnots − 2`, then `hop = (b − a)/(maxKnots − 2)`. There are `N = ceil((b − a)/hop)` equal steps from a to b, plus every keyframe time inside (a, b);
- the knots are sorted and de-duplicated (> 1e-6 s apart).

Outside the motion span the source is still, so the clip ends are the only knots there.

`hatWeight(knots, j, t)` is the linear hat function of knot j: it is 1 at `knots[j]`, falls linearly to 0 at the neighbouring knots, and is 0 beyond them. The weights of all knots sum to 1 on [first, last].

### 6.6 Moving sources (`movingSignal`, `addMovingSource`)

For one mic (true position, or the node centre when `mi` is null):

1. Build the knots over the clip `[S, S + L/fs]` (S = `start_s`).
2. For each knot j, piece j covers clip samples `a = ceil((k_{j−1} − S)fs)` to `b = floor((k_{j+1} − S)fs) + 1`, clamped to the clip, and is weighted sample by sample by `hatWeight(knots, j, S + i/fs)`. The pieces overlap and sum back to the clip.
3. The paths of piece j come from `findPaths(positionAt(src, k_j), mic)`, with one source graph per distinct knot position, cached. Delays, levels, reflections, diffraction and occlusion therefore follow the route. The position is taken at the emission time of the knot.
4. Delay groups: one forward FFT of the piece at size `m = nextPow2(len + 2·MOVING_PAD + 1 + MOVING_SPREAD)` (`MOVING_PAD` = `MOVING_SPREAD` = 2048 samples). Paths are sorted by delay and grouped while `ceil((τ − τ_min)·fs) ≤ room = m − len − 2·2048 − 1`. Each group starts at sample `B = floor((t_A + τ_min)·fs) − 2048`, is rendered in the m-size transform with `addPath` (delays `t_A + τ − B/fs`, the same filters), inverse transformed once, and overlap-added at B. Late echoes therefore never force one huge transform.
5. The full-length signal is transformed once at size n and added to the mic accumulator. The all-paths spectrum at mic 0 is cached per (source, node) because the activity pass needs it again.

**Doppler** is not a continuous time warp. It arises from the change in path delay between consecutive pieces: each piece is delayed by its knot's constant delay, and the crossfades blend neighbouring delays, so pitch follows the delay rate piecewise. Cutting the tails of the fractional-delay kernels at the piece edges limits the precision: a two-keyframe source that does not move renders about −40 dB off the static render.

A moving source:

- has no full-length spectrum;
- requires `addSourceSpectrum(..., at = { ni, mi })`;
- records no audit entries;
- has its path table entry (`rendered.paths`) at the mid-clip reference position (`rendered.source_positions`).

How the analysis treats moving sources (emitting position, recomputed centre paths, swept-azimuth uncertainty): **see §7**.

### 6.7 What the activity pass computes ([activity.js](packages/sim-core/src/activity.js))

`computeActivity(ctx, ni)` runs once per node right after its mics are rendered. It produces, per source, the own-contribution power in the localisation band at **mic 0** (the first mic of the layout) in 10 ms frames (`FRAME_S`), twice: `all` (every path) and `direct` (direct path only). It also produces the band noise power. It does this without rendering a full-rate signal per source:

- **Decimation** by `DEC = decimationFor(band, fs)`: the largest power of two ≤ 8 with `1.2·f_hi < 0.95·fs/(2·DEC)`. That is 8 for the default 200–1600 Hz band (as before 0.4), 4 for 200–3000 Hz and 2 for the 50–9000 Hz detection band. The source is accumulated only up to bin `kMax = m/2`, `m = n/DEC`. The band-weighted bins `lo..hi` are copied into a half-spectrum of size m/2 + 1 and inverse transformed at size m. That gives the band-limited signal at fs/DEC, scaled by n/m = DEC, which is divided out (`x/DEC`). It is then multiplied by mic 0's digital gain (including the gain error).
- **Band edges** (`bandWeight(f, [lo, hi])`): raised-cosine skirts 20 % wide, so a hard cut-off does not ring for seconds and stretch the windows:

```
w(f) = 0                                              f ≤ 0.8·lo  or  f ≥ 1.2·hi
w(f) = ½ − ½·cos(π (f − 0.8 lo)/(0.2 lo))             0.8 lo < f < lo
w(f) = 1                                              lo ≤ f ≤ hi
w(f) = ½ + ½·cos(π (f − hi)/(0.2 hi))                 hi < f < 1.2 hi
```

  The bins used are `lo = max(1, ceil(0.8·f_lo·n/fs))` and `hi = min(m/2 − 1, floor(1.2·f_hi·n/fs))`. The decimated Nyquist must stay above 1.2·f_hi; `decimationFor` guarantees it (before 0.4 the factor was fixed at 8 and a band above about 2.5 kHz was silently truncated).
- **Frames**: frame length `round(0.01·fs/8)` decimated samples (60 at 48 kHz), `frames = floor(total/(fs·0.01))`; power is the mean of `v²` per frame (digital units²).
- **Noise band power**: the actual noise of mic 0 (`amb + self`, including correlated noise, times the gain) is transformed at size n:

```
noise_band_power = (2 / (n·total)) · Σ_{k=lo..hi} w(f_k)² · |N_k|²            (Parseval, mean power over the render)
```

The same is done a second time in `detection_band_hz` (default 50–9000 Hz, all paths) for the "detected" SNR (P8, §7.9).

Output: `{ frame_s: 0.01, per_source: [{ all, direct, detection: Float32Array }], noise_band_power, noise_detection_power, detection_band_hz }`. How these frames become windows and SNR: **see §7**.

---

## 7. Analysis: from rendered audio to bearings, fixes, tracks, candidates and labels

Entry point: `analyseScenario(scenario, rendered, clipDurations, { progressive, profile })` in [analyse.js](packages/sim-core/src/analyse.js). It runs in the render worker right after `renderScenario` and returns one result per source. Labelling (§7.12) runs afterwards on the main thread and never changes anything computed here.

**Ground truth and the simulator.** The analysis mixes two kinds of input, and the export says which is which:

- *Measured* inputs a real node would also have: the mic mixtures, the node positions and orientations, the site model (buildings).
- *Simulator-only* inputs a real node would not have: each source's own contribution at mic 1 (`rendered.activity`), the true paths from the true source position (`rendered.paths`), and the true position itself.

Window containment (P1), the in-window SNR, the overlap level difference, the multipath term, the picked path and the track dominance gate use simulator-only inputs, and are marked as such below. `fix_suspect`, the window policy trigger, the reflection guard, the fix solver and the back-trace use measured inputs only.

All thresholds below are settings (`scenario.settings`), listed with their defaults in §7.14. **None is measured: every one is a placeholder** and is exported with `placeholder: true`.

### 7.1 Pipeline per source

```
for each source s:
  for each node n:
    active window   (own in-band power above noise, 10 ms frames)                    §7.2
    arrival span    (emission interval + propagation delay)        -> containment     §7.3
    overlap         (other sources' active windows in it, level difference)           §7.4
    candidate window (non-overlapped piece, or the whole contained window, flagged)
    window policy   (trigger type -> onset_gated | adaptive_long | fixed)             §7.5
    bearing         (GCC-PHAT TDOAs -> plane-wave least squares)                     §7.6
    in-window SNR gate (below min_snr_db: no_signal, no bearing)                      §7.3
    path report + picked path                                                         §7.8
    uncertainty     (noise ⊕ motion ⊕ multipath) and fix weight terms                 §7.7
    detected / localisable / heard                                                    §7.9
  fix              (robust weighted horizontal fix, z, flags)                         §7.10
  track            (common emission time, alpha-beta)                                 §7.11
  back-trace       (reflection, edge and roof hypotheses)                             §7.13
```

### 7.2 Activity frames and the active window

The activity pass (§6.7) gives, per node and source, `per_source[si].all[f]`. This is the mean power of the source's own contribution at mic 1, all paths, in the localisation band, in 10 ms frame `f`. It also gives `direct[f]` (direct path only), `detection[f]` (all paths, detection band) and the noise powers `noise_band_power` and `noise_detection_power`.

```
meanPower(frames, t0, t1) = mean of frames[floor(t0/0.01) .. max(f0+1, ceil(t1/0.01)) - 1]
toDb(p, N)                 = 10 log10(max(p / N, 1e-6))
```

**Active window** (`activeWindow`): first frame `a` and last frame `b` where `all[f] ≥ N · 10^(window_snr_db/10)` (default 3 dB):

```
active = [max(0, a·0.01 − pad), min(L, (b+1)·0.01 + pad + spread)]
pad    = window_pad_ms / 1000 (10 ms),   spread = max − min path delay to the node centre
```

No frame above the threshold gives `active = null`; the node falls back to `[start + firstDelay, +0.2 s]` and gets status `no_signal`. The active window spans first to last active frame, so it can contain silent gaps (a dog's barks, two bursts).

`snr_db` (unchanged from 0.3) = `toDb(meanPower(all, active), N)`: the source's in-band SNR over the active window.

### 7.3 P1: arrival-span containment and the in-window SNR gate ([windows.js](packages/sim-core/src/windows.js) `arrivalSpan`)

A source with clip duration `D` (from `clipDurations`) emits during `[start_s, start_s + D]`. At node `n`:

- **Static source**: `span = [start + d_min, start + D + d_min + spread]`, where `d_min` is the first path delay and `spread` the delay spread of the centre paths.
- **Moving source**: `t + |p(t) − node| / c` is sampled every 50 ms over the emission interval. The span is `[min, max + spread]`.

The localisation window must lie in `span ± pad`. So `contained = active ∩ [span0 − pad, span1 + pad]`; an empty intersection means `no_signal`. Containment trims the 10–30 ms of noise that frame quantisation and padding put before the arrival. *(Simulator-only: it uses the true start time.)*

**In-window SNR.** `window_snr_db = toDb(meanPower(all, w), N)` on the window `w` the bearing is finally taken on. If `window_snr_db < min_snr_db` (6 dB), the node gets `localisation_status: 'no_signal'` and `bearing: null`, and it contributes nothing. This closes the 0.3 hole where a node was `reliable: true` on a silent window. The regression scene: a gapped source whose only non-overlapped part was the silence between two bursts, which 0.3 reported with ±90° and a 70–78° error. *(Simulator-only: own-source power.)*

### 7.4 Overlap and the candidate window

`others` = sources whose active window at this node intersects `active`.

- `overlap_s` = length of the union of the intersections.
- `level_diff_db` = `10 log10(Σ_others ∫ P_other / ∫ P_own)` over the shared intervals: positive means the others are louder. *(Simulator-only.)*

**Candidate window.** With others present, the analysis subtracts their windows from the contained window. It keeps the longest free piece that is at least `min_window_ms` (30 ms) long *and* has a window SNR of at least `min_snr_db`: `localised_on: 'non_overlapped_part'`. With no such piece it uses the whole contained window and sets `localisation_status: 'unresolved_overlap'`, `overlapped: true`. Windows shorter than `min_window_ms` are widened about their centre.

`reliable` = status `ok` (as in 0.3, and as the labelling doc's overlap rule asks: overlapped windows are unreliable). **Since 0.4, `reliable: false` no longer keeps a node out of the fix.** Any node with a usable bearing enters it, weighted (§7.10).

### 7.5 P2: window policy ([windows.js](packages/sim-core/src/windows.js))

`window_policy` setting: `'auto'` (default) or `'fixed'`. `'fixed'` is the 0.3 behaviour: one bearing over the whole candidate window. Under `'auto'`, the *trigger type* picks the policy. The trigger comes from the mixture, never from a classifier.

**Trigger** (`triggerType`). This runs on the mixture in-band frames of mic 1 (`mixtureFrames`, the same raised-cosine band; cached per node):

```
floor = median of frames in [t − 1 s, t − 30 ms]
rise  = 10 log10( max frame in [t, t + trigger_rise_ms] / floor )
type  = impulsive if rise ≥ trigger_rise_db (12 dB) else sustained          trigger_rise_ms = 50
```

with `t` = start of the candidate window. The node exports `trigger: { type, rise_db, onset_s }`.

**onset_gated** (impulsive, and only when the candidate window starts at the onset). Steps:

1. Take a preliminary bearing `u` on `[t, t + pad + onset_window_ms]`.
2. **Reflection guard** (`reflectionGuardS`, site model only). For each wall within `reflector_search_m` (30 m) in front of which the node stands, at distance `d` with outward normal `n`: a far source in direction `u` (with `n·u > 0`) produces a specular reflection off it with extra delay

   ```
   Δt = 2 d (n · u) / c
   ```

   if the reflection point `node + (d/(n·u)) · (u − 2(n·u) n)` lies on the face (its extent and height). The guard is the smallest `Δt`.
3. Window length `= clamp(Δt, onset_min_ms, onset_window_ms)` (10–25 ms), plus `pad`.
4. If that window holds at least `onset_min_ms` with `window_snr ≥ min_snr_db`, use it. Otherwise fall through to adaptive_long.

The export carries `reflection_guard: { delay_s, surface, distance_m }`.

**adaptive_long** (sustained, or the fallback; `adaptiveWindow`). Windows grow from `t` by doubling: `τ = max(20 ms, min_window_ms) · 2^k`, then the whole window. Steps with `window_snr < min_snr_db` are skipped. Growth stops at the first step whose bearing drifts from the previous one by more than `max(adaptive_drift_deg, 3·√(σ_k² + σ_{k−1}²))` (`bearing_drift`), or whose uncertainty rises by more than `adaptive_sigma_rise` (25 %; `uncertainty_rise`). Of the accepted steps, the one with the lowest plane-wave residual `residual_s` (cross-mic consistency) is chosen. `adaptive_stop` records why growth stopped. For a steady tone this keeps long windows, since time gating cannot remove coherent interference. For a continuous source that another source later swamps, it stops before the takeover: the 0.3 "whole-window locking".

`progressive` (UI wedges) reuses the adaptive steps when present; otherwise it is the doubling sequence up to the chosen window.

### 7.6 Bearing ([localise.js](packages/sim-core/src/localise.js), unchanged)

**GCC-PHAT per pair** (`windowTdoas`). For window `[s0, s1)`:

1. Hann-window the samples: `w_i = ½ − ½ cos(2π(i + ½)/len)`.
2. Transform at size `n = nextPow2(2·len)`. Two real mics are packed into one complex FFT and separated with `A = (Z_k + conj Z_{n−k})/2`, `B = (Z_k − conj Z_{n−k})/(2j)`.
3. Keep only bins `lo..hi` of the localisation band.
4. Correlate with the PHAT weighting:

   ```
   G_k = A_k conj(B_k) / |A_k conj(B_k)|
   r(l) = (2/N_up) Σ_{k=lo..hi} Re{ G_k e^{j 2π k l / N_up} },   N_up = 4n   (4x up-sampled lag grid)
   ```

   `r(l)` is evaluated directly only at lags `|l| ≤ ceil(maxLag·4fs) + 4`, with `maxLag = max mic spacing / c`.
5. Refine the peak parabolically: `δ = ½(y₋ − y₊)/(y₋ − 2y₀ + y₊)`, `τ_ij = (l* + δ)/(4 fs)` (positive: sound reaches mic i later than mic j).

**Plane-wave fit.** For unit direction `u` towards the source, `t_i − t_j = −(p_i − p_j)·u / c`, so each pair gives a row `(p_j − p_i)·u = c τ_ij`. Least squares solves `AᵀA u = Aᵀb`.

- 3D arrays: solve the 3×3 system and normalise `u`. `elevation_confidence: 'low'` if `|el| > 80°`.
- Flat arrays (all row z = 0): solve for the horizontal part `h` only. If `|h| > 1`, scale it to 1. Then `u = (h_x, h_y, −√(1 − |h|²))`: the source is *assumed below* the node (`elevation_sign_assumed: true`). `elevation_raw_deg = acos|h|`; `elevation_confidence: 'low'` if `|h| > 1` or `|el| < 15°`.

Outputs: `direction`, `azimuth_deg = atan2(u_y, u_x)`, `elevation_deg`, `residual_s = rms((A u − b)/c)`.

### 7.7 Uncertainty (P5) and fix weights (P3) ([uncertainty.js](packages/sim-core/src/uncertainty.js))

**Noise term** (unchanged CRB; Carter, band-limited white signal), with `s` = linear in-window SNR, `T` the window length and `[f₁, f₂]` the band:

```
γ² = (s/(1+s))²
var(τ) = (1 − γ²) / (2 T γ² (4π²/3)(f₂³ − f₁³))
σ_τ = max(√var(τ) · PHAT_EFFICIENCY_PENALTY, 0.125 / (4 fs √12))        (interpolation floor; penalty = 1, placeholder)
σ_t = σ_τ / √2
σ_az = c σ_t / ( √Σ_k ((p_k − p̄)·e_az)² · max(cos el, 0.15) ),   e_az = (−sin az, cos az, 0)
```

The result is clamped to 90°.

**Motion term** (moving sources): `σ_motion = |az(emitted at w0) − az(emitted at w1)| / 2`, the half swept angle. *(Simulator-only.)* `uncertainty_noise_deg = √(σ_noise² + σ_motion²)`.

**Multipath term** (`multipathSigmaDeg`; *simulator-only*: uses the true paths of §7.8):

```
a      = min(1, 10^(−D/R / 20))          D/R = direct_to_reflected_db (no direct path: a = 1)
spread = min(1, delay_spread / multipath_spread_ref_ms)
inWin  = clamp((T − gap)/T, 0, 1)        gap = reflection_gap_s (strongest reflection after the first arrival)
σ_mp   = multipath_floor_deg · a · spread · inWin                     (5°, 20 ms)
```

An onset-gated window that ends before the reflection arrives has `inWin = 0`.

**Reported uncertainty**: `uncertainty_deg = min(90, √(σ_noise² + σ_motion² + σ_mp²))`. The export keeps `uncertainty_noise_deg`, `uncertainty_motion_deg` and `uncertainty_multipath_deg`.

**Fix weight terms** (`weight_terms`):

```
σ_overlap   = overlapped ? overlap_sigma_deg · 10^(min(level_diff, 20)/20) : 0                 (10° at 0 dB)
σ_reflector = reflector_sigma_deg · exp(−d_wall / reflector_scale_m)                            (3°, 5 m)
σ_total     = min(90, √(uncertainty_deg² + σ_overlap² + σ_reflector²)),    weight = 1 / σ_total²
```

`d_wall` = `nearest_reflector_m` (`nearestReflectorM`): horizontal distance from the node to the nearest wall face reaching the node's height. Site model only.

### 7.8 Path report and picked path ([pathreport.js](packages/sim-core/src/pathreport.js))

Per node and source, from the centre-of-array paths at the true position. A moving source uses the paths recomputed from the position that emitted the localised window: `findPaths` replaces `rendered.paths[ni].centre[si]`. *(Simulator-only.)* For each path:

- `level_db_re_direct = 20 log10(|p(1 kHz)| / |p_ref(1 kHz)|)`, with `p_ref` the direct path or, without one, the strongest path. `pathPressure` includes 1/r, bounce gains and the diffraction coefficient, and excludes air absorption.
- `arrival_azimuth_deg` / `arrival_elevation_deg`: direction from the node to the path's image point.
- For diffracted paths, the diffraction loss and phase at 1 kHz.

Also: `direct_to_reflected_db` (direct vs strongest non-direct), `delay_spread_s`, `reflection_gap_s`, `first_path_delay_s` and `direct_blocked`.

**Picked path (P5).** Among paths within `picked_path_tolerance_deg` (5°) of the bearing azimuth, a path is eligible when:

- its level is within `picked_path_level_window_db` (15 dB) of the strongest path; and
- when the bearing's elevation is trustworthy (`elevation_confidence ≠ 'low'`), its elevation is within `picked_path_elevation_tol_deg` (10°). Flat arrays compare `|elevation|`, because their sign is assumed.

The **strongest** eligible path is picked (0.3 picked the first azimuth match, which matched −50 dB paths). Outputs: `picked_path_index`, `picked_path_type`, `bearing_error_vs_direct_deg`, `bearing_error_vs_picked_deg`. `uncertainty_valid = bearing && picked_path_type === 'direct' && status ≠ unresolved_overlap` (unchanged).

### 7.9 P8: detected, localisable, heard

- `snr_detection_db = toDb(meanPower(detection, active), noise_detection_power)`: own broadband SNR in `detection_band_hz` (50–9000 Hz).
- `detected_broadband = snr_detection_db ≥ min_snr_db`.
- `localisable = snr_db ≥ min_snr_db or window_snr_db ≥ min_snr_db` (localisation band).
- `heard = detected_broadband or localisable`. A node can be detected without being localisable, and is then still "heard".
- `usable = bearing ≠ null`: it passed the in-window SNR gate.

Per source: `heard_nodes` = count of `heard` (0.3 counted only the nodes used in the fix), and `usable_nodes` = count of `usable`.

`snr_broadband_db` is the legacy whole-mixture figure: total mic-1 power over the active window (every source) against the analytic noise. `snr_direct_db` is the direct path only.

**Spatial aliasing.** `aliasing_limit_hz = c / (2 d_min)` per node; `band_above_aliasing` when the band top exceeds it. 10 cm square: ≈1.70 kHz; D180 ball: ≈1.81 kHz. Phase methods alias above it. GCC-PHAT on time delays does not, but its side lobes grow. The UI offers 200–1600 (default), 200–3000 and 100–4000 Hz bands. The activity decimation now follows the band (`decimationFor`: the largest power of two ≤ 8 with `1.2 f_hi < 0.95 fs/(2·DEC)`), so wide bands are no longer cut off at 2.5 kHz.

### 7.10 P3/P4: the position fix ([fix.js](packages/sim-core/src/fix.js) `robustFix`)

Inputs: every usable node as a horizontal ray: origin `o_i`, `u_i = (cos az_i, sin az_i)`, `σ_i = weight_terms.total_deg`, elevation and `elevation_trusted = !elevation_sign_assumed && elevation_confidence = 'ok'`.

**Weighted least squares (2D).** The point closest to the rays solves

```
Σ_i w_i (I − u_i u_iᵀ)(x − o_i) = 0
w_i = 1/σ_i²  (first pass),  then twice  w_i = 1 / (max(t_i, 1) · σ_i)²,   t_i = (x − o_i)·u_i
```

so each ray counts by the metres of error it implies at the fix.

**Residuals.** `z_i = |(x − o_i) × u_i| / (max(t_i, 1) · tan σ_i)`: the perpendicular miss in units of the miss one sigma of bearing implies there. `z = ∞` if `t_i ≤ 0`.

**Consensus (≥ 3 rays, `method: 'ransac_wls'`).**

1. Every pair crossing at `fix_min_crossing_deg` (10°) or more, meeting in front of both nodes, proposes its intersection.
2. The inlier set is the rays with `z ≤ fix_inlier_gate_sigma` (3). The largest set wins; ties go to the lower `Σ min(z, gate)²`.
3. The set is refitted, and rays that agree with the refit are re-admitted.
4. **Leave-one-out**: while three or more rays remain, drop the ray whose residual against the fit of the others is largest, if that exceeds the gate. A fit of the others counts only if those others still cross at ≥ 10°. Two near-parallel rays prove nothing: without this rule, LOO dropped good rays in the `overlap` and `continuous` scenes.

Each rejected node gets `{ node_id, reason: 'outlier' | 'behind_node' | 'untrusted_elevation', residual_sigma }`. The 3D path excludes usable rays without trusted elevation and marks them `untrusted_elevation`. Nodes without a usable bearing are listed with `no_signal`, `below_min_snr` or `no_bearing`. Two horizontal rays use `method: 'two_ray'`; two trusted rays use `3d_two_ray` only when the horizontal fix is poorly conditioned.

**3D fallback and conditioning.** The horizontal solver remains the default. If its inliers have a negative range or cross below `fix_min_crossing_deg` (10°), trusted-elevation rays are fitted in 3D with weighted closest-ray least squares:

```
Σ_i w_i (I − u_i u_iᵀ)(p − o_i) = 0
u_i = (cos el_i cos az_i, cos el_i sin az_i, sin el_i)
w_i = 1/σ_i², then twice w_i = 1 / (max(t_i, 1) · σ_i)²
```

The 3D path is used only when at least two trusted rays cross at 10° or more and every inlier range is positive. Three or more rays use 3D RANSAC and 3D leave-one-out residuals. `method` reports `3d_two_ray` or `3d_ransac_wls`; otherwise it remains `two_ray`, `ransac_wls` or `wls`. `max_crossing_angle_horizontal_deg` and `max_angle_deg` report the horizontal angle; `max_angle_3d_deg` reports 3D conditioning. `poorly_conditioned` uses the conditioning and ranges of the solver actually selected. A failed 3D fallback leaves the horizontal result poorly conditioned.

**Residuals.** Both solvers normalize the perpendicular miss by `max(t, 1) · tan σ`, with `z = ∞` for `t ≤ 0`. The 3D path measures perpendicular distance and range in 3D; its consensus and leave-one-out checks use that residual, not the horizontal projection. `z_3d_raw_m` reports the trusted-elevation 3D solution when available.

**Height.** If any inlier has a trusted elevation, the height comes from those elevations: the 2D path uses `z = Σ w_i (o_i,z + h_i tan el_i) / Σ w_i`, with `h_i` the horizontal range and `w_i = 1/(h_i σ_i)²`; the 3D path uses its fitted z. `source_height_prior_m` (1.5 m, ground-event prior) is used and `z_clamped: true` only when no inlier resolves elevation. `z_from_nodes` lists the nodes used.

**Suspect checks** (`fix_suspect`, `suspect_reasons`). These use measured quantities only:

| reason | test |
|---|---|
| `below_ground` | z < −0.5 m |
| `negative_range` | the rays only meet behind a node (range is 3D for the 3D solver) |
| `range_ratio` | max/min inlier range > `fix_range_ratio_max` (6; 3D range for the 3D solver) |
| `loo_residual` | any inlier's leave-one-out residual > `fix_loo_suspect_sigma` (2.5; 3D residual for the 3D solver) |
| `outside_scene` | outside the node/building bounds + `fix_bounds_margin_m` (50 m) |
| `weak_consensus` | as many rays rejected as kept |

The 0.3 rule (a used node picked a non-direct path or has its direct path blocked) reads the true paths. It is kept as `multipath_suspect`. **Known limit:** two rays always meet, so a biased two-node fix cannot be caught from the bearings. With 40 noisy four-ray trials at 1σ errors, at most 4 are flagged, and every fix 20 m or more off is flagged (unit test).

`fix.ready_s` = latest window end among the inliers. `error_horizontal_m` and `error_3d_m` are against the true position. A moving source is judged against the mean of the emitting positions of the used nodes.

### 7.11 P6: track ([track.js](packages/sim-core/src/track.js) `commonTimeTrack`)

0.3 used one arrival-time window for all nodes, so rays from different nodes described different moments. 0.4 steps through **emission times** `tE = start_s, start_s + 0.1, …` up to `start_s + D − W` (`W = TRACK_WINDOW_S = 0.1 s`, `TRACK_INTERVAL_S = 0.1 s`). Each step:

1. `p` = the filter's prediction, else the whole-event fix, else the node centroid at the height prior.
2. For each node: `tA = tE + |p − node|/c`, window `[tA, tA + W]`. It must lie in the node's contained active window and have window SNR ≥ `min_snr_db`. The bearing is cached per start sample. `σ = √(σ_noise² + σ_mp(W)²)`, with the multipath term evaluated at window length W.
3. **Dominance gate** (*simulator-only*): skip the window if the other sources' power in it is more than `track_overlap_max_db` (−6 dB) relative to this one's (`dominated_count`). Within about 6 dB, two sustained sources blend into one GCC-PHAT bearing *between* them. In the `continuous` scene three such blended rays met at a consistent ghost about 20 m from the truth.
4. **P5 gate** (`rejected_count`). For untrusted or non-positive elevation (including flat arrays and ground sources), retain the prior behavior: before the first fix use the node's long-window bearing; after two fixes use the predicted-position bearing plus `atan(|v| · interval / range)` of allowed motion; between those states do not gate. With trusted positive elevation, before a fix use that node's most recent accepted rolling bearing instead of the stale long-window reference. Apply `track_pre_fix_elevation_gate_deg` (90°, placeholder) as the total wide gate so a moving aerial source can continue through large bearing changes while the fix filter initializes. After two fixes, use the predicted-position gate as before. The standard floor is `max(track_gate_min_deg, track_gate_sigma · √(σ² + σ_ref²))` (5°, 3σ); the floor exists because CRB sigmas (~0.1°) are far below model mismatch. Gate and reference use measured bearings only, not simulator truth.
5. `robustFix` on the accepted rays (weights with the overlap and reflector terms). If it succeeds, `p` = the fix, and steps 2–5 repeat `track_iterations` (2) times so the windows follow the refined position.

**Filter**: constant-velocity alpha-beta on the horizontal position. Start with `x = z₁`. On the second fix, `v = (z₂ − z₁)/Δt` (two-point start). After that:

```
x⁻ = x + v Δt
r = z − x⁻
x = x⁻ + α r
v = v + (β/Δt) r          α = track_alpha = 0.5, β = track_beta = 0.2
```

Each fix: `t_emit_s` (the fix time), `t_s` (when the fix is available: the last inlier window end; the UI uses it), `position` (filtered, z from the fix), `raw_position`, `velocity_mps`, `method`, `inlier_nodes`, `rejected_nodes`, `fix_suspect`, `overlapped`, `true_position = positionAt(src, tE + W/2)`, `error_m` (filtered) and `raw_error_m`. Observations carry `t_s` (window end), `t_emit_s`, `window_s`, `direction`, `azimuth_deg`, `uncertainty_deg`, `azimuth_error_deg` and `snr_db`.

### 7.12 P9: labelling with the echo app's stack ([labelling.js](packages/sim-core/src/labelling.js), [beamform.js](packages/sim-core/src/beamform.js), [label.js](packages/sim-core/src/label.js))

**Decision (supersedes event_labelling_upgrade §7):** the simulator runs the same models and label logic as the echo app. There is one source of truth, and nothing is copied:

| piece | where it lives | used by |
|---|---|---|
| Period detection, pooling, agreement, confidence, target share, decoy floor, YAMNet corroboration, priorities | [packages/shared/src/periods.js](packages/shared/src/periods.js), [catalogue.js](packages/shared/src/catalogue.js), [settings.js](packages/shared/src/settings.js) `DEFAULTS` | echo app and sim |
| Labels, prompts, groups, corroboration thresholds, YAMNet mapping | [labels.json](packages/assets/public/config/labels.json), [priorities.json](packages/assets/public/config/priorities.json) | both |
| CLAP text embeddings | [clap_text_embeddings.json](packages/assets/public/config/clap_text_embeddings.json), made by `npm run clap:embed -w @echo/assets` (prompts hash checked) | both |
| CLAP input handling and scoring | [packages/shared/src/clap.js](packages/shared/src/clap.js): resampling, tiling a 5 s window to the 10 s input, text-embedding check against the prompts hash, cosine and softmax at the logit scale (`DEFAULTS.clap_logit_scale` = 18.66, **placeholder**), YAMNet score rounding | echo CLAP worker, sim browser runners, sim Node runners |
| CLAP audio tower | `Xenova/clap-htsat-unfused`, quantised ONNX ([packages/assets/public/models](packages/assets/public/models)), 48 kHz, 10 s input. Browser: [apps/echo/src/clapWorker.js](apps/echo/src/clapWorker.js) (the sim starts the echo worker). Node: [node-models.js](packages/sim-core/src/node-models.js) on onnxruntime-node | both |
| YAMNet | MediaPipe tasks-audio 1.1.0 on [packages/assets/public/model/yamnet.tflite](packages/assets/public/model/yamnet.tflite), 16 kHz, 0.975 s window. Browser: [apps/sim/src/models.js](apps/sim/src/models.js). Node: [node-models.js](packages/sim-core/src/node-models.js) (MediaPipe's worker loading path, WASM read from disk) | both |
| App window schedule as an adapter | [label.js](packages/sim-core/src/label.js) `classify()`: YAMNet every 0.5 s and CLAP every hop over the given audio, then `detectPeriods` (the app's `PeriodDetector` on 100 ms RMS/peak dBFS) and `labelPeriods` | sim |

**Per heard node and source** (`labelEvents`):

1. **Segment**: from the rendered node audio, `[first_arrival − label_pre_roll_s, max(first_arrival + D + 1, start + clap window + 0.5)]`. The 3 s pre-roll lets the detector learn the floor; its history minimum is 2 s.
2. **Inputs**: `omni` (mic 1) and, when the node has a bearing, `beamformed`. The beamformer is a far-field delay-and-sum towards the bearing: each mic is delayed by `d_m = (p_m − p̄)·u / c` with `X_m(f) e^{−j2πf d_m}`, and the mics are averaged. It passes a plane wave from `u` unchanged and attenuates others; with `stagger_8` at 1.5 kHz the opposite direction drops below 50 % energy (unit test). Classification uses the full band, not the localisation band (`band_hz: [0, fs/2]`).
3. **Stage 2**: `classify(segment, 48000, label_clap_mode)`. `clap5` (default) is the app's event mode, 5 s window, 1.25 s hop; `clap10` is the ambient mode, 10 s, 2.5 s. Resampling: YAMNet gets `resampleSinc` to 16 kHz. CLAP gets 48 kHz audio, the checkpoint's own rate (from `preprocessor_config.json`: `sampling_rate 48000`, `max_length_s 10`), so the worker's resampler is a no-op.
4. **Stage 1 trigger and association**: `trigger.level` = the app's level detector produced a period associated with the event. Association: among the periods that contain the expected arrival, start within `label_assoc_tol_s` (1 s) of it, or start while the source is still sounding at that node (arrival to arrival + clip length D), the one whose start is nearest the arrival. The last case was added after the real-model sanity check: the dog clip's first bark is 2.2 s into the clip, so its period started outside the 1 s tolerance and the event was dropped although both paths labelled it `dog_barking`. `trigger.yamnet` = a watchlist hit in `[arrival − 0.5 s, arrival + D]`; the watchlist is the corroboration rules of the `labels.json` groups (Screaming ≥ 0.2; Glass, Shatter, Breaking ≥ 0.4; Gunshot ≥ 0.2). No associated period means `detected: false` (Stage 1 missed it).
5. **Event output**: `label, label_text, group, confidence, agreement, priority (default_priority), target_share, group_shares, yamnet_corroboration, rule_flags, yamnet_top, clap_top, first_detection_s, lag_s, period_s, input, band_hz, true_label, true_group, correct (top-1), correct_top3` (true label among the winner and the CLAP top 3), plus `overlapped`, `n_overlapping`, `node_snr_db`, `localisation_status`, `direct_blocked` and `nearest_reflector_m` for the breakdowns.
6. **Multi-label (labelling doc §4, route 1)**: for each class, the peak CLAP *cosine* over the windows overlapping the period. Classes at or above their own threshold (manifest `cosine_min`, else `label_cosine_min` = 0.15) are listed highest first, so overlapped sources can carry several labels alongside the dominant one.

**Ground truth**: [config/sim-label-manifest.json](packages/assets/public/config/sim-label-manifest.json) (editable): clip id → `label`, optional `also` (accepted alternatives), `group`, `cosine_min`. The group defaults to `labels.json`. A clip with `label: null` (engine, door knock, crying baby) is not scored.

**Cross-node** (`sources[]`): a confidence-weighted vote over the detected nodes, using the beamformed input when present. `node_labels_disagree` is reported. Same-class sources overlapping in time (`same_class_sources`) cannot be separated by label: association is then by bearing and track (`association`), and `same_class_ambiguous` is set when fewer than two nodes localised the source.

**Summary** (`summary[input]`): `all`, `by_group`, `by_overlap` (0, 1, 2+) and `by_snr` (< 10, 10–20, ≥ 20 dB). Each has `top1`, `top3`, `alert_recall` (events whose true label is an alert at day priority and that were labelled alert), `false_alerts` (labelled alert where the truth is not), `mean_time_to_detection_s`, and the counts.

**Oracle mode** (`labelling_mode: 'oracle'`) substitutes the true labels without running models. A failure can then be put on the classifier or the localiser.

**Sanity check** (`labellingSanityCheck`, Settings → Labelling → *Run sanity check*, and `sim-labelling-models.test.js` with the real models on the glass, horn and dog clips): the app path (classify on the clean clip with 3 s pre-roll) against the sim path (the same clip rendered 2 m from a node at 1.5 m height, high SNR, omni). If the labels differ, the UI says not to use labelling results.

**Engineering**: `labelling_enabled` is off by default. The models are committed files (YAMNet ≈ 4.1 MB, CLAP audio tower ≈ 34 MB) and run offline. In the browser they are served from the frontend's own origin and load once; labelling runs on the main thread after the render worker returns, outside the render loop.

**In the simulator core (Node)**: [node-models.js](packages/sim-core/src/node-models.js) `loadNodeRunners()` returns `{ cat, runners, models }` with the same runner contract as the browser (`runners.yamnet(samples16k)`, `runners.clap(samples48k, windowS)`), so `labelEvents` runs unchanged in tests, scripts and batch runs. YAMNet goes through MediaPipe's worker loading path (`importScripts` evaluates the Emscripten loader as CommonJS and the WASM is read from disk). CLAP runs on onnxruntime-node with local files only (`allowRemoteModels = false`). Measured here: about 1.6 s to load both, YAMNet under 0.1 s per 0.975 s window, CLAP about 0.2 s per window. Models load once per process; `closeNodeRunners()` frees the YAMNet graph so the process can exit. With fixed seeds the render is deterministic, and the models are deterministic for a given input. The export records the models, catalogue version and logit scale (`labelling.models`).

**Privacy**: the labelling output holds labels, scores, confidences and times only. `buildExport` also scrubs any `mics`, `audio`, `samples`, `embedding(s)`, `spectrogram` or `audio_embeds` key, and every typed array.

### 7.13 P7: back-trace ([backtrace.js](packages/sim-core/src/backtrace.js))

Horizontal plane at each node's height. Input: the usable nodes with azimuth and `uncertainty_deg`. Tolerance `σ_n = max(uncertainty, min_tolerance_deg = 3°)`, or `fallback_uncertainty_deg = 5°`.

**Reflection unfolding** (unchanged; `traceBearing`). The ray walks to the first wall face hit at the node height (or the map edge = node/building bounds + 100 m). At a face it reflects specularly, `d' = d − 2(d·n)n`, up to `backtrace_reflection_order` (2). Legs: `solid` (direct) and `dashed` (after reflections), with `path_before`, `faces` and `ends_at`.

**Edge hypotheses (P7)**, so a node whose direct path is blocked can contribute:

- **Corner**: convex vertical corners of buildings taller than the node (four per box; left turns of the counter-clockwise outline), within `σ_n + atan(1 m/d)` of the bearing, visible from the node. Each fans legs every `edge_fan_step_deg` (5°) into open air. **Order 2**: on to any other corner of the same building that the first corner sees along a face (thick walls; the render's edge-to-edge chains).
- **Roof**: where the node's own ray meets a building taller than the node, the sound may have come over the roof along the same azimuth. A leg continues from where the ray leaves the footprint.

**Support** of a point `p` by a node. The best leg passing `p` within `tan σ_n · range` wins; direct or reflection legs are preferred over roof legs, then the shortest range. If no such leg exists, **corner support** applies when `p` is visible from the (last) corner and hidden from the node. Its range is `|node→corner(→corner2)| + |corner→p|`. Every support says its `hypothesis`: `direct`, `reflection` or `edge`.

**Candidates**: crossings of any two legs of different nodes, not inside a building, supported by at least 2 nodes. A crossing made by a fan leg must use an edge hypothesis, otherwise it is a coarse copy of a real crossing and is dropped.

```
score = (Σ_support weight) · angleFactor / (1 + meanPath / 100 m)
weight = 1, or edge_support_weight = 0.7 (placeholder) for edge supports
angleFactor = 1 if crossing ≥ 20°, else (angle/20)²
```

Candidates are sorted by score and clustered within 1 m. Outputs: `candidates[]` (`position, score, n_nodes, crossing_angle_deg, mean_path_m, total_path_m, hypotheses, support[]`, rank), `top` (3), `traces` (reflection legs, for the map), `edge_hypotheses` (per node: the corner chains and roofs considered), and against the truth `true_rank`, `true_error_m` and `n_candidates`. `intersection_error_m` is the plain fix's horizontal error.

An edge hypothesis constrains a region, not a ray: along another node's ray, every point inside the corner's view and the node's shadow is supported. Candidates near the truth therefore come in a few metres apart, and the true point need not rank first.

### 7.14 Analysis settings (all placeholders)

| setting | default | meaning |
|---|---|---|
| `localisation_band_hz` | [200, 1600] | bearing band (aliasing above ≈ 1.7–1.9 kHz at 9–10 cm) |
| `detection_band_hz` | [50, 9000] | band of `snr_detection_db` (kept below fs/4/1.2 for decimation by 2) |
| `min_snr_db` | 6 | in-window SNR for a usable bearing; detected and localisable gates |
| `window_snr_db` | 3 | frame threshold for the active window (a *setting*; the node field `window_snr_db` is the in-window SNR) |
| `window_pad_ms`, `min_window_ms` | 10, 30 | active-window padding; shortest window |
| `picked_path_tolerance_deg` | 5 | azimuth match for the picked path |
| `picked_path_level_window_db`, `picked_path_elevation_tol_deg` | 15, 10 | picked path level and elevation gates |
| `window_policy` | auto | auto or fixed |
| `onset_window_ms`, `onset_min_ms` | 25, 10 | onset-gated window length bounds |
| `trigger_rise_db`, `trigger_rise_ms` | 12, 50 | impulsive trigger |
| `adaptive_drift_deg`, `adaptive_sigma_rise` | 3, 0.25 | adaptive growth stops |
| `reflector_search_m` | 30 | walls checked for the reflection guard |
| `multipath_floor_deg`, `multipath_spread_ref_ms` | 5, 20 | multipath term |
| `overlap_sigma_deg` | 10 | overlap weight term at 0 dB |
| `reflector_sigma_deg`, `reflector_scale_m` | 3, 5 | near-wall weight term |
| `fix_min_crossing_deg` | 10 | horizontal and 3D conditioning, RANSAC pairs, LOO |
| `fix_inlier_gate_sigma` | 3 | inlier gate |
| `fix_loo_suspect_sigma` | 2.5 | `loo_residual` flag |
| `fix_range_ratio_max` | 6 | `range_ratio` flag |
| `fix_bounds_margin_m` | 50 | `outside_scene` flag |
| `source_height_prior_m` | 1.5 | z when no node resolves elevation |
| `track_gate_sigma`, `track_gate_min_deg` | 3, 5 | standard track gate |
| `track_pre_fix_elevation_gate_deg` | 90 | wide pre-fix gate for trusted positive-elevation rolling bearings |
| `track_overlap_max_db` | −6 | track dominance gate (simulator-only) |
| `track_iterations` | 2 | window alignment passes |
| `track_alpha`, `track_beta` | 0.5, 0.2 | alpha-beta filter |
| `backtrace_reflection_order` | 2 | back-trace reflections |
| `labelling_enabled`, `labelling_mode`, `label_clap_mode` | false, model, clap5 | labelling |
| `label_pre_roll_s`, `label_cosine_min`, `label_assoc_tol_s` | 3, 0.15, 1 | labelling |

Back-trace constants (`BACKTRACE_DEFAULTS`): `min_crossing_angle_deg` 20, `cluster_m` 1, `path_scale_m` 100, `fallback_uncertainty_deg` 5, `min_tolerance_deg` 3, `edge_margin_m` 100, `edges` true, `edge_fan_step_deg` 5, `edge_support_weight` 0.7.

### 7.15 Export (schema 0.6; [export.js](packages/sim-core/src/export.js))

*File → Export results* opens a standalone HTML report in a new tab. **Copy JSON** copies the complete `buildExport` payload:

```
{ app: 'echo-sim', schema: '0.6', changelog, notes, constants (simConstants, placeholders marked),
  thresholds: { key: { value, placeholder: true, note } }, scenario, nodes (layout, mic positions assumed and rendered),
  results: [ per source: source_id, true_position, nodes[], track, heard_nodes, usable_nodes, excluded_unreliable,
             backtrace, fix, error_horizontal_m, error_3d_m ],
  labelling?: { mode, clap_mode, events, sources, summary, models, association_rule, notes },
  rendering?: { sample_rate_hz, samples_per_mic, duration_s, fft_size, frequency_bins,
                nodes: [{ node_id, noise_band_power, noise_detection_power,
                          microphones: [{ mic_index, sources: [{ source_id, applied_paths }] }] }] } }
```

`EXPORT_CHANGELOG` lists every added and changed field since 0.3. Schema 0.5 adds trusted-elevation 3D fix methods and `track_pre_fix_elevation_gate_deg`; no field was removed. Fields whose meaning changed: `heard`, `heard_nodes`, `fix.max_angle_deg`, `fix.fix_suspect`, `fix.position[2]`, `picked_path_index`, `track.fixes[].t_s`. `labelling` is included only after label processing completes for the exact exported results; `labelling_enabled: true` is a request to run asynchronously, not proof that a labelling block exists. Exporting before completion or after a failed run leaves the block absent. The caveats go into `notes`: simulated, placeholders, no housing scattering, wind, rain, coloured noise or facade scattering, unvalidated diffraction, which fields are simulator-only, and that labelling accuracy here does not predict real-world accuracy.

Schema 0.6 adds optional scalar `rendering` diagnostics and the actual static-source per-microphone path audit (§6), including delay in samples (source start plus path travel time), 1 kHz gain and the applied filter description. This does not change rendering or localisation. Moving-source piece audits are not recorded; empty audit lists are not evidence of absent sound. FFT size and bin count refer to the full buffer, not each moving-source piece. Audio, spectra, activity-frame arrays and embeddings remain excluded.

The report ([ui/report.js](apps/sim/src/ui/report.js)) has eleven expandable stages: scene/calibration, acoustic paths, microphone render, detection/window selection, GCC-PHAT direction, uncertainty/weights, robust position fix, rolling track, indirect back-trace candidates, event labels, and constants/thresholds. Per-node dropdowns show saved inputs, formulas, numeric substitutions and outputs. Every accepted track observation and fix can be read as a table; full recorded fields are also available through expandable JSON blocks. Unrecorded pairwise TDOAs, FFT bins, intermediate matrices, rejected hypotheses and moving-source internals are explicitly identified as unavailable: this is an explanation of the saved calculations, not a fabricated full execution trace. Simulator-truth comparisons and derived values are labelled separately.

Exports use the scenario snapshot associated with the results, with a warning if the current editor is stale. Saved results can be reported without audio, but cannot supply the render audit until Create is run again. The report is self-contained (no external assets), detaches its opener, and remains usable after closing the simulator. **Expand all steps**, **Collapse all steps**, and **Print / PDF** support reading and sharing; printing temporarily opens steps and node sections. **Copy JSON** has visible success/failure feedback and a selectable **Complete JSON** fallback when clipboard permission is unavailable. Popup failures are shown in the simulator; allow popups and retry.

### 7.16 Other analysis modules

- [measured.js](packages/sim-core/src/measured.js): a draft measured-only multi-source localiser. It reads mixtures only (sliding GCC-PHAT bearings, onset detection from the mixture, node tracks, pairwise fusion). It is **not used** by `analyseScenario` or the UI, and its thresholds (`MEASURED_DEFAULTS`) are uncalibrated. `mixtureFrames` from it is used by the P2 trigger.
- [match.js](packages/sim-core/src/match.js) `attachDetections`: the older per-node detection matcher (labelled periods to sources by overlap) and an SNR-weighted 3D re-fix. Kept for `sim-label.test.js`; superseded by §7.12 for the UI and export.
- [attribution.js](packages/sim-core/src/attribution.js) `nodeShares`: each source's share of the sound at a node. *Measured*: from `snr_db + noise floor` of heard sources. *True*: free-field direct `level_1m_db − 20 log10 r`. Shown in the node inspector.

---

## 8. Heatmap, reach map, sweeps, sound library, OSM and DSP helpers

### 8.1 Heatmap field ([field.js](packages/sim-core/src/field.js), [ui/heatmap.js](apps/sim/src/ui/heatmap.js))

The heatmap is a time-resolved, height-sliced field that needs no Create. It is an **incoherent** sum (no interference).

- **Bands** (`FIELD_BANDS = ['250', '1k', '4k', 'loc']`): octave bands `[fc/√2, fc·√2)` at 250 Hz, 1 kHz and 4 kHz (`REACH_BANDS`), plus the localisation band with the raised-cosine `bandWeight`. Air absorption and diffraction are evaluated at fc, or at `sqrt(f_lo·f_hi)` (566 Hz for 200–1600 Hz) for the localisation band.
- **Arrivals** (`computeFieldArrivals`): `findPaths` from each source (one source graph and image cache per source) to every cell centre of the plan grid at the slice height, with `reflection_order = reach_reflection_order` (default 2) and the scenario's diffraction settings. Per path and band:

```
a_b = (gain/max(L,1))² · 10^(−α(fc_b)·L/10) · |D_chain(fc_b)|²       (wedge; legacy: · 10^(−loss_dB(fc_b)/10))
```

  The `topN = 16` strongest arrivals by `a_250 + a_1k + a_4k` are kept, with `delay = L/c` (Float32) and `a_b` (Float32 × 4). Cells inside a building (strict `insideBox`) are masked. Above a roof the cell is open air.
- **Clip envelopes** (`clipBandEnvelopes`): an FFT of the whole clip (size nextPow2), brick-wall octave bands or the weighted localisation band, inverse FFT, then the mean square per 10 ms frame (clip units²).
- **Pulse power at time t** (`pulsePower`), in Pa²:

```
P_b(cell, t) = Σ_sources gainPa² · Σ_{k<count} a_{k,b} · env_b[ floor((t − start_s − delay_k)/0.01) ]
```

- **Peak-hold** (`peakHoldPower`): the running maximum of P over frames 0, 0.01, ... up to t. The UI computes it incrementally and restarts on a seek backwards or a height change (it recomputes in one go after a jump of more than 400 frames).
- **Level mode**: `gainPa² · Σ a_{k,b} · mean(env_b)` (clip mean), or the final peak-hold when "show peak" is ticked.
- **dB** (`powerToDb`): `10 log10(P/(20 µPa)²)` dB SPL, or `10 log10(P/noisePa2)` above noise. "Above noise" is defined only for the localisation band, because the noise power is measured there with `noiseBandPowerPa2` (8.2).
- **Memory**: `estimateFieldBytes = cells · sources · topN · 5 · 4` bytes. `fitGridToBudget` doubles the cell size until it fits `DEFAULT_MEMORY_BUDGET_BYTES` = 64 MB, and the map label reports the coarsening.
- **Moving sources** (`fieldSources`, `fieldEnvelopes`): a moving source becomes `k = min(5, max(2, ceil(pathLength/20) + 1))` sub-sources at evenly spaced times over the moving part of the clip, plus the clip ends (duplicates removed). Each sub-source carries its knots, and its power envelope is multiplied by its hat weight at each frame centre, so the parts crossfade and sum to the source.

**UI controller**:

- *Grid*: the cell is `reach_cell_m` (default 2 m, min 0.5) for the fine pass and 4 m (`COARSE_CELL_M`) for the preview, grown by ×1.25 until there are at most 60 000 cells (`MAX_DRAW_CELLS`). The extent is the bounding box of nodes, keyframes and buildings, padded by 15 m.
- *Scheduling*: requests are debounced by 300 ms. A coarse preview comes first, then the fine pass. A new request terminates the worker, which cancels superseded jobs. Results are cached by height (up to 12 records). While the slider is dragged, the nearest cached height is shown; on release the exact one is computed.
- *Colour*: the turbo colour map (polynomial approximation) over a 60 dB span below the estimated loudest level in the band (rounded up to 5 dB). The legend is in 5 dB steps.
- *Overlays*: in Pulse mode a faint level backdrop (`heatmap_backdrop`, default 0.25) sits under the main layer. Above-noise mode draws a contour at `min_snr_db` (marching squares).
- *Worker*: it runs in its own `renderWorker` instance (`field` message).

### 8.2 Reach map and side view ([reach.js](packages/sim-core/src/reach.js))

The reach map is an energetic (incoherent) field over a grid, from the same `findPaths` (reflection order `reach_reflection_order`, default 2; diffraction as configured; one source graph and image cache per source). There is no time axis.

- **Source band powers** (`sourceBandLevels`): the whole-clip mean band power in clip units² (`clipBandPowers`, Parseval on the zero-padded spectrum: `(2/(n·len))·Σ |X_k|²` over the octave bins; the localisation band is weighted by w²), times `clipGainPa²`. That gives Pa² at 1 m. For a stationary clip this equals the calibrated level; impulsive clips read lower.
- **Per receiver** (`pathsBandPowers`): `P_b = Σ_paths P_src,b · (gain/max(L,1))² · 10^(−α(fc_b)L/10) · |D(fc_b)|²` (legacy: `· 10^(−loss_dB(fc_b)/10)`).
- **Outputs** (`computeReachField`):
  - `levelDb = 10 log10((P_250 + P_1k + P_4k)/(20 µPa)²)` dB SPL (−120 for no energy);
  - `snrDb = 10 log10(P_loc / noisePa2)`, or 60 when noise is off;
  - masked cells (inside a building) are NaN.
- **Noise reference** (`noiseBandPowerPa2(settings, fs = 48000, seconds = 4)`): ambient pink plus self white noise generated with streams `(seed, 0, 0, 1)` and `(seed, 0, 0, 2)`, band-weighted exactly like the activity pass, in Pa². It is deterministic and does not include `noise_correlation`. Reach-map SNR at a node matches that node's `snr_db` within 0.09 dB.
- **Grids** (`gridPositions`, cell centres, row-major):
  - `plan { x0, y0, cell, nx, ny, z }`;
  - `section { a, b, ns, nz, zmax }`, a vertical cross-section along the line a → b.
- **UI**:
  - reach map: plan cell `reach_cell_m`, grown by ×1.5 until there are at most 250 000 cells; extent as for the heatmap; the selected source only, or all if none is selected; a moving source uses its first keyframe;
  - side view (the **Side view** tool drags a line of at least 3 m): `ns = clamp(round(L/1 m), 20, 400)`, `nz = clamp(round(top/0.5 m), 20, 300)`, `zmax = 1.3·max(10, tallest building, node heights, source heights)`;
  - display: greyscale, SNR −10..30 dB or level (max − 50)..max dB, contour at `min_snr_db`;
  - requests are debounced by 400 ms after an edit and cached by a key of grid, source levels, settings and buildings. They run in a second `renderWorker` instance (`reach` message). With `diffraction_order` 0 the label says "no diffraction (pessimistic)".

### 8.3 Repeats and sweeps ([sweep.js](packages/sim-core/src/sweep.js))

- `runTrials(scenario, clips, durations, { seeds })`: for i = 0..seeds−1, it sets `seed = scenario.seed + i`, renders with `renderLengthS` and analyses. Per source it records `localised` (fix exists), `error_3d_m`, `error_horizontal_m`, `bearing_error_deg` per node (the angle between the estimated direction and the true azimuth and elevation) and `picked_not_direct` (any heard node followed a non-direct path).
- `summarise(trials)`: `trials`, `fix_rate`, `picked_not_direct_rate`, and the median and p90 of the 3D error (over localised trials) and of the bearing error. `percentile(v, p)` returns `sorted[min(n − 1, floor(p/100·n))]`.
- **Variables** (`SWEEP_VARIABLES`, in dialog order). Every variant returns a fresh scenario and never mutates the input:

| id | Effect |
|---|---|
| `mic_array` | `applyArrayToNode` on every node with the chosen library model (values are array ids) |
| `distance_scale` | every keyframe scaled in x, y about the node centroid by v |
| `node_count` | keep the first `round(v)` nodes (at least 1) |
| `node_height_m` | every node z = v |
| `noise_floor_db_spl`, `min_snr_db`, `temperature_c`, `ground_reflectivity`, `reflection_order`, `diffraction_order`, `mic_gain_sigma_db`, `mic_position_sigma_mm`, `heading_error_sigma_deg`, `noise_correlation` | set that setting to v |

- `sweepCases(vars)` builds the Cartesian product of the chosen values. `sweepMulti` refuses more than `MAX_SWEEP_CASES` = 60 combinations and runs `seeds` trials per combination, giving one row `{ values, ...summary }` per case. `sweep` (one parameter) is the older single-variable form. With nothing ticked, the dialog runs `runTrials` and one summary row.
- The dialog shows `cases × seeds = renders` and defaults to 50 seeds. It runs in `sweepWorker.js` on the current scenario (not the Create snapshot) and shows a table and a plot. Each seed re-renders every mic, so large runs take minutes.

### 8.4 Clips and sounds ([clips.js](packages/sim-core/src/clips.js), [sounds.js](packages/sim-core/src/sounds.js), [packages/assets/public/test-audio](packages/assets/public/test-audio))

**Manifest** (`test-audio/manifest.json`):

- dataset ESC-50 at pinned revision `33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6`, from https://github.com/karolpiczak/ESC-50;
- licence "CC-BY-NC-3.0 (dataset); see LICENSE.esc50 for individual credits";
- selection: the first filename in the pinned `esc50.csv` for each category, one clip per class, smoke test only;
- `fetch-test-audio.mjs` downloads `LICENSE` (as `LICENSE.esc50`), `meta/esc50.csv` and every listed file from `raw.githubusercontent.com` at that revision.

The clips are **non-commercial**: fine for this design tool, but they must stay out of any production product. That is one reason the simulator is a separate service from echo. Do not use AudioSet clips to judge YAMNet, which was trained on them.

The clips flagged `sim: true` form the built-in library. Each takes its level from `PLACEHOLDER_LEVELS` (`confirmed: false`):

| id | File | Level at 1 m (dB SPL, placeholder) |
|---|---|---|
| glass_breaking | 1-20133-A-39.wav | 100 |
| car_horn | 1-17124-A-43.wav | 105 |
| dog | 1-100032-A-0.wav | 100 |
| chainsaw | 1-116765-A-41.wav | 110 |
| engine | 1-18527-A-44.wav | 95 |
| airplane | 1-11687-A-47.wav | 120 |
| footsteps | 1-155858-A-25.wav | 75 |
| fireworks (gunshot decoy) | 1-115545-A-48.wav | 130 |
| thunderstorm (bang decoy) | 1-101296-A-19.wav | 120 |
| crying_baby (scream decoy) | 1-187207-A-20.wav | 100 |

`gunshot` (140) and `scream` (110) have levels but no file (user-supplied licensed recordings, not bundled). `door_wood_knock`, `rain` and `laughing` are in the manifest for the echo app but not flagged for the simulator. Unknown ids default to 90 dB.

**Generated test clips** (`GENERATED_CLIPS`, synthesised deterministically):

- `test_impulse` "Impulse (test, 200–1600 Hz flat)", 94 dB, confirmed: 60 ms; `s(t) = (sin 2πf2 t − sin 2πf1 t)/(πt)` (value `2(f2 − f1)` at t = 0) with f1 = 200 and f2 = 1600 Hz, times a Hann window centred on the clip, peak-normalised to 1.
- `test_noise_burst` "Noise burst (test, 50–12000 Hz flat)", 90 dB, confirmed: 1 s; unit magnitude and random phase (`mulberry32(1234)`) on every bin between 50 and 12 000 Hz, inverse FFT, 10 ms linear fade in and out, scaled to RMS exactly 1, so the loudest window and the clip mean agree.

`loadManifest()` returns the generated clips plus the sim-flagged ones. **The UI filters the list to entries with a `file`**, so the two generated clips are not offered in the picker. Tests and scripts use them through `synthesizeClip`.

**Loading**:

- `fetchClip` fetches `/test-audio/<file>` and decodes it with `decodeToMono`: an `OfflineAudioContext` at 48 kHz, channels averaged. On failure the error says to run `npm run fetch-test-audio`.
- `clipAvailable` sends a HEAD request and treats a `text/html` answer as missing (the SPA fallback returns `index.html` with status 200).
- The manifest is fetched with `cache: 'no-store'`.

**Sound models** (user library, [sounds.js](packages/sim-core/src/sounds.js); stored through `/api/library/sounds`):

- `kind` is `library` (a built-in file), `upload` (base64 audio of at most `MAX_AUDIO_BYTES` = 8 MB) or `generated`;
- `level_1m_db` is 0..200, plus `confirmed`, up to 12 labels of at most 40 characters, and notes of at most 2000 characters;
- an optional calibration `{ measured_db, distance_m, method, date }` uses the free-field law `level1mFromMeasurement(L_d, d) = L_d + 20·log10(d)`;
- generators: `tone` (20–20 000 Hz, at most 30 s, sine with 10 ms linear edges), `impulse` and `noise` (the test clips).

The workspace previews free-field level contours at radius `r = 10^((L_1m − L)/20)` m for L = 90, 80, ... 40 dB. Saved user sounds become clip-library entries whose `load(rate)` decodes or synthesises the audio.

**Uploads in the clip picker** ("Upload WAV…") are decoded locally, get the id `upload_N` and 90 dB at 1 m, and are not saved with simulations.

### 8.5 OpenStreetMap import

**Core** ([packages/sim-core/src/osm.js](packages/sim-core/src/osm.js)):

- `BATTERSEA` = { lat 51.4818, lon −0.1446, size 600 m } is the default tile.
- `mapArea` requires lat within ±80, lon within ±180 and size 200..1000 m, and truncates the name to 100 characters.
- `mapBounds`: half-height `dy = size/2 / 111194.9266` degrees, `dx = dy / cos(lat)`, giving [S, W, N, E].
- `projectMapPoint(lon, lat, origin)` is equirectangular about the tile centre (origin at 0, 0): `x = (lon − lon0)·π/180·6 371 000·cos(lat0)`, `y = (lat − lat0)·π/180·6 371 000`.
- `osmQuery` is the Overpass QL: `[out:json][timeout:12][maxsize:16777216]`, with ways and relations tagged `building`, `building:part`, `highway`, `railway`, `natural`, `landuse`, `leisure`, `waterway`, and nodes tagged `natural=tree` or `man_made=chimney`, inside the bounds, `out body geom`.
- `buildingHeight(tags)`: `height`, then `building:height` (in m, or ft × 0.3048), then `building:levels × 3 m`, then 15 m, clamped to [1, 300] m. `height_estimated` is true when no height tag was used.
- `importOsm(data, area)` converts with `osmtogeojson` (flat properties):
  - every polygon of a feature tagged `building` or `building:part` (not `no`), with an outer ring of at least 4 points and a bounding box of at least 0.5 × 0.5 m, becomes a building `{ id: osm-<feature id>-<polygon index>, position: bbox centre, size: [w, d, height], rotation_deg: 0, name, osm_id, height_estimated, footprint: rings normalised to the bbox }`;
  - other features become environment features: water (`natural=water` or `waterway`), road (`highway`), rail (`railway`), tree (`natural=tree`), land (`landuse`/`leisure`/`natural`), as polygons, lines (width 2 m for footway/path, 8 m water, else 6 m) or tree points;
  - it errors when there are no buildings, more than 250 buildings, `remark` is set (incomplete query) or the data has no `elements`.

**Backend** ([apps/backend/src/osm.js](apps/backend/src/osm.js), `POST /api/osm` with `{ lat, lon, size, name? }`):

- refuses cross-origin requests (403) and non-numeric or out-of-range input (400);
- tries the official OSM API (`https://api.openstreetmap.org/api/0.6/map.json?bbox=W,S,E,N`) first, then Overpass (`https://overpass-api.de/api/interpreter?data=<query>`);
- each attempt has a 15 s deadline that covers headers and body (even when the upstream ignores abort), a 16 MB cap, and a check for an `elements` array and no `remark`;
- returns the upstream JSON with `Cache-Control: no-store`, or 502 listing `host: reason` per failed endpoint;
- aborts the upstream when the client disconnects; never logs or stores bodies.

**UI** ([apps/sim/src/ui/osm.js](apps/sim/src/ui/osm.js), main.js): Settings → Map and environment → Load map (name, latitude, longitude, tile size).

- `bindOsmLoader` disables the button and shows a countdown ("Loading (Ns left)"), with a 35 s client deadline and a Cancel button that restores the controls at once. A late result cannot change the scene.
- On success it replaces all buildings and sets `environment`, removes (and lists) nodes and sources now inside a building, clears results, fits the view to the tile, shows the stale banner and switches to the Editor.
- **Remove map** deletes `environment` and every building with an `osm_id`.
- The environment and footprints are saved with the scenario, so reopening needs no fetch.

### 8.6 DSP helpers ([dsp.js](packages/sim-core/src/dsp.js), [spectro.js](packages/sim-core/src/spectro.js), [wav.js](packages/sim-core/src/wav.js), [profile.js](packages/sim-core/src/profile.js))

- `fft(re, im, inverse)`: in-place iterative radix-2 Cooley–Tukey on Float64Arrays, with bit-reversal permutation and twiddles cached per size. Forward uses `e^{−j2πk/n}`; inverse uses `e^{+j2πk/n}` and scales by 1/n. Lengths must be powers of two (`nextPow2(n) = 2^ceil(log2(max(2, n)))`).
- `rfft(signal, n)`: zero-pad to n and return the half spectrum (bins 0..n/2) as subarrays. `irfft(halfRe, halfIm, n)`: Hermitian fill (`X_{n−k} = conj X_k`), force `im[0] = im[n/2] = 0`, inverse FFT, return the real part.
- `resampleLinear(input, src, dst)`: linear interpolation.
- `resampleSinc(input, src, dst, taps = 32)`: windowed-sinc low-pass and decimation, used before the models (see §7). With `ratio = src/dst`, `cutoff = 0.95·min(1, dst/src)` and `half = ceil(taps·max(1, ratio))`, each output sample i at input position `c = i·ratio` is

```
y_i = Σ_j x_j·s_j·w_j / Σ_j s_j·w_j,   x = (j − c)/ratio,  s = sin(π·cutoff·x)/(πx) (s = cutoff at x = 0),  w = ½ + ½ cos(π(j − c)/half)
```

  over |j − c| ≤ half.
- `spectrogram(signal, fs, { frames = 250, size = 1024, maxHz = 8000 })`: Hann frames at `hop = floor((len − size)/frames)`, `10·log10(|X|² + 1e-20)` for bins up to maxHz.
- `encodeWavFloat32(channels, fs)`: interleaved IEEE-float WAV (format 3, 32-bit). `arrivalsCsv(rows)`: CSV with columns time_s, source, path, surfaces, length_m, level_db_re_direct, level_above_noise_db, arrival_azimuth_deg, overlapped, and quoting.
- `timed(profile, stage, fn)`: optional stage timing into `{ ms, calls }`; free when no profile is given.

---

## 9. UI layer (apps/sim)

This section replaces the former `simulation-guide.md` (user guide) and the parts of `simulation.md` (MVP brief) that still apply. Differences from those documents are listed in 8.12.

### 9.1 Screen layout ([index.html](apps/sim/index.html))

| Area | Content |
|---|---|
| Top bar | **Create**, **Play/Pause**, speed slider (0.05x–4x), time readout, status text, progress bar; on the right the simulation title (name · version, a dot when there are unsaved changes), the **File** menu and **Info (i)** |
| Banners | "Out of date, press Create" (stale); the load notice (scenario notices, OSM messages, save/open messages and errors) |
| Side nav (collapsible, state in `localStorage['sim.nav.collapsed']`) | **Scenes**, **Editor** (with tools Move, Add node, Add source, Add building, Side view, and a **3D view** checkbox), **Sound library**, **Mic arrays**, **Settings** |
| Centre | map canvas (2D) or, with 3D view ticked, the 3D canvas; particle legend; hint text; reach map and heatmap labels |
| Right | inspector, only when something is selected |
| Bottom | timeline canvas |
| Floating panels | Side view (section), Mic's-eye view |
| Dialogs | Choose a sound, Limits of this simulation (Info), Repeats and sweeps, Save simulation, Saved simulations (list and version history) |

The page has `connect-src 'self' blob:` CSP and `no-referrer`. The colours are a black page with white truth (sources, nodes), amber `#ffb000` for estimates and error lines, one colour per node (`NODE_COLORS`: 8 colours, cycled), one colour per source in particle mode (`hsl(i·137.508° mod 360, 85 %, 65 %)`) and the turbo heatmap.

On first open the **demo** is loaded:

- nodes n1 (0, 0), n2 (60, 0) and n3 (30, 50), 5 m up, flat square;
- one source s1 at (25, 20), starting at 3 s, playing the gunshot if one is available, otherwise glass breaking (no gunshot clip is bundled, so it is glass breaking);
- the view is centred at (30, 25).

### 9.2 State and status ([main.js](apps/sim/src/main.js))

`main.js` owns all state:

- `scenario`;
- `clips` (id → Float32Array at 48 kHz) and wavefront `analyses`;
- the `library` of clip entries;
- `status` (`edit | rendering | ready | stale`), `rendered`, `results`;
- the selection (`selected`, a shift-click second selection `selected2`, `pathFocus` from a clicked result row), the hover, the map view `{ cx, cy, scale px/m }`, the timeline `{ pxPerS }`;
- the playhead `t`, `playing` and `speed`;
- `lastCreate`, a deep snapshot of the scenario, clips and length at Create, so component views match the results even after edits.

Any edit calls `markEdited()`. If the status is `ready` it becomes `stale` and the banner shows. Old results stay visible, greyed in the timeline. The reach map is marked out of date and recomputed after 400 ms, the heatmap is rescheduled and the inspector re-renders. Edits made **while** Create runs are not flagged (the status is not `ready`). Physics is deterministic, so playback only scrubs `t` through cached results: only Create, components, reach map, heatmap and sweeps compute anything.

### 9.3 Tools and the map

- **Move** (default): click to select a node, source or building (the inspector opens); drag to move. Positions are rounded to 0.1 m and refused if they land inside a building. A moving source drags its whole path. A building drags by its body (snapped to 0.5 m) or resizes from a corner (minimum 1 m); a change that would cover a node or source is refused. Dragging empty space pans. The wheel zooms by ×1.15 per step (0.2–200 px/m).
- **Shift-click** a node and a source to show both and draw that pair's paths.
- **Add node**: places a flat-square node 5 m up at the click; the tool stays active.
- **Add source**: opens **Choose a sound** (library entries, greyed when the file is missing, with a note to build with `npm run build:sim` or run `npm run fetch-test-audio -w @echo/assets`; **Upload WAV…**; **Cancel**). The new source starts at 3 s with the clip's 1 m level.
- **Add building**: drag a rectangle (snapped to 0.5 m, at least 2 × 2 m). It becomes a 15 m box, refused if it would cover a node or source.
- **Side view**: drag a line of at least 3 m to open the vertical cross-section (reach-map maths, 8.2).
- **Delete** or **Backspace** removes the selection (the inspector also has a Delete button). There is no delete tool.

**Map drawing order**:

1. OSM environment (land, water, roads, rail, trees);
2. heatmap;
3. roof outlines dashed when the slice is above them;
4. reach map;
5. rings or particles;
6. buildings (real footprints);
7. nodes (square, label, optional magnified mic inset "mics ×N" with filled dots at or above the node plane and hollow dots below), sources (dot, id, clip; moving: dashed route, ring at the start, square at the end, dot at `positionAt(t)`), the path being drawn;
8. acoustic paths of the focused pair (node colour, dashed, brightness by level re the strongest);
9. results (bearing observations and cones, rolling fixes, back-trace; **see §7** for their meaning);
10. hover tooltip and scale bar.

The ring and fix overlays are described in Analysis. `ui/tracking.js` draws the latest fix at or before t as a large amber ring with its time, and earlier fixes as small hollow rings joined by a trail that breaks at gaps longer than 1.5 intervals. A stale fix is labelled "last fix".

**Display options** (Settings → Display; view-only, not part of the scenario):

- Sound display: Heatmap / waves, or Particles (particles disable the heatmap and ring controls);
- Waves in 3D view;
- Mic arrays (insets);
- Show reflections (paths);
- Reflected sound (reflected rings);
- Tone and grain;
- Sound during playback;
- **Nodes shown**: a tick box per node plus all and none. Hiding a node removes it, its inset, bearing line and observations from the map; it still takes part in Create and cannot be selected while hidden. Loading a scenario shows all nodes again.

**Particles** (`ui/particles.js`): the rings shown as dots. In 2D the dots are spaced evenly on each ring at the slice height; in 3D they lie on spheres on a Fibonacci lattice (golden angle 2.39996 rad). Rings are thinned to about 60 live rings, with at most 64 (2D) or 96 (3D) points per ring and 6000 in total. Points below the ground, or where the ring is invalid (blocked or no reflection point), are skipped. These are visual sound-energy markers, not air molecules, and they do not diffract.

### 9.4 Inspector

- **Node**: x, y. **Advanced**: height z, rotation (°), and either mic spacing (`flat_square`, `tetrahedron`) or the `stagger_8` ring radii, upper ring height and mics per ring. The **Mic array** select offers the simple layouts and every library array (picking one copies it into the node as `custom`; a copy whose library entry is gone shows as "(copy in this scenario)"). Delete. After Create: the **Mic's-eye view** button (the view also opens automatically the first time the node is selected) and the node result panel (see §7).
- **Source**: name (id), x and y (for a moving source "path start", which moves the whole path), level at 1 m (dB), start (s) (moving the start shifts the trip with it), and a "Level is a placeholder (unconfirmed)" note. **Path** panel: still sources show **Add path**; moving sources show points, length, mean speed in m/s and km/h, **moves from (s)** and **arrives at (s)**, **Redraw path** and **Remove path**. **Advanced**: height z (sets the whole path). Delete. After Create: the result panel (see §7).
- **Building**: x, y, width, depth, height (each at least 1 m), "Concrete, absorption 0.03 (placeholder)", Delete. Rotation is not editable (0 only).

**Drawing a path**: Add path starts at the source. Each click adds a point (ignored within 0.3 m of the previous one, refused if the segment crosses a building; checked every 0.5 m). Double-click or Enter finishes, Backspace removes the last point, Esc cancels. A new path runs from `start_s` over the clip length (at least 1 s) at constant speed (`keyframesAlong`); a redrawn path keeps the old timing. A path that fails `placementErrors` is rejected.

### 9.5 Timeline

- The ruler uses nice ticks.
- There is one row (28 px) per source with the clip as a block (accent when selected). Dragging the block changes `start_s` (rounded to 0.01 s) and shifts the motion with it.
- A moving source has a blue motion bar with draggable start and end handles (retime, at least 0.1 s; the status shows the span and speed) and a draggable body (shift the trip).
- Clicking elsewhere moves the playhead. The wheel zooms (4–400 px/s, default 40).
- After Create, a first-arrival tick is drawn per node and source, and the error lane shows each source's error over its audible span, scaled 0–20 m (see §7).

### 9.6 Playback

- **Play/Pause** advances `t` by `dt·speed` on each animation frame and stops at `scenarioLengthS`. Play after the end restarts from 0.
- **Speed** is `2^v` with v ∈ [−4.32, 2], which gives 0.05x–4x, and snaps to 1x within 0.04.
- **Sound during playback**, at exactly 1x only (otherwise the speed label says "(muted)"):
  - *Sources, as recorded* (`dry`, works before Create): each clip is played at its start time, peak-normalised to 0.6 and scaled by `clamp(10^((L_1m − L_max)/20), 0.1, 1)`, so louder sources are louder but distance is not applied;
  - *n1 mic 1 (rendered)* etc. (after Create): that mic's rendered signal, gain 8;
  - *Off*.

  Audio goes through a Web Audio `DynamicsCompressor`. It restarts when the playhead drifts by more than 0.15 s from the audio clock (seeks, retiming) and needs a page click first (a browser rule).
- **Loop** (`frame`): it updates t, syncs the audio and, in the Editor view, draws the mic view, map, 3D view, timeline and side view. In the Mic arrays and Sound library views it draws their previews.

### 9.7 Mic's-eye view ([ui/micview.js](apps/sim/src/ui/micview.js))

It opens for the selected node after Create and reads `lastCreate.scenario`, `rendered` and `results`.

- **Traces**: one per mic, drawn from a min/max pyramid so a 30 s trace costs a few operations per pixel. Scale is linear or dBFS. The expected direct arrival at each mic is marked when zoomed in far enough to see inter-mic delays. There is an arrival lane and a playhead. Click or drag to seek or zoom.
- **Spectrogram** (`spectro.js`).
- **Show**: *Total*; *By source*, *By path* (direct, ground, wall, diffracted) or *Noise only*, which come from the worker's `components` message and are cached per mode; *Audit*.
- **Arrivals table**: per source and path, the time `start_s + delay`, path type and surfaces, level re direct, level over noise and arrival azimuth. The picked path is highlighted, and clicking a row seeks and zooms there.
- **Audit**: for every static source and mic, the applied record from the render (6.2) next to an independent `findPaths` recomputation (`delay = (start_s + L/c)·fs`, `gain = 20 log10 pathPressure(1 kHz) − α(1 kHz)·L`). It reports the worst delay and gain differences (flagged above 0.05 samples or 0.05 dB) and dropped-candidate counts by reason. Moving sources are listed as not audited.
- **Delay view**: the GCC-PHAT curve for one source and mic pair over that node's window, with the true direct lag, the estimated lag and the picked-path lag (see §7).
- **Exports**: "4-channel WAV" (float32, all mics of the node; the label predates N-mic layouts) and "Arrivals CSV".

### 9.8 3D view ([ui/view3d.js](apps/sim/src/ui/view3d.js))

This is a 2D canvas, not WebGL.

- **Camera**: an orbit camera `{ target, yaw = −0.8, pitch = 0.6, dist = 120, fov = 0.9 }`, with `eye = target + dist·(cos p cos y, cos p sin y, sin p)`. The projector builds `f = normalise(target − eye)`, `r = normalise(f × z)`, `u = r × f` and projects `[w/2 + (d·r/z_c)k, h/2 − (d·u/z_c)k]` with `k = (h/2)/tan(fov/2)`; points with depth below 0.1 are null.
- **Controls**: drag orbits (pitch 0.05–1.5); shift-drag or right-drag pans; the wheel zooms (5–5000 m). The camera fits the scene.
- **Drawing**: ground grid; OSM layer; buildings far to near as translucent prisms (real footprints); nodes on poles; sources (moving ones at `positionAt(t)`); wave spheres as latitude rings and meridians clipped at the ground and hidden where blocked or invalid; the slice-plane cut; particles; bearing rays (elevation below the horizon assumed for flat arrays); rolling fixes; back-trace (see §7).

### 9.9 File menu, saving and opening simulations ([ui/library.js](apps/sim/src/ui/library.js), [ui/scenes.js](apps/sim/src/ui/scenes.js))

- **New simulation**: resets to a fresh scenario (built-in defaults merged with the browser defaults, 9.10) after a discard check.
- **Save…** (Ctrl+S, ⌘+S) and **Save as new…** open the save dialog: name (1..200), description (≤ 2000), a note for this version (≤ 500), and **Include current results**. Saving an open simulation posts a new version with `base_version = latest_version`. A 409 `version_conflict` asks whether to save on top as v(latest + 1), which re-posts without `base_version`. A 404 says the simulation was deleted and to use Save as new. The scenario is validated on the server with `validateScenario`. Results must be an array of objects with a string `source_id`. Rendered audio and uploaded WAV clips are not saved; nodes, sources, buildings, map area and settings are.
- **Open saved…**: the list (search by name, debounced; newest first), open the latest version, version history (open any version), rename, delete.
- **Files on this computer**:
  - **Download scenario file** (`scenario.json`);
  - **Load scenario file** (validates and applies, clears results, detaches from the saved simulation);
  - **Export results**: after Create (or opening saved results), opens the step-by-step HTML report in a new tab. **Copy JSON** copies `buildExport(...)`, schema 0.6 (§7.15), including optional labels and render audits. The original result scenario is used even if the editor has changed;
  - **Repeats / sweep** (8.3).
- **Applying a scenario** (`applyScenario`) runs validation and notices, replaces the scene, and sets `status = 'ready'` with `rendered = null` when saved results come with it, so the map, fixes and tables show at once and Create re-renders the audio. It also resets playback, hidden nodes and selection, fits the view and loads the clips.
- **Dirty tracking** compares a JSON snapshot of the scenario with the baseline saved or opened. The title shows `name · vN` (and "(latest vM)" for an older version) with a dirty dot; the document title gets "• ". The **URL** keeps `?sim=<uuid>` and `&v=<n>` when not the latest, so a reload or a shared link reopens it. The title refreshes every 1.5 s.
- **Scenes** workspace: a card per saved simulation (name, description, "N nodes · N sources · N buildings · area", "Results: located a of b · vN · 3 hours ago"), a **+ New scene** card, an "Unsaved scene" card when the open scene is not saved, and a Delete button per card.

**API** (`/api/simulations`; the bodies are summarised in 1.3):

| Method and path | Body / query | Returns |
|---|---|---|
| `GET /` | `q` (≤ 200, ILIKE on name), `limit` 1..200 (100), `offset` | `{ simulations: [{ id, name, description, latest_version, summary, created_at, updated_at }] }` newest first |
| `POST /` | `{ name, description?, scenario, results?, note? }` | 201, the simulation with `version` |
| `GET /:id` / `GET /:id?version=n` / `GET /:id/versions/:n` | – | the simulation with `version: { version, note, summary, size_bytes, created_at, has_results, scenario, results }` |
| `GET /:id/versions` | – | `{ versions: [metadata, newest first] }` |
| `POST /:id/versions` | `{ scenario, results?, note?, base_version? }` | 201; 409 `{ error: 'version_conflict', latest_version }` when stale |
| `PATCH /:id` | `{ name?, description? }` | updated row |
| `DELETE /:id` | – | 204 |

`summary` = `{ nodes, sources, buildings, environment: { kind, name, lat, lon } | null, has_results, located }` (located = results with `error_3d_m != null`). `size_bytes` is the JSON size of the scenario plus results. Ids must be UUIDs and versions positive integers. Errors are `{ error, message }`.

### 9.10 Settings panel and the `s_<key>` binding

The Settings workspace edits the **open scene's** settings, which are saved with it. Every input whose id starts with `s_` is bound to `scenario.settings[<key>]` on `change`: checkboxes give a boolean, selects with `data-string` give a string, everything else gives a number. Every change calls `markEdited`. `syncSettingsInputs()` writes the settings back into the inputs after a load.

| Card | Inputs |
|---|---|
| Map and environment | OSM name, latitude, longitude, tile size, Load map, Cancel loading, Remove map |
| Air and noise | `s_temperature_c`, `s_humidity_pct`, `s_noise_floor_db_spl`, `s_ground_reflectivity`, `s_noise_enabled`, `s_seed` |
| Propagation | `s_reflection_order` (0 ground only, 1, 2), `s_diffraction_order` (0 off, 1, 2 default), `s_diffraction_model` (wedge, maekawa), `s_path_prune_db` (min 10), `s_block_direct_behind_buildings` |
| Localisation | `s_min_snr_db`, `s_picked_path_tolerance_deg`, `s_window_policy` (auto / fixed), `locBand` (200–1600 / 200–3000 / 100–4000 Hz, with the aliasing note), `s_source_height_prior_m`, Direction cones, Back-trace candidates, Back-trace lines for all nodes (see §7) |
| Labelling | `s_labelling_enabled`, `s_labelling_mode` (models / oracle), `s_label_clap_mode` (5 s / 10 s), `s_label_pre_roll_s`, *Run sanity check*, status line (§7.12) |
| Display | Sound display, Waves in 3D view, Mic arrays, Show reflections, Reflected sound, Tone and grain, Sound during playback, Nodes shown |
| Heatmap | Heatmap on, Mode (Pulse, Peak-hold, Level), Level-mode peak, Band (localisation, 250 Hz, 1 kHz, 4 kHz), Source (selected or all), Above noise, `s_heatmap_backdrop`, `s_slice_height_m`, slider z = 0 .. tallest building + 10 m in 0.5 m steps, buttons street 1.5 m, node (the selected node, or the most common node height), roof |
| Reach map | Reach map on, View (SNR or level), `s_reach_cell_m`, `s_reach_reflection_order` |

**Defaults**:

- **Save as my defaults** stores the values of all `s_` keys in `localStorage['sim.defaultSettings']`;
- **Apply defaults to this scene** copies them in;
- **Reset defaults** forgets them.

New scenes start from `DEFAULT_SETTINGS` overridden by the stored defaults (only keys that have an `s_` input and the same type as the built-in default). Settings without an input (realism toggles, band, windows, self-noise, pressure, render rate, air absorption, digital references, noise correlation) can only be changed through a scenario file or a sweep.

### 9.11 Create and the workers

**Create**:

1. It requires at least one node and one source and no `placementErrors`, and loads all clips.
2. It sets `status = 'rendering'` and snapshots `lastCreate`.
3. It posts `{ scenario, clips: [[id, Float32Array]], lengthS: renderLengthS, durations }` to the first `renderWorker`.
4. On `done` it stores `rendered` and `results`, sets `t = 0`, `status = 'ready'`, the status text "Located a of b sounds", refreshes the listen options and reopens the mic view. On `error` it alerts and returns to `edit`.

[renderWorker.js](apps/sim/src/renderWorker.js) handles four message types, and the UI runs three instances (Create and components; reach and side view; heatmap):

| Message | Work | Reply |
|---|---|---|
| default | `renderScenario` (progress × 0.9), then `analyseScenario(..., { progressive: true })` | `done { rendered, results }`, mic buffers transferred |
| `components` | `renderComponents(scenario, clips, lengthS, nodeIndex, mode)` | `components { series }`, transferred |
| `field` | `fieldSources` (one source or all), `fitGridToBudget`, `computeFieldArrivals`, `fieldEnvelopes`, `noiseBandPowerPa2` | `field_done { rec }` or `field_error` |
| `reach` | `computeReachField` with `noiseBandPowerPa2` (0 when noise is off) | `reach_progress`, `reach_done { levelDb, snrDb, mask }` |

[sweepWorker.js](apps/sim/src/sweepWorker.js) runs `sweepMulti` (ticked variables), `sweep` (one `param`) or `runTrials` (plain repeats), with progress and `done { rows }` or `error`. Workers receive clips as `[id, Float32Array]` pairs and rebuild a `Map`.

### 9.12 Where the code differs from the older user guide and MVP brief

From `simulation-guide.md`:

- The guide says the tool "models open ground only (no buildings)". It now has box buildings, OSM footprints, reflections and wedge diffraction.
- The guide says each node has 4 microphones. Layouts now have 4, 8 (`stagger_8`) or 2..64 (library arrays).
- The guide describes a left strip with a Display menu and a Settings gear. The code has the side nav (Scenes, Editor, Sound library, Mic arrays, Settings), Display options in the Settings panel, two extra tools (Add building, Side view) and a 3D view checkbox.
- The guide lists sweep variables as nothing, distance scale, noise floor and node count, one at a time. The code ticks any number of 14 variables (including mic array and node height), runs every combination (at most 60) and defaults to 50 seeds.
- The guide shows waveforms and a spectrogram in the node panel. These are now in the Mic's-eye view, which opens automatically.
- The guide says the picker lists 10 sounds. That matches; the two generated test clips exist in the core but are filtered out of the UI.

From `simulation.md` (MVP brief, version 0.1):

- Classification is not part of Create itself. Since 0.4 it runs after Create when `labelling_enabled` is on, with the echo app's models (§7.12).
- The scenario length is the end of the last clip, not that plus 10 s.
- Buildings, reflections up to order 2, diffraction, a 3D view, moving sources, a heatmap, a reach map, a side view, saved simulations, libraries and OSM all exist, though the brief had them out of scope or "later".
- Objects are not locked after Create; edits mark results stale.
- The colour rule "one accent colour only" no longer holds (node colours, source colours, heatmap).
- There is no Delete tool (Delete key and button).
- The scenario version is 0.2.
- No downsampling to model rates happens in the localisation path.
- The brief's acceptance checks 1–9 are still tested (`test/sim.test.js`, `sim-buildings`, `sim-components`).

From the Info dialog (`index.html`), which is partly out of date:

- It says buildings are axis-aligned boxes with 4 corners and 4 roof edges. OSM footprints are prisms with per-corner angles.
- It says "Static sources". Moving sources exist.

---

## 10. Validation, decisions and roadmap

### 10.1 Validation and performance records (formerly packages/sim-core/docs)

These numbers come from the generated files at the time they were run (2026-10-18, node v24.21.0, single run, one thread). Regenerate them with the scripts named.

**Wedge diffraction validation** (formerly `docs/diffraction-validation.md`; regenerate with `node scripts/sim-diffraction-validation.mjs`, which writes `reports/diffraction-validation.md`). These are checks against exact or independent numerical solutions of the same idealised problem, not against measurements. UTD was chosen over BTM for production because it is a closed-form complex response per path that the renderer, the reach map and the audit can all evaluate cheaply and identically. BTM (exact for an infinite rigid wedge) is the independent reference. The production coefficient and the BTM time-domain solution agree to 0.01 dB and 0.3°, and the BTM normalisation was fixed by the exact half-plane shadow-boundary value of ½ (−6.02 dB).

1. *Half-plane at the shadow boundary* (exact BTM, receiver 0.2° into the shadow, r_S = r_R = 10 m, source 15° from the face):

| f (Hz) | 125 | 250 | 500 | 1000 | 2000 | 4000 |
|---|---|---|---|---|---|---|
| exact (dB) | −3.38 | −4.09 | −4.69 | −5.15 | −5.52 | −5.82 |
| UTD (dB) | −3.39 | −4.09 | −4.69 | −5.15 | −5.52 | −5.82 |
| old Maekawa (dB) | −4.77 | −4.77 | −4.77 | −4.77 | −4.77 | −4.77 |

   The high-frequency limit is −6.02 dB.

   *Continuity across a building corner*: a 1 m arc at r = 10 m sampled every 1 cm with the full engine.

| f (Hz) | 125 | 250 | 500 | 1000 | 2000 | 4000 |
|---|---|---|---|---|---|---|
| level at the boundary (dB) | −2.85 | −3.66 | −4.32 | −4.82 | −5.17 | −5.42 |
| largest step between samples (dB) | 0.012 | 0.018 | 0.026 | 0.038 | 0.056 | 0.083 |

   The target was no step above 0.5 dB: met.
2. *Comparison with the exact solution*. The target is an absolute error of at most 1.5 dB wherever the exact level is within 25 dB of the free field.
   - (2a) UTD coefficient against the exact rigid half-plane, 7 geometries (r_S/r_R from 2/2 to 100/100 m, shadow angles 5–60°) × 6 frequencies: 36 cells compared, 0 outside 1.5 dB, worst 0.03 dB.
   - (2b) Full engine at a 90° building corner against the exact wedge: 37 cells, 0 outside, worst 0.16 dB (the corner table includes the far edges of the test building and the wall factor 0.985).
   - Example (10/10 m, 20°): UTD −15.70 dB vs exact −15.70 dB at 1 kHz; engine −14.71 vs −14.67 dB.
3. *Causality*: impulse source, noise off, node behind a 10 × 10 × 15 m building. The earliest path arrival `length/c` is sample 18986.60 and the peak is at sample 18988; the first sample above −20 dB of the peak is 18987 and the first above −40 dB is 18981.

| samples before the peak | 1 | 2 | 5 | 10 | 30 | 100 | 1000 |
|---|---|---|---|---|---|---|---|
| diffracted (dB re peak) | −2.71 | −27.96 | −36.44 | −42.47 | −51.61 | −59.69 | −67.17 |
| ideal delayed impulse (dB re peak) | −15.79 | −21.08 | −28.57 | −34.43 | −43.87 | −54.33 | −74.88 |

   The requirement that nothing arrives before `length/c` minus one sample is met at the −20 dB level. Below that, the pre-arrival level is band-limiting ringing of the 1/√t onset, compared above with the ideal impulse. Clamping the coefficient at 10 Hz added a −47 dB plateau, so the grid starts at 1 Hz.
4. *Frequency behaviour*: single-edge loss at a corner, receiver 20° into the shadow, r = 10 m:

| f (Hz) | 125 | 250 | 500 | 1000 | 2000 | 4000 |
|---|---|---|---|---|---|---|
| loss (dB) | 6.85 | 9.16 | 11.76 | 14.58 | 17.52 | 20.51 |

5. *Roof edge and round the ends* (node at 100 m and 5 m high, source at 1.5 m, 10 × 10 × 15 m building between them):

| Path | Length (m) | Delay (ms) |
|---|---|---|
| `b1:edge:SW + b1:edge:SE` | 100.615 | 295.587 |
| `b1:edge:NW + b1:edge:NE` | 100.615 | 295.587 |
| `b1:roof:west + b1:roof:east` | 103.079 | 302.826 |

   In each case the delay equals length/c.
6. *Order 2 in a two-building canyon* (source (0, 0, 1.5), receiver (90, 0, 3), two 14 × 6 × 12 m buildings, ground 0.8, reflection order 1):

| prune dB | kept | E | SE | ES | EE | pruned | blocked | off_face |
|---|---|---|---|---|---|---|---|---|
| 200 | 36 | 4 | 4 | 2 | 22 | 0 | 448 | 70 |
| 60 | 32 | 4 | 4 | 2 | 18 | 4 | 448 | 70 |
| 50 | 22 | 4 | 4 | 2 | 8 | 14 | 448 | 70 |
| 40 | 22 | 4 | 4 | 2 | 8 | 14 | 448 | 70 |

7. *Reference renderer agreement* (production vs the independent time-domain render, target below −60 dB): blocked direct at order 2 with two buildings −81.79 dB; lit receiver near a shadow boundary −88.77 dB; two-building canyon with reflection and diffraction −83.42 dB.
8. *Not done*: the optional wave-solver check (`scripts/sim-wavesolver-check.mjs`) was not written. Double diffraction, including the grazing leg along a face, is not checked against an exact thick-screen solution. Order 1 cannot connect opposite sides of a building. Ground effects at edges, facade scattering, slope diffraction and vertex diffraction are not modelled.

**Stage profile** (formerly `docs/profile-before.md` with `--legacy`, i.e. order 0 Maekawa, and `docs/profile-after.md` with the wedge model at order 2 after the GCC-PHAT rewrite; `node scripts/sim-profile.mjs <out> [--legacy]`). The scenes are: scene 1, open field, 2 nodes, 1 source, 10 s; scene 2, 3 buildings, 2 nodes, 1 source, 10 s; scene 3, 4 nodes, 4 sources, 6 buildings, 30 s.

| Stage | s1 before | s1 after | s2 before | s2 after | s3 before | s3 after |
|---|---|---|---|---|---|---|
| clip spectra | 110 ms | 100 ms | 68 ms | 58 ms | 1.01 s | 1.16 s |
| path table | 1 ms | 3 ms | 1 ms | 38 ms | 7 ms | 155 ms |
| per-mic render | 641 ms | 835 ms | 489 ms | 2.22 s | 5.64 s | 78.48 s |
| noise generation | 622 ms | 701 ms | 591 ms | 621 ms | 3.77 s | 3.58 s |
| activity | 329 ms | 418 ms | 358 ms | 407 ms | 3.05 s | 5.20 s |
| bearing, full window | 10.75 s | 740 ms | 5.13 s | 701 ms | 20.29 s | 3.26 s |
| progressive bearings | 7.55 s | 614 ms | 3.84 s | 956 ms | 23.46 s | 4.55 s |
| path report / rest / back-trace | ≈ 12 ms | ≈ 7 ms | ≈ 6 ms | ≈ 12 ms | ≈ 30 ms | ≈ 28 ms |
| **Create total** | **20.06 s** | **3.45 s** | **10.51 s** | **5.04 s** | **57.40 s** | **96.56 s** |
| reach map, one source (4 m cells, 50 × 38) | 104 ms | 100 ms | 479 ms | 1.39 s | 995 ms | 3.18 s |
| FFT size / bins per mic | 524288 / 262145 | same | same | same | 2097152 / 1048577 | same |
| paths per source and mic (min/mean/max) | 2/2.0/2 | 2/2.0/2 | 0/1.0/2 | 21/25.0/29 | 0/1.2/3 | 12/42.0/67 |
| dropped candidates | none | none | blocked 8, off_face 96 | blocked 8266, off_face 1170, pruned 76 | blocked 108, off_face 1482 | blocked 271738, off_face 27037, pruned 1256 |

How to read the profile:

- Before the rewrite, about 90 % of Create was GCC-PHAT bearing estimation. Packing the four mics into two complex FFTs and evaluating the band-limited PHAT correlation only at the needed lags made it 10–15× faster, and the bearings agree with the old code to 1.3e-10°.
- The acceptance target was that scene 3 at order 2 takes at most 2× the "before" time (about 105–115 s); it took 96.6 s, which met it narrowly.
- The remaining hot spot is the per-mic render: 78 s on scene 3, with on average 42 paths per source and mic, each looping over 1 M bins.
- Short-buffer rendering, decimated localisation, bin skipping and node parallelism were not implemented, because they change rendered numbers (the golden data would need regenerating) and the target was already met.

**Heatmap field timings** (`scripts/sim-heatmap-timing.mjs`; top 16 arrivals, diffraction order 2, reflection order 2; upper bounds because the sensitivity sweep was running at the same time):

| Scene | Sources | 4 m preview (1254 cells) | 2 m full (4875 cells) |
|---|---|---|---|
| scene 2 | 1 | 1.95 s | 4.10 s |
| scene 3 | 4 | 10.48 s | 37.73 s |

The default heatmap shows only the selected source, about a quarter of the scene-3 cost. Pulse and peak-hold frames are cheap after that (a sum over at most 16 arrivals per cell).

**Path pruning** (formerly `docs/prune-report.md`; `scripts/sim-prune-report.mjs` writes `reports/prune-report.md`; wedge model at order 2; 200 dB means no pruning; counts over every source, node and mic):

| Scene | prune dB | kept | pruned | blocked (incl. not visible) | off_face |
|---|---|---|---|---|---|
| scene 1 | any | 16 | 0 | 0 | 0 |
| scene 2 | 200 / 60 / 50 / 40 | 276 / 240 / 200 / 140 | 0 / 36 / 76 / 136 | 8266 | 1170 |
| scene 3 | 200 / 60 / 50 / 40 | 3945 / 3443 / 2689 / 1952 | 0 / 502 / 1256 / 1993 | 271738 | 27037 |

Effect on the scene-2 mean bearing error at prune 200 / 60 / 50 / 40 dB: node n1 11.066 / 11.066 / 10.842 / 10.800°, node n2 0.291 / 0.300 / 0.340 / 0.357°. n1's bearing follows an edge, not the source, so it is about 11° either way.

**Sensitivity** (formerly `docs/sensitivity.md`; `node scripts/sim-sensitivity.mjs 20` writes `reports/sensitivity.md`). The sweep uses 20 seeds per value, varies one input at a time on three scenes (open_street, overlap, canyon_blocked_direct) with short synthetic noise bursts at 48 kHz, and ranks the inputs by the change in mean bearing error between the low and high ends. In open_street and overlap the baseline errors are large (about 46–66°) because of the strong, late wall echo the estimator follows. The top effects:

| Rank | Scene | Input (low → high) | Bearing error low → high (°) | Change |
|---|---|---|---|---|
| 1 | canyon_blocked_direct | diffraction_order 0 → 2 | 68.79 → 23.44 | −45.35 |
| 2 | overlap | diffraction_order 0 → 2 | 21.73 → 46.50 | +24.77 |
| 3 | overlap | model maekawa order 1 → wedge order 2 | 21.73 → 46.50 | +24.77 |
| 4 | canyon_blocked_direct | source level −10 → +10 dB | 32.55 → 23.20 | −9.34 |
| 5 | canyon_blocked_direct | noise_correlation 0 → 0.9 | 23.44 → 30.61 | +7.16 |
| 6 | open_street | mic_position_sigma_mm 0 → 5 | 66.38 → 71.01 | +4.63 |
| 7 | open_street | heading_error_sigma_deg 0 → 5 | 66.38 → 69.85 | +3.46 |
| 8 | overlap | temperature_c 0 → 30 | 47.53 → 44.48 | −3.06 |

Everything else changed by less than 2.6°. `CONCRETE_ABSORPTION` 0.01 → 0.1, humidity 30 → 90 %, building height ×0.8 → ×1.2 and position ±1 m all changed it by under 1°, and `mic_gain_sigma_db` 0 → 2 by 0.00°. The full 39-row table, with fix error and heard fraction, is in the file.

### 10.2 Design decisions and measured numbers (from the developer notes)

These are kept from `NOTES.md` without the analysis, localisation and back-trace parts. Old paths `src/sim/core/*` are now `packages/sim-core/src/*`.

- **One source of truth for paths.** The map rings once had their own image-source enumeration with no ground image and their own on-face test. Now `reflectionSequences` and `surfaceGain` are shared, `reflectionImages` includes the ground image at −z_src with the real gain, ring validity calls `traceReflection`, and ring blocking uses the same 3D `segmentBlocked`. The reach map, side view and heatmap call `findPaths` per cell. Dropped paths are audited with reasons; before, they were dropped silently. The level chain (`spl_ref_db`, `dbfs_ref_db`), ISO 9613-1 and the diffraction formulas are single implementations.
- **DC-bin fix** (found by the reference renderer, disclosed rather than hidden by a tolerance change): see 6.2.
- **Independent reference renderer** (`test/reference-render.js`: windowed-sinc delay plus an explicit per-path linear-phase FIR, time-domain convolution). Worst-mic relative difference on a band-limited noise burst:

| Scene | Difference |
|---|---|
| free field | −89.9 dB |
| ground only | −89.5 dB |
| one wall | −90.8 dB |
| blocked direct with reflections | −139.8 dB |
| blocked direct with Maekawa diffraction | −68.4 dB |

  The requirement is below −60 dB. The comparison clip must be band-limited, because the reference sinc rolls off above about 0.9 × Nyquist by design. With a full-band white clip the free-field scene showed −42 dB from the top octave alone: a test-signal problem, not a render bug.
- **Microphone fidelity** (`test/sim-fidelity.test.js`):
  - components plus noise equal the total to < 1e-6;
  - the audit had 16 applied paths per mic, worst delay and gain differences of 0.0 samples and 0.0 dB, and 82 dropped paths, all with reasons;
  - an impulse with noise off gives exactly one spike per path within 2 samples, and digital silence before the start;
  - a noise-only render reads 45.14 dB vs 45.14 dB expected, and 0.00 dB in band against the reach noise reference;
  - a noise burst reads 96.00 dB at 1 m (configured 96) and falls 6.00 / 6.03 / 6.03 dB per doubling;
  - the impulse amplitude ratio at 2 m vs 4 m is 2.003;
  - air absorption over 80 m matches ISO 9613-1 at 0.09 / 0.33 / 2.13 dB;
  - the ground path delay and gain match the mirrored source to 1e-9;
  - with the direct path blocked there is no spike at the direct time, and the first spike is sample-exact at the earliest path;
  - a path at 94 % of the buffer does not wrap;
  - the reference-vs-production delay is 0.0000 samples on an impulse and on a 500 Hz tone. Production uses exact phase-ramp delays, so the only interpolator in the system is the reference's sinc.
- **Reach map** (`test/sim-reach.test.js`):
  - open field at order 0 with the ground off: 6.02 dB per doubling of the **3D** distance at 1.5, 5 and 10 m, and circular contours within 0.1 dB;
  - the shadow behind a 15 m box is at the numerical floor at z = 2 and 20 m and gone at z = 24 m. The edge is the line from the source over the near top corner (z = 22.5 m at that receiver), so being above the roof is not enough by itself;
  - shadow edges bracket the corner lines within one 2 m cell;
  - one-wall mirror: 58.5 ms and −4.53 dB;
  - Maekawa on the map: 3.8 dB at the edge, 10.9 then 11.2 dB with depth, and 16.4 dB at 250 Hz vs 20.0 dB at 4 kHz;
  - reach map vs microphone: 0.16 dB for a broadband burst; −9.62 dB for a 300 Hz tone, which is expected because the map ignores interference and the ground plus wall coherent sum can cancel most of a tone.
- **Speed of sound**: one function, tested at 0 and 25 °C (about 4.4 % scaling).
- **Sample rate**: localisation runs at the render rate; there is no downsampling stage, so no anti-aliasing check is needed.
- **Defaults chosen for diffraction**: wedge model, order 2, prune 50 dB, cap 128. The legacy model keeps its cap of 64 and does no pruning, so it stays bit-identical. With `diffraction_order: 0`, and with `diffraction_order: 1, diffraction_model: 'maekawa'`, the building scenes match the old code exactly (`golden-legacy-buildings.json`, generated by the pre-wedge code and never regenerated). `golden-wedge.json` pins the new defaults and was regenerated once, when the grid start moved from 10 Hz to 1 Hz.
- **Order 1 cannot connect opposite sides of a building.** Order 2 stays the default; order 1 saves time only by dropping the E+S, S+E and E+E searches, and then a thick building has no shadow-zone energy.
- **Same-building double diffraction** halves the coefficient at each grazing end. That and the `1/sqrt(s0 s1 s2 (s0+s1+s2))` spreading are engineering approximations. Slope and vertex diffraction are omitted.
- **Roofs do not reflect**, so R0 = 0 in the roof-edge coefficient. Walls use the wall factor, so direct, reflected and diffracted fields stay continuous.
- **Visibility graph** sampling (9 per edge, 5 × 5 per pair) and the aggregated `blocked` drop: see 5.6.
- **Tests changed when the default changed**: the scene helpers for back-trace, buildings, diffraction, fidelity and reference now set `diffraction_order: 0, diffraction_model: 'maekawa'` explicitly (they test the old model). No expected value was changed. `sim-reach` sets `'maekawa'` for its diffraction test. New suites: `sim-wedge`, `sim-vertical`.
- **Moving sources**: the data model is unchanged (keyframes). Static sources go through the unchanged `addPath`, so all golden tests are bit-identical. A still two-keyframe source matches the static render to about −40 dB. The render audit, reflected rings and reach map (path start) are deliberately not motion-aware; the heatmap uses up to 5 crossfaded sub-sources.
- **Heatmap defaults**: on, Pulse mode, localisation band, the selected source (all when none is selected), backdrop 0.25, slider 0 to the tallest building + 10 m. "Above noise" applies to the localisation band only. Wall echoes above wall tops vanish (finite faces, `off_face`). The heatmap side view was not integrated; the side view still uses the reach map.
- **`concrete_absorption`** (optional setting) was added so the sensitivity sweep can vary it; when unset the behaviour is unchanged.
- **Monorepo and saved simulations**: there are four Railway services and `SIM_ENABLED` is gone. Saved simulations are append-only versions with a 409 on a stale `base_version`, and the server validates scenarios with `validateScenario`.
- **Browser smoke tests** (headless Chromium via Playwright or CDP, not part of `npm test`) were run for the mic view, building drag, stale banner, heatmap, moving path editing, and save, reload, versions, rename and delete. No console errors were seen.

### 10.3 Roadmap: object twins (NOT BUILT)

> This summarises `sound_simulator.md` (1 Nov 2026), the architecture plan for what comes next. **None of the object-twin layer exists in the code.** The last part of this section says what does.

**Idea.** An object is a **digital twin** that synthesises its own sound from its physical state, not an audio clip carried along a path. The plan adds the object library and the layers that drive it to the existing site simulator.

**Flow.** Motion engine → Object twins → Site engine → Array model → Simulated recording → Real pipeline → Scoring. The motion engine also passes true positions straight to Scoring. Real recordings are used to fit the twins' fingerprints, to calibrate the site, and for the final test.

| Block | Plan |
|---|---|
| Real recordings | clean object sounds and on-site noise, to fit fingerprints and calibrate the site |
| Motion engine | paths and speeds, controls over time, the true position kept |
| Object twins | anatomy and materials, a fitted fingerprint, sound from state |
| Site engine | buildings, wind, delay and Doppler, background noise |
| Array model | 12 mics per node, mic response, timing and drift |
| Simulated recording | multichannel audio plus ground truth |
| Real pipeline | detect, classify, localise |
| Scoring | compares the pipeline output with the ground truth |

**Object twin library.** A twin has three parts:

1. *Anatomy and materials*: the physical build (for example rotors, blades and body for a drone, or glass and thickness for a bottle), which sets what sounds it can make.
2. *Control and state*: the inputs (throttle, steering, impact force) and the resulting state over time (rotor speeds, attitude, velocity).
3. *Fingerprint*: parameters fitted from clean, isolated real recordings.

Three synthesis classes are needed: **continuous** (drones, vehicles; sound is a function of ongoing state), **impulsive** (glass breaking, gunshots, impacts; triggered by an event, then rings out) and **vocal** (shouting; shaped by a source and its level). Adding an object means adding a twin and a fingerprint; no other layer changes.

**Motion and scenario engine.** Paths and kinematics (position, velocity and altitude from waypoints, a controller or a recorded log); dynamics (controls produce internal state, so sound follows state, not only Doppler); several twins per scene with their own paths and times; randomisation (sweeps over speed, path, variant and timing). Every scenario stores the true position and class of each object at every moment.

**Site and propagation engine.** Geometry (reflection, blocking, diffraction), propagation (moving-source delay per mic, which gives Doppler and the inter-mic time differences, plus distance loss and air absorption), and environment (wind, weather, background noise, ideally from real recordings of the target site). The twin supplies the source sound and its direction pattern.

**Array and sensor model.** The 12-mic icosahedral layout with the node's position and orientation; mic sensitivity, noise floor, frequency response and sampling matched to the hardware; timing between mics and between nodes, including realistic clock drift. The output has the same format as the real hardware, so the pipeline runs on it unchanged.

**Outputs and uses.** Training data; regression testing of every pipeline change against fixed scenarios; coverage planning (load a site map, place nodes, see where objects would be missed); demos; and a live map showing simulated or real events.

**Validation loop.** Fit the fingerprint on clean recordings. Check the site model by comparing simulated and real recordings at the same positions and adjusting reflections and background noise. As the final test, train only on simulated data and run the detector and localiser on real node recordings. Results are only ever reported on real recordings.

**Build order.**

1. Define the twin interface: state in, source sound and direction pattern out.
2. Build the first twin, with its fingerprint fitted from clean recordings.
3. Connect it to the site simulator and array model, starting with open ground.
4. Run the simulation-to-real test on the nodes.
5. Add an impulsive twin, then library tooling.

**Open questions.** Which object and brand go first (whatever the target customer sees)? Which clean recordings exist or must be made? Is each source's direction pattern modelled or measured per object? How is clock drift between nodes represented?

**What already exists in the code:**

| Plan block | Status in code |
|---|---|
| Site engine | **Mostly built**: box and OSM-footprint buildings, specular reflections up to order 2, UTD wedge diffraction up to order 2, per-mic delay, 1/r spreading, ISO 9613-1 absorption, synthetic pink ambient and white self-noise (optionally correlated), a moving-source delay per mic with piecewise Doppler. **Missing**: wind, weather, temperature gradients, background noise from real site recordings, facade scattering, source direction patterns (every source is an omnidirectional point) |
| Motion engine | **Partly built**: keyframed polylines with linear interpolation, constant speed per drawn path, the true emitting position (`emittedPosition`), several sources per scene, sweeps over distance scale and settings. **Missing**: controllers, recorded logs, dynamics, per-object state, randomised speed, path or variant |
| Object twins | **Not built.** Sources are audio clips (ESC-50, uploads) or generated tone, impulse and noise, with a calibrated 1 m level (sound library with a measured-level calibration record). There is no state-driven synthesis, no fingerprint fitting, and no continuous, impulsive or vocal classes |
| Array model | **Partly built**: arbitrary arrays of 2..64 mics including the 12-mic D180 ball and its subsets, an array library with derived figures, heading, position and gain errors (3.6). **Missing**: mic frequency response, sensitivity spread beyond a broadband gain, sampling other than the render rate, clock drift and inter-node timing, shell diffraction |
| Simulated recording + ground truth | **Built**: per-node multichannel float signals, WAV export, results with true positions (see §7) |
| Real pipeline / scoring | **Partly built** (§7): localisation on the render and scoring against the truth; labelling with the echo app's stack and per-label scoring (§7.12), off by default; validation against real recordings not done |
| Validation loop | **Not built**: no fitting to or comparison with real recordings |

### 10.4 Roadmap: sound disaggregation model (partly built)

Goal: split the sound at a site into its sources and say how much each contributes, as energy disaggregation splits a meter reading into appliances: "of the noise at this spot, X % road, Y % bar, Z % generator", plus where each source is. Principle: **localise first, tag by direction, attribute loudness**. Full audio separation is optional and not the first step.

Why not separate the audio first: sources add, and walls add echoes, so the mix is hard to un-mix (the cocktail-party problem). Neural separation works best on a clean single-mic mix with little reverb, and degrades with many overlapping sources and echoes. Nodes have several mics at known positions, so sources in different places can be separated by geometry, which is more reliable than separating by sound alone.

| Step | What it does | Status in the simulator |
|---|---|---|
| 1. Capture and time sync | each node records its array and timestamps frames; nodes share a clock (mesh sync, no GNSS); raw audio stays on the node | rendered per node on one exact clock; no clock drift modelled |
| 2. Detect and localise | events and positions from arrival-time differences across mics and nodes; site geometry corrects for echoes | §7.2–§7.11, back-trace §7.13 |
| 3. Direction focus | steer the array to each localised source (beamforming) | delay-and-sum, `beamform.js` (§7.12) |
| 4. Multi-label tagging | CLAP-style labels with YAMNet as context, on the focused signal; several tags per signal | P9 labelling, `multi_labels` (§7.12) |
| 5. Loudness attribution | each source's level at a point of interest from its position and beamformed level, corrected for distance and reflections; dB and share of total | node shares only (`attribution.js`, measured vs free-field true); no point-of-interest attribution |
| 6. Track and aggregate | tracks over time; per-source summaries, heatmap of where sound is produced, timeline | track (§7.11); aggregation not built |

Outputs planned: a source list (road, bar, generator, drone), contribution per source (road 60 %, bar 25 %, generator 15 %; for noise enforcement), a source heatmap (control room), and event cards ("possible fight, courtyard B, 02:14"; estate or prison security).

Validation in the simulator first, where the truth is known:

1. localisation error per source against truth, by distance and number of overlapping sources;
2. tagging accuracy with 1, 2 and 3+ overlapping sources;
3. attribution error of each source's share;
4. failure cases: two sources in the same direction, heavy reflections, wind, a loud source masking a quiet one;
5. the real-world check: a 3-node proof of concept with Flightradar data as ground truth for aircraft.

Set the heatmap grid size only after step 1 shows what accuracy can honestly be claimed.

Risks and open questions:

- Same-direction sources (a bar with a road behind it) cannot be split by geometry: report them combined, with a flag.
- Reflections can put a source in the wrong place, which needs the site model.
- Quiet sources under loud ones are missed: report detection limits.
- Privacy: speech never leaves the node; decide what is stored and for how long.
- Calibration: attribution in dB needs calibrated mics (a chirp or reference source at install).
- Claims: present shares with an error range until validated.

Next steps: define pass/fail targets for localisation and attribution; run the simulator with 2, 3 and 5 overlapping sources; pick a first real site (a road plus a second known source); compare the attributed shares with a reference measurement. Optional full separation can be added later for clips where it measurably improves tagging.

---

## 11. Tests and scripts

`npm test` at the root runs every workspace. The engine suites run with `npm test -w @echo/sim-core` (`node --test --test-timeout=900000 test/*.test.js`).

**packages/sim-core/test** (suites):

| File | Checks |
|---|---|
| `sim.test.js` | MVP acceptance: speed of sound; ISO 9613-1 value; 6 dB per doubling; delay r/c and about 4.4 % from 0 to 25 °C; less energy above 4 kHz far away; single-node bearing within 2° at 20 m; 3 nodes within 1 m; a 3 kHz tone localises worse than a click; tetrahedron resolves up/down; determinism; layout geometry; ring slice radius; spectrogram bin; low-SNR nodes excluded; overlap flagged |
| `sim-buildings.test.js` | one-wall mirror (lengths, 58.5 ms, −4.5 dB, in a render); blocked direct removed and first arrival = earliest reflection; blocking switch; placement rules; v0.1 files load; order 2 wall-wall and wall-ground within the cap; deterministic diagnostics; saved test scenarios load |
| `sim-components.test.js` | components sum to the render; direct arrival at `start + r_k/c` within one sample; by-source ratio follows spreading; no direct component when blocked; GCC curve shows direct and reflection peaks; WAV and CSV export |
| `sim-fidelity.test.js` | composition, render audit, impulse spikes, noise switch, level chain (noise and burst), spreading, air absorption band loss, ground path, blocked direct, padding/wrap, interpolator agreement within 0.05 sample (impulse, 500 Hz) |
| `sim-reference.test.js` | production render against the independent time-domain reference (`reference-render.js`) on several scenes (free field, ground, wall, blocked, Maekawa, three wedge scenes), below −60 dB |
| `sim-diffraction.test.js` | legacy model: about 5 dB at the shadow edge and the 20 dB cap; order 0 changes nothing; order 1 adds paths only when blocked; bearing at a corner with a diffracted picked path; 200 Hz loses less than 3 kHz |
| `sim-wedge.test.js` | defaults; old-file notice; Fresnel F continuity and limits; half-plane vs BTM within 0.1 dB; −6 dB boundary; corner engine vs exact within 1.5 dB; no step > 0.5 dB on a 1 cm arc; lit and shadow sides; causality; frequency behaviour; roof and end paths; order 1 vs 2 limit; order 2 canyon chains and pruning; blocked legs; GO jump at the boundary; audit with wedge paths |
| `sim-vertical.test.js` | ground-bounce elevation −atan((z_n + z_s)/d) (−16.26°); wall-bounce elevation (−7.57°); finite wall height (`off_face`, with an over-edge path when diffraction is on); ring radius `sqrt((ct)² − dz²)` for images; roofs never reflect |
| `sim-footprint.test.js` | ring simplification and orientation; L-shaped notch is open ground; placement inside the bbox but outside the outline; a square footprint equals the box; 45° wall mirror law; corner edges and angles (concave skipped); back-trace off angled walls; grid blocking equals brute force; outline blocking vs dense sampling |
| `sim-osm.test.js` | projection, footprints and heights; height units, storeys and fallbacks; roads and parks kept, incomplete data rejected; bounded query; scenario keeps or rejects the environment |
| `sim-reach.test.js` | 6 dB per 3D doubling; slice above the roof; straight shadow edges; mirror; Maekawa on the map; SNR at the node within 1 dB of `snr_db`; reach vs mic (burst, tone) |
| `sim-field.test.js` | memory estimate and coarsening; time-mean pulse = reach-map band power within 1.5 dB; pulse peaks within one frame of the arrivals; final peak-hold = running max; slice above the roof opens the mask; 6 dB per doubling and circular contours; diffracted energy behind a building |
| `sim-motion.test.js` | `positionAt`; crossfade weights sum to 1; validation of paths; a still path renders like a static source; an approaching source gets louder and arrives on time; components add up; moving-source analysis uses the emitting position; heatmap sub-sources |
| `sim-stagger.test.js` | `stagger_8` geometry, distances, parameters and rotation; `flat_square` unchanged; stagger measures elevation; position jitter perturbs only the rendered array; flat-square sign flag |
| `sim-libraries.test.js` | `ball12_d180` and `flat4_100` figures match the design data; `icosaBall` reproduces the table; custom layouts in metres rotate with the node; array validation; 6 dB per doubling calibration; tone synth and sound validation |
| `sim-more-libraries.test.js` | all built-in arrays validate; subsets keep the ball coordinates and have a vertical baseline; dome and puck give 12 mics; node shares sum to 100 (`attribution.js`) |
| `sim-sweep.test.js`, `sim-sweep-vars.test.js` | percentile; variants do not mutate the input; repeats vary the seed; more nodes localise where one cannot; sweeps with buildings report the reflection-picked rate; variable list; `mic_array` variant; Cartesian product and the 60-case limit; import template round trip; unit conversion and bad-entry errors |
| `sim-golden.test.js` | regression against `test/golden/*.json` (signals within 1e-6 for orders 0, 1, 2 and the default; legacy building and wedge sets; bearing baseline `golden-phase3.json`) |
| `sim-backtrace.test.js` | corner scene unfolds via the right faces and lands on the source; rays branch and stop at the order; crossings behind a node rejected; `intersectRays` negative range and line angle |
| `sim-label.test.js` | window schedule; event matching; the older detect, label and attach pipeline on a gunshot (stub runners) |
| `sim-suite.test.js` | the fixed-seed A–E suite runs and reports (`suite-lib.js`) |
| `sim-upgrade.test.js` | 0.4/0.5 analysis: P1 silent-window regression and containment; P2 onset-gated vs fixed; P3 two of five bad rays rejected with reasons; P4 horizontal and trusted-elevation 3D fixes, z clamp, suspect checks; P6 moving ground and aerial D180 tracks; P7 corner edge support and visibility; P8 detected but not localisable, band-following decimation |
| `sim-labelling.test.js` | P9 with stub runners: manifest truth; omni and beamformed labelling with the app stack, bearings untouched, required fields, no audio-derived arrays; oracle mode; delay-and-sum steering; sanity check; export schema 0.6, scalar render audit and absent labels before completion |
| `sim-labelling-models.test.js` | P9 with the real YAMNet and CLAP (Node runners): the app path and the sim path agree on the clean glass, horn and dog clips. Skipped without the model files or the ESC-50 clips |
| `sim-upgrade-regression.test.js` | the six upgrade scenes against `test/fixtures/upgrade-0.4.json`: fails if any fix, node azimuth or track error gets worse beyond tolerance, or fewer nodes are heard/usable (skipped without the ESC-50 clips) |

Helpers: `reference-render.js` (independent slow renderer), `btm-reference.js` (exact BTM wedge, Svensson et al. closed form, transformed numerically), `wedge-lib.js` (coherent field of a path list and the exact wedge field), `golden-lib.js` and `golden-scenes.js` (fingerprints and fixed synthetic scenes), `profile-scenes.js` (the three profile scenes), `backtrace-scene.js`, `suite-lib.js` and `upgrade-scenes.js` (see §7), and `scenarios/*.json` (one-wall mirror and horn/fireworks overlap inputs).

**packages/sim-core/scripts** (run from `packages/sim-core`):

| Script | Does |
|---|---|
| `sim-golden.mjs [file] [--set base\|legacy-buildings\|wedge]` | regenerates golden data. `legacy-buildings` must only be generated by pre-wedge code |
| `sim-diffraction-validation.mjs [out.md]` | writes `docs/diffraction-validation.md` |
| `sim-profile.mjs <out.md> [--legacy] [--title]` | stage timing of Create on the three scenes (`docs/profile-*.md`) |
| `sim-heatmap-timing.mjs` | heatmap preview and full-resolution timings |
| `sim-prune-report.mjs` | `docs/prune-report.md` |
| `sim-sensitivity.mjs [seeds] [out]` | `docs/sensitivity.md` |
| `sim-overlap-check.mjs` | overlap and SNR check with the real ESC-50 clips |
| `sim-stagger-compare.mjs [--seed] [--json]` | flat_square vs stagger_8 (σ 0 and 1 mm) on a car horn, engine and glass scene |
| `sim-heading-sweep.mjs [--seeds] [--label]` | fix error vs heading σ on suite scenario A |
| `sim-labelling-report.mjs [--suite exports\|upgrade] [--scenes a,b] [--json out]` | labelling with the real models: sanity check on three clean clips, then per scene, node and source the omni and beamformed labels, multi-labels, oracle run and summary metrics, with totals by overlap, SNR and blocked direct path |
| `sim-upgrade-report.mjs [--suite upgrade\|exports] [--core dir] [--json out] [--scenes a,b] [--set k=v]` | per-scene table of the six upgrade scenes, or of the seven exported runs ([export-scenes.js](packages/sim-core/test/export-scenes.js)) (fix error, node azimuth errors and policies, heard/usable, flags, track fixes, 1σ/2σ calibration); `--core .before/src` runs an older copy of the core on the same render for before/after |
| `sim-experiments.mjs overlap\|standoff\|arrays\|range-angle\|realism` | the five brief experiments (§13.5) |
| `sim-golden.mjs --set analysis-0.4` | regenerates `test/golden/golden-analysis-0.4.json` (analysis values only; signal goldens untouched) |
| `sim-uncertainty-calibration.mjs` | empirical azimuth spread against the stated uncertainty, 10 scenes × seeds |
| `backtrace-report.mjs` | back-trace on the corner scene |
| `sim-suite.mjs` | A–E suite with WBR (wrong-but-reliable) rates |
| `lib-wav.mjs` | minimal PCM16/float32 WAV reader, mono mix, resampled to 48 kHz |

`packages/assets/scripts/fetch-test-audio.mjs` downloads the clips (8.4).

**apps/sim/test** (`npm test -w @echo/sim`):

| File | Checks |
|---|---|
| `report.test.js` | all eleven calculation stages; complete JSON fidelity; zero/false values; no-fix and missing labels; actual render audits; untrusted text escaping; legacy/stale results; popup failures; standalone inline runtime; clipboard success/denial and manual fallback; lazy records, expand/collapse and print state |
| `sim-view3d.test.js` | particles move outwards, keep source colours and replay deterministically; 3D particles on spheres respect walls and ground; projection skips points behind the camera; the projector puts the target at the centre with up as up; 3D playback draws rolling fixes, not whole-event candidates for a moving source |
| `sim-tracking.test.js` | the ring follows the latest elapsed fix and keeps earlier circles; no extrapolation or connecting across gaps; projection and ring sizes on both canvases |
| `sim-osm-loader.test.js` | busy state always clears on a hard timeout and retry works; cancel restores the controls and late results cannot change the scene; success applied once; async and sync errors surfaced |
| `sim-library.test.js` | summary and results sentences; relative times; URL state for the open simulation and older versions; the API client sends JSON and maps errors to messages |
| `vite-config.test.js` | the dev server serves the sim with the same-origin CSP and forwards `/api` |

**Other suites the simulator depends on**:

- `packages/web-server/test/server.test.js`: serves the build with the CSP and forwards `/api`; 502 when the backend is down.
- `apps/backend/test/simulations.test.js`: memory store, and Postgres when `TEST_DATABASE_URL` is set; the summary records the map area; migrations are forward-only and ordered.
- `apps/backend/test/library.test.js`: store, list, replace and delete an array model; reject bad models, ids and kinds; a calibrated generated sound.
- `apps/backend/test/osm-api.test.js`: deadlines cover stalled headers and bodies; a bounded tile from the official API; retry and failure reporting; a valid mirror response after invalid data; rejection of invalid, oversized and cross-origin requests.

---

## 12. Known limits

- **Geometry.**
  - Buildings are axis-aligned boxes (rotation must be 0) or vertical prisms over an OSM outline simplified to 1 m. Courtyards are solid.
  - All faces are one placeholder concrete (energy absorption 0.03, frequency independent).
  - There is no transmission through walls.
  - Roofs and undersides never reflect.
  - The ground is an infinite flat rigid plane with a real, frequency-independent reflection coefficient (`ground_reflectivity`, placeholder 0.8). There is no ground impedance, no terrain and no ground effect at edges.
- **Reflections** are specular only, up to order 2. There is no facade scattering, no diffuse reflection and no frequency-dependent absorption.
- **Diffraction** is UTD for a rigid wedge, orders 1 and 2. Validation covers only the listed checks (half-plane and 90° corner against exact BTM, continuity, causality, frequency trend, reference renderer). Double diffraction (including same-building grazing chains) and its spreading are unvalidated engineering approximations. Slope and vertex diffraction are omitted. Visibility is sampled (a slit under 1/9 of an edge can be missed). Order 1 cannot connect opposite sides of a building. Nothing is validated against measurements.
- **Atmosphere**: uniform temperature and humidity, no wind, no temperature or wind gradients (rays never bend), no rain, no turbulence.
- **Sources**: omnidirectional points. Clip levels are placeholders, calibrated on the loudest 125 ms window. Motion is keyframed polylines at piecewise constant speed. Doppler is piecewise (crossfaded constant-delay pieces, about −40 dB precision against a static render). Moving sources are not audited, have no reflected rings, and the reach map uses their start point.
- **Microphones**: free-field points, with no housing or shell scattering and no frequency response. The only impairments are broadband gain, position and heading errors. There is no clock jitter or drift and no inter-node timing. The digital scaling (94 dB SPL = −26 dBFS) is an assumed placeholder.
- **Noise**: synthetic stationary pink (ambient) and white (self) noise, independent per mic unless `noise_correlation` is set. There is no real site background and no wind noise.
- **Displays**: the rings are a stylised loudness display (no diffraction, no true wavelength). The heatmap and reach map are incoherent energy sums (no interference; a tone can differ by about 10 dB from the coherent render), use whole-clip mean levels, and compute one slice height at a time.
- **Numerics**: circular FFT rendering relies on the render-length padding. The path cap is 128 per mic (wedge) or 64 (legacy).
- **Performance**: the per-mic render dominates with many diffracted paths (78 s of 96 s on the 4-node, 4-source, 6-building, 30 s scene).
- **Clips**: ESC-50 is non-commercial and must stay out of production. Uploaded WAVs are not saved with simulations.
- **Localisation, SNR, uncertainty and classification limits**:
  - Several analysis quantities read the simulator's ground truth (own-source power, true paths, true start time): containment, in-window SNR, `level_diff_db`, the multipath term, the picked path, the track dominance gate, `multipath_suspect` (§7, header). Real nodes would have to estimate them. `fix_suspect`, the trigger, the reflection guard, the fix and the back-trace do not use truth.
  - The reported uncertainty has no term for heading, mic position or gain errors. With the realism toggles on (2.5° heading, 1 dB gain, 5 mm position, ρ = 0.3), calibration drops from 78 %/85 % to 37 %/52 % within 1σ/2σ (§13).
  - Flat arrays cannot resolve elevation: z is clamped to a prior (1.5 m) and 3D error equals horizontal error by construction.
  - A biased two-node fix cannot be detected from bearings alone.
  - Two sustained sources within about 6 dB blend into one bearing between them; this is flagged, not separated.
  - An edge hypothesis constrains a region, so blocked nodes add support but rarely pin a point alone. A node hearing a blend of corner and roof arrivals matches no single hypothesis.
  - Same-class sources cannot be separated by label.
  - Labelling with the real models is correct on clean, close clips but falls apart with range on rendered audio (§13.7): glass holds to about 10 m, a horn to about 20 m. Treat sim labelling metrics as a lower bound shaped by the render, not a prediction for real nodes.

---

## 13. Schema 0.4 localisation upgrade (Nov 2026): brief, verification and results

The brief (formerly `sim-upgrade.md`) asked for nine work packages, P1–P9. It came with findings read from six exported runs (2–5 nodes, 1–7 sources); **those six exports are not in the repository**. Six fixed stand-in scenes in [test/upgrade-scenes.js](packages/sim-core/test/upgrade-scenes.js) rebuild the conditions they describe: `near_wall`, `overlap`, `continuous`, `moving`, `blocked` and `five_node`, with ESC-50 clips. They are the regression fixtures in place of the exports. Hard constraints kept throughout:

- Localise first, label after: labelling never changes a bearing or a fix.
- No audio, spectra or embeddings in exports.
- Unmeasured constants are marked `placeholder`.
- No change to the physics: render fingerprints are identical to the old golden files, and only the analysis goldens moved, to `golden-analysis-0.4.json`.
- Thresholds are settings with documented defaults.

Commits on branch `sim-upgrade-0.4`, one per package, except where packages share code: P1+P2 (one block), P3+P4+P5 (the fix weights need the split uncertainty), P6, P8, P7, P9 + export, then regression suite + experiments.

### 13.1 Findings checked against the code

| Finding (from the exports) | Verdict from the code (0.3) |
|---|---|
| Long windows pull bearings towards reflections | **Confirmed** as a mechanism: one bearing over the whole active window (`loc = active`) |
| Nodes ~3 m from a wall get large errors (reflection ~14 ms late, ~1 dB down) | **Consistent**: no reflection handling in the window; delay 2 d (n·u)/c ≈ 14–17 ms at 3 m. Not reproducible without the exports. In the stand-in scene the node 3 m from a wall was only 0.5° off |
| Window selected on silence, still `reliable: true`, ±90° | **Confirmed**: the longest non-overlapped piece of the active window was used with no in-window SNR check. Reproduced exactly (P1 test: ±90°, 70–78° error, reliable) |
| `unresolved_overlap` forces `reliable: false` even with good bearings | **Confirmed**: `used = bearing && heard && reliable` |
| Whole-window locking on the nearest continuous source | **Confirmed** mechanism (single whole-event window); reproduced as 8.0° at `continuous` n3 |
| Picked-path matcher too loose (−50 dB paths, +54° elevation) | **Confirmed**: first path within 5° in azimuth, no level or elevation test |
| Uncertainty ignores multipath | **Confirmed**: CRB (+ motion) only; 23 % of stand-in bearings were within 1σ |
| Flat-array elevation sign assumed; underground fixes | **Confirmed**: planar fit assumes below; 3D ray intersection then follows that z (stand-ins: z −1.9 and −2.7 m) |
| `fix_suspect` / `poorly_conditioned` miss obvious failures | **Confirmed**: `fix_suspect` = a used node picked a non-direct path or is blocked; conditioning from the 3D angle; no range, height or bounds checks |
| Bad nodes not rejected | **Confirmed**: plain SNR-weighted least squares over all used nodes |
| `heard_nodes` is 0 while nodes have `heard: true` | **Confirmed**: `heard_nodes = rays.length` (the used nodes) |
| Moving sources: few track fixes, rays from different times | **Confirmed**: track windows were in arrival time, the same for every node, and every overlapped window was skipped |
| Blocked nodes give no back-trace candidates | **Confirmed**: only reflection unfolding |
| In-band SNR far below broadband; "not heard" | **Confirmed**: `heard` used in-band SNR only; `snr_broadband_db` is a whole-mixture figure |

Contradictions and notes:

- The brief's `window_snr_db` export field shares its name with an existing *setting* (the active-window frame threshold). Both are kept: the setting is in `settings`, the field is per node.
- The brief cites `claude/11-localisation-methods.md`, `claude/14-mic-array-library.md` and `sound-disaggregation-model.md`; the repository had `micarrays.md` and `sound_disaggregation.md`. Their content is in §4 and §7.12.
- `event_labelling_upgrade.md` §7 ("the simulator no longer runs YAMNet or CLAP") is superseded by P9.

### 13.2 What was built, by package

| Package | Where | Summary |
|---|---|---|
| P1 window SNR + containment | `windows.js` `arrivalSpan`, `analyse.js` | §7.3 |
| P2 adaptive window, policy from trigger | `windows.js` `triggerType`, `reflectionGuardS`, `adaptiveWindow` | §7.5 |
| P3 weighted robust inclusion | `fix.js`, `uncertainty.js` weight terms | §7.7, §7.10 |
| P4 solver sanity and flags | `fix.js` | §7.10 |
| P5 picked path, split uncertainty, track gate | `pathreport.js`, `uncertainty.js`, `track.js` | §7.7, §7.8, §7.11 |
| P6 common-time motion-compensated track | `track.js` | §7.11 |
| P7 diffraction-aware back-trace | `backtrace.js` `edgeLegs`, `roofLegs` | §7.13 |
| P8 detected vs localisable | `activity.js`, `analyse.js` | §7.9 |
| P9 labelling with the app stack | `labelling.js`, `beamform.js`, `apps/sim/src/main.js`, `config/sim-label-manifest.json` | §7.12 |
| Export schema 0.6 + changelog | `export.js` | §7.15 |

### 13.3 Before (0.3) and after (0.4) on the six scenes

Same render for both, analysed by the 0.3 code (`.before/src`, a copy taken before the change) and the 0.4 code: `node scripts/sim-upgrade-report.mjs [--core .before/src]`. "−" means no value: no fix, or no bearing. Fix z is clamped to 1.5 m in 0.4 (flat arrays), so its 3D error equals its horizontal error. 0.3 3D errors were 0.5–5.0 m, with z between −2.7 and 3.6 m. SIMULATED results.

| scene / source | fix error m (0.3 → 0.4) | heard 0.3 → 0.4 | usable 0.4 | per-node azimuth error ° (0.3 → 0.4) | track fixes 0.3 → 0.4 (0.4 median m) | 0.4 flags |
|---|---|---|---|---|---|---|
| near_wall / s1 | 0.5 → 0.1 | 3 → 3 | 3 | n1 0.0→0.0, n2 0.0→0.0, n3 0.5→0.2 | 11 → 16 (0.2) | - |
| overlap / s1 | 0.3 → 0.8 | 3 → 3 | 3 | n1 0.2→0.2, n2 0.0→0.8, n3 0.0→0.1 | 4 → 4 (0.3) | - |
| overlap / s2 | 0.4 → 0.1 | 3 → 3 | 3 | n1 0.0→0.1, n2 0.1→0.0, n3 0.0→0.1 | 14 → 15 (1.6) | - |
| continuous / s1 | 1.8 → 0.6 | 3 → 3 | 3 | n1 0.1→0.2, n2 0.4→0.4, n3 0.7→1.4 | 4 → 4 (1.2) | - |
| continuous / s2 | 3.6 → 0.2 | 3 → 3 | 3 | n1 0.3→0.3, n2 0.1→0.3, n3 8.0→0.1 | 4 → 6 (1.1) | - |
| moving / s1 | 2.6 → 1.1 | 3 → 3 | 3 | n1 1.6→1.1, n2 4.1→0.9, n3 2.9→1.0 | 50 → 50 (0.4) | -; rejected n1 (outlier) |
| blocked / s1 | 0.1 → 0.1 | 2 → 3 | 3 | n1 0.1→0.1, n2 0.1→0.1, n3 6.1→15.8 | 18 → 18 (0.4) | -; rejected n3 (outlier) |
| five_node / s1 | - → 0.3 | 1 → 5 | 5 | n1 0.1→0.0, n2 0.0→0.5, n3 0.3→1.0, n4 29.4→1.3, n5 2.2→0.3 | 0 → 2 (1.6) | - |
| five_node / s2 | - → - | 0 → 1 | 1 | n1 1.1→-, n2 1.5→-, n3 1.2→-, n4 3.4→96.3, n5 0.9→- | 2 → 0 (-) | - |

Calibration (fraction of node bearings whose true error is within the reported 1σ / 2σ): **0.3: 23 % / 39 % (31 bearings) → 0.4: 78 % / 85 % (27 bearings).**

Where 0.4 is worse:

- `overlap` s1: the n2 bearing goes from 0.0° to 0.8°, because the onset-gated window is shorter than 0.3's non-overlapped piece. The fix error goes from 0.3 to 0.8 m.
- `blocked` n3: 6.1° → 15.8°. This node hears only diffracted sound, a blend of the two corners and the roof. The robust fix now rejects it as an outlier, so the fix is unaffected (0.1 m).
- `five_node` s2 (80 dB footsteps under a louder dog): 0.3 had 1–3° bearings at four nodes from whole low-SNR windows, but did not use them (heard 0). The 0.4 in-window SNR gate drops them as `no_signal`, and the one bearing left (n4) is 96° off. With one usable node there is no fix in either version.
- Fewer bearings in total (27 vs 31): the P1 gate removes low-SNR windows by design.

Acceptance items of the brief:

| Item | Result |
|---|---|
| P1 s10 no longer reliable from a silent window | Reproduced and fixed (`sim-upgrade.test.js`) |
| P2 s1@n3/n7, s9@n1, s13@n2 improve | The exports are missing. On the stand-ins, `continuous` n3 8.0→0.1°, `five_node` n4 29.4→1.3°, the `moving` nodes 1.6–4.1→0.9–1.1°. Worse ones are listed above |
| P3 s12, s11 produce fixes; 5-node 21 m → few m | Stand-in `five_node` s1: no fix (0.3, one usable node) → 0.3 m with all 5 nodes. Synthetic 5-node test with two bad rays: both rejected, error < 2 m |
| P4 underground fixes clamped or flagged | All flat-array fixes clamped (`z_clamped`); trusted-elevation underground fixes flagged `below_ground` (unit test) |
| P5 calibration before/after | 23 %/39 % → 78 %/85 % within 1σ/2σ |
| P6 s8 > 3 track fixes, error vs moving truth | `moving`: 50 fixes, median 0.4 m against the true position at the emission time (0.3: 50 fixes with no per-fix error, rays from different times) |
| P7 s9, s11, s13 blocked nodes produce candidates; true source in top 3 | Exports missing. `blocked`: n3 contributes roof hypotheses (wrong, ranked 2–3); the true source stays rank 1. Corner test: the blocked node supports the true candidate through an order-2 corner chain, rank ≤ 3 |
| P8 detected vs localisable | Exported; a 4–8 kHz source is detected, not localisable, and still heard |
| P9 labelling metrics, omni vs beamformed | Measured with the real models in Node: see §13.7 |

### 13.4 Labelling stack location (P9 report)

The echo app's shared labelling code is importable as modules, so nothing was copied: `@echo/shared` (`periods.js`: `PeriodDetector`, `labelPeriods` with group pooling, decoy floor, target share and YAMNet corroboration; `catalogue.js`; `settings.js` `DEFAULTS`, including `clap_logit_scale` 18.66), `packages/assets/public/config` (`labels.json`, `priorities.json`, `clap_text_embeddings.json` from `packages/assets/scripts/clap-embed.mjs`), and `apps/echo/src/clapWorker.js` (the CLAP checkpoint `Xenova/clap-htsat-unfused`). The checkpoint rate and window come from `preprocessor_config.json` (48 kHz, 10 s), not assumed. The YAMNet runner in `apps/sim/src/models.js` mirrors the echo app's own runner (MediaPipe, 16 kHz). Since then the CLAP scoring and YAMNet score rounding have moved into `@echo/shared/clap.js`, so the echo worker, the sim's browser runners and its Node runners ([node-models.js](packages/sim-core/src/node-models.js)) share one copy (§7.12, §13.7).

### 13.5 Experiments (`scripts/sim-experiments.mjs`; SIMULATED, hypotheses only)

**1. Overlap sweep**: two sustained 1.5 s noise sources, s2 starting `gap` after s1 at `s2 − s1` dB. Direction error of s1.

| gap s | s2 - s1 dB | s1 median az err deg | s1 fix err m | s1 overlapped nodes |
|---|---|---|---|---|
| 0 | -10 | 2.3 | 5.1 | 3 |
| 0 | 0 | 5.6 | 12.6 | 3 |
| 0 | 10 | 19.0 | 19.0 | 3 |
| 0.25 | -10 | 0.4 | 0.3 | 3 |
| 0.25 | 0 | 0.4 | 0.6 | 3 |
| 0.25 | 10 | 0.4 | 0.5 | 3 |
| 0.5 | -10 | 0.2 | 0.2 | 3 |
| 0.5 | 0 | 0.3 | 0.2 | 3 |
| 0.5 | 10 | 0.3 | 0.3 | 3 |
| 1 | -10 | 0.3 | 0.3 | 3 |
| 1 | 0 | 0.3 | 0.2 | 3 |
| 1 | 10 | 0.3 | 0.2 | 3 |
| 2 | -10 | 0.1 | 0.1 | 0 |
| 2 | 0 | 0.1 | 0.1 | 0 |
| 2 | 10 | 0.1 | 0.1 | 0 |

Simultaneous starts are the failure case: with nothing non-overlapped, error grows with the interferer's level, to 19 m at +10 dB. A gap of 0.25 s is already enough for the onset window.

**2. Wall standoff** (one node d m in front of a long 12 m wall, source 40 m away at 30–150°, median of 5 directions):

| wall distance m | impulse az err deg (policy) | sustained az err deg (policy) |
|---|---|---|
| 0.5 | 3.2 (onset_gated) | 6.5 (adaptive_long) |
| 1 | 1.4 (onset_gated) | 4.5 (adaptive_long) |
| 2 | 0.2 (onset_gated) | 7.2 (adaptive_long) |
| 3 | 0.3 (onset_gated) | 6.8 (adaptive_long) |
| 5 | 0.2 (onset_gated) | 4.4 (adaptive_long) |
| 8 | 0.3 (onset_gated) | 5.2 (adaptive_long) |
| 15 | 0.3 (onset_gated) | 1.4 (adaptive_long) |

Hypothesis: for impulsive sounds, onset gating removes the wall effect from about 2 m standoff. For sustained sounds the wall costs 4–7° at every standoff up to 8 m and 1.4° at 15 m; time gating cannot remove it, as the brief expected. No standoff rule is adopted from this single scene.

**3. Array control** (three nodes, 6 random impulsive sources, all nodes the same array):

| array | mics | median az err deg | median sigma deg | median fix err m |
|---|---|---|---|---|
| flat4_100 | 4 | 0.24 | 0.27 | 0.28 |
| planar12_d180 | 12 | 0.14 | 0.23 | 0.16 |
| ball12_d180 | 12 | 0.14 | 0.23 | 0.25 |

With 12 mics at the same aperture, flat and ball give the same horizontal error here. So in azimuth the gain comes from mic count and aperture, not shape. The ball's benefit is elevation; this test clamps z and does not measure that.

**4. Range vs crossing angle** (two nodes on a baseline, source on the bisector):

| range m | crossing deg | median fix err m (3 seeds) |
|---|---|---|
| 40 | 15 | 0.60 |
| 40 | 30 | 0.39 |
| 40 | 60 | 0.29 |
| 40 | 90 | 0.26 |
| 40 | 120 | 0.32 |
| 15 | 60 | 0.03 |
| 30 | 60 | 0.11 |
| 60 | 60 | 0.37 |
| 100 | 60 | 1.11 |

Fix error grows steadily as the crossing angle falls (0.26 m at 90°, 0.60 m at 15°) and roughly with range squared at a fixed angle (0.03 m at 15 m, 1.11 m at 100 m), as the bearing error times range predicts.

**5. Realism toggles** (heading 2.5°, gain 1 dB, position 5 mm, noise correlation 0.3) on the six scenes:

| scene | source | horiz m | 3D m | z m | heard | usable | flags | track fixes (median m) | per-node az error deg (policy) |
|---|---|---|---|---|---|---|---|---|---|
| near_wall | s1 | 2.1 | 2.1 | 1.5 | 3 | 3 | z_clamped | 17 (0.5) | n1 0.6 a, n2 0.2 a, n3 5.7 a |
| overlap | s1 | 7.0 | 7.0 | 1.5 | 3 | 3 | z_clamped | 4 (6.3) | n1 0.8 o, n2 4.9 o, n3 7.2 o |
| overlap | s2 | 0.5 | 0.5 | 1.5 | 3 | 3 | z_clamped | 3 (3.1) | n1 0.2 a, n2 0.8 a, n3 6.1 a |
| continuous | s1 | 11.6 | 11.6 | 1.5 | 3 | 3 | z_clamped | 4 (12.1) | n1 0.5 o, n2 5.0 o, n3 7.9 o |
| continuous | s2 | 32.1 | 32.1 | 1.5 | 3 | 3 | z_clamped | 3 (16.2) | n1 1.0 a, n2 2.1 a, n3 6.8 a |
| moving | s1 | 9.9 | 9.9 | 1.5 | 3 | 3 | z_clamped | 3 (8.0) | n1 1.7 o, n2 4.2 o, n3 8.4 o |
| blocked | s1 | 1.5 | 1.5 | 1.5 | 3 | 3 | z_clamped | 19 (1.6) | n1 0.8 a, n2 1.8 a, n3 38.3 a |
| five_node | s1 | 4.8 | 4.8 | 1.5 | 5 | 5 | z_clamped | 2 (5.2) | n1 0.1 o, n2 0.4 o, n3 8.3 o, n4 5.4 o, n5 0.6 o |
| five_node | s2 | - | - | - | 1 | 1 | - | 0 (-) | n1 -, n2 -, n3 -, n4 99.5 a, n5 - |

calibration: 27 node bearings, 37% within 1 sigma, 52% within 2 sigma

Much of the result does not survive realistic node errors. Fix errors reach 7–32 m, and the moving track keeps only 3 fixes, because the gate rejects biased bearings. Calibration falls to 37 %/52 %, because heading error is not in the reported uncertainty. A heading-uncertainty term, or per-node heading estimation (localisation todo item 5), is the next step.

### 13.6 Earlier analysis history and open work

From the developer notes and `docs/localisation-todo.md` (both folded in here):

- **0.3 back-trace results** (`backtrace-report.mjs`, before P7). True rank / candidate error: three-node scene s1 1 / 0.04 m, s2 2 / 17.2 m, s3 1 / 0.13 m; two-node tetrahedron s1 1 / 0.03 m. In the corner scene the source unfolds via `b5:west` and `b6:north` to 0.01 m, but ranks 2: a shorter-path crossing scores higher. The plain intersection there has a negative range and is rejected (before that change it returned a point behind a node).
- **Earlier `intersectRays` changes**: a positive range along every ray is required; conditioning is computed as the angle between lines, `acos|d1·d2|`.
- **Moving-source analysis (pre-0.4, kept)**: per-node truth is the emitting position at the middle of the localisation window. Centre paths are recomputed there, and half the swept azimuth is added to the uncertainty. The source truth is the mean over the used nodes.
- **A–E suite baseline** (old layout, 50 seeds, old code; `docs/suite/baseline-v1-layout.json`): A glass, median 4.9 m, WBR(3 m) 76 %; heading sweep 4.5 m at 0° and 6.8 m at 5°. D glass 0 % localised (rejected as `unresolved_overlap`, oracle SINR about 10 dB). D engine track coverage 0 %, fix error about 72 m (arrival-time stamping, addressed by P6). C dog 100 % localised, median 31 m, all marked reliable.
- **Open (from the todo, still valid)**:
  1. Re-run the A–E baseline on the range-spread layout, before and after 0.4 (`node scripts/sim-suite.mjs --label … --seeds 50`).
  2. Wire the measured-only localiser (`measured.js`) into the suite and calibrate `MEASURED_DEFAULTS` across scenarios B, C and D, so accept/reject uses no mixture-oracle SNR or truth.
  3. Replace `start_s` in the emission-time logic with a measured onset.
  4. Add a third-node option and `low_confidence` for two-node fixes.
  5. Estimate per-node heading offsets from confident fixes (the realism run in §13.5 shows why).
  6. Run a mixed-spacing (5/15 cm) band experiment.
  7. Height from the ground bounce (direct vs ground-reflected delay, never in the 2D solve), with a `ground_type` setting.
  8. Use real building footprints in the suite.
- **Acceptance targets (simulated, from the todo)**: single isolated source median < 5 m and p90 < 10 m up to 50 m, median < 10 m at 50–100 m. Scenario D engine track coverage > 70 % with median < 10 m. D glass localised on ≥ 70 % of seeds. WBR must not rise against the baseline.


### 13.7 Labelling with the real models (Nov 2026)

The real YAMNet and CLAP now run inside the simulator core ([node-models.js](packages/sim-core/src/node-models.js), §7.12). Run with `node scripts/sim-labelling-report.mjs --suite exports|upgrade`. The exports suite is the seven exported runs the brief was written from ([export-scenes.js](packages/sim-core/test/export-scenes.js)); the upgrade suite is the six stand-in scenes. Default settings: `clap5`, logit scale 18.66 (**placeholder**), `label_cosine_min` 0.15. SIMULATED audio throughout.

**Sanity check: passes.** On the clean glass, horn and dog clips the app path and the sim path give the same label (`glass_break`, `car_horn`, `dog_barking`). The dog first disagreed (sim: none). The models agreed, but the bark starts 2.2 s into the clip, so the period fell outside the 1 s association tolerance. The association rule now also accepts a period that starts while the source is still sounding (§7.12).

**Results** (events = heard node × source × input; "scored" excludes clips with no catalogue label, such as engine):

| suite | input | events | scored | top-1 | top-3 |
|---|---|---|---|---|---|
| exports (7 runs) | omni | 42 | 30 | 3 % | 3 % |
| exports | beamformed | 40 | 30 | 0 % | 0 % |
| upgrade (6 scenes) | omni | 27 | 21 | 24 % | 29 % |
| upgrade | beamformed | 27 | 21 | 24 % | 29 % |
| both | oracle | – | 51 | 100 % | 100 % |

- **The localiser is not the cause.** Oracle labels score 100 % on the same events, and the failures happen on clean, non-overlapped, high-SNR nodes too.
- **The classifier fails with range.** Glass at 14–130 m in the exports is labelled `angle_grinder` at every node, and `bottle_bank` in the upgrade scenes. Car horns at 20–60 m in `seven_source` come out as `reversing_beeps` or `bin_lorry`. The only consistently correct source is the dog in `five_node` (5 of 5 nodes, 21–26 dB).
- **Range sweep** (one node, open field, 100 dB source):

| clip | 2 m | 5 m | 10 m | 20 m | 40 m | 80 m |
|---|---|---|---|---|---|---|
| glass, noise 30 dB | glass_break | glass_break | glass_break | bottle_bank | bottle_bank | angle_grinder |
| glass, noise 45 dB | glass_break | glass_break | glass_break | bottle_bank | bottle_bank | angle_grinder |
| horn, noise 30 dB | car_horn | car_horn | car_horn | car_horn | metal_bang | unexplained_impact |
| horn, noise 45 dB | car_horn | car_horn | car_horn | car_alarm | metal_bang | none |

  Air absorption off gives the same labels. With no noise the glass still flips (to `bottle_bank`, then `angle_grinder`). With no noise and no ground reflection it reads `bottle_smash` at 10–80 m, which is the right family but the wrong label. So noise is not the driver. The likely causes are the lower input level (a 100 dB source at 80 m reaches the classifier at about −58 dBFS) and the ground-reflection comb filter. **Unverified**: the input level was not varied on its own.
- **Beamforming does not help.** Beamformed equals omni on the upgrade scenes and is slightly worse on the exports. A gain at the classifier would need correct labels first.
- **Overlap**: in `seven_source` every horn and the glass are `unresolved_overlap` with 3–6 overlapping sources (three engines). Labels there are dominated by engine-like classes. The three horns are reported as same-class sources and are not separated.
- **Multi-labels** at cosine 0.15 list two or three classes for almost every event. The true label appears among them only for the dog, the footsteps and one horn (`s13` at n3). The threshold is a **placeholder** and is too low to be informative.

**What would change this** (not done): test level normalisation at the classifier input (for example a fixed RMS before YAMNet and CLAP) against the range sweep, and check the app on real recordings at 10–80 m. The real-world question is whether real nodes at these ranges show the same drop. The sim cannot answer it, since its render has no housing, wind or facade scattering.

### 13.8 Schema 0.5 trusted-elevation fixes and aerial tracking

The horizontal solver now falls back to weighted 3D ray fitting when horizontal conditioning fails and trusted elevations have sufficient 3D crossing angle. The track gate for trusted positive elevations follows each node's recent accepted rolling bearing with a 90° placeholder gate; flat arrays and non-positive elevations keep the prior gate. No simulator truth is used by either new path, and the renderer is unchanged.

**D180 orbit fixture** (`sim-upgrade.test.js`): two 12-mic D180 nodes and a synthetic source orbiting at 75 m. The first common-time fix error was 0.09 m; the track produced 96 fixes, median filtered error 1.10 m, and 4 rejected observations. The originally reported drone export/config is not in this repository, so this fixture exercises the stated geometry but is not a byte-for-byte replay of that run.

**Six-scene upgrade report:** all six stand-in scenes are flat-array scenes. Compared with the before-change report, none improved or worsened: all fix errors, track fix counts and median errors stayed the same. Signal goldens remained unchanged; analysis goldens were regenerated with `node scripts/sim-golden.mjs --set analysis-0.4`.

Export schema is 0.5. The 90° gate is in `thresholds` with `placeholder: true`. `labelling_enabled` requests asynchronous labelling; exports include `labelling` only after `labelEvents` completes for the exact results being exported. Exporting early, or after labelling fails, leaves that optional block absent.
