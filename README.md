# echo

Phone sound labeller v2.2. YAMNet (MediaPipe) and CLAP (transformers.js, Web Worker) run on the device. Audio is never stored or uploaded. Only labels, levels and notes are posted to `POST /api/report` when you tap **View results**, and the server forwards them to Gemini.

## Develop

```sh
npm install
npm run fetch-models          # CLAP audio model into public/models (once)
npm run dev:server            # API on :8787 (set GEMINI_API_KEY to use Gemini)
npm run dev                   # Vite, proxies /api to :8787
```

After editing CLAP prompts in `public/config/labels.json`, run `npm run clap:embed` to regenerate `public/config/clap_text_embeddings.json`. Priorities are in `public/config/priorities.json`.

## Build / run production

```sh
npm run build
npm run start   # Express: serves dist/ and /api/report on $PORT (default 8787)
```

## Deploy to Railway

`railway.json` runs `npm run build` then `npm run start`. Environment variables: `GEMINI_API_KEY` (required for Gemini; without it the basic report is used), `GEMINI_MODEL` (default `gemini-3.8-flash`), `GEMINI_THINKING_LEVEL` (default `medium`), `MAX_BODY_BYTES` (default 2 MB), `RATE_LIMIT_PER_MIN` (default 10).

## Assets

- `public/model/yamnet.tflite` and `public/model/yamnet_class_map.csv` — the model and its class names, hosted ourselves (no third-party runtime calls).
- `public/wasm/` — MediaPipe's WASM runtime, copied out of `node_modules` by `scripts/copy-wasm.mjs` (runs on `npm install` via `postinstall`).
- `public/worklet/capture-processor.js` — AudioWorklet that buffers mic samples into overlapping windows in memory only.

See [instructions/instructions_v2.2.md](instructions/instructions_v2.2.md) for the full product brief.

## Sample test rig (internal, non-commercial only)

Tap **Run sample test** to play 13 fixed ESC-50 clips through the **same AudioWorklet,
YAMNet, CLAP, period detector and labelling rules** as microphone capture. No microphone
permission is requested. The graph opens automatically with sample names, relative
levels, model scores, current top-five predictions, progress, stop and JSON export.
Headphones are recommended; playback is audible but the input is wired digitally,
not re-recorded from the speakers. Keep the tab in the foreground.

The checked-in fixtures are selected reproducibly from a pinned ESC-50 revision.
To restore them: `npm run fetch-test-audio`. The manifest, metadata and full upstream
licence/individual credits are in [public/test-audio/](public/test-audio/).
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
